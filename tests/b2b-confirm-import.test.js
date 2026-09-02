const test = require("node:test");
const assert = require("node:assert/strict");
const { createController } = require("../public/js/b2b-outreach-dashboard");

function element() { return { disabled: true, className: "", textContent: "" }; }
function classList(initial = []) { const values = new Set(initial); return { add: (value) => values.add(value), remove: (value) => values.delete(value), contains: (value) => values.has(value) }; }
function harness(authFetch, { refreshAfterImport = async () => {}, sleep = async () => {} } = {}) {
  const elements = { b2bConfirmImport: element(), b2bImportStatus: element(), b2bJobStatus: element(), b2bImportModal: { classList: classList() } };
  elements.b2bConfirmImport.textContent = "Confirm Import";
  const controller = createController({ authFetch, showMessage() {}, documentRef: { getElementById: (id) => elements[id] }, refreshAfterImport, sleep });
  controller.state.importBatchId = "batch-real-123";
  elements.b2bConfirmImport.disabled = false;
  return { controller, elements };
}

test("success shows loading, refreshes contacts and auto-closes the modal", async () => {
  let call;
  let refreshed = 0;
  let signalRefresh;
  const refreshStarted = new Promise((resolve) => { signalRefresh = resolve; });
  let release;
  const closingDelay = new Promise((resolve) => { release = resolve; });
  const { controller, elements } = harness(async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => ({ ok: true, data: { completed: true, result: { imported: 8, skippedDuplicates: 2, reviewRequired: 3, invalid: 1 } } }) };
  }, { refreshAfterImport: async () => { refreshed += 1; signalRefresh(); }, sleep: async () => closingDelay });
  const confirming = controller.confirmImport();
  assert.equal(elements.b2bConfirmImport.disabled, true);
  assert.equal(elements.b2bConfirmImport.textContent, "Importing...");
  await refreshStarted;
  assert.equal(refreshed, 1);
  assert.equal(elements.b2bImportModal.classList.contains("hidden"), false);
  assert.match(elements.b2bImportStatus.textContent, /Imported: 8.*Skipped duplicates: 2.*Review required: 3.*Invalid: 1/);
  release();
  await confirming;
  assert.equal(call.url, "/api/admin/b2b-outreach/import/confirm");
  assert.equal(call.options.method, "POST");
  assert.deepEqual(JSON.parse(call.options.body), { batchId: "batch-real-123" });
  assert.equal(elements.b2bImportModal.classList.contains("hidden"), true);
  assert.equal(elements.b2bJobStatus.textContent, "Import completed successfully.");
  assert.equal(controller.state.importBatchId, "");
  assert.equal(elements.b2bConfirmImport.disabled, true);
  assert.equal(elements.b2bConfirmImport.textContent, "Confirm Import");
});

test("failed confirm shows a modal error and allows a retry", async () => {
  const { controller, elements } = harness(async () => ({ ok: false, json: async () => ({ ok: false, message: "Preview batch expired." }) }));
  await controller.confirmImport();
  assert.equal(elements.b2bImportStatus.textContent, "Import failed: Preview batch expired.");
  assert.match(elements.b2bImportStatus.className, /error/);
  assert.equal(elements.b2bImportModal.classList.contains("hidden"), false);
  assert.equal(elements.b2bConfirmImport.disabled, false);
  assert.equal(elements.b2bConfirmImport.textContent, "Confirm Import");
});

test("double click cannot submit the same batch twice", async () => {
  let resolveResponse;
  let calls = 0;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const { controller, elements } = harness(async () => { calls += 1; return response; });
  const first = controller.confirmImport();
  const second = controller.confirmImport();
  assert.equal(calls, 1);
  assert.equal(elements.b2bConfirmImport.disabled, true);
  assert.equal(elements.b2bImportStatus.textContent, "Confirming import...");
  resolveResponse({ ok: true, json: async () => ({ ok: true, data: { completed: true, result: {} } }) });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
