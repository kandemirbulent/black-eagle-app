function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getBaseUrl(env = process.env) {
  if (env.PUBLIC_BASE_URL) {
    return String(env.PUBLIC_BASE_URL).trim().replace(/\/+$/, "");
  }

  if (env.RENDER_EXTERNAL_URL) {
    return String(env.RENDER_EXTERNAL_URL).trim().replace(/\/+$/, "");
  }

  if (env.NODE_ENV === "production") {
    return "https://blackeagleuk.com";
  }

  return `http://localhost:${env.PORT || 3000}`;
}

function serializeCustomer(customer) {
  if (!customer) return null;

  const source =
    typeof customer.toObject === "function" ? customer.toObject() : customer;

  return {
    _id: source._id,
    applicationId: source.applicationId || "",
    customerCode: source.customerCode || "",
    companyName: source.companyName || "",
    companyAddress: source.companyAddress || "",
    postcode: source.postcode || "",
    firstName: source.firstName || "",
    lastName: source.lastName || "",
    mobilePhone: source.mobilePhone || "",
    email: source.email || "",
    website: source.website || "",
    vatNumber: source.vatNumber || "",
    companyNumber: source.companyNumber || "",
    status: source.status || "pending",
    approvedAt: source.approvedAt || null,
    createdAt: source.createdAt || null,
    notes: source.notes || "",
    eventDate: source.eventDate || null,
  };
}

module.exports = {
  normalizeEmail,
  getBaseUrl,
  serializeCustomer,
};
