const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEGMENTS = new Set(["HOTELS", "CATERING", "EVENT_VENUES", "FACILITIES_MANAGEMENT", "PROPERTY_MANAGEMENT", "CORPORATE"]);
const EDITABLE_FIELDS = new Set(["decisionMakerName", "companyName", "role", "businessEmail", "phone", "officialWebsite", "segment", "bestBlackEagleOffer", "sourceUrl", "notes"]);
const VERIFICATION_FIELDS = new Set(["decisionMakerName", "role", "businessEmail", "phone", "officialWebsite", "sourceUrl"]);

function coded(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; return error; }
const clean = (value) => String(value ?? "").trim();

function normalizeUrl(value) {
  const input = clean(value); if (!input) return "";
  let parsed; try { parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { throw coded("B2B_CONTACT_URL_INVALID"); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw coded("B2B_CONTACT_URL_INVALID");
  parsed.hash = ""; return parsed.toString();
}

function buildContactUpdate(input = {}, existing = {}, actorId = "", now = new Date()) {
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !EDITABLE_FIELDS.has(key))) throw coded("B2B_CONTACT_FIELDS_INVALID");
  const values = {};
  for (const key of keys) values[key] = clean(input[key]);
  if (Object.hasOwn(values, "companyName") && !values.companyName) throw coded("B2B_CONTACT_COMPANY_REQUIRED");
  if (values.businessEmail && !EMAIL.test(values.businessEmail.toLowerCase())) throw coded("B2B_CONTACT_EMAIL_INVALID");
  if (Object.hasOwn(values, "businessEmail")) values.businessEmail = values.businessEmail.toLowerCase();
  for (const key of ["officialWebsite", "sourceUrl"]) if (Object.hasOwn(values, key)) values[key] = normalizeUrl(values[key]);
  if (values.segment) { values.segment = values.segment.toUpperCase(); if (!SEGMENTS.has(values.segment)) throw coded("B2B_CONTACT_SEGMENT_INVALID"); }
  const merged = { ...existing, ...values };
  if (Object.hasOwn(values, "companyName")) values.normalizedCompany = values.companyName.toLowerCase();
  if (Object.hasOwn(values, "businessEmail")) values.normalizedEmail = values.businessEmail;
  if (Object.hasOwn(values, "companyName") || Object.hasOwn(values, "decisionMakerName")) values.normalizedPersonCompany = `${clean(merged.decisionMakerName).toLowerCase()}|${clean(merged.companyName).toLowerCase()}`;
  const verificationChanged = keys.some((key) => VERIFICATION_FIELDS.has(key) && clean(existing[key]) !== clean(values[key]));
  if (verificationChanged) {
    values.verificationStatus = "NOT_VERIFIED";
    values.eligibilityStatus = clean(merged.businessEmail) ? "CONTACT_REVIEW_REQUIRED" : "PROSPECT_RESEARCH_REQUIRED";
    if (clean(existing.outreachStatus).toUpperCase() !== "SENT" && !existing.lastEmailSentAt) Object.assign(values, { outreachStatus: "REVIEW_REQUIRED", selectedAt: null, selectedBy: "", selectedAuthority: "" });
  }
  return { ...values, manualEditedAt: now, manualEditedBy: String(actorId || ""), updatedAt: now };
}

module.exports = { EMAIL, EDITABLE_FIELDS, buildContactUpdate, coded };
