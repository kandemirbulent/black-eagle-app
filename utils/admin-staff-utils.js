const STAFF_SORT_FIELDS = new Set([
  "createdAt",
  "firstName",
  "lastName",
  "email",
  "mobile",
  "role",
  "status",
  "city",
  "postcode",
]);

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBooleanFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStaffListOptions(query = {}) {
  const paginationRequested = query.page != null || query.limit != null;
  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 25), 100);
  const requestedSortBy = String(query.sortBy || "createdAt").trim();
  const sortBy = STAFF_SORT_FIELDS.has(requestedSortBy)
    ? requestedSortBy
    : "createdAt";
  const sortOrder = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;

  return { page, limit, sortBy, sortOrder, paginationRequested };
}

function isSuperAdminUser(adminUser) {
  return String(adminUser?.role || "").trim().toLowerCase() === "superadmin";
}

function maskBankValue(value, visibleDigits = 4) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= visibleDigits) return "*".repeat(normalized.length);
  return `${"*".repeat(normalized.length - visibleDigits)}${normalized.slice(-visibleDigits)}`;
}

function serializeMaskedBankDetails(bankDetails = {}) {
  const hasAnyBankDetails = [
    bankDetails.accountHolder,
    bankDetails.bankName,
    bankDetails.sortCode,
    bankDetails.accountNumber,
    bankDetails.iban,
  ].some((value) => String(value || "").trim());

  return {
    hasBankDetails: hasAnyBankDetails,
    accountHolder: maskBankValue(bankDetails.accountHolder, 1),
    bankName: maskBankValue(bankDetails.bankName, 1),
    sortCode: maskBankValue(bankDetails.sortCode, 2),
    accountNumber: maskBankValue(bankDetails.accountNumber, 4),
    iban: maskBankValue(bankDetails.iban, 4),
  };
}

function hasCompleteBankDetails(bankDetails = {}) {
  return [bankDetails.accountHolder, bankDetails.sortCode, bankDetails.accountNumber]
    .every((value) => Boolean(String(value || "").trim()));
}

module.exports = {
  escapeRegex,
  hasCompleteBankDetails,
  isSuperAdminUser,
  parseBooleanFilter,
  parseStaffListOptions,
  serializeMaskedBankDetails,
};
