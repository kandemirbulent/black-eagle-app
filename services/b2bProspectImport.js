const crypto = require("node:crypto");
const XLSX = require("xlsx");

const MAX_ROWS = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_ALIASES = new Map();
const aliases = {
  companyName: ["Company / Venue", "Company", "Company Name"],
  decisionMakerName: ["Decision Maker", "Contact", "Contact Name", "Name"],
  role: ["Position / Role", "Role", "Job Title", "Position"],
  businessEmail: ["Business Email", "Email", "Work Email"],
  phone: ["Phone", "Telephone"], segment: ["Segment", "Category"],
  bestBlackEagleOffer: ["Best Black Eagle Offer", "Best Offer", "Offer"],
  verificationStatus: ["Verification", "Verification Status"],
  sourceUrl: ["Source URL", "Source", "URL"],
  personalisationFacts: ["Personalisation Details", "Personalization Details", "Personalisation Facts", "Personalization Facts"],
  outreachStatus: ["Outreach Status"],
};
const headerKey = (value) => String(value || "").trim().toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ");
for (const [field, names] of Object.entries(aliases)) for (const name of names) FIELD_ALIASES.set(headerKey(name), field);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
function classifyContact(contact = {}) {
  const named = Boolean(clean(contact.decisionMakerName));
  const role = Boolean(clean(contact.role));
  const emailValid = EMAIL_PATTERN.test(clean(contact.businessEmail).toLowerCase());
  const verified = ["VERIFIED", "VALID"].includes(String(contact.verificationStatus || "").toUpperCase());
  if (!named) return "PROSPECT_RESEARCH_REQUIRED";
  if (verified && emailValid && role) return "SEND_ELIGIBLE";
  if (verified && emailValid) return "CONTACT_VERIFIED";
  return "CONTACT_REVIEW_REQUIRED";
}

function normalizeSegment(value) {
  const text = clean(value).toLowerCase();
  if (!text) return "UNKNOWN";
  if (/hotel/.test(text)) return "HOTELS";
  if (/cater/.test(text)) return "CATERING";
  if (/event\s*venue|^venue$/.test(text)) return "EVENT_VENUES";
  if (/facilit|^fm$/.test(text)) return "FACILITIES_MANAGEMENT";
  if (/propert/.test(text)) return "PROPERTY_MANAGEMENT";
  if (/corporate/.test(text)) return "CORPORATE";
  return "UNKNOWN";
}

function normalizeVerification(value) {
  const text = clean(value).toUpperCase().replace(/[\s-]+/g, "_");
  if (["VERIFIED", "VALID"].includes(text)) return text;
  if (["NOT_VERIFIED", "UNVERIFIED", "NOT_VALID"].includes(text)) return "NOT_VERIFIED";
  return text ? "REQUIRES_REVIEW" : "NOT_VERIFIED";
}

function parseWorkbook(buffer, fileName = "") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  const sheets = workbook.SheetNames.map((name) => {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false, blankrows: false });
    const headers = (grid[0] || []).map((heading, index) => ({ index, field: FIELD_ALIASES.get(headerKey(heading)), source: clean(heading) })).filter((item) => item.field);
    return { name, grid, headers, suitable: headers.some((item) => item.field === "companyName") };
  });
  const selected = sheets.find((sheet) => sheet.suitable);
  if (!selected) throw Object.assign(new Error("No sheet contains a supported Company column."), { code: "B2B_IMPORT_COMPANY_COLUMN_REQUIRED" });
  if (selected.grid.length - 1 > MAX_ROWS) throw Object.assign(new Error(`Workbook exceeds the ${MAX_ROWS} row limit.`), { code: "B2B_IMPORT_ROW_LIMIT" });
  const rows = selected.grid.slice(1).map((cells, index) => {
    const contact = {};
    for (const header of selected.headers) contact[header.field] = clean(cells[header.index]);
    const hasSourceValue = Object.values(contact).some(Boolean);
    contact.companyName = clean(contact.companyName);
    contact.decisionMakerName = clean(contact.decisionMakerName);
    contact.role = clean(contact.role);
    contact.businessEmail = clean(contact.businessEmail).toLowerCase();
    contact.segment = normalizeSegment(contact.segment);
    contact.verificationStatus = normalizeVerification(contact.verificationStatus);
    const factText = clean(contact.personalisationFacts);
    contact.personalisationFacts = factText ? [{ fact: factText, verified: ["VERIFIED", "VALID"].includes(contact.verificationStatus) }] : [];
    const reasons = [];
    let importStatus = "NEW", importable = true;
    if (!contact.companyName) { importStatus = "INVALID"; importable = false; reasons.push("COMPANY_REQUIRED"); }
    if (contact.businessEmail && !EMAIL_PATTERN.test(contact.businessEmail)) { importStatus = "REVIEW_REQUIRED"; importable = false; reasons.push("INVALID_EMAIL"); }
    if (!contact.businessEmail) { importStatus = "REVIEW_REQUIRED"; reasons.push("EMAIL_RESEARCH_REQUIRED"); }
    if (!contact.decisionMakerName) { importStatus = "REVIEW_REQUIRED"; reasons.push("DECISION_MAKER_REVIEW_REQUIRED"); }
    if (!contact.role) { importStatus = "REVIEW_REQUIRED"; reasons.push("ROLE_REVIEW_REQUIRED"); }
    if (!["VERIFIED", "VALID"].includes(contact.verificationStatus)) { importStatus = "REVIEW_REQUIRED"; reasons.push("VERIFICATION_REQUIRED"); }
    if (contact.segment === "UNKNOWN") { importStatus = "REVIEW_REQUIRED"; reasons.push("SEGMENT_REVIEW_REQUIRED"); }
    contact.eligibilityStatus = classifyContact(contact);
    contact.outreachStatus = contact.eligibilityStatus === "SEND_ELIGIBLE" ? "READY" : "REVIEW_REQUIRED";
    return { row: index + 2, contact, importStatus, importable, reasons, hasSourceValue };
  }).filter((row) => row.hasSourceValue).map(({ hasSourceValue: _ignored, ...row }) => row);
  return { sourceFileName: clean(fileName), sheetNames: sheets.map((sheet) => sheet.name), selectedSheet: selected.name, rows };
}

