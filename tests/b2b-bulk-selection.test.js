const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createController, selectionBlockedReason } = require("../public/js/b2b-outreach-dashboard");

function contact(id, overrides = {}) { return { _id: id, recordVersion: 1, companyName: `Company ${id}`, decisionMakerName: `Person ${id}`, role: "Manager", businessEmail: `person${id}@real.example`, verificationStatus: "VERIFIED", eligibilityStatus: "SEND_ELIGIBLE", selectedAt: null, optOut: false, doNotContact: false, bounceStatus: "", ...overrides }; }
function classList() { const values = new Set(["hidden"]); return { add: (value) => values.add(value), remove: (value) => values.delete(value), contains: (value) => values.has(value) }; }
function element() { return { textContent: "", disabled: false, checked: false, indeterminate: false, value: "", dataset: {}, style: {}, classList: classList(), replaceChildren() {}, addEventListener() {}, setAttribute(name, value) { this[name] = value; }, appendChild() {}, append() {}, getBoundingClientRect() { return { left: 100, top: 100, right: 124, bottom: 124, width: 24, height: 24 }; }, insertCell() { return element(); }, insertRow() { return element(); } }; }
function harness(items) {
  const calls = [];
  const elements = new Proxy({}, { get(target, key) { if (!target[key]) target[key] = element(); return target[key]; } });
  const operations = async (name, payload) => {
    calls.push({ name, payload });
    const filtered = items.filter((item) => !payload?.segment || item.segment === payload.segment);
    const eligible = filtered.filter((item) => item.eligibilityStatus === "SEND_ELIGIBLE" && !item.optOut && !item.doNotContact && !["HARD_BOUNCE", "BLOCKED", "INVALID"].includes(item.bounceStatus));
    if (name === "LIST_CONTACTS") return { items: filtered, total: filtered.length, selectedCount: items.filter((item) => item.selectedAt).length, eligibleCount: eligible.length, selectedEligibleCount: eligible.filter((item) => item.selectedAt).length };
    if (name === "SELECT_CONTACT") { const item = items.find((entry) => entry._id === payload.contactId); item.selectedAt = new Date(); return item; }
    if (name === "DESELECT_CONTACT") { const item = items.find((entry) => entry._id === payload.contactId); item.selectedAt = null; return item; }
    if (name === "BULK_SELECT_CONTACTS") { const deselect = eligible.length > 0 && eligible.every((item) => item.selectedAt); eligible.forEach((item) => { item.selectedAt = deselect ? null : new Date(); }); return { action: deselect ? "DESELECTED" : "SELECTED", selected: deselect ? 0 : eligible.length, eligibleCount: eligible.length, unavailable: filtered.length - eligible.length, selectedCount: items.filter((item) => item.selectedAt).length }; }
    if (name === "CLEAR_CONTACT_SELECTION") { items.forEach((item) => { item.selectedAt = null; }); return { selectedCount: 0 }; }
  };
  const controller = createController({ authFetch: async () => {}, showMessage() {}, documentRef: { getElementById: (id) => elements[id], createElement: () => element() }, operationOverride: operations });
  controller.state.contacts = items;
  return { controller, calls, elements };
}

test("current page selects and deselects eligible contacts but never blocked contacts", async () => {
  const items = [contact("1"), contact("2"), contact("3", { eligibilityStatus: "PROSPECT_RESEARCH_REQUIRED", decisionMakerName: "", optOut: true })];
  const { controller, calls } = harness(items);
  await controller.selectCurrentPage(true);
  assert.deepEqual(calls.filter((call) => call.name === "SELECT_CONTACT").map((call) => call.payload.contactId), ["1", "2"]);
  assert.equal(items[2].selectedAt, null);
  await controller.selectCurrentPage(false);
  assert.deepEqual(calls.filter((call) => call.name === "DESELECT_CONTACT").map((call) => call.payload.contactId), ["1", "2"]);
});

test("select all results passes active filters, persists count, and triggers no send", async () => {
  const items = [contact("1", { segment: "HOTELS" }), contact("2", { segment: "HOTELS" }), contact("3", { segment: "HOTELS", bounceStatus: "HARD_BOUNCE" }), contact("4", { segment: "CATERING", selectedAt: new Date() })];
  const { controller, calls, elements } = harness(items);
  elements.b2bSearch.value = "Hotel"; elements.b2bSegment.value = "HOTELS";
  await controller.selectAllResults();
  const bulk = calls.find((call) => call.name === "BULK_SELECT_CONTACTS");
  assert.equal(bulk.payload.search, "Hotel"); assert.equal(bulk.payload.segment, "HOTELS");
  assert.equal(controller.state.selectedCount, 3); assert.match(elements.b2bSelectedCount.textContent, /3 contacts selected.*1 unavailable/); assert.equal(elements.b2bSelectAllResults.textContent, "Deselect All Results");
  await controller.selectAllResults();
  assert.equal(items[0].selectedAt, null); assert.equal(items[1].selectedAt, null); assert.ok(items[3].selectedAt); assert.equal(elements.b2bSelectAllResults.textContent, "Select All Results");
  assert.equal(calls.some((call) => call.name === "SEND_APPROVED"), false);
});

