const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSupportMessageInput,
} = require("../utils/support-utils");

test("validateSupportMessageInput accepts customer candidate message", () => {
  const result = validateSupportMessageInput({
    name: "Jane Doe",
    email: "JANE@example.com",
    phone: "07123456789",
    userType: "customer-candidate",
    message: "Need help with registration",
    sourcePage: "/contact.html",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.email, "jane@example.com");
  assert.equal(result.data.userType, "customer-candidate");
  assert.equal(result.data.priority, "Normal");
});

test("validateSupportMessageInput accepts logged-in staff message", () => {
  const result = validateSupportMessageInput({
    userId: "staff-1",
    name: "Alex Staff",
    email: "alex@staff.com",
    role: "staff",
    message: "I need support",
    sourcePage: "/staff-logins/staff-dashboard.html",
    priority: "Urgent",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.role, "staff");
  assert.equal(result.data.userType, "");
  assert.equal(result.data.priority, "Urgent");
});

test("validateSupportMessageInput rejects missing candidate type for guest user", () => {
  const result = validateSupportMessageInput({
    name: "Guest",
    email: "guest@example.com",
    message: "Hello",
    sourcePage: "/index.html",
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
});
