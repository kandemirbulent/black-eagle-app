// GENERATED from Sales Agent pricing sources by scripts/build-app-pricing.cjs. Do not edit.
"use strict";
const modules = {};
modules["core/role-pricing"] = (() => {
const SUPPORTED_ROLE_SELL_RATES = Object.freeze({
  Waiter: 20,
  Barback: 22,
  Bartender: 25,
  Security: 26,
  Mixologist: 27,
  Steward: 27,
  Supervisor: 27,
  Chef: 28,
});

return {SUPPORTED_ROLE_SELL_RATES};
})();
modules["core/deterministic-rules"] = (() => {
const { SUPPORTED_ROLE_SELL_RATES } = modules["core/role-pricing"];
const cleanText = value => String(value || "").replace(/\s+/g, " ").trim();
const WAITER_ALIASES = [
  "food runner",
  "catering staff",
  "catering assistant",
  "service staff",
  "waiting staff",
];

const MODEL_ALIASES = [
  "model", "models", "promotional model", "promotional models", "event model", "event models",
  "promo staff", "promostaff", "promotional staff", "promotions staff",
  "brand ambassador", "brand ambassadors", "brand ambassador staff", "promotional team",
];
const STEWARD_ALIASES = [
  "steward", "stewards", "event steward", "event stewards",
  "hospitality steward", "hospitality stewards",
];
const MODEL_SELL_RATE = 25;
const MODEL_MINIMUM_HOURS = 6;
const CUSTOMER_MESSAGE_SAFE_LIMIT = 850;
const DEFAULT_MODEL_QUANTITY = 1;
const MODEL_QUANTITY_ASSUMPTION = "Model quantity not specified; quotation prepared for 1 model.";
const MODEL_QUANTITY_CUSTOMER_MESSAGE = "This quotation is based on one model, as the required quantity was not specified. If you require a different number of models or any other staff, please confirm the exact quantities and we will revise the quotation accordingly.";
const STAFFING_ESTIMATE_NOTICE = "The staffing numbers in this quotation are estimated based on the guest count, event duration and duties provided. If you require different staff numbers, please confirm the exact quantities and we will revise the quotation accordingly.";
const MISSING_TIMINGS_ASSUMPTION = "Event timings were not provided; quotation prepared using the minimum 6-hour booking.";
const DURATION_ASSUMPTIONS = Object.freeze({
  FULL_DAY: { hours: 8, notice: "Full day assumed = 8 hours." },
  HALF_DAY: { hours: 6, notice: "Half day assumed = 6 hours." },
  A_FEW_HOURS: { hours: 6, notice: "A few hours assumed = 6 hours." },
  UNKNOWN_DURATION: { hours: 6, notice: "Unknown duration assumed = 6 hours." },
});
const STANDARD_ROLE_RULES = Object.freeze({
  Waiter: { guestsPerStaff: 40 }, Bartender: { guestsPerStaff: 65 },
  Barback: { guestsPerStaff: 100 }, Mixologist: { guestsPerStaff: 75 },
  Supervisor: { guestsPerStaff: 150 }, Steward: { guestsPerStaff: null },
  Security: { guestsPerStaff: null }, Chef: { guestsPerStaff: null },
});
const SUPPORTED_ROLES = new Set([...Object.keys(SUPPORTED_ROLE_SELL_RATES), "Model"]);

function guestsPerStaffForRole(role) {
  return STANDARD_ROLE_RULES[role]?.guestsPerStaff ?? null;
}

function canonicalStaffRole(value) {
  const role = cleanText(value);
  const normalized = role.toLowerCase();
  if (normalized === "waiter" || normalized === "waiters" || normalized === "runner" || normalized === "runners" || WAITER_ALIASES.some((alias) => normalized === alias || normalized === `${alias}s`)) return "Waiter";
  if (normalized === "bartender" || normalized === "bartenders") return "Bartender";
  if (normalized === "barback" || normalized === "barbacks") return "Barback";
  if (normalized === "mixologist" || normalized === "mixologists") return "Mixologist";
  if (normalized === "supervisor" || normalized === "supervisors") return "Supervisor";
  if (STEWARD_ALIASES.includes(normalized)) return "Steward";
  if (normalized === "security" || normalized === "security staff" || normalized === "security officer" || normalized === "security officers") return "Security";
  if (normalized === "chef" || normalized === "chefs" || normalized === "event chef" || normalized === "event chefs") return "Chef";
  if (MODEL_ALIASES.includes(normalized)) return "Model";
  return role;
}

function recalculateKnownPrice(next, sellRateForRole = customerSellRateForRole) {
  const hours = Number(next.billableHours);
  if (!Number.isFinite(hours) || hours <= 0) return next;
  let labourSubtotal = 0;
  for (const item of next.staffBreakdown || []) {
    const rate = sellRateForRole(item.role);
    if (!Number.isFinite(rate)) return next;
    labourSubtotal += item.quantity * hours * rate;
  }
  next.labourSubtotal = labourSubtotal;
  if (next.londonOrOutsideLondon === "OUTSIDE_LONDON") {
    next.vehicleCount = Math.ceil(next.recommendedStaff / 5);
    next.totalVehicleMiles = Number((Number(next.roundTripMiles || 0) * next.vehicleCount).toFixed(2));
    next.vehicleCost = next.totalVehicleMiles;
    next.travelLabourCost = Number((Number(next.travelHoursPerStaff || 0) * (next.staffBreakdown || [])
      .reduce((sum, item) => sum + item.quantity * sellRateForRole(item.role), 0)).toFixed(2));
  }
  next.recommendedPrice = Number((next.labourSubtotal + Number(next.travelLabourCost || 0) + Number(next.vehicleCost || 0) + Number(next.parkingCost || 0) + Number(next.accommodationCost || 0)).toFixed(2));
  if (Number.isFinite(next.customerBudget)) {
    next.budgetStatus = next.recommendedPrice > next.customerBudget ? "ABOVE_CUSTOMER_BUDGET" : "WITHIN_CUSTOMER_BUDGET";
    next.budgetDifference = Number(Math.abs(next.recommendedPrice - next.customerBudget).toFixed(2));
  }
  return next;
}


return {CUSTOMER_MESSAGE_SAFE_LIMIT,guestsPerStaffForRole,canonicalStaffRole,recalculateKnownPrice};
})();
modules["core/greater-london"] = (() => {
// Full-postcode administrative region lookup; never infer membership from an outcode.
// https://postcodes.io/docs/postcode/schema/
function fullPostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/\s/g, "");
  return /^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(compact)
    ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : null;
}

