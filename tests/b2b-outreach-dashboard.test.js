const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Types: { ObjectId } } = require("mongoose");
const { createB2BOutreachRouter } = require("../routes/b2bOutreachRoutes");
const { canonicalRequest, signRequest, buildSignedRequest } = require("../services/b2bOutreachIntegration");
const { B2B_OUTREACH_WORKER_COMMAND, createRenderSalesAgentTrigger } = require("../services/salesAgentJobTrigger");
const dashboard = require("../public/js/b2b-outreach-dashboard.js");

function collectionHarness() {
  const documents = [];
  return {
    documents,
    collection: {
      async insertOne(document) { const stored = { ...document, _id: new ObjectId() }; documents.push(stored); return { insertedId: stored._id }; },
      async updateOne(filter, update) { const found = documents.find((item) => String(item._id) === String(filter._id) && (!filter.status || item.status === filter.status)); if (found) Object.assign(found, update.$set || {}); return { matchedCount: found ? 1 : 0 }; },
      async findOne(filter) { return documents.find((item) => {
        if (filter._id && String(item._id) !== String(filter._id)) return false;
        if (filter.actorId && item.actorId !== filter.actorId) return false;
        if (filter.operation?.$in && !filter.operation.$in.includes(item.operation)) return false;
        if (typeof filter.operation === "string" && item.operation !== filter.operation) return false;
        if (filter.requestFingerprint && item.requestFingerprint !== filter.requestFingerprint) return false;
        if (filter.status?.$in && !filter.status.$in.includes(item.status)) return false;
        if (filter.createdAt?.$gte && new Date(item.createdAt) < filter.createdAt.$gte) return false;
        return true;
      }) || null; },
    },
  };
}

async function withServer(run, { authenticated = true } = {}) {
  const state = collectionHarness();
  const triggerCalls = [];
  const app = express(); app.use(express.json());
  app.use("/api", createB2BOutreachRouter({
    requireAdminAuth(req, res, next) { if (!authenticated) return res.status(401).json({ ok: false }); req.adminUser = { _id: "64b000000000000000000001" }; next(); },
    getRequestsCollection: () => state.collection,
    triggerJob: async (input) => { triggerCalls.push(input); return { jobId: "job-1" }; },
    env: { B2B_OUTREACH_INTERNAL_API_KEY: "shared-test-secret" },
    now: () => new Date("2026-09-02T12:00:00.000Z"),
    logger: { error() {} },
  }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  try { await run({ base: `http://127.0.0.1:${server.address().port}`, state, triggerCalls }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("unauthenticated users cannot create B2B dashboard requests", () => withServer(async ({ base, state }) => {
  const response = await fetch(`${base}/api/admin/b2b-outreach/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "LIST_CONTACTS", payload: {} }) });
  assert.equal(response.status, 401); assert.equal(state.documents.length, 0);
}, { authenticated: false }));

test("canonical HMAC field order matches the Sales Agent contract and nonce is unique", () => {
  const input = { operation: "LIST_CONTACTS", payload: { page: 1 }, actorId: "admin-1", requestedAt: "2026-09-02T12:00:00.000Z", nonce: "nonce-1" };
  assert.equal(canonicalRequest(input), '{"operation":"LIST_CONTACTS","payload":{"page":1},"actorId":"admin-1","requestedAt":"2026-09-02T12:00:00.000Z","nonce":"nonce-1"}');
  assert.match(signRequest(input, "secret"), /^[a-f\d]{64}$/);
  const options = { operation: "LIST_CONTACTS", actorId: "admin-1", secret: "secret", now: () => new Date("2026-09-02T12:00:00.000Z") };
  assert.notEqual(buildSignedRequest(options).nonce, buildSignedRequest(options).nonce);
});

test("dashboard adapter creates signed LIST/SELECT/GENERATE/UPDATE/APPROVE requests and triggers the B2B job", () => withServer(async ({ base, state, triggerCalls }) => {
  const cases = [
    ["LIST_CONTACTS", { page: 2, search: "Hotel" }],
    ["SELECT_CONTACT", { contactId: "64b000000000000000000010", expectedVersion: 1 }],
    ["GENERATE_DRAFT", { contactId: "64b000000000000000000010" }],
    ["UPDATE_DRAFT", { draftId: "64b000000000000000000020", subject: "Edited", body: "Edited body" }],
    ["APPROVE_DRAFT", { draftId: "64b000000000000000000020" }],
  ];
  for (const [operation, payload] of cases) {
    const response = await fetch(`${base}/api/admin/b2b-outreach/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, payload }) });
    assert.equal(response.status, 202);
  }
  assert.deepEqual(state.documents.map((item) => item.operation), cases.map(([operation]) => operation));
  assert.deepEqual(state.documents[3].payload, cases[3][1]);
  assert.ok(state.documents.every((item) => item.actorId === "64b000000000000000000001" && /^[a-f\d]{64}$/.test(item.signature)));
  assert.ok(triggerCalls.every((call) => call.startCommand === B2B_OUTREACH_WORKER_COMMAND && /^[a-f\d]{24}$/.test(call.b2bRequestId)));
}));

test("missing shared secret fails closed before Mongo insert or Render trigger", async () => {
  const state = collectionHarness(); let triggers = 0;
  const app = express(); app.use(express.json()); app.use("/api", createB2BOutreachRouter({ requireAdminAuth(req, _res, next) { req.adminUser = { _id: "admin-1" }; next(); }, getRequestsCollection: () => state.collection, triggerJob: async () => { triggers += 1; }, env: {}, logger: { error() {} } }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  try { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/b2b-outreach/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "LIST_CONTACTS" }) }); assert.equal(response.status, 503); assert.equal((await response.json()).code, "B2B_AUTH_NOT_CONFIGURED"); assert.equal(state.documents.length, 0); assert.equal(triggers, 0); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});

