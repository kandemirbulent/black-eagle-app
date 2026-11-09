const pricing = require("./agentPricing.generated.cjs");

function priceBarkRecordOffline(record) {
  return pricing.calculateRecordPricing({ ...record, platform: "bark" });
}

// Runs before the import transaction. Do not trust route data in uploaded JSON.
async function prepareBarkPricing(records, previous, { routeResolver = pricing.resolveGoogleRoute, locationResolver = pricing.resolveGreaterLondon } = {}) {
  const cache = new Map();
  for (const record of records) {
    const existing = previous.get(record.opportunityId);
    if (existing && pricing.pricingProtectionReason(existing)) continue;
    if (existing?.barkSource?.notificationSentAt && new Date(existing.barkSource.notificationSentAt) >= record.sentAt) continue;
    const input = { ...record.value, platform: "bark", opportunityId: record.opportunityId };
    const postcode = pricing.locationPostcode(input);
    if (!cache.has(postcode)) cache.set(postcode, (async () => {
      const route = await routeResolver(input);
      return { route, travelLocation: route.verified ? await locationResolver(input) : null };
    })());
    const evidence = await cache.get(postcode);
    const calculated = pricing.calculateRecordPricing(input, evidence);
    Object.assign(record.value, calculated, evidence, {
      travelLabour: calculated.travelLabourCost, travelHours: calculated.travelHoursPerStaff,
      pricingVersion: "google-routes-v2", manualSubmissionEligible: false, autoSubmissionEligible: false,
    });
  }
}
module.exports = { priceBarkRecordOffline, prepareBarkPricing };
