const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRole,
  buildRoleRequirementsFromOrder,
  getRequiredQuantityForRole,
  canAutoApprovalStart,
} = require("../utils/event-utils");

test("normalizeRole trims and lowercases values", () => {
  assert.equal(normalizeRole("  Waiter "), "waiter");
  assert.equal(normalizeRole(null), "");
});

test("buildRoleRequirementsFromOrder groups repeated services", () => {
  const result = buildRoleRequirementsFromOrder({
    staff: [
      { service: "Waiter", quantity: 2 },
      { service: " waiter ", quantity: 1 },
      { service: "Chef", quantity: 3 },
      { service: "", quantity: 10 },
    ],
  });

  assert.deepEqual(result, [
    { role: "waiter", quantityRequired: 3 },
    { role: "chef", quantityRequired: 3 },
  ]);
});

test("getRequiredQuantityForRole returns matching quantity or zero", () => {
  const event = {
    roleRequirements: [
      { role: "waiter", quantityRequired: 2 },
      { role: "chef", quantityRequired: 1 },
    ],
  };

  assert.equal(getRequiredQuantityForRole(event, "Waiter"), 2);
  assert.equal(getRequiredQuantityForRole(event, "bartender"), 0);
});

test("canAutoApprovalStart allows last-minute or waited events", () => {
  const now = new Date("2026-04-18T12:00:00Z");

  assert.equal(
    canAutoApprovalStart(
      {
        createdAt: new Date("2026-04-18T10:00:00Z"),
        eventDate: new Date("2026-04-19T09:00:00Z"),
      },
      now
    ),
    true
  );

  assert.equal(
    canAutoApprovalStart(
      {
        createdAt: new Date("2026-04-15T09:00:00Z"),
        eventDate: new Date("2026-04-25T09:00:00Z"),
      },
      now
    ),
    true
  );

  assert.equal(
    canAutoApprovalStart(
      {
        createdAt: new Date("2026-04-18T09:00:00Z"),
        eventDate: new Date("2026-04-25T09:00:00Z"),
      },
      now
    ),
    false
  );
});