test("Render B2B one-off job receives only a validated request ID environment assignment", async () => {
  let requestBody;
  const trigger = createRenderSalesAgentTrigger({ env: { RENDER_API_KEY: "render-secret", RENDER_SALES_AGENT_SERVICE_ID: "srv-1" }, fetchFn: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, status: 201, statusText: "Created", text: async () => JSON.stringify({ id: "job-b2b" }) }; } });
  await trigger({ startCommand: B2B_OUTREACH_WORKER_COMMAND, b2bRequestId: "64b000000000000000000099" });
  assert.deepEqual(requestBody, { startCommand: "B2B_OUTREACH_REQUEST_ID=64b000000000000000000099 npm run b2b:request" });
  await assert.rejects(trigger({ startCommand: B2B_OUTREACH_WORKER_COMMAND, b2bRequestId: "unsafe value" }), (error) => error.code === "B2B_REQUEST_ID_INVALID");
});

test("research enqueue returns immediately and duplicate active request triggers Render once", () => withServer(async ({ base, state, triggerCalls }) => {
  const body = { operation: "RESEARCH_BATCH", payload: { contactIds: ["64b000000000000000000011", "64b000000000000000000012"] } };
  const first = await fetch(`${base}/api/admin/b2b-outreach/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const second = await fetch(`${base}/api/admin/b2b-outreach/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, payload: { contactIds: [...body.payload.contactIds].reverse() } }) });
  assert.equal(first.status, 202); assert.equal((await first.json()).data.status, "QUEUED");
  const duplicate = (await second.json()).data; assert.equal(duplicate.status, "ALREADY_QUEUED"); assert.equal(duplicate.duplicate, true);
  assert.equal(state.documents.length, 1); assert.equal(triggerCalls.length, 1);
}));

test("dashboard research action does not poll a long-running request", async () => {
  const statusElement = { className: "", textContent: "" }, calls = [];
  const controller = dashboard.createController({ authFetch: async (url) => { calls.push(url); return { ok: true, json: async () => ({ ok: true, data: { requestId: "64b000000000000000000099", status: "QUEUED" } }) }; }, showMessage() {}, documentRef: { getElementById: (id) => id === "b2bJobStatus" ? statusElement : null } });
  const queued = await controller.queueResearch({ contactIds: ["one", "two"] });
  assert.equal(queued.status, "QUEUED"); assert.deepEqual(calls, ["/api/admin/b2b-outreach/operations"]); assert.equal(statusElement.textContent, "Research queued for 2 prospects.");
});

