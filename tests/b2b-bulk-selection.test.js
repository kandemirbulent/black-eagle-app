const test = require("node:test");
const assert = require("node:assert/strict");
const { createController } = require("../public/js/b2b-outreach-dashboard");

function contact(id, overrides = {}) { return { _id: id, recordVersion: 1, companyName: `Company ${id}`, selectedAt: null, optOut: false, doNotContact: false, bounceStatus: "", ...overrides }; }
function element() { return { textContent: "", disabled: false, checked: false, indeterminate: false, value: "", replaceChildren() {}, addEventListener() {}, appendChild() {}, append() {}, insertCell() { return element(); }, insertRow() { return element(); } }; }
function harness(items) {
  const calls = [];
  const elements = new Proxy({}, { get(target, key) { if (!target[key]) target[key] = element(); return target[key]; } });
  const operations = async (name, payload) => {
    calls.push({ name, payload });
    if (name === "LIST_CONTACTS") return { items, total: items.length, selectedCount: items.filter((item) => item.selectedAt).length };
    if (name === "SELECT_CONTACT") { const item = items.find((entry) => entry._id === payload.contactId); item.selectedAt = new Date(); return item; }
    if (name === "DESELECT_CONTACT") { const item = items.find((entry) => entry._id === payload.contactId); item.selectedAt = null; return item; }
    if (name === "BULK_SELECT_CONTACTS") { items.filter((item) => !item.optOut && !item.doNotContact && !["HARD_BOUNCE", "BLOCKED", "INVALID"].includes(item.bounceStatus)).forEach((item) => { item.selectedAt = new Date(); }); return { selected: 2, unavailable: 1, selectedCount: 2 }; }
    if (name === "CLEAR_CONTACT_SELECTION") { items.forEach((item) => { item.selectedAt = null; }); return { selectedCount: 0 }; }
  };
  const controller = createController({ authFetch: async () => {}, showMessage() {}, documentRef: { getElementById: (id) => elements[id], createElement: () => element() }, operationOverride: operations });
  controller.state.contacts = items;
  return { controller, calls, elements };
}

test("current page selects and deselects eligible contacts but never blocked contacts", async () => {
  const items = [contact("1"), contact("2"), contact("3", { optOut: true })];
  const { controller, calls } = harness(items);
  await controller.selectCurrentPage(true);
  assert.deepEqual(calls.filter((call) => call.name === "SELECT_CONTACT").map((call) => call.payload.contactId), ["1", "2"]);
  assert.equal(items[2].selectedAt, null);
  await controller.selectCurrentPage(false);
  assert.deepEqual(calls.filter((call) => call.name === "DESELECT_CONTACT").map((call) => call.payload.contactId), ["1", "2"]);
});

test("select all results passes active filters, persists count, and triggers no send", async () => {
  const items = [contact("1"), contact("2"), contact("3", { bounceStatus: "HARD_BOUNCE" })];
  const { controller, calls, elements } = harness(items);
  elements.b2bSearch.value = "Hotel"; elements.b2bSegment.value = "HOTELS";
  await controller.selectAllResults();
  const bulk = calls.find((call) => call.name === "BULK_SELECT_CONTACTS");
  assert.equal(bulk.payload.search, "Hotel"); assert.equal(bulk.payload.segment, "HOTELS");
  assert.equal(controller.state.selectedCount, 2); assert.match(elements.b2bSelectedCount.textContent, /2 contacts selected.*1 unavailable/);
  assert.equal(calls.some((call) => call.name === "SEND_APPROVED"), false);
});

test("clear selection persists through reload and reports zero selected", async () => {
  const items = [contact("1", { selectedAt: new Date() }), contact("2", { selectedAt: new Date() })];
  const { controller, calls, elements } = harness(items);
  await controller.clearSelection();
  assert.equal(calls.some((call) => call.name === "CLEAR_CONTACT_SELECTION"), true);
  assert.equal(controller.state.selectedCount, 0); assert.equal(elements.b2bSelectedCount.textContent, "0 contacts selected");
});
