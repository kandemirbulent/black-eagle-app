const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEmail,
  getBaseUrl,
  serializeCustomer,
} = require("../utils/customer-utils");

test("normalizeEmail trims and lowercases values", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("getBaseUrl prefers PUBLIC_BASE_URL and removes trailing slash", () => {
  assert.equal(
    getBaseUrl({
      PUBLIC_BASE_URL: "https://example.com/",
      NODE_ENV: "production",
      PORT: "9000",
    }),
    "https://example.com"
  );
});

test("getBaseUrl falls back to production or localhost values", () => {
  assert.equal(
    getBaseUrl({ RENDER_EXTERNAL_URL: "https://black-eagle-app.onrender.com/" }),
    "https://black-eagle-app.onrender.com"
  );
  assert.equal(getBaseUrl({ NODE_ENV: "production" }), "https://blackeagleuk.com");
  assert.equal(getBaseUrl({ PORT: "4500" }), "http://localhost:4500");
  assert.equal(getBaseUrl({}), "http://localhost:3000");
});

test("serializeCustomer keeps public fields and excludes sensitive ones", () => {
  const result = serializeCustomer({
    _id: "customer-1",
    applicationId: "BE-CUST-123",
    customerCode: "BE-111222",
    companyName: "Black Eagle",
    email: "customer@example.com",
    status: "approved",
    resetToken: "secret-token",
    tokenExpires: new Date("2030-01-01"),
    password: "hashed-password",
  });

  assert.deepEqual(result, {
    _id: "customer-1",
    applicationId: "BE-CUST-123",
    customerCode: "BE-111222",
    companyName: "Black Eagle",
    companyAddress: "",
    postcode: "",
    firstName: "",
    lastName: "",
    mobilePhone: "",
    email: "customer@example.com",
    website: "",
    vatNumber: "",
    companyNumber: "",
    status: "approved",
    approvedAt: null,
    createdAt: null,
    notes: "",
    eventDate: null,
  });
});
