const { createHash } = require("node:crypto");
const { ObjectId } = require("mongoose").Types;
const { prepareBarkPricing } = require("./barkPricing");
const { pricingProtectionReason } = require("./agentPricing.generated.cjs");
const LIMIT = 1000;
const SUBMISSION_BLOCKER = "BARK_SUBMISSION_NOT_SUPPORTED";
const digest = value => createHash("sha256").update(value).digest("hex");
const text = (v, max = 10000) => typeof v === "string" ? v.slice(0, max) : "";
const number = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

function validateBundle(bundle, now = new Date()) {
  if (bundle?.mode === "BASELINE") throw new Error("BARK_LEGACY_BASELINE_REEXPORT_REQUIRED");
  if (!["bark-email-import-v1", "bark-email-import-v2"].includes(bundle?.format) || bundle.complete !== true
    || !["INITIAL", "INCREMENTAL"].includes(bundle.mode) || !Array.isArray(bundle.records)
    || !bundle.records.length || bundle.records.length > LIMIT) throw new Error("BARK_COMPLETE_IMPORT_REQUIRED");
  const startedAt = new Date(bundle.startedAt);
  if (!Number.isFinite(startedAt.getTime()) || startedAt > now) throw new Error("BARK_IMPORT_TIME_INVALID");
  const records = bundle.records.map(r => {
    if (!/^[a-f0-9]{64}$/.test(r?.messageKey || "") || !Number.isFinite(Date.parse(r?.sentAt)) || new Date(r.sentAt) > startedAt) throw new Error("BARK_MESSAGE_METADATA_INVALID");
    const prx = /^\d{1,20}$/.test(r.prx || "") ? r.prx : null;
    const staff = (Array.isArray(r.staffBreakdown) ? r.staffBreakdown : []).map(s => {
      if (!["Waiter", "Bartender", "Barback", "Mixologist", "Supervisor", "Model"].includes(s.role) || !Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > 1000) throw new Error("BARK_STAFF_INVALID");
      return { role: s.role, quantity: s.quantity };
    });
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(r.eventDate || "") && Number.isFinite(Date.parse(r.eventDate))
      && new Date(r.eventDate).toISOString().slice(0, 10) === r.eventDate ? new Date(r.eventDate) : null;
    const credits = number(r.platformCostEstimate?.amount);
    const notificationType = ["REQUEST", "AMBIGUOUS_REQUEST", "NON_REQUEST"].includes(r.notificationType)
      ? r.notificationType : prx ? "AMBIGUOUS_REQUEST" : "NON_REQUEST";
    const receivedAt = Number.isFinite(Date.parse(r.receivedAt)) ? new Date(r.receivedAt) : null;
    return {
      messageKey: r.messageKey, sentAt: new Date(r.sentAt), receivedAt, prx, notificationType,
      opportunityId: prx ? `prx:${prx}` : `mail:${r.messageKey}`,
      value: {
        platform: "bark", eventName: text(r.eventName || r.serviceType || "Bark enquiry", 300), eventDate,
        location: text(r.location, 500), staffBreakdown: staff, workingHours: number(r.workingHours),
        labourSubtotal: number(r.labourSubtotal), finalPrice: null,
        platformCostEstimate: { unit: "CREDITS", status: credits === null ? "UNKNOWN" : "KNOWN", amount: credits },
        assumptions: (r.assumptions || []).filter(v => typeof v === "string").slice(0, 30).map(v => text(v, 1000)),
        blockingReasons: [...new Set([...(r.blockingReasons || []).filter(v => typeof v === "string").slice(0, 30).map(v => text(v, 100)), "BARK_REQUEST_ID_UNVERIFIED", SUBMISSION_BLOCKER, "TRAVEL_COSTS_NOT_VERIFIED",
          ...(!eventDate ? ["BARK_EVENT_DATE_UNVERIFIED"] : []), ...(notificationType === "AMBIGUOUS_REQUEST" ? ["BARK_NOTIFICATION_REVIEW_REQUIRED"] : [])])],
        analysisStatus: "MANUAL_REVIEW", resultStatus: "MANUAL_REVIEW", manualApprovalRequired: true,
        manualSubmissionEligible: false, quoteSubmitted: false,
        barkSource: { prx, identityStatus: "CANDIDATE_UNVERIFIED", customerName: text(r.customerName, 200), serviceType: text(r.serviceType, 200),
          advertisedCreditsRequired: number(r.advertisedCreditsRequired),
          emailRequestText: text(r.emailRequestText, 2000000),
          notificationSentAt: new Date(r.sentAt), emailReceivedAt: receivedAt, requestCreatedAt: null,
          customerNotes: text(r.customerNotes, 2000000), customerNoteStatus: ["READ", "NOT_PROVIDED"].includes(r.customerNoteStatus) ? r.customerNoteStatus : "UNREAD",
          guestRange: cleanRange(r.guestRange), durationRange: cleanRange(r.durationRange),
          guestCount: number(r.guestCount), billableHours: number(r.billableHours), durationAssumed: r.durationAssumed === true,
          // Never persist token-bearing deep links or raw email/headers.
          requestUrl: prx ? `https://www.bark.com/sellers/dashboard/?prx=${prx}` : "",
          originalRequest: { customerName: text(r.customerName, 200), serviceType: text(r.serviceType, 200), location: text(r.location, 500),
            requestedStaff: (Array.isArray(r.originalRequest?.requestedStaff) ? r.originalRequest.requestedStaff : staff).map(s => ({
              role: text(s.role, 100), ...(s.quantity != null ? { quantity: s.quantity } : {})
            })),
            customerNotes: text(r.customerNotes, 2000000), eventDate: eventDate?.toISOString() || null,
            guestCount: number(r.guestCount), workingHours: number(r.workingHours) },
        },
      },
    };
  });
  return { mode: bundle.mode, startedAt, records };
}
function cleanRange(v) {
  return v && number(v.min) !== null && number(v.max) !== null && v.max >= v.min ? { min: v.min, max: v.max } : null;
}

