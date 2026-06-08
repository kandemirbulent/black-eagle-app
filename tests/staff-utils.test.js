const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStaffAddress,
  getStaffLocationSummary,
} = require("../utils/staff-utils");

test("buildStaffAddress joins structured staff address fields", () => {
  assert.equal(
    buildStaffAddress({
      addressLine1: "221 Baker Street",
      addressLine2: "Flat 2",
      city: "London",
    }),
    "221 Baker Street, Flat 2, London"
  );
});

test("buildStaffAddress falls back to legacy address when structured fields are missing", () => {
  assert.equal(
    buildStaffAddress({
      address: "10 Queen Street, Manchester",
    }),
    "10 Queen Street, Manchester"
  );
});

test("getStaffLocationSummary prefers stored city and address lines", () => {
  const result = getStaffLocationSummary({
    address: "Legacy Combined Address",
    addressLine1: "12 River Road",
    addressLine2: "Suite B",
    city: "Bolton",
  });

  assert.deepEqual(result, {
    addressLine1: "12 River Road",
    addressLine2: "Suite B",
    city: "Bolton",
    region: "",
    address: "12 River Road, Suite B, Bolton",
  });
});

test("getStaffLocationSummary can derive city from old staff records", () => {
  const result = getStaffLocationSummary({
    address: "42 Example Street, London, Greater London",
  });

  assert.deepEqual(result, {
    addressLine1: "42 Example Street",
    addressLine2: "",
    city: "London",
    region: "Greater London",
    address: "42 Example Street, London",
  });
});
