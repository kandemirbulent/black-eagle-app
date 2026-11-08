const test = require("node:test");
const assert = require("node:assert/strict");
const { importBarkBundle, validateBundle } = require("../services/barkEmailImport");
const { opportunitySelectionPolicy } = require("../routes/salesAgentRoutes");
const now = new Date("2027-01-03T12:00:00Z");
const admin = { _id: "64b000000000000000000001", role: "admin" };
const record = (key, overrides = {}) => ({ messageKey:key.repeat(64), sentAt:"2027-01-02T10:00:00Z", notificationType:"REQUEST", prx:"12345678", eventDate:"2027-06-05", serviceType:"Bartending", staffBreakdown:[{role:"Bartender",quantity:2}], labourSubtotal:300, ...overrides });
const bundle = (mode, records, startedAt="2027-01-02T12:00:00Z") => ({format:"bark-email-import-v1",complete:true,mode,startedAt,records});
function memory() {
  let data = {};
  const clone = value => JSON.parse(JSON.stringify(value));
  const matches = (r,f) => Object.entries(f).every(([k,v])=>String(r[k])===String(v));
  const db = { collection(name) { data[name] ||= []; return {
    async findOne(f) { return data[name].find(r=>matches(r,f)) || null; },
    async insertOne(r) { if(data[name].some(x=>String(x._id)===String(r._id))) throw Error("duplicate"); data[name].push(clone(r)); },
    async countDocuments(f) { return data[name].filter(r=>matches(r,f)).length; },
    async updateOne(f,u,o={}) { let r=data[name].find(x=>matches(x,f));if(!r&&o.upsert){r={...f};data[name].push(r);}if(!r)return;Object.assign(r,clone(u.$set||{}));for(const[k,v]of Object.entries(u.$inc||{}))r[k]=(r[k]||0)+v; }
  }; } };
  const session = { async withTransaction(fn) {const before=clone(data);try{await fn();}catch(e){data=before;throw e;}} };
  return { db, session, rows:name=>data[name]||[] };
}
test("initial import includes existing future enquiries and checkpoint covers only the uploaded batch", async()=>{
  const m=memory();const base=await importBarkBundle({...m,bundle:bundle("INITIAL",[record("a")]),admin,now});
  assert.equal(base.imported,1);assert.equal(m.rows("salesagentopportunityresults").length,1);
  const next=await importBarkBundle({...m,bundle:bundle("INCREMENTAL",[record("b",{prx:"87654321",sentAt:"2027-01-03T10:00:00Z"})],now.toISOString()),admin,now});
  assert.equal(next.imported,1);assert.equal(m.rows("salesagentopportunityresults")[0].manualSubmissionEligible,false);
  assert.equal(m.rows("barkmailcheckpoints")[0].mailboxScanComplete,false);
});
test("Message-ID dedup and prx candidate grouping allow delayed unseen mail but exclude past events", async()=>{
  const m=memory();await importBarkBundle({...m,bundle:bundle("INITIAL",[record("a")]),admin,now});
  const r=await importBarkBundle({...m,admin,now,bundle:bundle("INCREMENTAL",[
    record("a"),record("b",{sentAt:"2027-01-03T10:00:00Z"}),
    record("c",{prx:"11"}),record("d",{prx:"22",sentAt:"2027-01-03T10:00:00Z",eventDate:"2026-01-01"})],now.toISOString())});
  assert.equal(r.duplicates,1);assert.equal(r.updated,1);assert.equal(r.expired,1);assert.equal(r.imported,1);
  assert.equal(m.rows("salesagentopportunityresults").length,2);
});
test("new reminders update candidate source and invalidate selection, preserving edited price", async()=>{
  const m=memory();await importBarkBundle({...m,bundle:bundle("INITIAL",[record("a")]),admin,now});
  const one=record("b",{prx:"9",sentAt:"2027-01-03T10:00:00Z"});
  await importBarkBundle({...m,bundle:bundle("INCREMENTAL",[one],now.toISOString()),admin,now});
  m.rows("salesagentopportunityresults")[1].finalPrice=777;
  const r=await importBarkBundle({...m,bundle:bundle("INCREMENTAL",[{...one,messageKey:"c".repeat(64),sentAt:"2027-01-03T11:00:00Z"}],now.toISOString()),admin,now});
  assert.equal(r.updated,1);const saved=m.rows("salesagentopportunityresults")[1];assert.equal(saved.finalPrice,777);assert.equal(saved.recordVersion,2);assert.equal(saved.selectedVersion,null);
});
test("incomplete or failed import never advances checkpoint or partially writes",async()=>{
  const m=memory();await assert.rejects(importBarkBundle({...m,bundle:bundle("INCREMENTAL",[record("a")]),admin,now}),/INITIAL_IMPORT_REQUIRED/);
  assert.throws(()=>validateBundle({...bundle("INITIAL",[record("a")]),complete:false},now),/COMPLETE_IMPORT/);
  const failing={...m,db:{collection(name){const c=m.db.collection(name);if(name==="barkmailmessages")c.insertOne=async()=>{throw Error("failure");};return c;}}};
  await assert.rejects(importBarkBundle({...failing,bundle:bundle("INITIAL",[record("a")]),admin,now}),/failure/);
  assert.equal(m.rows("barkmailcheckpoints").length,0);assert.equal(m.rows("salesagentruns").length,0);
  assert.equal(m.rows("salesagentopportunityresults").length,0);
});
test("today and missing dates are retained, promotions and expired events are not opportunities",async()=>{
  const m=memory();const r=await importBarkBundle({...m,admin,now,bundle:bundle("INITIAL",[
    record("a",{eventDate:"2027-01-03"}),record("b",{prx:"2",eventDate:null}),
    record("c",{prx:"3",eventDate:"2027-01-02"}),record("d",{prx:null,notificationType:"NON_REQUEST"})])});
  assert.equal(r.imported,2);assert.equal(r.expired,1);assert.equal(r.ignored,1);
  assert.ok(m.rows("salesagentopportunityresults")[1].blockingReasons.includes("BARK_EVENT_DATE_UNVERIFIED"));
});
test("reupload is idempotent across restart; partial batches never suppress other unseen mail",async()=>{
  const m=memory(),input=bundle("INITIAL",[record("a")]);
  await importBarkBundle({...m,admin,now,bundle:input});
  assert.equal((await importBarkBundle({...m,admin,now,bundle:input})).duplicates,1);
  const later=await importBarkBundle({...m,admin,now,bundle:bundle("INCREMENTAL",[record("b",{prx:"2",sentAt:"2026-12-01T00:00:00Z"})],"2027-01-01T00:00:00Z")});
  assert.equal(later.imported,1);assert.equal(m.rows("barkmailmessages").length,2);
});
test("only uploaded legacy baseline rows recover, once, and unrelated baseline rows stay untouched",async()=>{
  const m=memory();await importBarkBundle({...m,admin,now,bundle:bundle("INITIAL",[record("a")])});
  await m.db.collection("barkmailmessages").insertOne({_id:`proton:${"b".repeat(64)}`,baseline:true,prx:"2"});
  await m.db.collection("barkmailmessages").insertOne({_id:`proton:${"c".repeat(64)}`,baseline:true,prx:"3"});
  const input=bundle("INITIAL",[record("b",{prx:"2"})]);
  const first=await importBarkBundle({...m,admin,now,bundle:input});
  assert.equal(first.recovered,1);assert.equal(first.imported,1);
  assert.equal((await importBarkBundle({...m,admin,now,bundle:input})).duplicates,1);
  assert.equal(m.rows("barkmailmessages").find(r=>r.prx==="3").evaluatedAt,undefined);
  assert.throws(()=>validateBundle(bundle("BASELINE",[record("a")]),now),/REEXPORT_REQUIRED/);
});
test("reviewed/submitted records and older source snapshots are preserved on reminders",async()=>{
  for(const protection of [{lastEditedAt:now.toISOString(),finalPrice:555},{quoteSubmitted:true,resultStatus:"SUBMITTED"},{approvalStatus:"REJECTED"}]){
    const m=memory();await importBarkBundle({...m,admin,now,bundle:bundle("INITIAL",[record("a")])});
    const saved=m.rows("salesagentopportunityresults")[0];Object.assign(saved,protection);const before=JSON.stringify(saved);
    const r=await importBarkBundle({...m,admin,now,bundle:bundle("INCREMENTAL",[record("b",{sentAt:"2027-01-03T11:00:00Z"})],now.toISOString())});
    assert.equal(r.preserved,1);assert.equal(JSON.stringify(saved),before);
  }
});
test("same name with different candidate IDs is not merged; date types remain separate",async()=>{
  const m=memory();await importBarkBundle({...m,admin,now,bundle:bundle("INITIAL",[
    record("a",{customerName:"Synthetic Same Name",receivedAt:"2027-01-02T10:00:10Z"}),
    record("b",{prx:"2",customerName:"Synthetic Same Name",eventDate:"2027-02-30"})])});
  assert.equal(m.rows("salesagentopportunityresults").length,2);
  const source=m.rows("salesagentopportunityresults")[0].barkSource;
  assert.equal(source.notificationSentAt,"2027-01-02T10:00:00.000Z");assert.equal(source.emailReceivedAt,"2027-01-02T10:00:10.000Z");assert.equal(source.requestCreatedAt,null);
  assert.equal(m.rows("salesagentopportunityresults")[1].eventDate,null);
});
test("London calendar preserves today without a time and failed later imports do not advance checkpoint",async()=>{
  const m=memory(),londonNow=new Date("2027-06-05T23:30:00Z");
  const input=bundle("INITIAL",[record("a",{eventDate:"2027-06-06"}),record("b",{prx:"2",eventDate:"2027-06-05"})]);
  const r=await importBarkBundle({...m,admin,now:londonNow,bundle:input});assert.equal(r.imported,1);assert.equal(r.expired,1);
  const before=JSON.stringify(m.rows("barkmailcheckpoints"));
  const failing={...m,db:{collection(name){const c=m.db.collection(name);if(name==="barkmailmessages")c.insertOne=async()=>{throw Error("write failed");};return c;}}};
  await assert.rejects(importBarkBundle({...failing,admin,now:londonNow,bundle:bundle("INCREMENTAL",[record("c",{prx:"3",eventDate:null})])}),/write failed/);
  assert.equal(JSON.stringify(m.rows("barkmailcheckpoints")),before);assert.equal(m.rows("salesagentopportunityresults").length,1);
});
test("Bark allows versioned preview selection but never actual submission, even after edits",()=>{
  const policy=opportunitySelectionPolicy({platform:"bark",recordVersion:1,resultStatus:"MANUAL_REVIEW",finalPrice:999});
  assert.equal(policy.manualSelectionEligible,true);assert.equal(policy.submissionEligible,false);assert.equal(policy.submissionBlocker,"BARK_SUBMISSION_NOT_SUPPORTED");
  assert.equal(opportunitySelectionPolicy({platform:"bark",recordVersion:1,resultStatus:"SENT"}).manualSelectionEligible,false);
});
