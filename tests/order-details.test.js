const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { create } = require("../public/js/order-details");
const order = { _id: "507f1f77bcf86cd799439011", orderId: "BE123456", eventName: "Wedding <test>", orderStatus: "Pending", totalWithVat: 200, staff: [{ service: "Waiter", quantity: 2, hours: 6 }] };
function setup({ permitted = true, ok = true } = {}) {
  const elements = new Map();
  const document = { addEventListener() {}, getElementById(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { value: "", textContent: "", innerHTML: "", focus() {}, addEventListener() {}, classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
        toggle: (name, hidden) => hidden ? classes.add(name) : classes.delete(name),
      } });
    }
    return elements.get(id);
  } };
  const requests = [];
  let refreshes = 0;
  const controller = create({ document, canEdit: () => permitted, onSaved: async () => { refreshes++; }, authFetch: async (url, options) => {
    requests.push({ url, ...options });
    return { ok, json: async () => ok ? { success: true, order: { ...order, orderStatus: "Completed" } } : { message: "Validation failed" } };
  } });
  controller.open(order);
  return { controller, requests, el: (name) => document.getElementById(`orderDetails${name}`), refreshes: () => refreshes };
}
test("Orders event button uses the Order Mongo ID and existing listing order remains unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/dashboard.html"), "utf8");
  assert.match(source, /data-order-details="\$\{escapeHtml\(order\._id\)\}"/);
  assert.match(source, /ordersCache\.find\(\(item\) => String\(item\._id\) === button\.dataset\.orderDetails\)/);
  assert.match(source, /if \(order\) orderDetails\.open\(order\)/);
  assert.match(source, /tbody\.innerHTML = ordersCache\.map/);
  assert.match(source, /onSaved: \(\) => loadOrders\(\)/);
});
test("detail displays escaped existing values and Super Admin edit prefills status", () => {
  const s = setup();
  assert.match(s.el("Content").innerHTML, /Wedding &lt;test&gt;/);
  assert.match(s.el("Content").innerHTML, /BE123456/);
  assert.match(s.el("Content").innerHTML, /2 × Waiter/);
  assert.equal(s.el("Edit").classList.contains("hidden"), false);
  s.controller.edit();
  assert.equal(s.el("Status").value, "Pending");
});
test("save PATCHes existing Order ID with only status, then refreshes details and list", async () => {
  const s = setup(); s.controller.edit(); s.el("Status").value = "Completed";
  await s.controller.save({ preventDefault() {} });
  assert.deepEqual(s.requests, [{ url: `/admin/orders/${order._id}/status`, method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"orderStatus":"Completed"}' }]);
  assert.match(s.el("Content").innerHTML, /Completed/);
  assert.equal(s.refreshes(), 1);
});
test("cancel makes no request and preserves saved values", () => {
  const s = setup(); s.controller.edit(); s.el("Status").value = "Changed"; s.controller.cancel();
  assert.equal(s.requests.length, 0); assert.match(s.el("Content").innerHTML, /Pending/);
  s.controller.edit(); assert.equal(s.el("Status").value, "Pending");
});
test("non-Super Admin has no edit action and cannot send update", async () => {
  const s = setup({ permitted: false });
  assert.equal(s.el("Edit").classList.contains("hidden"), true);
  s.el("Status").value = "Completed"; await s.controller.save({ preventDefault() {} });
  assert.equal(s.requests.length, 0);
});
test("blank status is rejected without request", async () => {
  const s = setup(); s.el("Status").value = "  "; await s.controller.save({ preventDefault() {} });
  assert.equal(s.requests.length, 0); assert.equal(s.el("Error").textContent, "Order status is required.");
});
test("backend validation failure remains visible without replacing detail or refreshing", async () => {
  const s = setup({ ok: false }); s.controller.edit(); s.el("Status").value = "Completed";
  await s.controller.save({ preventDefault() {} });
  assert.equal(s.el("Error").textContent, "Validation failed");
  assert.match(s.el("Content").innerHTML, /Pending/); assert.equal(s.refreshes(), 0);
});