function locationPostcode(location = {}) {
  if (location.postcode) return fullPostcode(location.postcode);
  const matches = String(location.location || "").toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g) || [];
  const postcodes = [...new Set(matches.map(fullPostcode).filter(Boolean))];
  return postcodes.length === 1 ? postcodes[0] : null;
}

function createGreaterLondonResolver({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 4000, ttlMs = 86_400_000, maxEntries = 1000 } = {}) {
  const cache = new Map();
  return async function resolveGreaterLondon(location) {
    const postcode = locationPostcode(location);
    const unknown = reason => ({ postcode, isGreaterLondon: null, source: "POSTCODES_IO", reason });
    if (!postcode) return unknown("FULL_POSTCODE_REQUIRED");
    const cached = cache.get(postcode);
    if (cached && cached.expires > now()) return { ...await cached.value };
    const entry = { expires: now() + ttlMs };
    entry.value = (async () => {
      try {
        const response = await fetchImpl(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
        if (!response.ok) return unknown("LOOKUP_UNAVAILABLE");
        const data = await response.json();
        const result = data?.result;
        if (data?.status !== 200 || fullPostcode(result?.postcode) !== postcode || !result?.country) return unknown("UNVERIFIED_RESPONSE");
        if (["Scotland", "Wales", "Northern Ireland", "Channel Islands", "Isle of Man"].includes(result.country)) {
          return { postcode, isGreaterLondon: false, source: "POSTCODES_IO", reason: "VERIFIED_COUNTRY", region: result.country };
        }
        const regions = ["North East", "North West", "Yorkshire and The Humber", "East Midlands", "West Midlands", "East of England", "London", "South East", "South West"];
        if (result.country !== "England" || !regions.includes(result.region)) return unknown("UNVERIFIED_REGION");
        return { postcode, isGreaterLondon: result.region === "London", source: "POSTCODES_IO", reason: "VERIFIED_REGION", region: result.region };
      } catch { return unknown("LOOKUP_FAILED"); }
    })();
    cache.delete(postcode);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(postcode, entry);
    const result = await entry.value;
    if (result.isGreaterLondon === null) entry.expires = now() + 60_000;
    return { ...result };
  };
}

const resolveGreaterLondon = createGreaterLondonResolver();

return {fullPostcode,locationPostcode,createGreaterLondonResolver,resolveGreaterLondon};
})();
modules["core/google-routes"] = (() => {
const { locationPostcode } = modules["core/greater-london"];

const ROUTE_ORIGIN = "NW10 5JE";
// No response body, address, key or transport error is logged or propagated.
function createGoogleRoutesResolver({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function resolveRoute(location = {}) {
    const destination = locationPostcode(location);
    const failure = reason => ({ verified: false, source: "GOOGLE_ROUTES", origin: ROUTE_ORIGIN, destination, reason });
    if (!destination) return failure("FULL_DESTINATION_POSTCODE_REQUIRED");
    if (!apiKey?.trim()) return failure("GOOGLE_ROUTES_API_KEY_MISSING");
    try {
      const response = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
        body: JSON.stringify({ origin: { address: `${ROUTE_ORIGIN}, UK` }, destination: { address: `${destination}, UK` },
          travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", computeAlternativeRoutes: false }),
      });
      if (!response.ok) return failure("GOOGLE_ROUTES_HTTP_ERROR");
      const data = await response.json();
      if (!Array.isArray(data.routes) || data.routes.length !== 1) return failure("GOOGLE_ROUTES_NO_UNIQUE_ROUTE");
      const route = data.routes[0];
      const seconds = typeof route.duration === "string" && /^\d+(?:\.\d+)?s$/.test(route.duration) ? Number(route.duration.slice(0, -1)) : NaN;
      if (typeof route.distanceMeters !== "number" || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0 || !Number.isFinite(seconds) || seconds <= 0) return failure("GOOGLE_ROUTES_INVALID_METRICS");
      return { verified: true, source: "GOOGLE_ROUTES", origin: ROUTE_ORIGIN, destination,
        oneWayMiles: route.distanceMeters / 1609.344, oneWayHours: seconds / 3600 };
    } catch { return failure("GOOGLE_ROUTES_REQUEST_FAILED"); }
  };
}

// Evaluated at invocation time so existing environment loading remains authoritative.
const resolveGoogleRoute = location => createGoogleRoutesResolver({ apiKey: process.env.GOOGLE_ROUTES_API_KEY })(location);

return {ROUTE_ORIGIN,createGoogleRoutesResolver,resolveGoogleRoute};
})();
modules["core/route-pricing"] = (() => {
const { recalculateKnownPrice } = modules["core/deterministic-rules"];
const { SUPPORTED_ROLE_SELL_RATES } = modules["core/role-pricing"];
const { locationPostcode } = modules["core/greater-london"];
const { ROUTE_ORIGIN } = modules["core/google-routes"];

const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const ROUTED_PLATFORM_SELL_RATES = Object.freeze({ ...SUPPORTED_ROLE_SELL_RATES, Mixologist: 26, Model: 25 });
const rates = ROUTED_PLATFORM_SELL_RATES;
function verifiedRouteFacts({ location, postcode, route, travelLocation } = {}) {
  const destination = locationPostcode({ location, postcode });
  const routeValid = Boolean(destination && route?.verified === true && route.source === "GOOGLE_ROUTES" && route.origin === ROUTE_ORIGIN && route.destination === destination
    && Number.isFinite(route.oneWayMiles) && route.oneWayMiles > 0 && Number.isFinite(route.oneWayHours) && route.oneWayHours > 0);
  const londonVerified = Boolean(destination && travelLocation?.postcode === destination && travelLocation.source === "POSTCODES_IO" && typeof travelLocation.isGreaterLondon === "boolean");
  return { routeValid, londonVerified };
}
// Bark/Add to Event only. Togather's established pricing path is unchanged.
function priceStaffWithRoute({ platform, staffBreakdown = [], workingHours, location, postcode, route, travelLocation } = {}) {
  if (!["bark", "addtoevent"].includes(platform)) throw new Error("ROUTE_PRICING_PLATFORM_UNSUPPORTED");
  const blockers = [];
  const actualHours = workingHours == null ? null : workingHours;
  const validHours = actualHours === null || (typeof actualHours === "number" && Number.isFinite(actualHours) && actualHours > 0);
  const validStaff = staffBreakdown.length > 0 && staffBreakdown.every(s => Number.isInteger(s.quantity) && s.quantity > 0 && Object.hasOwn(rates, s.role))
    && new Set(staffBreakdown.map(s => s.role)).size === staffBreakdown.length;
  if (!validStaff) blockers.push("NO_VALID_SUPPORTED_STAFF");
  if (!validHours) blockers.push("INVALID_DURATION");
  const billableHours = validHours ? Math.max(6, actualHours ?? 6) : null;
  const labourSubtotal = validHours && validStaff ? money(recalculateKnownPrice({ billableHours, staffBreakdown }, role => rates[role]).labourSubtotal) : null;
  const { routeValid, londonVerified } = verifiedRouteFacts({ location, postcode, route, travelLocation });
  if (!routeValid) blockers.push(route?.reason || "TRAVEL_COSTS_NOT_VERIFIED");
  if (!londonVerified) blockers.push("GREATER_LONDON_NOT_VERIFIED");
  const vehicleCount = validStaff ? Math.ceil(staffBreakdown.reduce((n, s) => n + s.quantity, 0) / 5) : null;
  const roundTripMiles = routeValid ? route.oneWayMiles * 2 : null;
  const vehicleCost = routeValid && validStaff ? money(roundTripMiles * vehicleCount) : null;
  const travelHoursPerStaff = routeValid && londonVerified ? travelLocation.isGreaterLondon ? 0 : Math.max(1, route.oneWayHours) : null;
  const travelLabourCost = validStaff && travelHoursPerStaff !== null ? money(staffBreakdown.reduce((n, s) => n + s.quantity * rates[s.role], 0) * travelHoursPerStaff) : null;
  const complete = labourSubtotal !== null && travelLabourCost !== null && vehicleCost !== null;
  return { workingHours: actualHours, billableHours, durationAssumed: actualHours === null, labourSubtotal, vehicleCount,
    oneWayMiles: routeValid ? route.oneWayMiles : null, oneWayHours: routeValid ? route.oneWayHours : null,
    roundTripMiles, travelHoursPerStaff, travelLabourCost, vehicleCost,
    finalPrice: complete ? money(labourSubtotal + travelLabourCost + vehicleCost) : null,
    priceStatus: complete ? "COMPLETE" : "PARTIAL", pricingBlockers: blockers };
}

// A pure plan: no database handle, network calls, versions, approvals or source records are mutated.
function planPricingDryRun(records = []) {
  return records.map(record => {
    const protectedReason = pricingProtectionReason(record);
    return { platform: record.platform, opportunityId: record.opportunityId, protectedReason,
      ...(protectedReason ? {} : { pricing: priceStaffWithRoute(record) }), writes: 0 };
  });
}

function pricingProtectionReason(record = {}) {
  const statuses = [record.resultStatus, record.status, record.submissionStatus, record.platformState, record.verifiedStatus, record.verifiedPlatformState];
  const submitted = record.quoteSubmitted === true || record.submittedAt || record.submissionVerifiedAt || record.quoteUuid || record.quoteUUID || record.verifiedQuoteUuid || record.platformQuoteId
    || statuses.some(status => ["SENT","SUBMITTED","QUOTE_SUBMITTED","ALREADY_QUOTED","QUOTED","PENDING","ACCEPTED","CONFIRMED","BOOKED","SUBMITTING","QUEUED"]
      .includes(String(status || "").toUpperCase().replace(/[ -]+/g,"_")));
  const edited = record.lastEditedAt || record.lastEditedBy || record.manuallyEdited === true || record.quoteEditedAt || record.editedBy || record.manualOverrideApplied || record.manualApprovedAt
    || ["APPROVED","HOLD","REJECTED"].includes(record.approvalStatus)
    || Object.values(record.manualOverrides || {}).some(v => Array.isArray(v) ? v.length > 0 : typeof v === "number" ? v > 0 : typeof v === "string" && v.trim().length > 0);
  return submitted ? "SUBMITTED_RECORD_PROTECTED" : edited ? "MANUAL_EDIT_PROTECTED" : record.submissionLock ? "SUBMISSION_IN_PROGRESS_PROTECTED" : null;
}

return {ROUTED_PLATFORM_SELL_RATES,verifiedRouteFacts,priceStaffWithRoute,planPricingDryRun,pricingProtectionReason};
})();
modules["platforms/bark/normalize"] = (() => {
const { canonicalStaffRole, recalculateKnownPrice, guestsPerStaffForRole } = modules["core/deterministic-rules"];
const { priceStaffWithRoute, ROUTED_PLATFORM_SELL_RATES } = modules["core/route-pricing"];

// Local adapter input contract, NOT a claimed Bark DOM/API response schema:
// { requestId, customerName, serviceType, eventName, eventDate (YYYY-MM-DD),
//   location, guestCount, requestedStaff: [{ role, quantity? }], budget,
//   customerNotes (explicit null/empty means absent), durationHours,
//   creditStatus, creditsRequired, supplyRequirements: [string] }
// Future extraction must map verified Bark fields into this contract.
const rates = ROUTED_PLATFORM_SELL_RATES;
const text = value => typeof value === "string" ? value.trim() : "";
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const money = value => Math.round(value * 100) / 100;

function normalizeBarkRequest(input = {}, { route, travelLocation } = {}) {
  const missingFields = [];
  const blockers = [];
  const assumptions = [];
  const opportunityId = text(input.requestId);
  const canonicalKey = opportunityId ? `bark:${opportunityId}` : null;
  const customerName = text(input.customerName);
  const serviceType = text(input.serviceType);
  const location = text(input.location);
  const rawDate = text(input.eventDate);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && Number.isFinite(Date.parse(rawDate))
    && new Date(rawDate).toISOString().slice(0, 10) === rawDate;
  const eventDate = validDate ? rawDate : null;
  const guestCount = Number.isInteger(input.guestCount) && input.guestCount > 0 ? input.guestCount : null;
  const budget = typeof input.budget === "number" && Number.isFinite(input.budget) && input.budget >= 0 ? input.budget : null;
  for (const [field, value] of Object.entries({ requestId: opportunityId, customerName, serviceType, eventDate, location, guestCount, budget: budget !== null })) {
    if (!value) missingFields.push(field);
  }
  for (const field of ["requestId", "serviceType", "eventDate", "location"]) {
    if (missingFields.includes(field)) blockers.push(`MISSING_OR_INVALID_${field.toUpperCase()}`);
  }
  const noteProvided = Object.hasOwn(input, "customerNotes");
  const customerNotes = typeof input.customerNotes === "string" ? input.customerNotes : "";
  const customerNoteStatus = !noteProvided || (input.customerNotes !== null && typeof input.customerNotes !== "string")
    ? "UNREAD" : customerNotes.trim() ? "READ" : "NOT_PROVIDED";
  if (customerNoteStatus === "UNREAD") { missingFields.push("customerNotes"); blockers.push("CUSTOMER_NOTES_UNREAD"); }

  const durationMissing = input.durationHours === undefined || input.durationHours === null;
  const workingHours = durationMissing ? null : positive(input.durationHours) ? input.durationHours : null;
  const billableHours = durationMissing ? 6 : workingHours === null ? null : Math.max(6, workingHours);
  if (durationMissing) { missingFields.push("durationHours"); assumptions.push("Working duration not provided; quotation assumes the minimum 6-hour booking."); }
  else if (workingHours === null) blockers.push("INVALID_DURATION");

  const staffBreakdown = [];
  const requestedRoles = [];
  const unsupportedRoles = [];
  const seen = new Set();
  for (const request of Array.isArray(input.requestedStaff) ? input.requestedStaff : []) {
    const role = canonicalStaffRole(text(request?.role));
    requestedRoles.push(text(request?.role));
    if (!Object.hasOwn(rates, role)) { unsupportedRoles.push(text(request?.role) || "UNKNOWN_ROLE"); continue; }
    if (seen.has(role)) { blockers.push("DUPLICATE_ROLE_REQUIRES_REVIEW"); continue; }
    seen.add(role);
    const unspecified = request.quantity === undefined || request.quantity === null;
    const ratio = role === "Bartender" ? 50 : guestsPerStaffForRole(role);
    const quantity = unspecified && ratio && guestCount ? Math.ceil(guestCount / ratio) : request.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) { blockers.push(`MISSING_OR_INVALID_QUANTITY:${role}`); continue; }
    if (unspecified) assumptions.push(`Estimated ${quantity} ${role}(s) at one per ${ratio} guests; customer confirmation may revise the quantity.`);
    staffBreakdown.push({ role, quantity });
  }
  if (!staffBreakdown.length) blockers.push("NO_VALID_SUPPORTED_STAFF");
  if (unsupportedRoles.length) blockers.push("UNSUPPORTED_ROLE_REQUIRES_REVIEW");
  const supplies = Array.isArray(input.supplyRequirements) ? input.supplyRequirements.map(text).filter(Boolean) : [];
  // These are declared requirements, not a keyword-based guess about customer intent.
  if (supplies.length) blockers.push("NON_STAFF_SUPPLY_REQUIRES_REVIEW");
  if (/\b(catering|food|alcohol|ice|equipment)\b/i.test(`${serviceType} ${customerNotes}`)) blockers.push("STAFF_ONLY_SCOPE_REVIEW_REQUIRED");

  const amount = typeof input.creditsRequired === "number" && Number.isFinite(input.creditsRequired) && input.creditsRequired >= 0 ? input.creditsRequired : null;
  const declaredCreditStatus = text(input.creditStatus).toUpperCase();
  const creditStatus = declaredCreditStatus === "FREE" && amount === 0 ? "FREE"
    : declaredCreditStatus === "PAID" && amount > 0 ? "PAID" : "UNKNOWN";
  const price = billableHours !== null && staffBreakdown.length && !blockers.some(code => /QUANTITY|DUPLICATE_ROLE|NO_VALID_SUPPORTED/.test(code))
    ? recalculateKnownPrice({ billableHours, staffBreakdown }, role => rates[role]) : null;
  const labourSubtotal = price ? money(price.labourSubtotal) : null;
  // No route/Greater London evidence is supplied by this fixture contract.
  // A labour preview must never masquerade as a complete customer quotation.
  blockers.push("TRAVEL_COSTS_NOT_VERIFIED");
  const routePricing = route ? priceStaffWithRoute({ platform: "bark", staffBreakdown: blockers.some(code => /QUANTITY|DUPLICATE_ROLE/.test(code)) ? [] : staffBreakdown,
    workingHours: workingHours === null && !durationMissing ? NaN : workingHours, location, route, travelLocation }) : null;
  return {
    platform: "bark", opportunityId, canonicalKey, agentEventId: canonicalKey,
    customer: customerName, customerName, serviceType, eventName: text(input.eventName), eventDate,
    location, guestCount, budget, customerNotes, customerNoteStatus, requestedRoles,
    supportedRoles: staffBreakdown.map(item => item.role), unsupportedRoles, staffBreakdown,
    workingHours, billableHours, durationAssumed: durationMissing, labourSubtotal, finalPrice: null,
    travelHoursPerStaff: null, travelLabourCost: null, vehicleCost: null,
    ...(routePricing || {}),
    ...(route ? { route, travelLocation: travelLocation || null } : {}),
    creditStatus, platformCostEstimate: { unit: "CREDITS", status: creditStatus === "UNKNOWN" ? "UNKNOWN" : "KNOWN", amount: creditStatus === "UNKNOWN" ? null : amount },
    resultStatus: "MANUAL_REVIEW", analysisStatus: "MANUAL_REVIEW", priceStatus: routePricing?.priceStatus || "LABOUR_PREVIEW_ONLY",
    blockingReasons: [...new Set(routePricing ? [...blockers.filter(b => b !== "TRAVEL_COSTS_NOT_VERIFIED"), ...routePricing.pricingBlockers] : blockers)], missingFields, assumptions,
    manualApprovalRequired: true, manualSubmissionEligible: false, autoSubmissionEligible: false,
    quoteSubmitted: false, sourceMetadata: { adapter: "bark-local-fixture-v1", liveSchemaVerified: false },
  };
}

return {normalizeBarkRequest};
})();
modules["core/record-pricing"] = (() => {
const { createHash } = require("node:crypto");
const { normalizeBarkRequest } = modules["platforms/bark/normalize"];
const { priceStaffWithRoute, pricingProtectionReason } = modules["core/route-pricing"];

const stable = v => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(stable)
  : v && typeof v === "object" && v._bsontype === "ObjectId" ? String(v)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const pricingDigest = value => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function barkPricingInput(record) {
  const source = record.barkSource || record;
  const original = source.originalRequest || {};
  const service = String(source.serviceType || original.serviceType || record.serviceType || "");
  let requestedStaff = record.staffBreakdown?.length ? record.staffBreakdown : original.requestedStaff || source.requestedStaff || [];
  const notes = source.customerNotes ?? record.customerNotes;
  const text = String(source.emailRequestText || "");
  if (!requestedStaff.length && /^bartend(?:ing|er)(?:\s+professional)?$/i.test(service.trim())) requestedStaff = [{ role: "Bartender" }];
  // Explicit requested service, not the general Catering category or guest count.
  if (!requestedStaff.length && /(?:^|\n)\s*(?:(\d+)\s+)?waiting staff required\s*(?:$|\n|[,.;])/i.test(text)) {
    const count = text.match(/(?:^|\n)\s*(\d+)\s+waiting staff required\b/i);
    requestedStaff = [{ role: "Waiter", ...(count ? { quantity: Number(count[1]) } : {}) }];
  }
  const status = source.customerNoteStatus || record.customerNoteStatus;
  const hours = source.durationAssumed === true || record.durationAssumed === true ? null
    : (source.originalRequest?.workingHours ?? record.workingHours ?? original.durationHours ?? null);
  const eventDate = record.eventDate instanceof Date ? record.eventDate.toISOString().slice(0,10) : String(record.eventDate || original.eventDate || "").slice(0,10);
  return { requestId: record.opportunityId || record.requestId, serviceType: service, eventDate,
    location: record.location || source.location || original.location || "", guestCount: source.guestCount || record.guestCount || source.guestRange?.max,
    requestedStaff, durationHours: hours === 0 ? null : hours,
    ...(status === "NOT_PROVIDED" ? { customerNotes: null } : status === "READ" && typeof notes === "string" ? { customerNotes: notes } : {}),
    creditStatus: "UNKNOWN" };
}

function calculateRecordPricing(record, { route = record.route, travelLocation = record.travelLocation } = {}) {
  if (!["bark", "addtoevent"].includes(record.platform)) throw Error("PRICING_PLATFORM_UNSUPPORTED");
  if (record.platform === "bark") {
    const normalized = normalizeBarkRequest(barkPricingInput(record), { route, travelLocation });
    const invalidStaff = normalized.blockingReasons.some(code => /DUPLICATE_ROLE|MISSING_OR_INVALID_QUANTITY/.test(code));
    const pricing = priceStaffWithRoute({ ...barkPricingInput(record), platform: "bark", staffBreakdown: invalidStaff ? [] : normalized.staffBreakdown,
      workingHours: normalized.blockingReasons.includes("INVALID_DURATION") ? NaN : normalized.workingHours, route, travelLocation });
    const repaired = new Set(["NO_VALID_SUPPORTED_STAFF", "TRAVEL_COSTS_NOT_VERIFIED"]);
    return { ...pricing, staffBreakdown: normalized.staffBreakdown, assumptions: [...new Set([...(record.assumptions || []), ...normalized.assumptions])],
      blockingReasons: [...new Set([...(record.blockingReasons || []).filter(b => !repaired.has(b)),
        ...normalized.blockingReasons.filter(b => !b.startsWith("MISSING_OR_INVALID_REQUESTID")), ...pricing.pricingBlockers,
        "BARK_REQUEST_ID_UNVERIFIED", "BARK_SUBMISSION_NOT_SUPPORTED"])].sort(),
      resultStatus: "MANUAL_REVIEW", manualSubmissionEligible: false, autoSubmissionEligible: false };
  }
  return priceStaffWithRoute({ ...record, workingHours: record.durationAssumed || record.decisionDetails?.durationExact === false
    ? null : record.workingHours, route, travelLocation });
}

function planRecordRepricing(record) {
  const protectedReason = pricingProtectionReason(record);
  if (protectedReason) return { id: record._id, protectedReason, action: "PRESERVE" };
  const pricing = calculateRecordPricing(record);
  const patch = { ...pricing, travelLabour: pricing.travelLabourCost, travelHours: pricing.travelHoursPerStaff,
    pricingVersion: "google-routes-v2" };
  if (record.quoteSnapshot) patch.quoteSnapshot = { ...record.quoteSnapshot, staffBreakdown: pricing.staffBreakdown || record.staffBreakdown,
    workingHours: pricing.workingHours, finalPrice: pricing.finalPrice };
  // A partial recalculation must never leave an older total/sendability in place.
  if (patch.priceStatus !== "COMPLETE") {
    patch.manualSubmissionEligible = false;
    patch.resultStatus = "MANUAL_REVIEW";
  }
  const same = Object.entries(patch).every(([k,v]) => pricingDigest(record[k] ?? null) === pricingDigest(v ?? null));
  return { id: record._id, action: same ? "UNCHANGED" : "UPDATE", expectedDigest: pricingDigest(record), patch };
}

function summarizeRecordRepricing(records) {
  const report = { records: records.length, updateable: 0, protected: 0, unchanged: 0, complete: 0, manualReview: 0, labourCalculated: 0, reasons: {}, apiCalls: 0, writes: 0 };
  for (const record of records) {
    const plan = planRecordRepricing(record);
    if (plan.action === "PRESERVE") { report.protected++; continue; }
    if (plan.action === "UPDATE") report.updateable++; else report.unchanged++;
    if (plan.patch.priceStatus === "COMPLETE") report.complete++;
    if (plan.patch.labourSubtotal > 0) report.labourCalculated++;
    if (plan.patch.resultStatus === "MANUAL_REVIEW" || record.resultStatus === "MANUAL_REVIEW" || plan.patch.priceStatus !== "COMPLETE") report.manualReview++;
    for (const reason of plan.patch.pricingBlockers || []) report.reasons[reason] = (report.reasons[reason] || 0) + 1;
  }
  return report;
}

// Library only: no CLI apply switch. A caller needs explicit approval plus a fresh CAS snapshot.
async function applyRecordRepricing(collection, snapshot, { approved = false, now = new Date() } = {}) {
  if (approved !== true) throw Error("PRICING_WRITE_APPROVAL_REQUIRED");
  const current = await collection.findOne({ _id: snapshot._id });
  if (!current || pricingDigest(current) !== pricingDigest(snapshot)) return { modifiedCount: 0, reason: "RECORD_CHANGED" };
  const plan = planRecordRepricing(current);
  if (plan.action !== "UPDATE") return { modifiedCount: 0, reason: plan.action };
  // Exact snapshot + known absent guards protect concurrent edits/submission, including legacy records without versions.
  const filter = { ...current };
  for (const key of ["lastEditedAt","lastEditedBy","manualOverrideApplied","manualOverrides","manualApprovedAt","manualApprovedBy","manualApprovedVersion","approvalStatus","submittedAt","submissionVerifiedAt","quoteSubmitted","quoteUuid","verifiedQuoteUuid","platformQuoteId","submissionLock","submissionStatus","recordVersion","updatedAt"]) {
    if (!Object.hasOwn(current,key)) filter[key] = { $exists: false };
  }
  return collection.updateOne(filter, { $set: { ...plan.patch, updatedAt: now, selectedVersion: null,
    selectionSelectedAt: null, selectionSelectedBy: "", approvalStatus: "NEEDS_REVIEW" }, $inc: { recordVersion: 1 } });
}

return {pricingDigest,barkPricingInput,calculateRecordPricing,planRecordRepricing,summarizeRecordRepricing,applyRecordRepricing};
})();
modules["platforms/bark/price-request"] = (() => {
const { normalizeBarkRequest } = modules["platforms/bark/normalize"];
const { resolveGoogleRoute } = modules["core/google-routes"];
const { resolveGreaterLondon } = modules["core/greater-london"];

// Explicit pricing entry point. Does not import worker, database or submission code.
async function priceBarkRequest(input, { routeResolver = resolveGoogleRoute, locationResolver = resolveGreaterLondon } = {}) {
  const route = await routeResolver(input);
  // Missing configuration must not cause even a postcode-network lookup.
  const travelLocation = route.verified ? await locationResolver(input) : null;
  return normalizeBarkRequest(input, { route, travelLocation });
}

return {priceBarkRequest};
})();
module.exports = { sourceHash: "716329dedcb7d46fc65e5989b62e753234cc92df70a80090151d98e0103e3b5b", ...modules["core/record-pricing"], ...modules["core/route-pricing"], ...modules["platforms/bark/price-request"], ...modules["core/google-routes"], ...modules["core/greater-london"] };
