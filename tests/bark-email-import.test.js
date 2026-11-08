const test = require("node:test");
const assert = require("node:assert/strict");
const { importBarkBundle, validateBundle } = require("../services/barkEmailImport");
const { opportunitySelectionPolicy } = require("../routes/salesAgentRoutes");
const now = new Date("2027-01-03T12:00:00Z");
const admin = { _id: "64b000000000000000000001", role: "admin" };
const record = (key, overrides = {}) => ({ messageKey:key.repeat(64), sentAt:"2027-01-02T10:00:00Z", prx:"12345678", eventDate:"2027-06-05", serviceType:"Bartending", staffBreakdown:[{role:"Bartender",quantity:2}], labourSubtotal:300, ...overrides });
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
test("baseline creates no opportunities; only later messages become quarantined candidates", async()=>{
  const m=memory();const base=await importBarkBundle({...m,bundle:bundle("BASELINE",[record("a")]),admin,now});
  assert.equal(base.baseline,1);assert.equal(m.rows("salesagentopportunityresults").length,0);
  const next=await importBarkBundle({...m,bundle:bundle("INCREMENTAL",[record("b",{prx:"87654321",sentAt:"2027-01-03T10:00:00Z"})],now.toISOString()),admin,now});
  assert.equal(next.imported,1);assert.equal(m.rows("salesagentopportunityresults")[0].manualSubmissionEligible,false);
  assert.equal(m.rows("barkmailcheckpoints")[0].mailboxScanComplete,false);
});
test("Message-ID hash dedup, baseline reminders, delayed mail and expired events cannot create duplicate/new quotes", async()=>{
  const m=memory();await importBarkBundle({...m,bundle:bundle("BASELINE",[record("a")]),admin,now});
  const r=await importBarkBundle({...m,admin,now,bundle:bundle("INCREMENTAL",[
    record("a"),record("b",{sentAt:"2027-01-03T10:00:00Z"}),
    record("c",{prx:"11"}),record("d",{prx:"22",sentAt:"2027-01-03T10:00:00Z",eventDate:"2026-01-01"})],now.toISOString())});
  assert.equal(r.duplicates,1);assert.equal(r.historical,2);assert.equal(r.expired,1);assert.equal(r.imported,0);
});
test("new reminders update candidate source and invalidate selection, preserving edited price", async()=>{
  const m=memory();await importBarkBundle({...m,bundle:bundle("BASELINE",[record("a")]),admin,now});
  const one=record("b",{prx:"9",sentAt:"2027-01-03T10:00:00Z"});
  await importBarkBundle({...m,bundle:bundle("INCREMENTAL",[one],now.toISOString()),admin,now});
  m.rows("salesagentopportunityresults")[0].finalPrice=777;
  const r=await importBarkBundle({...m,bundle:bundle("INCREMENTAL",[{...one,messageKey:"c".repeat(64)}],now.toISOString()),admin,now});
  assert.equal(r.updated,1);const saved=m.rows("salesagentopportunityresults")[0];assert.equal(saved.finalPrice,777);assert.equal(saved.recordVersion,2);assert.equal(saved.selectedVersion,null);
});
test("incomplete or failed import never advances checkpoint or partially writes",async()=>{
  const m=memory();await assert.rejects(importBarkBundle({...m,bundle:bundle("INCREMENTAL",[record("a")]),admin,now}),/BASELINE_REQUIRED/);
  assert.throws(()=>validateBundle({...bundle("BASELINE",[record("a")]),complete:false},now),/COMPLETE_IMPORT/);
  const failing={...m,db:{collection(name){const c=m.db.collection(name);if(name==="barkmailmessages")c.insertOne=async()=>{throw Error("failure");};return c;}}};
  await assert.rejects(importBarkBundle({...failing,bundle:bundle("BASELINE",[record("a")]),admin,now}),/failure/);
  assert.equal(m.rows("barkmailcheckpoints").length,0);assert.equal(m.rows("salesagentruns").length,0);
});
test("Bark allows versioned preview selection but never actual submission, even after edits",()=>{
  const policy=opportunitySelectionPolicy({platform:"bark",recordVersion:1,resultStatus:"MANUAL_REVIEW",finalPrice:999});
  assert.equal(policy.manualSelectionEligible,true);assert.equal(policy.submissionEligible,false);assert.equal(policy.submissionBlocker,"BARK_SUBMISSION_NOT_SUPPORTED");
  assert.equal(opportunitySelectionPolicy({platform:"bark",recordVersion:1,resultStatus:"SENT"}).manualSelectionEligible,false);
});