async function applyDuplicateStatus(parsed, contactsCollection) {
  const filters = [];
  for (const row of parsed.rows) {
    const normalizedCompany = row.contact.companyName.toLowerCase();
    const normalizedPersonCompany = row.contact.decisionMakerName ? `${row.contact.decisionMakerName.toLowerCase()}|${normalizedCompany}` : "";
    row.normalizedEmail = row.contact.businessEmail || "";
    row.normalizedPersonCompany = normalizedPersonCompany;
    if (row.normalizedEmail) filters.push({ normalizedEmail: row.normalizedEmail });
    if (normalizedPersonCompany) filters.push({ normalizedPersonCompany });
  }
  const existing = filters.length ? await contactsCollection.find({ $or: filters }, { projection: { normalizedEmail: 1, normalizedPersonCompany: 1 } }).toArray() : [];
  const emails = new Set(existing.map((item) => item.normalizedEmail).filter(Boolean));
  const people = new Set(existing.map((item) => item.normalizedPersonCompany).filter(Boolean));
  for (const row of parsed.rows) {
    const duplicateReason = row.normalizedEmail && emails.has(row.normalizedEmail) ? "DUPLICATE_EMAIL" : row.normalizedPersonCompany && people.has(row.normalizedPersonCompany) ? "DUPLICATE_PERSON_COMPANY" : "";
    if (duplicateReason) { row.importStatus = "DUPLICATE"; row.importable = false; row.reasons = [duplicateReason]; }
    else { if (row.normalizedEmail) emails.add(row.normalizedEmail); if (row.normalizedPersonCompany) people.add(row.normalizedPersonCompany); }
    delete row.normalizedEmail; delete row.normalizedPersonCompany;
  }
  return parsed;
}

function summarize(rows) {
  const count = (status) => rows.filter((row) => row.importStatus === status).length;
  return { totalRows: rows.length, prospectResearchRequired: rows.filter((row) => row.importStatus !== "DUPLICATE" && row.contact.eligibilityStatus === "PROSPECT_RESEARCH_REQUIRED").length, contactReviewRequired: rows.filter((row) => row.importStatus !== "DUPLICATE" && row.contact.eligibilityStatus === "CONTACT_REVIEW_REQUIRED").length, contactVerified: rows.filter((row) => row.importStatus !== "DUPLICATE" && row.contact.eligibilityStatus === "CONTACT_VERIFIED").length, sendEligible: rows.filter((row) => row.importStatus !== "DUPLICATE" && row.contact.eligibilityStatus === "SEND_ELIGIBLE").length, duplicates: count("DUPLICATE"), invalid: count("INVALID"), importable: rows.filter((row) => row.importable).length, new: count("NEW"), reviewRequired: count("REVIEW_REQUIRED"), readyToImport: rows.filter((row) => row.importable).length };
}

function createPreviewBatchStore({ ttlMs = 15 * 60 * 1000, now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  const batches = new Map();
  return {
    create(actorId, parsed) { const currentTime = now().getTime(); for (const [key, batch] of batches) if (batch.expiresAt < currentTime) batches.delete(key); const id = randomBytes(24).toString("hex"); batches.set(id, { actorId: String(actorId), parsed, expiresAt: currentTime + ttlMs }); return id; },
    consume(id, actorId) { const batch = batches.get(String(id)); batches.delete(String(id)); return batch && batch.actorId === String(actorId) && batch.expiresAt >= now().getTime() ? batch.parsed : null; },
    size: () => batches.size,
  };
}

module.exports = { aliases, normalizeSegment, normalizeVerification, classifyContact, parseWorkbook, applyDuplicateStatus, summarize, createPreviewBatchStore };
