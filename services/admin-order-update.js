"use strict";

// Existing manual-order form fields only. Schedule/staff/prices require their
// own business validation and are deliberately not part of this endpoint.
const allowedFields = ["eventName", "location", "notes"];
function validateDetails(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) {
    throw Object.assign(new Error("Provide at least one editable field."), { status: 400 });
  }
  const changes = {};
  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      throw Object.assign(new Error("Request contains a non-editable field."), { status: 400 });
    }
    if (typeof body[key] !== "string") {
      throw Object.assign(new Error(`${key} must be text.`), { status: 400 });
    }
    changes[key] = body[key].trim();
    if (key !== "notes" && !changes[key]) {
      throw Object.assign(new Error(`${key} must not be empty.`), { status: 400 });
    }
  }
  return changes;
}

function createAdminOrderDetailsUpdate({ Order, Event }) {
  return async function updateOrderDetails(req, res) {
    try {
      if (!/^[a-f\d]{24}$/i.test(req.params.id || "")) {
        return res.status(400).json({ success: false, message: "Invalid Order ID." });
      }
      const changes = validateDetails(req.body);
      let updatedOrder;
      // Keep the existing linked entity consistent, without invoking Order's
      // financial pre-save hook or any event creation/assignment flow.
      await Order.db.transaction(async (session) => {
        updatedOrder = await Order.findOneAndUpdate(
          { _id: req.params.id }, { $set: changes },
          { new: true, runValidators: true, upsert: false, session }
        );
        if (!updatedOrder) throw Object.assign(new Error("Order not found."), { status: 404 });
        const linkedEvents = await Event.find({ order: updatedOrder._id }).limit(2).session(session).lean();
        if (linkedEvents.length > 1) {
          throw Object.assign(new Error("Multiple linked events found; details were not updated."), { status: 409 });
        }
        if (linkedEvents.length) {
          const eventChanges = {};
          for (const [key, value] of Object.entries(changes)) eventChanges[key === "eventName" ? "title" : key] = value;
          await Event.updateOne(
            { _id: linkedEvents[0]._id, order: updatedOrder._id }, { $set: eventChanges },
            { runValidators: true, upsert: false, session }
          );
        }
      });
      return res.json({ success: true, order: updatedOrder });
    } catch (error) {
      const status = error.status || (error.name === "ValidationError" ? 400 : 500);
      return res.status(status).json({ success: false, message: status === 500
        ? "Order details could not be updated. No details were saved."
        : error.name === "ValidationError" ? "Order details failed validation." : error.message });
    }
  };
}
module.exports = { createAdminOrderDetailsUpdate, validateDetails };
