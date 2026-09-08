const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createB2BOutreachRouter } = require("../routes/b2bOutreachRoutes");
const { createController } = require("../public/js/b2b-outreach-dashboard");

const ID = "64b000000000000000000010";
const OTHER_ID = "64b000000000000000000011";

async function withServer(run) {
  const contact = { _id: ID, decisionMakerName: "Old Name", companyName: "Old Hotel", role: "Manager", businessEmail: "old@example.com", normalizedEmail: "old@example.com", phone: "1", officialWebsite: "https://old.example/", segment: "HOTELS", bestBlackEagleOffer: "Waiters", sourceUrl: "https://source.example/", notes: "Keep note", mailHistory: [{ id: "mail-1" }], opportunityIds: ["opp-1"], quoteIds: ["quote-1"], outreachStatus: "SENT", lastEmailSentAt: new Date("2026-09-01T09:00:00.000Z"), senderMailbox: "sales@example.com", optOut: true, doNotContact: true, bounceStatus: "HARD_BOUNCE", recordVersion: 4 };
  const other = { _id: OTHER_ID, normalizedEmail: "used@example.com" };
  let writes = 0, creates = 0;
  const contacts = {
    async findOne(query) {
      if (query.normalizedEmail) return query.normalizedEmail === other.normalizedEmail ? other : null;
      return String(query._id) === ID ? contact : null;
    },
    async updateOne(query, update) { assert.equal(String(query._id), ID); Object.assign(contact, update.$set); contact.recordVersion += update.$inc.recordVersion; writes++; return { matchedCount: 1 }; },
    async insertOne() { creates++; throw new Error("must not create"); },
  };
  const app = express(); app.use(express.json()); app.use(createB2BOutreachRouter({ requireAdminAuth(req, res, next) { const role = req.headers["x-role"]; if (!role) return res.sendStatus(401); req.adminUser = { _id: "admin-1", role }; next(); }, getContactsCollection: () => contacts, getRequestsCollection() { throw new Error("unused"); }, triggerJob: async () => { throw new Error("unused"); }, now: () => new Date("2026-09-08T12:00:00.000Z"), logger: { error() {} } }));
  const server = app.listen(0); await new Promise((resolve) => server.once("listening", resolve));
  try { await run({ base: `http://127.0.0.1:${server.address().port}`, contact, stats: () => ({ writes, creates }) }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("existing contact updates by ID without creating or removing related history", () => withServer(async ({ base, contact, stats }) => {
  const response = await fetch(`${base}/admin/b2b-outreach/contacts/${ID}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-role": "SUPERADMIN" }, body: JSON.stringify({ companyName: "New Hotel", businessEmail: " NEW@EXAMPLE.COM ", notes: "Updated note" }) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data._id, ID); assert.equal(contact.companyName, "New Hotel"); assert.equal(contact.businessEmail, "new@example.com"); assert.equal(contact.normalizedEmail, "new@example.com"); assert.deepEqual(contact.mailHistory, [{ id: "mail-1" }]); assert.deepEqual(contact.opportunityIds, ["opp-1"]); assert.deepEqual(contact.quoteIds, ["quote-1"]); assert.equal(contact.outreachStatus, "SENT"); assert.equal(contact.lastEmailSentAt.toISOString(), "2026-09-01T09:00:00.000Z"); assert.equal(contact.senderMailbox, "sales@example.com"); assert.equal(contact.optOut, true); assert.equal(contact.doNotContact, true); assert.equal(contact.bounceStatus, "HARD_BOUNCE"); assert.deepEqual(stats(), { writes: 1, creates: 0 });
}));

test("duplicate normalized email rejects update and preserves the old record", () => withServer(async ({ base, contact, stats }) => {
  const response = await fetch(`${base}/admin/b2b-outreach/contacts/${ID}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-role": "SUPERADMIN" }, body: JSON.stringify({ businessEmail: " USED@EXAMPLE.COM " }) });
  const body = await response.json(); assert.equal(response.status, 409); assert.equal(body.code, "B2B_CONTACT_EMAIL_DUPLICATE"); assert.equal(contact.businessEmail, "old@example.com"); assert.deepEqual(stats(), { writes: 0, creates: 0 });
}));

test("contact edit preserves existing SUPERADMIN authorization", () => withServer(async ({ base, contact, stats }) => {
  const response = await fetch(`${base}/admin/b2b-outreach/contacts/${ID}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-role": "ADMIN" }, body: JSON.stringify({ companyName: "Blocked" }) });
  const body = await response.json(); assert.equal(response.status, 403); assert.equal(body.code, "SUPERADMIN_REQUIRED"); assert.equal(contact.companyName, "Old Hotel"); assert.deepEqual(stats(), { writes: 0, creates: 0 });
}));

function element() { return { children: [], value: "", textContent: "", disabled: false, checked: false, indeterminate: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(name, handler) { this[name] = handler; }, setAttribute() {}, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, insertRow() { const row = element(); this.children.push(row); return row; }, insertCell() { return this.insertRow(); } }; }

test("editor prefills, Save refreshes the row, and Cancel performs no request", async () => {
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= element(); } });
  const before = { _id: ID, decisionMakerName: "Ada", companyName: "Old Hotel", businessEmail: "ada@example.com", segment: "HOTELS" }, after = { ...before, companyName: "New Hotel" };
  let patches = 0, lists = 0;
  const controller = createController({ actorRole: "SUPERADMIN", documentRef: { getElementById: (id) => elements[id], createElement: element }, windowRef: { innerWidth: 1200, innerHeight: 800, addEventListener() {} }, showMessage() {}, authFetch: async (url, options) => { patches++; assert.equal(url, `/api/admin/b2b-outreach/contacts/${ID}`); assert.equal(options.method, "PATCH"); return { ok: true, json: async () => ({ ok: true, data: after }) }; }, operationOverride: async (name) => { assert.equal(name, "LIST_CONTACTS"); lists++; return { items: [after], total: 1, selectedCount: 0, eligibleCount: 0 }; } });
  controller.openContactEditor(before); assert.equal(elements.b2bEditCompanyName.value, "Old Hotel"); assert.equal(elements.b2bEditBusinessEmail.value, "ada@example.com"); controller.closeContactEditor(); assert.equal(patches, 0);
  controller.openContactEditor(before); elements.b2bEditCompanyName.value = "New Hotel"; await controller.saveContact(); assert.equal(patches, 1); assert.equal(lists, 1); assert.equal(elements.b2bContactsTable.children[0].children[2].textContent, "New Hotel");
});