test("Research All queues the server-side active set rather than current-page IDs", async () => {
  const calls = [], statusElement = { className: "", textContent: "" };
  const controller = dashboard.createController({ authFetch: async () => {}, showMessage() {}, actorRole: "SUPERADMIN", documentRef: { getElementById: (id) => id === "b2bJobStatus" ? statusElement : null }, operationOverride: async (name, payload) => { calls.push({ name, payload }); return { requestId: "request-1", status: "QUEUED", totalProspects: 582 }; } });
  await controller.researchAll();
  assert.deepEqual(calls, [{ name: "RESEARCH_BATCH", payload: { recordView: "ACTIVE" } }]); assert.equal(statusElement.textContent, "Research queued for 582 prospects.");
});

test("research progress renders terminal state, refreshes contacts and stops polling", async () => {
  const timers = [], elements = new Proxy({}, { get(target, key) { if (!target[key]) target[key] = { textContent: "", className: "", disabled: false, checked: false, indeterminate: false, value: "", replaceChildren() {}, insertRow() { return { insertCell() { return {}; } }; } }; return target[key]; } });
  let requestReads = 0, listReads = 0;
  const controller = dashboard.createController({ authFetch: async (url) => ({ ok: true, json: async () => ({ ok: true, data: url.endsWith("/research/active") ? { requestId: "request-1", status: "RUNNING", processedProspects: 10, totalProspects: 25, contactsFound: 3 } : { requestId: "request-1", status: "COMPLETED", processedProspects: 25, totalProspects: 25, contactsFound: 8, noContactFound: 15, researchRequired: 2, failed: 0 } }) }), showMessage() {}, actorRole: "SUPERADMIN", documentRef: { getElementById: (id) => elements[id] }, windowRef: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} }, operationOverride: async (name) => { if (name === "LIST_CONTACTS") { listReads++; return { items: [], total: 0 }; } } });
  await controller.recoverResearchTracking(); assert.match(elements.b2bJobStatus.textContent, /10 \/ 25 processed/); assert.equal(timers.length, 1);
  requestReads++; await timers.shift()(); assert.match(elements.b2bJobStatus.textContent, /Research completed.*25 \/ 25.*8 contacts found.*15 no contact/); assert.equal(listReads, 1); assert.equal(controller.state.activeResearchRequestId, ""); assert.equal(timers.length, 0); assert.equal(requestReads, 1);
});

test("SEND_APPROVED disabled is never presented as SENT", async () => {
  const statusElement = { className: "", textContent: "" };
  const documentRef = { getElementById: (id) => id === "b2bJobStatus" ? statusElement : null };
  let calls = 0;
  const authFetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => ({ ok: true, data: { requestId: "64b000000000000000000099" } }) };
    return { ok: true, json: async () => ({ ok: true, data: { status: "FAILED", response: { ok: false, code: "B2B_OUTREACH_SEND_DISABLED", message: "B2B_OUTREACH_SEND_DISABLED" } } }) };
  };
  const controller = dashboard.createController({ authFetch, showMessage() {}, documentRef, sleep: async () => {}, pollIntervalMs: 0 });
  controller.state.draft = { _id: "64b000000000000000000020", approved: true };
  await controller.sendApproved();
  assert.equal(statusElement.textContent, "Email sending is not enabled yet.");
  assert.doesNotMatch(statusElement.textContent, /sent successfully/i);
});

test("browser bundle does not contain the shared secret environment name or signing implementation", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/b2b-outreach-dashboard.js"), "utf8");
  assert.doesNotMatch(source, /B2B_OUTREACH_INTERNAL_API_KEY|createHmac|shared-test-secret/);
});