test("page checkbox state is checked for all and indeterminate for partial selection", async () => {
  const items = [contact("1", { selectedAt: new Date() }), contact("2", { selectedAt: new Date() })];
  const { controller, elements } = harness(items); await controller.loadContacts(); assert.equal(elements.b2bSelectPage.checked, true); assert.equal(elements.b2bSelectPage.indeterminate, false);
  items[1].selectedAt = null; await controller.loadContacts(); assert.equal(elements.b2bSelectPage.checked, false); assert.equal(elements.b2bSelectPage.indeterminate, true);
});

test("import modal has desktop resize, viewport bounds, internal scroll and mobile fallback", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/dashboard.html"), "utf8");
  assert.match(html, /id="b2bImportResizeHandle"/); assert.match(html, /position:\s*absolute[\s\S]*cursor:\s*nwse-resize[\s\S]*pointer-events:\s*auto/); assert.match(html, /\.b2b-import-body[^}]*overflow:\s*auto/);
  assert.match(html, /max-width:\s*calc\(100vw - 32px\)/); assert.match(html, /max-height:\s*calc\(100vh - 32px\)/); assert.match(html, /@media \(max-width: 700px\)[\s\S]*resize:\s*none/);
});

test("pointer drag resizes within minimum and viewport bounds then stops", () => {
  const panel = { style: {}, getBoundingClientRect: () => ({ width: 900, height: 600 }) };
  let captured = 0, released = 0;
  const handle = { setPointerCapture: () => { captured++; }, releasePointerCapture: () => { released++; } };
  const elements = { b2bImportPanel: panel, b2bImportResizeHandle: handle };
  const windowRef = { innerWidth: 1200, innerHeight: 800, addEventListener() {} };
  const controller = createController({ authFetch: async () => {}, showMessage() {}, documentRef: { getElementById: (id) => elements[id] }, windowRef });
  const target = {};
  controller.startImportResize({ pointerId: 1, clientX: 100, clientY: 100, currentTarget: target, preventDefault() {} });
  controller.moveImportResize({ pointerId: 1, clientX: 600, clientY: 600 });
  assert.equal(panel.style.width, "1168px"); assert.equal(panel.style.height, "768px");
  controller.moveImportResize({ pointerId: 1, clientX: -500, clientY: -500 });
  assert.equal(panel.style.width, "700px"); assert.equal(panel.style.height, "450px");
  controller.stopImportResize({ pointerId: 1, currentTarget: target });
  const stoppedWidth = panel.style.width; controller.moveImportResize({ pointerId: 1, clientX: 500, clientY: 500 });
  assert.equal(panel.style.width, stoppedWidth); assert.equal(captured, 1); assert.equal(released, 1);
  windowRef.innerWidth = 650; controller.clampImportModal(); assert.equal(panel.style.width, ""); assert.equal(panel.style.height, "");
});

test("disabled checkbox explanations are deterministic and top-level help is present", () => {
  assert.match(selectionBlockedReason(contact("1", { eligibilityStatus: "PROSPECT_RESEARCH_REQUIRED", decisionMakerName: "" })), /decision maker research required/i);
  assert.match(selectionBlockedReason(contact("2", { eligibilityStatus: "CONTACT_REVIEW_REQUIRED", verificationStatus: "NOT_VERIFIED" })), /email verification required/i);
  assert.match(selectionBlockedReason(contact("3", { optOut: true })), /contact is blocked/i);
  const html = fs.readFileSync(path.join(__dirname, "../public/dashboard.html"), "utf8"); assert.match(html, /Only Send Eligible contacts are selectable\./);
});

test("interactive tooltip opens on hover/focus or tap and closes outside or on Escape", () => {
  const tooltip = element(); tooltip.getBoundingClientRect = () => ({ width: 220, height: 44 });
  const control = element(); control.dataset.tooltip = "Not send eligible — verification required.";
  const controller = createController({ authFetch: async () => {}, showMessage() {}, documentRef: { getElementById: (id) => id === "b2bEligibilityTooltip" ? tooltip : null }, windowRef: { innerWidth: 800, innerHeight: 600, addEventListener() {} } });
  controller.showEligibilityTooltip(control); assert.equal(tooltip.classList.contains("hidden"), false); assert.equal(tooltip.textContent, control.dataset.tooltip); assert.equal(control["aria-expanded"], "true");
  controller.hideEligibilityTooltip(); assert.equal(tooltip.classList.contains("hidden"), true);
  controller.toggleEligibilityTooltip(control); assert.equal(controller.state.tooltipPinned, true); controller.hideEligibilityTooltip(); assert.equal(tooltip.classList.contains("hidden"), false);
  controller.handleEligibilityOutsideClick({ target: { closest: () => null } }); assert.equal(tooltip.classList.contains("hidden"), true);
  controller.toggleEligibilityTooltip(control); controller.handleEligibilityKeydown({ key: "Escape" }); assert.equal(tooltip.classList.contains("hidden"), true);
});

test("clear selection persists through reload and reports zero selected", async () => {
  const items = [contact("1", { selectedAt: new Date() }), contact("2", { selectedAt: new Date() })];
  const { controller, calls, elements } = harness(items);
  await controller.clearSelection();
  assert.equal(calls.some((call) => call.name === "CLEAR_CONTACT_SELECTION"), true);
  assert.equal(controller.state.selectedCount, 0); assert.equal(elements.b2bSelectedCount.textContent, "0 contacts selected");
});