async function importBarkBundle({ db, session, bundle, admin, now = new Date(), pricingOptions }) {
  const input = validateBundle(bundle, now);
  const checkpoints = db.collection("barkmailcheckpoints"), messages = db.collection("barkmailmessages");
  const results = db.collection("salesagentopportunityresults");
  const candidateIds = input.records.map(r => new ObjectId(digest(`bark:${r.opportunityId}`).slice(0, 24)));
  const existingPricing = new Map((await results.find({ _id: { $in: candidateIds } }, { session }).toArray()).map(r => [r.opportunityId, r]));
  const todayForPricing = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year:"numeric",month:"2-digit",day:"2-digit" }).format(now);
  const pricingCandidates = input.records.filter(r => r.notificationType !== "NON_REQUEST" && (!r.value.eventDate || r.value.eventDate.toISOString().slice(0,10) >= todayForPricing));
  await prepareBarkPricing(pricingCandidates, existingPricing, pricingOptions);
  let outcome;
  await session.withTransaction(async () => {
    const options = { session };
    let checkpoint = await checkpoints.findOne({ _id: "proton:Bark Leads" }, options);
    if (!checkpoint && input.mode !== "INITIAL") throw new Error("BARK_INITIAL_IMPORT_REQUIRED");
    // Fetch transaction snapshots in two indexed queries, not two round trips per email.
    const messageKeys = [...new Set(input.records.map(record => `proton:${record.messageKey}`))];
    const resultId = record => new ObjectId(digest(`bark:${record.opportunityId}`).slice(0, 24));
    const resultIds = [...new Map(input.records.map(record => { const id = resultId(record); return [String(id), id]; })).values()];
    const priorMessages = new Map((await messages.find({ _id: { $in: messageKeys } }, options).toArray()).map(record => [String(record._id), record]));
    const priorResults = new Map((await results.find({ _id: { $in: resultIds } }, options).toArray()).map(record => [String(record._id), record]));
    const resultWrites = [];
    const messageWrites = [];
    if (!checkpoint) {
      checkpoint = { _id: "proton:Bark Leads", baselineCutoffUtc: input.startedAt, runId: new ObjectId() };
      await db.collection("salesagentruns").insertOne({ _id: checkpoint.runId, runType: "BARK_EMAIL_IMPORT", status: "COMPLETED", origin: "BARK_MANUAL_EMAIL_IMPORT",
        activeLock: `released:${checkpoint.runId}`, triggeredBy: new ObjectId(String(admin._id)), triggeredByRole: admin.role,
        createdAt: now, updatedAt: now, completedAt: now, finishedAt: now,
        totals: { opportunitiesFound: 0, quotesSubmitted: 0, manualReview: 0, skipped: 0, failed: 0, openAiCalls: 0, platformActions: 0 } }, options);
    }
    outcome = { imported: 0, updated: 0, duplicates: 0, recovered: 0, preserved: 0, ignored: 0, expired: 0 };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    for (const record of input.records) {
      const messageId = `proton:${record.messageKey}`;
      const priorMessage = priorMessages.get(messageId);
      // Controlled recovery touches only legacy baseline messages present in this INITIAL upload.
      const recover = input.mode === "INITIAL" && (priorMessage?.baseline === true || priorMessage?.historical === true) && !priorMessage.evaluatedAt;
      if (priorMessage && !recover) { outcome.duplicates++; continue; }
      const expired = record.value.eventDate && record.value.eventDate.toISOString().slice(0, 10) < today;
      const id = resultId(record);
      const existing = priorResults.get(String(id));
      // Unknown identity is a quarantined candidate, never a sendable new quote.
      if (record.notificationType === "NON_REQUEST") outcome.ignored++;
      else if (!expired) {
        const insert = { ...record.value, _id: id, opportunityId: record.opportunityId, runId: checkpoint.runId, recordVersion: 1, createdAt: now, updatedAt: now };
        if (!existing) {
          resultWrites.push({ insertOne: { document: insert } });
          priorResults.set(String(id), insert);
          outcome.imported++;
        }
        else if (pricingProtectionReason(existing) || existing.quoteSubmitted || existing.quoteUuid || existing.verifiedQuoteUuid || existing.platformQuoteId
          || existing.lastEditedAt || existing.manualOverrideApplied || existing.manualApprovedAt || existing.submissionLock
          || ["READY", "NEEDS_REVIEW", "APPROVED", "HOLD", "REJECTED"].includes(existing.approvalStatus)
          || /SENT|SUBMITTED|PENDING|ACCEPTED|CONFIRMED|BOOKED|ALREADY_QUOTED/.test(String(existing.resultStatus || "").toUpperCase())
          || /SUBMITTED|ALREADY_QUOTED|SENT|QUEUED|SUBMITTING/.test(`${existing.platformState || ""} ${existing.verifiedStatus || ""} ${existing.submissionStatus || ""}`.toUpperCase())
          || (existing.barkSource?.notificationSentAt && new Date(existing.barkSource.notificationSentAt) >= record.sentAt)) {
          outcome.preserved++;
        } else {
          // Preserve edited quotation and invalidate any selection on new source evidence.
          const preserveUnmarkedPrice = existing.finalPrice > 0 && existing.priceStatus !== "COMPLETE";
          const set = { ...(preserveUnmarkedPrice ? { barkSource: record.value.barkSource } : record.value), updatedAt: now, selectedVersion: null,
            blockingReasons: record.value.blockingReasons, resultStatus: "MANUAL_REVIEW", manualSubmissionEligible: false };
          resultWrites.push({ updateOne: { filter: { _id: id, platform: "bark" }, update: { $set: set, $inc: { recordVersion: 1 } } } });
          priorResults.set(String(id), { ...existing, ...set, recordVersion: Number(existing.recordVersion || 0) + 1 });
          outcome.updated++;
        }
      } else outcome.expired++;
      const ledger = { prx: record.prx, sentAt: record.sentAt, receivedAt: record.receivedAt, requestCreatedAt: null,
        importedAt: now, evaluatedAt: now, notificationType: record.notificationType, expired: !!expired };
      if (recover) {
        messageWrites.push({ updateOne: { filter: { _id: messageId }, update: { $set: { ...ledger, baselineRecoveredAt: now } } } });
        outcome.recovered++;
      } else messageWrites.push({ insertOne: { document: { _id: messageId, ...ledger, baseline: false } } });
      // Also deduplicate repeated messages and candidate updates within this same package.
      priorMessages.set(messageId, { ...priorMessage, ...ledger, _id: messageId });
    }
    // Ordered bulk operations retain input order and all-or-nothing transaction semantics.
    // Deliberately sequential: parallel operations on the same session are not supported.
    if (resultWrites.length) await results.bulkWrite(resultWrites, { ...options, ordered: true });
    if (messageWrites.length) await messages.bulkWrite(messageWrites, { ...options, ordered: true });
    await checkpoints.updateOne({ _id: checkpoint._id }, { $set: { baselineCutoffUtc: checkpoint.baselineCutoffUtc, runId: checkpoint.runId,
      lastSuccessfulScanAtUtc: now, lastSuccessfulImportAtUtc: now, initialImportPolicyVersion: 2, status: "COMPLETE_MANUAL_BATCH", mailboxScanComplete: false,
      lastMessageKey: input.records.at(-1).messageKey }, $inc: { batches: 1 } }, { ...options, upsert: true });
    const total = await results.countDocuments({ platform: "bark", runId: checkpoint.runId }, options);
    await db.collection("salesagentruns").updateOne({ _id: checkpoint.runId }, { $set: { updatedAt: now, "totals.opportunitiesFound": total, "totals.manualReview": total } }, options);
  });
  return outcome;
}

function classifyBarkImportError(error = {}) {
  if (/^BARK_[A-Z_]+$/.test(error.message || "")) return { code: error.message, status: error.message === "BARK_DATABASE_NOT_READY" ? 503 : 400 };
  if (error.code === 13) return { code: "BARK_DATABASE_PERMISSION_DENIED", status: 503 };
  if (error.code === 18) return { code: "BARK_DATABASE_AUTHENTICATION_FAILED", status: 503 };
  if (error.code === 11000 || error.code === 112) return { code: "BARK_IMPORT_WRITE_CONFLICT", status: 409 };
  if (error.code === 251) return { code: "BARK_IMPORT_TRANSACTION_ABORTED", status: 503 };
  if (error.code === 20 && /transaction|replica set/i.test(error.message || "")) return { code: "BARK_TRANSACTION_UNSUPPORTED", status: 503 };
  if (["MongoServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError"].includes(error.name)) return { code: "BARK_DATABASE_UNAVAILABLE", status: 503 };
  return { code: "BARK_IMPORT_FAILED", status: 500 };
}

module.exports = { importBarkBundle, validateBundle, classifyBarkImportError, SUBMISSION_BLOCKER };
