const crypto = require("node:crypto");

const OPERATIONS = new Set([
  "LIST_CONTACTS", "GET_CONTACT", "SELECT_CONTACT", "DESELECT_CONTACT", "GENERATE_DRAFT",
  "GET_DRAFT", "UPDATE_DRAFT", "APPROVE_DRAFT", "SEND_APPROVED",
  "IMPORT_CONTACTS", "BULK_SELECT_CONTACTS", "CLEAR_CONTACT_SELECTION",
]);

function canonicalRequest(request = {}) {
  return JSON.stringify({
    operation: request.operation,
    payload: request.payload || {},
    actorId: request.actorId,
    requestedAt: request.requestedAt,
    nonce: request.nonce,
  });
}

function signRequest(request, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(canonicalRequest(request)).digest("hex");
}

function buildSignedRequest({ operation, payload = {}, actorId, secret, now = () => new Date(), randomBytes = crypto.randomBytes }) {
  if (!OPERATIONS.has(operation)) throw Object.assign(new Error("Unsupported B2B operation."), { code: "B2B_OPERATION_NOT_SUPPORTED" });
  if (!String(actorId || "").trim()) throw Object.assign(new Error("Authenticated admin is required."), { code: "B2B_ACTOR_REQUIRED" });
  if (!String(secret || "").trim()) throw Object.assign(new Error("B2B integration secret is not configured."), { code: "B2B_AUTH_NOT_CONFIGURED" });
  const request = {
    operation,
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
    actorId: String(actorId),
    requestedAt: now().toISOString(),
    nonce: randomBytes(24).toString("hex"),
    status: "QUEUED",
    createdAt: now(),
    updatedAt: now(),
  };
  return { ...request, signature: signRequest(request, secret) };
}

function safeResponse(document = {}) {
  return {
    requestId: String(document._id || ""),
    operation: document.operation || "",
    status: document.status || "QUEUED",
    response: document.response || null,
    createdAt: document.createdAt || null,
    startedAt: document.startedAt || null,
    completedAt: document.completedAt || null,
  };
}

module.exports = { OPERATIONS, canonicalRequest, signRequest, buildSignedRequest, safeResponse };
