const SUPPORT_MESSAGE_STATUSES = ["New", "In Progress", "Resolved"];
const SUPPORT_MESSAGE_PRIORITIES = ["Normal", "Urgent"];
const SUPPORT_MESSAGE_USER_TYPES = ["customer-candidate", "staff-candidate"];
const SUPPORT_MESSAGE_ROLES = ["customer", "staff"];

function normalizeSupportMessageInput(input = {}) {
  const role = SUPPORT_MESSAGE_ROLES.includes(String(input.role || "").trim().toLowerCase())
    ? String(input.role || "").trim().toLowerCase()
    : "";
  const userType = SUPPORT_MESSAGE_USER_TYPES.includes(
    String(input.userType || "").trim().toLowerCase()
  )
    ? String(input.userType || "").trim().toLowerCase()
    : "";

  return {
    userId: String(input.userId || "").trim(),
    name: String(input.name || "").trim(),
    email: String(input.email || "").trim().toLowerCase(),
    phone: String(input.phone || "").trim(),
    role,
    userType,
    message: String(input.message || "").trim(),
    sourcePage: String(input.sourcePage || "").trim(),
    status: "New",
    priority:
      String(input.priority || "").trim() === "Urgent"
        ? "Urgent"
        : "Normal",
  };
}

function validateSupportMessageInput(input = {}) {
  const normalized = normalizeSupportMessageInput(input);

  if (!normalized.message) {
    return {
      ok: false,
      statusCode: 400,
      body: { success: false, message: "Support message is required." },
    };
  }

  if (!normalized.sourcePage) {
    return {
      ok: false,
      statusCode: 400,
      body: { success: false, message: "Source page is required." },
    };
  }

  if (!normalized.name || !normalized.email) {
    return {
      ok: false,
      statusCode: 400,
      body: { success: false, message: "Name and email are required." },
    };
  }

  if (!normalized.role && !normalized.userType) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        success: false,
        message: "User type is required for non-logged-in visitors.",
      },
    };
  }

  return {
    ok: true,
    data: normalized,
  };
}

module.exports = {
  SUPPORT_MESSAGE_PRIORITIES,
  SUPPORT_MESSAGE_ROLES,
  SUPPORT_MESSAGE_STATUSES,
  SUPPORT_MESSAGE_USER_TYPES,
  normalizeSupportMessageInput,
  validateSupportMessageInput,
};
