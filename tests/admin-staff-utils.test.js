const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeRegex,
  hasCompleteBankDetails,
  parseBooleanFilter,
  parseStaffListOptions,
  serializeMaskedBankDetails,
  isSuperAdminUser,
} = require("../utils/admin-staff-utils");

test("escapeRegex treats user search text as literal text", () => {
  const escaped = escapeRegex("Alex.*(admin)?");
  const regex = new RegExp(escaped, "i");

  assert.equal(regex.test("Alex.*(admin)?"), true);
  assert.equal(regex.test("Alex SUPERADMIN"), false);
});

test("parseStaffListOptions caps page size and whitelists sort fields", () => {
  assert.deepEqual(
    parseStaffListOptions({ page: "3", limit: "500", sortBy: "password", sortOrder: "asc" }),
    { page: 3, limit: 100, sortBy: "createdAt", sortOrder: 1, paginationRequested: true }
  );
});

test("parseStaffListOptions supplies safe defaults", () => {
  assert.deepEqual(parseStaffListOptions({}), {
    page: 1,
    limit: 25,
    sortBy: "createdAt",
    sortOrder: -1,
    paginationRequested: false,
  });
});

test("isSuperAdminUser rejects normal admins", () => {
  assert.equal(isSuperAdminUser({ role: "admin" }), false);
  assert.equal(isSuperAdminUser({ role: "superadmin" }), true);
  assert.equal(isSuperAdminUser(null), false);
});

test("parseBooleanFilter only accepts explicit boolean values", () => {
  assert.equal(parseBooleanFilter("true"), true);
  assert.equal(parseBooleanFilter("FALSE"), false);
  assert.equal(parseBooleanFilter("yes"), null);
});

test("serializeMaskedBankDetails never returns full bank values", () => {
  const source = {
    accountHolder: "Alex Example",
    bankName: "Example Bank",
    sortCode: "112233",
    accountNumber: "12345678",
    iban: "GB00EXAMPLE123456789",
  };
  const masked = serializeMaskedBankDetails(source);

  assert.equal(masked.hasBankDetails, true);
  for (const key of Object.keys(source)) {
    assert.notEqual(masked[key], source[key]);
  }
  assert.match(masked.accountNumber, /5678$/);
  assert.match(masked.sortCode, /33$/);
});

test("hasCompleteBankDetails requires payroll-critical fields", () => {
  assert.equal(hasCompleteBankDetails({
    accountHolder: "Alex Example",
    sortCode: "112233",
    accountNumber: "12345678",
  }), true);
  assert.equal(hasCompleteBankDetails({ accountHolder: "Alex Example" }), false);
});
