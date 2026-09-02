const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const XLSX = require("xlsx");
const { Types: { ObjectId } } = require("mongoose");
const { parseWorkbook, applyDuplicateStatus, summarize, createPreviewBatchStore } = require("../services/b2bProspectImport");
const { createB2BOutreachRouter } = require("../routes/b2bOutreachRoutes");

function workbookBuffer(rows, sheetName = "Prospects") { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName); return XLSX.write(book, { type: "buffer", bookType: "xlsx" }); }
function contacts(existing = []) { return { writes: 0, find() { return { toArray: async () => existing }; }, async insertOne() { this.writes++; } }; }

test("xlsx parsing normalizes supported columns, segments and verification without fabrication", () => {
  const parsed = parseWorkbook(workbookBuffer([
    ["Company / Venue", "Contact Name", "Job Title", "Work Email", "Category", "Verification Status", "Personalization Facts", "URL"],
    ["Real Hotel", "Ada Smith", "Head Chef", "ada@real.example", "Hospitality Hotel", "Verified", "Hosts corporate events", "https://real.example"],
    ["No Email Ltd", "", "", "", "FM", "Unknown", "Unconfirmed note", ""],
    ["Bad Email Ltd", "Ben", "Manager", "not-an-email", "Venue", "Valid", "", ""],
  ]), "prospects.xlsx");
  assert.equal(parsed.selectedSheet, "Prospects");
  assert.equal(parsed.rows[0].contact.segment, "HOTELS"); assert.equal(parsed.rows[0].contact.verificationStatus, "VERIFIED");
  assert.deepEqual(parsed.rows[0].contact.personalisationFacts, [{ fact: "Hosts corporate events", verified: true }]);
  assert.equal(parsed.rows[1].contact.businessEmail, ""); assert.ok(parsed.rows[1].reasons.includes("EMAIL_RESEARCH_REQUIRED")); assert.equal(parsed.rows[1].contact.segment, "FACILITIES_MANAGEMENT");
  assert.equal(parsed.rows[1].contact.personalisationFacts[0].verified, false);
  assert.equal(parsed.rows[2].importStatus, "REVIEW_REQUIRED"); assert.equal(parsed.rows[2].importable, false); assert.ok(parsed.rows[2].reasons.includes("INVALID_EMAIL"));
});

test("duplicate email and person-company rows are skipped in preview without contact mutation", async () => {
  const collection = contacts([{ normalizedEmail: "existing@real.example", normalizedPersonCompany: "other|other ltd" }, { normalizedPersonCompany: "ada smith|real hotel" }]);
  const parsed = parseWorkbook(workbookBuffer([["Company", "Name", "Email"], ["Email Duplicate", "One", "existing@real.example"], ["Real Hotel", "Ada Smith", "new@real.example"], ["Fresh Ltd", "Fresh Person", "fresh@real.example"], ["Fresh Ltd", "Fresh Person", "second@real.example"]]));
  await applyDuplicateStatus(parsed, collection);
  assert.deepEqual(parsed.rows.map((row) => row.importStatus), ["DUPLICATE", "DUPLICATE", "REVIEW_REQUIRED", "DUPLICATE"]);
  assert.equal(collection.writes, 0); assert.deepEqual(summarize(parsed.rows), { totalRows: 4, new: 0, duplicates: 3, reviewRequired: 1, invalid: 0, readyToImport: 1 });
});

function routeHarness({ authenticated = true } = {}) {
  const requestDocuments = [], contactCollection = contacts(), batches = createPreviewBatchStore({ now: () => new Date("2026-09-02T12:00:00Z") });
  const requests = { async insertOne(document) { const stored = { ...document, _id: new ObjectId() }; requestDocuments.push(stored); return { insertedId: stored._id }; }, async updateOne() {}, async findOne() { return null; } };
  const app = express(); app.use(express.json()); app.use("/api", createB2BOutreachRouter({ requireAdminAuth(req, res, next) { if (!authenticated) return res.status(401).json({ ok: false }); req.adminUser = { _id: "admin-1" }; next(); }, getRequestsCollection: () => requests, getContactsCollection: () => contactCollection, triggerJob: async () => ({ jobId: "job-import" }), env: { B2B_OUTREACH_INTERNAL_API_KEY: "secret" }, now: () => new Date("2026-09-02T12:00:00Z"), batchStore: batches, logger: { error() {} } }));
  return { app, requestDocuments, contactCollection, batches };
}
async function withServer(harness, run) { const server = await new Promise((resolve) => { const instance = harness.app.listen(0, () => resolve(instance)); }); try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); } }
async function upload(base, buffer) { const form = new FormData(); form.append("file", new Blob([buffer]), "prospects.xlsx"); return fetch(`${base}/api/admin/b2b-outreach/import/preview`, { method: "POST", body: form }); }

test("unauthenticated import is blocked", () => { const harness = routeHarness({ authenticated: false }); return withServer(harness, async (base) => { const response = await upload(base, workbookBuffer([["Company"], ["Real Ltd"]])); assert.equal(response.status, 401); assert.equal(harness.batches.size(), 0); }); });

test("preview keeps contacts unchanged and confirm queues only importable rows", () => { const harness = routeHarness(); return withServer(harness, async (base) => {
  const previewResponse = await upload(base, workbookBuffer([["Company", "Email", "Verification"], ["Ready Ltd", "ready@real.example", "Verified"], ["Missing Email Ltd", "", "Not Verified"], ["Invalid Ltd", "bad-email", "Verified"], ["", "empty@real.example", "Verified"]]));
  assert.equal(previewResponse.status, 200); const preview = (await previewResponse.json()).data; assert.equal(harness.contactCollection.writes, 0); assert.equal(preview.summary.readyToImport, 2);
  const confirm = await fetch(`${base}/api/admin/b2b-outreach/import/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: preview.batchId }) }); assert.equal(confirm.status, 202);
  assert.equal(harness.requestDocuments.length, 1); assert.equal(harness.requestDocuments[0].operation, "IMPORT_CONTACTS"); assert.equal(harness.requestDocuments[0].payload.contacts.length, 2); assert.equal(harness.contactCollection.writes, 0); assert.equal(harness.batches.size(), 0);
}); });

test("uploads use memory storage so no temporary file remains to clean", () => { const harness = routeHarness(); return withServer(harness, async (base) => { const response = await upload(base, workbookBuffer([["Company"], ["Memory Only Ltd"]])); assert.equal(response.status, 200); assert.equal(Object.prototype.hasOwnProperty.call((await response.json()).data, "path"), false); }); });
