(function (root) {
  "use strict";
  const escape = (value) => String(value ?? "-").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  function create({ document, authFetch, canEdit, onSaved }) {
    const el = (name) => document.getElementById(`orderDetails${name}`);
    let order = null;
    let saving = false;
    let opener = null;
    const editable = { eventName: "EventName", location: "Location", notes: "Notes" };
    const controls = ["Save", "Cancel", "Close", "Status", ...Object.values(editable)];
    function render() {
      const fields = [
        ["Order ID", order.orderId], ["Event", order.eventName],
        ["Customer", order.companyName || order.customerName], ["Date", order.eventDate],
        ["Start", order.startTime], ["End", order.endTime], ["Location", order.location],
        ["City", order.city], ["Postcode", order.postcode], ["Description", order.description],
        ["Order status", order.orderStatus], ["Payment status", order.paymentStatus],
        ["Total (GBP)", order.totalWithVat ?? order.totalAmount], ["Paid (GBP)", order.amountPaid],
        ["Notes", order.notes],
      ];
      el("Content").innerHTML = `<dl>${fields.map(([label, value]) => `<dt>${label}</dt><dd>${escape(value === "" ? "-" : value)}</dd>`).join("")}</dl><h4>Staff requirements</h4><ul>${(order.staff || []).map((staff) => `<li>${escape(staff.quantity)} × ${escape(staff.displayService || staff.service)} — ${escape(staff.hours)} hours</li>`).join("")}</ul>`;
      el("Form").classList.add("hidden");
      el("Edit").classList.toggle("hidden", !canEdit());
    }
    function close() {
      if (saving) return;
      el("Modal").classList.add("hidden");
      opener?.focus();
    }
    function open(value) {
      if (saving) return;
      order = value;
      opener = document.activeElement;
      el("Error").textContent = "";
      render();
      el("Modal").classList.remove("hidden");
      el("Close").focus();
    }
    function edit() {
      if (!order || !canEdit() || saving) return;
      el("Status").value = order.orderStatus || "";
      for (const [key, name] of Object.entries(editable)) el(name).value = order[key] || "";
      el("Form").classList.remove("hidden");
      el("Edit").classList.add("hidden");
      el("Status").focus();
    }
    function cancel() {
      if (saving) return;
      el("Error").textContent = "";
      render();
    }
    async function save(event) {
      event.preventDefault();
      if (!order || !canEdit() || saving) return;
      const status = el("Status").value.trim();
      if (!status) { el("Error").textContent = "Order status is required."; return; }
      const changes = {};
      for (const [key, name] of Object.entries(editable)) {
        const value = el(name).value.trim();
        if (value !== (order[key] || "")) {
          if (key !== "notes" && !value) { el("Error").textContent = `${key} must not be empty.`; return; }
          changes[key] = value;
        }
      }
      const statusChanged = status !== (order.orderStatus || "");
      if (!Object.keys(changes).length && !statusChanged) { cancel(); return; }
      saving = true;
      controls.forEach((name) => { el(name).disabled = true; });
      el("Error").textContent = "";
      let saved = false;
      try {
        // The list contains Order._id, not the human orderId or linked Event._id.
        const base = `/admin/orders/${encodeURIComponent(order._id)}`;
        const updates = [];
        if (Object.keys(changes).length) updates.push([base, changes]);
        if (statusChanged) updates.push([`${base}/status`, { orderStatus: status }]);
        for (const [url, body] of updates) {
          const response = await authFetch(url, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
          const result = await response.json();
          if (!response.ok || !result.success || !result.order) throw new Error(result.message || "Could not update order.");
          order = result.order;
          saved = true;
        }
        render();
      } catch (error) {
        el("Error").textContent = `${saved ? "Details saved, but status was not saved. " : ""}${error.message || "Could not update order."}`;
      }
      finally {
        if (saved) {
          try { await onSaved(); } catch (_) { el("Error").textContent += " Saved changes could not be refreshed in the Orders list. Please reload."; }
        }
        saving = false;
        controls.forEach((name) => { el(name).disabled = false; });
      }
    }
    el("Edit").addEventListener("click", edit);
    el("Cancel").addEventListener("click", cancel);
    el("Close").addEventListener("click", close);
    el("Form").addEventListener("submit", save);
    el("Modal").addEventListener("click", (event) => { if (event.target === el("Modal")) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !el("Modal").classList.contains("hidden")) close(); });
    return { open, edit, cancel, save };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.OrderDetails = { create };
})(typeof window !== "undefined" ? window : globalThis);
