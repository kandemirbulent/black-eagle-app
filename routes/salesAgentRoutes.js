const express = require("express");
const mongoose = require("mongoose");
const {
  createRenderSalesAgentTrigger,
  createRenderSalesAgentJobStatusClient,
  createRenderSalesAgentJobCancelClient,
  MANUAL_REVIEW_WORKER_COMMAND,
  ADD_TO_EVENT_SUBMISSION_WORKER_COMMAND,
} = require("../services/salesAgentJobTrigger");

const SETTINGS_FIELDS = new Set([
  "autoRunEnabled",
  "autoSubmitEnabled",
  "maxOpenAiCallsPerRun",
  "maxOpenAiCallsPerDay",
]);

const RESULT_STATUS_PRECEDENCE = Object.freeze({
  FAILED: 0,
  SKIPPED: 1,
  MANUAL_REVIEW: 2,
  QUOTE_READY: 3,
  SUBMITTED: 4,
  PENDING: 4,
  ACCEPTED: 5,
  CONFIRMED: 5,
  BOOKED: 5,
});
const DEFAULT_QUEUED_TIMEOUT_MS = 600000;
const DEFAULT_WORKER_START_GRACE_MS = 120000;
const MAX_BULK_OPPORTUNITIES = 100;
const APPROVAL_STATUSES = new Set(["NOT_REVIEWED", "READY", "NEEDS_REVIEW", "APPROVED", "HOLD", "REJECTED"]);
const EDITABLE_OVERRIDE_FIELDS = new Set([
  "guestCount", "startTime", "endTime", "durationHours", "requestedRoles", "staffBreakdown",
  "finalPrice", "discountType", "discountValue", "discountReason", "customerMessage",
]);
const TERMINAL_OPPORTUNITY_STATUSES = new Set([
  "SENT", "SUBMITTED", "PENDING", "ACCEPTED", "CONFIRMED", "BOOKED", "ALREADY_QUOTED",
  "EXPIRED", "UNAVAILABLE", "QUEUED", "SUBMITTING",
]);

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function currentQuotePrice(record = {}) {
  const candidates = [record.manualOverrides?.finalPrice, record.quoteSnapshot?.calculatedPrice, record.finalPrice];
  const value = candidates.map(Number).find((candidate) => Number.isFinite(candidate) && candidate > 0);
  return value || 0;
}

function opportunitySelectionPolicy(record = {}) {
  const platform = normalizePlatform(record.platform);
  const status = canonicalStatus(record);
  const approvalStatus = String(record.approvalStatus || "NOT_REVIEWED").toUpperCase();
  const version = Number(record.recordVersion);
  const price = currentQuotePrice(record);
  let blocker = "";
  if (platform !== "addtoevent") blocker = platform === "togather" ? "TOGATHER_AUTOMATIC_POLICY" : "PLATFORM_NOT_SUPPORTED";
  else if (record.manualApprovalRequired !== true || record.manualSubmissionEligible !== true) blocker = "MANUAL_POLICY_NOT_ENABLED";
  else if (status !== "READY") blocker = status === "ALREADY_QUOTED" ? "ALREADY_QUOTED" : `STATUS_${status || "UNKNOWN"}`;
  else if (!["NOT_REVIEWED", "READY", "APPROVED"].includes(approvalStatus)) blocker = `APPROVAL_STATUS_${approvalStatus}`;
  else if (record.quoteSubmitted || record.quoteUuid || TERMINAL_OPPORTUNITY_STATUSES.has(status)) blocker = status === "ALREADY_QUOTED" ? "ALREADY_QUOTED" : `STATUS_${status || "SUBMITTED"}`;
  else if (record.unavailable === true) blocker = "UNAVAILABLE";
  else if (record.expiresAt && new Date(record.expiresAt) <= new Date()) blocker = "EXPIRED";
  else if (record.submissionLock) blocker = "ACTIVE_SUBMISSION_LOCK";
  else if (price <= 0) blocker = "CURRENT_QUOTE_REQUIRED";
  else if (!Number.isInteger(version) || version < 1) blocker = "RECORD_VERSION_REQUIRED";
  return { manualSelectionEligible: !blocker, manualSelectionBlocker: blocker };
}

function serializeOpportunity(record = {}) {
  return { ...record, ...opportunitySelectionPolicy(record) };
}

function validateRecordReferences(records) {
  if (!Array.isArray(records) || !records.length) return { error: "OPPORTUNITY_SELECTION_REQUIRED" };
  if (records.length > MAX_BULK_OPPORTUNITIES) return { error: "OPPORTUNITY_SELECTION_TOO_LARGE" };
  const seen = new Set();
  const normalized = [];
  for (const item of records) {
    const id = String(item?.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return { error: "INVALID_OPPORTUNITY_ID" };
    if (seen.has(id)) return { error: "DUPLICATE_OPPORTUNITY_ID" };
    if (!Number.isInteger(item?.expectedVersion) || item.expectedVersion < 1) return { error: "EXPECTED_VERSION_REQUIRED" };
    seen.add(id);
    normalized.push({ id, expectedVersion: item.expectedVersion });
  }
  return { records: normalized };
}

function validateManualOverrides(body = {}) {
  const keys = Object.keys(body).filter((key) => key !== "expectedVersion");
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) return { error: "EXPECTED_VERSION_REQUIRED" };
  if (!keys.length) return { error: "EDITABLE_FIELDS_REQUIRED" };
  if (keys.some((key) => key.startsWith("$") || !EDITABLE_OVERRIDE_FIELDS.has(key))) return { error: "EDITABLE_FIELD_NOT_ALLOWED" };
  const overrides = {};
  for (const key of keys) overrides[key] = body[key];
  return { expectedVersion: body.expectedVersion, overrides };
}

function redactFailureLog(value) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(password|secret|api.?key|token|cookie|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

function queuedTimeoutMs(env = process.env) {
  const configured = Number(env.SALES_AGENT_QUEUED_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_QUEUED_TIMEOUT_MS;
}

function workerStartGraceMs(env = process.env) {
  const configured = Number(env.SALES_AGENT_WORKER_START_GRACE_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_WORKER_START_GRACE_MS;
}

function withinWorkerStartGrace(run, env, currentTime) {
  const queuedAt = new Date(run?.queuedAt || run?.createdAt || 0);
  return Number.isFinite(queuedAt.getTime())
    && currentTime.getTime() - queuedAt.getTime() < workerStartGraceMs(env);
}

function terminalRenderWithinGrace(render, env, currentTime) {
  const finishedAt = new Date(render?.finishedAt || 0);
  return Number.isFinite(finishedAt.getTime())
    && currentTime.getTime() - finishedAt.getTime() < workerStartGraceMs(env);
}

function workerDiagnosticReason(run = {}) {
  const candidates = [
    run.workerDiagnostic?.errorMessage,
    run.workerDiagnostic?.failureReason,
    run.errorMessage,
    run.failureReason,
    run.errorSummary,
  ];
  return candidates
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .find((value) => /NO_QUEUED_RUN|No queued Sales Agent run|SALES_AGENT_QUEUE_DIAGNOSTICS/i.test(value)) || "";
}

function buildActiveRunDiagnostics(runs = [], { currentTime = new Date(), env = process.env, render = {} } = {}) {
  const activeRunIds = runs.map((run) => {
    const status = String(run.status || "UNKNOWN").toUpperCase();
    const activeLock = String(run.activeLock || "");
    const createdAt = run.createdAt || null;
    const updatedAt = run.updatedAt || null;
    const reference = new Date(updatedAt || createdAt || currentTime);
    const gracePeriodActive = withinWorkerStartGrace(run, env, currentTime)
      || terminalRenderWithinGrace(render, env, currentTime);
    const renderStatus = String(run.renderJobStatus || render.status || "").toLowerCase();
    const actuallyTerminal = ["succeeded", "failed", "canceled"].includes(renderStatus);
    const reasons = [`status ${status}`];
    if (activeLock && !activeLock.startsWith("released:")) reasons.push("lock not released");
    if (gracePeriodActive) reasons.push("grace period active");
    if (["QUEUED", "RUNNING"].includes(status)) reasons.push("waiting for reconciliation");
    return {
      runId: String(run._id || ""), status, activeLock,
      createdAt, updatedAt,
      renderJobId: String(run.renderJobId || run.triggerJobId || ""),
      renderJobStatus: renderStatus,
      ageSeconds: Math.max(0, Math.floor((currentTime.getTime() - reference.getTime()) / 1000)),
      activeReasons: reasons,
      expected: gracePeriodActive || !actuallyTerminal,
      actuallyTerminal,
      reconciliationShouldAlreadyHaveCompleted: actuallyTerminal && !gracePeriodActive,
    };
  });
  return {
    queuedCount: activeRunIds.filter((run) => run.status === "QUEUED").length,
    activeRunCount: activeRunIds.length,
    activeRunIds,
  };
}

async function recoverStaleQueuedRun(SalesAgentRun, { env = process.env, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - Math.max(queuedTimeoutMs(env), workerStartGraceMs(env)));
  return SalesAgentRun.findOneAndUpdate(
    {
      status: "QUEUED",
      $and: [
        { $or: [{ renderJobId: { $exists: false } }, { renderJobId: "" }] },
        { $or: [{ triggerJobId: { $exists: false } }, { triggerJobId: "" }] },
      ],
      $or: [
        { updatedAt: { $lt: cutoff } },
        { updatedAt: { $exists: false }, createdAt: { $lt: cutoff } },
      ],
    },
    {
      $set: {
        status: "FAILED",
        activeLock: "released:stale-queued",
        failureCode: "WORKER_NOT_AVAILABLE",
        triggerStatus: "FAILED",
        errorSummary: "Queued run expired before being claimed by a worker.",
        failedStage: "WORKER_START",
        failureReason: "The worker did not claim the queued run before the timeout.",
        errorMessage: "Queued run expired before being claimed by a worker.",
        failureAt: now,
        completedAt: now,
        finishedAt: now,
        updatedAt: now,
      },
    },
    { new: true, runValidators: true }
  );
}

function canonicalStatus(result = {}, includeVerified = true) {
  const platformState = String(
    (includeVerified && result.verifiedPlatformState) || result.platformState || ""
  ).trim().toUpperCase();
  const resultStatus = String(
    (includeVerified && result.verifiedStatus) || result.resultStatus || result.analysisStatus || ""
  ).trim().toUpperCase();
  const status = platformState || resultStatus;
  return status === "SENT" ? "SUBMITTED" : status;
}

function verifiedCanonicalCandidate(result = {}) {
  const status = canonicalStatus(result);
  if (!["SUBMITTED", "PENDING", "ACCEPTED", "CONFIRMED", "BOOKED"].includes(status)) return true;
  return result.quoteSubmitted === true
    || Boolean(String(result.verifiedQuoteUuid || result.quoteUuid || "").trim());
}

function overlayCanonicalLatest(baseResults = [], allResults = []) {
  const grouped = new Map();
  for (const result of allResults) {
    const key = `${String(result.platform || "").toLowerCase()}:${String(result.opportunityId || "")}`;
    if (!key.endsWith(":") && verifiedCanonicalCandidate(result)) {
      const current = grouped.get(key);
      const rank = RESULT_STATUS_PRECEDENCE[canonicalStatus(result)] ?? -1;
      const currentRank = current ? RESULT_STATUS_PRECEDENCE[canonicalStatus(current)] ?? -1 : -1;
      const timestamp = new Date(result.updatedAt || result.createdAt || 0).getTime();
      const currentTimestamp = current
        ? new Date(current.updatedAt || current.createdAt || 0).getTime()
        : -1;
      if (!current || rank > currentRank || (rank === currentRank && timestamp > currentTimestamp)) {
        grouped.set(key, result);
      }
    }
  }
  return baseResults.map((base) => {
    const key = `${String(base.platform || "").toLowerCase()}:${String(base.opportunityId || "")}`;
    const latest = grouped.get(key);
    if (!latest) return base;
    const baseRank = RESULT_STATUS_PRECEDENCE[canonicalStatus(base, false)] ?? -1;
    const latestStatus = canonicalStatus(latest);
    const latestRank = RESULT_STATUS_PRECEDENCE[latestStatus] ?? -1;
    if (latestRank <= baseRank) return base;
    const submittedOrBetter = latestRank >= RESULT_STATUS_PRECEDENCE.SUBMITTED;
    return {
      ...base,
      resultStatus: latestStatus,
      analysisStatus: latest.analysisStatus || base.analysisStatus,
      quoteSubmitted: submittedOrBetter ? true : latest.quoteSubmitted,
      quoteUuid: latest.verifiedQuoteUuid || latest.quoteUuid || base.quoteUuid,
      platformState: latest.verifiedPlatformState || latest.platformState || latestStatus.toLowerCase(),
      blockingReasons: submittedOrBetter ? [] : (latest.blockingReasons || base.blockingReasons),
      updatedAt: latest.updatedAt || base.updatedAt,
    };
  });
}

function serializeSettings(settings) {
  return settings || {
    key: "global",
    autoRunEnabled: false,
    autoSubmitEnabled: false,
    maxOpenAiCallsPerRun: 0,
    maxOpenAiCallsPerDay: 0,
    updatedBy: null,
    updatedAt: null,
  };
}

function validateSettingsUpdate(body = {}) {
  const keys = Object.keys(body);
  const unknownFields = keys.filter((key) => !SETTINGS_FIELDS.has(key));
  if (unknownFields.length) {
    return { error: `Unknown settings fields: ${unknownFields.join(", ")}` };
  }
  if (!keys.length) return { error: "At least one settings field is required." };

  const update = {};
  for (const key of keys) {
    const value = body[key];
    if (key === "autoRunEnabled" || key === "autoSubmitEnabled") {
      if (typeof value !== "boolean") return { error: `${key} must be a boolean.` };
      update[key] = value;
      continue;
    }
    if (!Number.isInteger(value) || value < 0) {
      return { error: `${key} must be a non-negative integer.` };
    }
    update[key] = value;
  }
  return { update };
}

function createSalesAgentRouter({
  requireAdminAuth,
  requireSuperAdmin,
  SalesAgentRun,
  SalesAgentOpportunityResult,
  SalesAgentSettings,
  triggerSalesAgentRun = createRenderSalesAgentTrigger(),
  getRenderJobStatus = createRenderSalesAgentJobStatusClient(),
  cancelRenderJob = createRenderSalesAgentJobCancelClient(),
  env = process.env,
  now = () => new Date(),
  logger = console,
}) {
  const router = express.Router();

  async function withPersistedResultCount(run) {
    if (!run) return null;
    const value = typeof run.toObject === "function" ? run.toObject() : { ...run };
    value.persistedResultCount = await SalesAgentOpportunityResult.countDocuments({ runId: value._id });
    value.partialResultCount = value.persistedResultCount;
    value.partialResultsAvailable = value.persistedResultCount > 0
      && ["RUNNING", "FAILED", "CANCELED"].includes(String(value.status || "").toUpperCase());
    return value;
  }

  async function releaseFailedAddToEventSubmissionLocks(results = []) {
    for (const result of results) {
      const lockRunId = result?.submissionLock?.runId;
      const hasVerifiedQuote = result?.quoteSubmitted === true
        || Boolean(String(result?.verifiedQuoteUuid || result?.quoteUuid || "").trim());
      if (normalizePlatform(result?.platform) !== "addtoevent" || !lockRunId || hasVerifiedQuote) continue;
      const run = await SalesAgentRun.findById(lockRunId).lean();
      const terminal = ["COMPLETED", "FAILED", "CANCELED"].includes(String(run?.status || "").toUpperCase());
      const noPlatformAction = Number(run?.totals?.platformActions || 0) === 0
        && Number(run?.totals?.quotesSubmitted || 0) === 0;
      if (!terminal || !noPlatformAction || run?.runType !== "ADD_TO_EVENT_SUBMISSION") continue;
      const cleared = await SalesAgentOpportunityResult.findOneAndUpdate(
        { _id: result._id, recordVersion: result.recordVersion, "submissionLock.runId": lockRunId },
        { $set: { submissionLock: null, selectedVersion: null, selectionSelectedAt: null, selectionSelectedBy: "" } },
        { new: true, runValidators: true }
      ).lean();
      if (cleared) Object.assign(result, cleared);
    }
    return results;
  }

  async function reconcileRun(run, renderOverride = null) {
    if (!run) return run;
    const localStatus = String(run.status).toUpperCase();
    if (["COMPLETED", "FAILED", "CANCELED"].includes(localStatus)) {
      if (String(run.activeLock || "") === "global" || !run.finishedAt) {
        const terminalAt = new Date(run.finishedAt || run.completedAt || run.failureAt || run.updatedAt || now());
        return await SalesAgentRun.findOneAndUpdate(
          { _id: run._id, status: localStatus },
          { $set: { activeLock: `released:${run._id}`, finishedAt: terminalAt } },
          { new: true, runValidators: true }
        ) || run;
      }
      return run;
    }
    if (!["QUEUED", "RUNNING"].includes(localStatus)) return run;
    const jobId = String(run.renderJobId || run.triggerJobId || "").trim();
    const serviceId = String(run.renderServiceId || env.RENDER_SALES_AGENT_SERVICE_ID || "").trim();
    if (!jobId) return run;
    let render = renderOverride;
    try {
      if (!render) render = await getRenderJobStatus({ serviceId, jobId });
    } catch (error) {
      logger.error("Sales Agent Render reconciliation failed", redactFailureLog(error?.stack || error));
      return run;
    }
    if (render?.timedOut) return run;
    const checkedAt = render?.checkedAt ? new Date(render.checkedAt) : now();
    const status = String(render?.status || "").toLowerCase();
    const baseSet = {
      renderServiceId: serviceId,
      renderJobId: jobId,
      renderJobStatus: render?.missing ? "missing" : status,
      lastRenderStatusCheckAt: checkedAt,
    };
    if (render?.startedAt) baseSet.renderStartedAt = new Date(render.startedAt);
    if (["pending", "running"].includes(status)) {
      const updated = await SalesAgentRun.findOneAndUpdate(
        { _id: run._id, status: { $in: ["QUEUED", "RUNNING"] } },
        { $set: baseSet },
        { new: true, runValidators: true }
      );
      return updated || run;
    }
    let terminalStatus = "";
    let failureCode = "";
    let failureReason = "";
    if (status === "canceled") {
      terminalStatus = "CANCELED";
      failureCode = "RENDER_JOB_CANCELED";
      failureReason = "RENDER_JOB_CANCELED";
    } else if (status === "failed") {
      terminalStatus = "FAILED";
      failureCode = "RENDER_JOB_FAILED";
      failureReason = "The Render One-Off Job failed before the workflow recorded completion.";
    } else if (status === "succeeded") {
      if (["QUEUED", "RUNNING"].includes(String(run.status).toUpperCase())
        && (withinWorkerStartGrace(run, env, now()) || terminalRenderWithinGrace(render, env, now()))) {
        return run;
      }
      terminalStatus = "FAILED";
      const activeRuns = await SalesAgentRun.find({ status: { $in: ["QUEUED", "RUNNING"] } })
        .select("_id status activeLock createdAt updatedAt renderJobId triggerJobId renderJobStatus")
        .lean();
      const activeDiagnostic = buildActiveRunDiagnostics(activeRuns, { currentTime: now(), env, render });
      logger.info?.(`SALES_AGENT_QUEUE_DIAGNOSTICS ${JSON.stringify(activeDiagnostic)}`);
      if (activeDiagnostic.activeRunCount === 1 && activeDiagnostic.queuedCount === 0) {
        logger.info?.(`SALES_AGENT_ACTIVE_RUN_DIAGNOSTICS ${JSON.stringify(activeDiagnostic.activeRunIds[0])}`);
      }
      const current = activeDiagnostic.activeRunIds.find((item) => item.runId === String(run._id));
      const preservedWorkerReason = workerDiagnosticReason(run);
      failureCode = "NO_QUEUED_RUN";
      failureReason = preservedWorkerReason || (
        `NO_QUEUED_RUN: Worker found no eligible QUEUED Sales Agent run; `
        + `activeRunCount=${activeDiagnostic.activeRunCount}; queuedCount=${activeDiagnostic.queuedCount}; `
        + `runId=${String(run._id)}; status=${current?.status || String(run.status).toUpperCase()}; `
        + `activeLock=${current?.activeLock || String(run.activeLock || "")}.`
      );
    } else if (render?.missing) {
      const reference = new Date(run.triggeredAt || run.updatedAt || run.createdAt || 0);
      if (!Number.isFinite(reference.getTime()) || now().getTime() - reference.getTime() < queuedTimeoutMs(env)) return run;
      terminalStatus = "FAILED";
      failureCode = "RENDER_JOB_MISSING";
      failureReason = "The Render job could not be found after the stale-run threshold.";
    } else {
      return run;
    }
    const finishedAt = render?.finishedAt ? new Date(render.finishedAt) : now();
    const updated = await SalesAgentRun.findOneAndUpdate(
      { _id: run._id, status: { $in: ["QUEUED", "RUNNING"] } },
      { $set: {
        ...baseSet,
        status: terminalStatus,
        activeLock: `released:${run._id}`,
        failureCode,
        failureReason,
        errorSummary: failureReason,
        errorMessage: failureReason,
        failureAt: finishedAt,
        completedAt: finishedAt,
        finishedAt,
        renderFinishedAt: finishedAt,
      } },
      { new: true, runValidators: true }
    );
    return updated || await SalesAgentRun.findById(run._id).lean() || run;
  }

  async function markRenderTriggerFailed(run, triggerError) {
    logger.error("Sales Agent failure at RENDER_TRIGGER", redactFailureLog(triggerError?.stack || triggerError));
    const failedAt = now();
    const diagnostic = triggerError?.diagnostic || {};
    const safeRenderMessage = diagnostic.safeMessage || "Sales Agent worker could not be started.";
    const failedRun = await SalesAgentRun.findByIdAndUpdate(
      run._id,
      {
        $set: {
          status: "FAILED",
          activeLock: `released:${run._id}`,
          triggerStatus: "FAILED",
          failureCode: diagnostic.errorCode || "WORKER_TRIGGER_FAILED",
          errorSummary: "Sales Agent worker could not be started.",
          failedStage: "RENDER_TRIGGER",
          failureReason: "Render could not create the Sales Agent job.",
          errorMessage: safeRenderMessage,
          failureAt: failedAt,
          failureHttpStatus: diagnostic.httpStatus || null,
          failureHttpStatusText: diagnostic.httpStatusText || "",
          upstreamErrorCode: diagnostic.renderErrorCode || diagnostic.errorCode || "",
          upstreamResponseBody: diagnostic.responseBody || "",
          failureRequestAt: diagnostic.requestTimestamp ? new Date(diagnostic.requestTimestamp) : failedAt,
          completedAt: failedAt,
          finishedAt: failedAt,
        },
      },
      { new: true, runValidators: true }
    );
    return { failedRun: failedRun || run, safeRenderMessage };
  }

  router.get("/admin/sales-agent/opportunities/:id", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, code: "INVALID_OPPORTUNITY_ID" });
    }
    const opportunity = await SalesAgentOpportunityResult.findById(req.params.id).lean();
    if (!opportunity) return res.status(404).json({ success: false, code: "OPPORTUNITY_NOT_FOUND" });
    return res.json({ success: true, opportunity: serializeOpportunity(opportunity) });
  });

  router.patch("/admin/sales-agent/opportunities/:id", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, code: "INVALID_OPPORTUNITY_ID" });
    }
    const validation = validateManualOverrides(req.body || {});
    if (validation.error) return res.status(400).json({ success: false, code: validation.error });
    const existing = await SalesAgentOpportunityResult.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, code: "OPPORTUNITY_NOT_FOUND" });
    const policy = opportunitySelectionPolicy(existing);
    if (normalizePlatform(existing.platform) !== "addtoevent" || existing.manualApprovalRequired !== true) {
      return res.status(409).json({ success: false, code: policy.manualSelectionBlocker || "PLATFORM_POLICY_BLOCKED" });
    }
    const set = Object.fromEntries(Object.entries(validation.overrides).map(([key, value]) => [`manualOverrides.${key}`, value]));
    set.lastEditedAt = now();
    set.lastEditedBy = String(req.adminUser._id);
    set.approvalStatus = "NOT_REVIEWED";
    const updated = await SalesAgentOpportunityResult.findOneAndUpdate(
      { _id: req.params.id, recordVersion: validation.expectedVersion },
      { $set: set, $inc: { recordVersion: 1 } },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) return res.status(409).json({ success: false, code: "OPPORTUNITY_VERSION_CONFLICT" });
    return res.json({ success: true, opportunity: serializeOpportunity(updated) });
  });

  router.post("/admin/sales-agent/opportunities/bulk-status", requireAdminAuth, async (req, res) => {
    const validation = validateRecordReferences(req.body?.records);
    if (validation.error) return res.status(400).json({ success: false, code: validation.error });
    const targetStatus = String(req.body?.targetStatus || "").toUpperCase();
    if (!["HOLD", "REJECTED"].includes(targetStatus)) {
      return res.status(400).json({ success: false, code: "INVALID_TARGET_STATUS" });
    }
    const outcomes = [];
    for (const reference of validation.records) {
      const existing = await SalesAgentOpportunityResult.findById(reference.id).lean();
      if (!existing) {
        outcomes.push({ id: reference.id, success: false, code: "OPPORTUNITY_NOT_FOUND" });
        continue;
      }
      const policy = opportunitySelectionPolicy(existing);
      if (!policy.manualSelectionEligible) {
        outcomes.push({ id: reference.id, success: false, code: policy.manualSelectionBlocker });
        continue;
      }
      const updated = await SalesAgentOpportunityResult.findOneAndUpdate(
        { _id: reference.id, recordVersion: reference.expectedVersion },
        {
          $set: {
            approvalStatus: targetStatus,
            lastEditedAt: now(),
            lastEditedBy: String(req.adminUser._id),
          },
          $inc: { recordVersion: 1 },
        },
        { new: true, runValidators: true }
      ).lean();
      outcomes.push(updated
        ? { id: reference.id, success: true, opportunity: serializeOpportunity(updated) }
        : { id: reference.id, success: false, code: "OPPORTUNITY_VERSION_CONFLICT" });
    }
    return res.json({ success: outcomes.every((item) => item.success), outcomes });
  });

  router.post("/admin/sales-agent/opportunities/selection-preview", requireAdminAuth, async (req, res) => {
    const validation = validateRecordReferences(req.body?.records);
    if (validation.error) return res.status(400).json({ success: false, code: validation.error });
    const records = [];
    const blocked = [];
    for (const reference of validation.records) {
      const existing = await SalesAgentOpportunityResult.findById(reference.id).lean();
      if (!existing) {
        blocked.push({ id: reference.id, code: "OPPORTUNITY_NOT_FOUND" });
        continue;
      }
      if (Number(existing.recordVersion) !== reference.expectedVersion) {
        blocked.push({ id: reference.id, code: "OPPORTUNITY_VERSION_CONFLICT" });
        continue;
      }
      const serialized = serializeOpportunity(existing);
      if (!serialized.manualSelectionEligible) {
        blocked.push({ id: reference.id, code: serialized.manualSelectionBlocker });
        continue;
      }
      records.push(serialized);
    }
    const platformBreakdown = records.reduce((totals, record) => {
      const platform = String(record.platform || "unknown").toLowerCase();
      totals[platform] = (totals[platform] || 0) + 1;
      return totals;
    }, {});
    const sum = (selector) => records.reduce((total, record) => total + (Number(selector(record)) || 0), 0);
    return res.json({
      success: blocked.length === 0,
      preview: {
        selectedCount: records.length,
        opportunityIds: records.map((record) => record.opportunityId),
        platformBreakdown,
        combinedQuotationValue: sum(currentQuotePrice),
        estimatedCredits: sum((record) => record.platformCostEstimate?.status === "KNOWN" ? record.platformCostEstimate.amount : 0),
        estimatedRevenue: sum((record) => record.quoteSnapshot?.estimatedRevenue),
        estimatedProfit: sum((record) => record.quoteSnapshot?.estimatedProfit),
        records,
        blocked,
        noSubmission: true,
        message: "Submission worker is not enabled in this phase.",
      },
    });
  });

  router.post("/admin/sales-agent/opportunities/selection", requireAdminAuth, async (req, res) => {
    const validation = validateRecordReferences(req.body?.records);
    if (validation.error) return res.status(400).json({ success: false, code: validation.error });
    if (validation.records.length !== 1 || typeof req.body?.selected !== "boolean") {
      return res.status(400).json({ success: false, code: "SINGLE_SELECTION_UPDATE_REQUIRED" });
    }
    const reference = validation.records[0];
    const existing = await SalesAgentOpportunityResult.findById(reference.id).lean();
    if (!existing) return res.status(404).json({ success: false, code: "OPPORTUNITY_NOT_FOUND" });
    if (Number(existing.recordVersion) !== reference.expectedVersion) {
      return res.status(409).json({ success: false, code: "OPPORTUNITY_VERSION_CONFLICT" });
    }
    if (req.body.selected) {
      const policy = opportunitySelectionPolicy(existing);
      if (!policy.manualSelectionEligible || canonicalStatus(existing) !== "READY") {
        return res.status(409).json({ success: false, code: policy.manualSelectionBlocker || "STATUS_NOT_READY" });
      }
    }
    const updated = await SalesAgentOpportunityResult.findOneAndUpdate(
      { _id: reference.id, recordVersion: reference.expectedVersion },
      { $set: req.body.selected ? {
        selectedVersion: reference.expectedVersion,
        selectionSelectedAt: now(),
        selectionSelectedBy: String(req.adminUser._id),
      } : {
        selectedVersion: null,
        selectionSelectedAt: null,
        selectionSelectedBy: "",
      } },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) return res.status(409).json({ success: false, code: "OPPORTUNITY_VERSION_CONFLICT" });
    return res.json({ success: true, selected: req.body.selected, opportunity: serializeOpportunity(updated) });
  });

  router.post("/admin/sales-agent/opportunities/submit-selected", requireAdminAuth, async (req, res) => {
    const validation = validateRecordReferences(req.body?.records);
    if (validation.error) return res.status(400).json({ success: false, code: validation.error });
    const selected = [];
    for (const reference of validation.records) {
      const existing = await SalesAgentOpportunityResult.findById(reference.id).lean();
      if (!existing) return res.status(404).json({ success: false, code: "OPPORTUNITY_NOT_FOUND" });
      if (Number(existing.recordVersion) !== reference.expectedVersion) return res.status(409).json({ success: false, code: "OPPORTUNITY_VERSION_CONFLICT" });
      if (Number(existing.selectedVersion) !== reference.expectedVersion) return res.status(409).json({ success: false, code: "PERSISTED_SELECTION_REQUIRED" });
      const policy = opportunitySelectionPolicy(existing);
      if (!policy.manualSelectionEligible || canonicalStatus(existing) !== "READY") {
        return res.status(409).json({ success: false, code: policy.manualSelectionBlocker || "STATUS_NOT_READY" });
      }
      const credits = existing.platformCostEstimate || {};
      if (credits.status !== "KNOWN" || !Number.isFinite(Number(credits.amount))) {
        return res.status(409).json({ success: false, code: "CREDIT_COST_UNKNOWN" });
      }
      selected.push({ record: existing, reference, price: currentQuotePrice(existing), credits: Number(credits.amount) });
    }
    const activeSubmissionRun = await SalesAgentRun.findOne({
      runType: "ADD_TO_EVENT_SUBMISSION",
      status: { $in: ["QUEUED", "RUNNING"] },
      activeLock: "global",
    }).sort({ createdAt: -1 }).lean();
    if (activeSubmissionRun) {
      const reconciled = await reconcileRun(activeSubmissionRun);
      if (["QUEUED", "RUNNING"].includes(String(reconciled?.status || "").toUpperCase())) {
        return res.status(409).json({ success: false, code: "ADD_TO_EVENT_SUBMISSION_ALREADY_ACTIVE" });
      }
    }
    let run;
    const lockedIds = [];
    try {
      run = await SalesAgentRun.create({
        runType: "ADD_TO_EVENT_SUBMISSION", status: "QUEUED", activeLock: "global", origin: "ADMIN_DASHBOARD_SELECTION",
        queuedAt: now(), triggeredBy: req.adminUser._id, triggeredByRole: req.adminUser.role, triggerStatus: "TRIGGERING",
        submissionSelection: {
          records: selected.map(({ record, reference }) => ({ id: reference.id, selectedVersion: reference.expectedVersion, opportunityId: record.opportunityId, platform: "addtoevent" })),
          selectedCount: selected.length,
          approvedCreditCost: selected.reduce((sum, item) => sum + item.credits, 0),
          combinedQuotationValue: selected.reduce((sum, item) => sum + item.price, 0),
        },
      });
      for (const item of selected) {
        const locked = await SalesAgentOpportunityResult.findOneAndUpdate(
          { _id: item.reference.id, recordVersion: item.reference.expectedVersion, submissionLock: null },
          { $set: { approvalStatus: "APPROVED", submissionLock: { runId: run._id, selectedAt: now(), selectedBy: String(req.adminUser._id) } } },
          { new: true, runValidators: true }
        ).lean();
        if (!locked) {
          const error = new Error("Selection changed before submission lock.");
          error.code = "OPPORTUNITY_VERSION_CONFLICT";
          throw error;
        }
        lockedIds.push(item.reference.id);
      }
      const trigger = await triggerSalesAgentRun({ startCommand: ADD_TO_EVENT_SUBMISSION_WORKER_COMMAND });
      const queued = await SalesAgentRun.findOneAndUpdate(
        { _id: run._id, status: "QUEUED" },
        { $set: { triggerStatus: "TRIGGERED", triggerJobId: trigger.jobId, renderJobId: trigger.jobId, renderServiceId: env.RENDER_SALES_AGENT_SERVICE_ID || "", triggeredAt: now() } },
        { new: true, runValidators: true }
      );
      return res.status(201).json({ success: true, run: queued, selectedCount: selected.length, estimatedCredits: selected.reduce((sum, item) => sum + item.credits, 0) });
    } catch (error) {
      await Promise.all(lockedIds.map((id) => SalesAgentOpportunityResult.findOneAndUpdate(
        { _id: id, "submissionLock.runId": run?._id }, { $set: { selectedVersion: null, submissionLock: null } }, { new: true }
      )));
      if (run) await SalesAgentRun.findOneAndUpdate(
        { _id: run._id }, { $set: { status: "FAILED", activeLock: `released:${run._id}`, triggerStatus: "FAILED", failedStage: "RENDER_TRIGGER", failureCode: error.code || "WORKER_TRIGGER_FAILED", completedAt: now(), finishedAt: now() } }, { new: true }
      );
      const conflict = error.code === "OPPORTUNITY_VERSION_CONFLICT";
      return res.status(conflict ? 409 : 503).json({ success: false, code: conflict ? error.code : "WORKER_TRIGGER_FAILED" });
    }
  });

  router.post("/admin/sales-agent/runs", requireAdminAuth, async (req, res) => {
    try {
      await recoverStaleQueuedRun(SalesAgentRun, { env, now: now() });
      const run = await SalesAgentRun.create({
        runType: "DISCOVERY",
        status: "QUEUED",
        activeLock: "global",
        origin: "ADMIN_DASHBOARD",
        queuedAt: now(),
        triggeredBy: req.adminUser._id,
        triggeredByRole: req.adminUser.role,
        triggerStatus: "TRIGGERING",
      });
      try {
        const persistedRun = await SalesAgentRun.findById(run._id)
          .select("_id runType status activeLock origin queuedAt triggerStatus")
          .lean();
        if (!persistedRun || String(persistedRun._id) !== String(run._id)
          || persistedRun.status !== "QUEUED" || persistedRun.activeLock !== "global") {
          const handoffError = new Error("Persisted Sales Agent run could not be verified before Render trigger.");
          handoffError.code = "RUN_PERSISTENCE_VERIFICATION_FAILED";
          throw handoffError;
        }
        logger.info?.(`SALES_AGENT_RUN_PERSISTED runId=${String(persistedRun._id)} status=${persistedRun.status}`);
        const trigger = await triggerSalesAgentRun({ runId: String(run._id) });
        const triggeredRun = await SalesAgentRun.findByIdAndUpdate(
          run._id,
          {
            $set: {
              triggerStatus: "TRIGGERED",
              triggerJobId: trigger.jobId,
              renderServiceId: String(env.RENDER_SALES_AGENT_SERVICE_ID || ""),
              renderJobId: trigger.jobId,
              renderJobStatus: "pending",
              triggeredAt: new Date(),
            },
          },
          { new: true, runValidators: true }
        );
        return res.status(201).json({ success: true, run: triggeredRun || run });
      } catch (triggerError) {
        const { failedRun, safeRenderMessage } = await markRenderTriggerFailed(run, triggerError);
        return res.status(503).json({
          success: false,
          code: "WORKER_TRIGGER_FAILED",
          message: safeRenderMessage,
          run: failedRun || run,
        });
      }
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          code: "SALES_AGENT_RUN_ALREADY_ACTIVE",
          message: "A Sales Agent run is already queued or running.",
        });
      }
      logger.error("Sales Agent run creation failed", redactFailureLog(error?.stack || error));
      return res.status(500).json({ success: false, message: "Could not create Sales Agent run." });
    }
  });

  router.post("/admin/sales-agent/manual-review-runs", requireAdminAuth, async (req, res) => {
    const sourceRunId = String(req.body?.sourceRunId || "").trim();
    logger.info?.(`MANUAL_REVIEW_REQUEST sourceRunId=${sourceRunId}`);
    if (!sourceRunId) {
      return res.status(400).json({ success: false, code: "SOURCE_RUN_ID_REQUIRED" });
    }
    if (!mongoose.Types.ObjectId.isValid(sourceRunId)) {
      return res.status(400).json({ success: false, code: "INVALID_SOURCE_RUN_ID" });
    }
    try {
      const sourceRun = await SalesAgentRun.findById(sourceRunId).select("_id").lean();
      if (!sourceRun) {
        return res.status(404).json({ success: false, code: "SOURCE_RUN_NOT_FOUND" });
      }
      const manualReviewCount = await SalesAgentOpportunityResult.countDocuments({
        runId: sourceRunId,
        resultStatus: "MANUAL_REVIEW",
      });
      if (!manualReviewCount) {
        return res.status(409).json({ success: false, code: "NO_MANUAL_REVIEW_RECORDS" });
      }
      const run = await SalesAgentRun.create({
        runType: "MANUAL_REVIEW_RESUME",
        sourceRunId,
        status: "QUEUED",
        activeLock: `manual-review:${sourceRunId}`,
        triggeredBy: req.adminUser._id,
        triggeredByRole: req.adminUser.role,
        triggerStatus: "TRIGGERING",
        manualReviewResume: {
          selectedCount: manualReviewCount,
          remainingManualReview: manualReviewCount,
        },
      });
      try {
        const persistedTrigger = await SalesAgentRun.findById(run._id).select("_id sourceRunId").lean();
        const persistedSourceRunId = String(persistedTrigger?.sourceRunId || "");
        logger.info?.(`MANUAL_REVIEW_TRIGGER sourceRunId=${persistedSourceRunId}`);
        if (persistedSourceRunId !== sourceRunId) {
          await SalesAgentRun.findByIdAndUpdate(run._id, {
            $set: {
              status: "FAILED",
              activeLock: `released:${run._id}`,
              triggerStatus: "FAILED",
              failureCode: "MANUAL_REVIEW_SOURCE_RUN_MISMATCH",
              failureReason: "The persisted manual-review source run did not match the selected run.",
              errorMessage: "MANUAL_REVIEW_SOURCE_RUN_MISMATCH",
              failedStage: "RENDER_TRIGGER",
              failureAt: now(),
              completedAt: now(),
              finishedAt: now(),
            },
          });
          return res.status(409).json({ success: false, code: "MANUAL_REVIEW_SOURCE_RUN_MISMATCH" });
        }
        logger.info?.(`MANUAL_REVIEW_WORKER_SOURCE_RUN sourceRunId=${persistedSourceRunId}`);
        const trigger = await triggerSalesAgentRun({
          runId: String(run._id),
          startCommand: MANUAL_REVIEW_WORKER_COMMAND,
          sourceRunId,
          persistedSourceRunId,
        });
        const triggeredRun = await SalesAgentRun.findByIdAndUpdate(
          run._id,
        { $set: {
          triggerStatus: "TRIGGERED", triggerJobId: trigger.jobId, triggeredAt: now(),
          renderServiceId: String(env.RENDER_SALES_AGENT_SERVICE_ID || ""), renderJobId: trigger.jobId, renderJobStatus: "pending",
        } },
          { new: true, runValidators: true }
        );
        return res.status(201).json({
          success: true,
          run: triggeredRun || run,
          sourceRunId,
          manualReviewCount,
        });
      } catch (triggerError) {
        const { failedRun, safeRenderMessage } = await markRenderTriggerFailed(run, triggerError);
        return res.status(503).json({
          success: false,
          code: "WORKER_TRIGGER_FAILED",
          message: safeRenderMessage,
          run: failedRun,
        });
      }
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          code: "MANUAL_REVIEW_RESUME_ALREADY_ACTIVE",
          message: "A manual review submission is already active for this source run.",
        });
      }
      logger.error("Manual review resume creation failed", redactFailureLog(error?.stack || error));
      return res.status(500).json({ success: false, code: "MANUAL_REVIEW_RESUME_CREATE_FAILED" });
    }
  });

  router.get("/admin/sales-agent/manual-review-runs/status", requireAdminAuth, async (req, res) => {
    const sourceRunId = String(req.query.sourceRunId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(sourceRunId)) {
      return res.status(400).json({ success: false, code: "INVALID_SOURCE_RUN_ID" });
    }
    const run = await SalesAgentRun.findOne({
      runType: "MANUAL_REVIEW_RESUME",
      sourceRunId,
    }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, run: run || null });
  });

  router.get("/admin/sales-agent/runs", requireAdminAuth, async (req, res) => {
    const runs = await SalesAgentRun.find({ runType: { $in: ["DISCOVERY", null] } })
      .sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ success: true, runs: await Promise.all(runs.map(withPersistedResultCount)) });
  });

  router.post("/admin/sales-agent/runs/:runId/reconcile", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
      return res.status(400).json({ success: false, code: "INVALID_RUN_ID" });
    }
    const run = await SalesAgentRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ success: false, code: "SALES_AGENT_RUN_NOT_FOUND" });
    const previousStatus = String(run.status || "").toUpperCase();
    const previousLock = String(run.activeLock || "");
    const reconciled = await reconcileRun(run);
    const value = await withPersistedResultCount(reconciled);
    const newStatus = String(value?.status || previousStatus).toUpperCase();
    const lockReleased = previousLock === "global" && String(value?.activeLock || "") !== "global";
    const reconciliationReason = newStatus === previousStatus && !lockReleased
      ? "RUN_STILL_ACTIVE_OR_ALREADY_CONSISTENT"
      : String(value?.failureCode || (lockReleased ? "TERMINAL_LOCK_RELEASED" : "STATUS_RECONCILED"));
    return res.json({
      success: true,
      run: value,
      reconciliation: {
        previousStatus,
        newStatus,
        lockReleased,
        preservedResultCount: Number(value?.persistedResultCount || 0),
        reconciliationReason,
      },
    });
  });

  router.post("/admin/sales-agent/runs/:runId/cancel", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
      return res.status(400).json({ success: false, code: "INVALID_RUN_ID" });
    }
    const run = await SalesAgentRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ success: false, code: "SALES_AGENT_RUN_NOT_FOUND" });
    const localStatus = String(run.status || "").toUpperCase();
    if (localStatus === "CANCELED") {
      return res.json({ success: true, run: await withPersistedResultCount(run), idempotent: true });
    }
    if (!["QUEUED", "RUNNING"].includes(localStatus)) {
      return res.status(409).json({ success: false, code: "SALES_AGENT_RUN_NOT_ACTIVE", run: await withPersistedResultCount(run) });
    }
    const jobId = String(run.renderJobId || run.triggerJobId || "").trim();
    const serviceId = String(run.renderServiceId || env.RENDER_SALES_AGENT_SERVICE_ID || "").trim();
    if (!jobId || !serviceId) {
      return res.status(409).json({ success: false, code: "RENDER_JOB_REFERENCE_MISSING" });
    }
    try {
      const current = await getRenderJobStatus({ serviceId, jobId });
      if (current?.timedOut) {
        return res.status(503).json({ success: false, code: "RENDER_CANCEL_INCONCLUSIVE", message: "Render status check timed out. The run was not changed." });
      }
      if (["canceled", "failed", "succeeded"].includes(String(current?.status || "").toLowerCase())) {
        const reconciled = await reconcileRun(run, current);
        return res.json({ success: true, run: await withPersistedResultCount(reconciled), alreadyTerminal: true });
      }
      if (!["pending", "running"].includes(String(current?.status || "").toLowerCase())) {
        return res.status(503).json({ success: false, code: "RENDER_CANCEL_INCONCLUSIVE", message: "Render did not return a cancellable job state. The run was not changed." });
      }
      const canceled = await cancelRenderJob({ serviceId, jobId });
      if (canceled?.timedOut || String(canceled?.status || "").toLowerCase() !== "canceled") {
        return res.status(503).json({ success: false, code: "RENDER_CANCEL_INCONCLUSIVE", message: "Render did not confirm cancellation. The run was not changed." });
      }
      const reconciled = await reconcileRun(run, canceled);
      return res.json({ success: true, run: await withPersistedResultCount(reconciled) });
    } catch (error) {
      logger.error("Sales Agent Render cancellation failed", redactFailureLog(error?.stack || error));
      return res.status(503).json({ success: false, code: "RENDER_CANCEL_FAILED", message: "Render could not confirm cancellation. The run was not changed." });
    }
  });

  router.get("/admin/sales-agent/runs/:runId", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
      return res.status(400).json({ success: false, code: "INVALID_RUN_ID" });
    }
    const run = await SalesAgentRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ success: false, code: "SALES_AGENT_RUN_NOT_FOUND" });
    return res.json({ success: true, run: await withPersistedResultCount(run) });
  });

  router.get("/admin/sales-agent/runs/:runId/results", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
      return res.status(400).json({ success: false, code: "INVALID_RUN_ID" });
    }
    const run = await SalesAgentRun.findById(req.params.runId).select("_id").lean();
    if (!run) return res.status(404).json({ success: false, code: "SALES_AGENT_RUN_NOT_FOUND" });
    const results = await SalesAgentOpportunityResult.find({ runId: req.params.runId })
      .sort({ createdAt: 1 }).lean();
    await releaseFailedAddToEventSubmissionLocks(results);
    if (req.query.canonicalLatest !== "true" || !results.length) {
      return res.json({ success: true, results: results.map(serializeOpportunity) });
    }
    const keys = results.map((result) => ({
      platform: result.platform,
      opportunityId: result.opportunityId,
    }));
    const allResults = await SalesAgentOpportunityResult.find({ $or: keys })
      .sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, results: overlayCanonicalLatest(results, allResults).map(serializeOpportunity) });
  });

  router.get("/admin/sales-agent/status", requireAdminAuth, async (req, res) => {
    await recoverStaleQueuedRun(SalesAgentRun, { env, now: now() });
    let run = await SalesAgentRun.findOne({
      runType: { $in: ["DISCOVERY", null] },
      status: { $in: ["QUEUED", "RUNNING"] },
    })
      .sort({ createdAt: -1 }).lean();
    if (run) run = await reconcileRun(run);
    return res.json({ success: true, status: run?.status || "IDLE", run: await withPersistedResultCount(run) });
  });

  router.get(
    "/superadmin/sales-agent/settings",
    requireAdminAuth,
    requireSuperAdmin,
    async (req, res) => {
      const settings = await SalesAgentSettings.findOne({ key: "global" }).lean();
      return res.json({ success: true, settings: serializeSettings(settings) });
    }
  );

  router.patch(
    "/superadmin/sales-agent/settings",
    requireAdminAuth,
    requireSuperAdmin,
    async (req, res) => {
      const validation = validateSettingsUpdate(req.body);
      if (validation.error) {
        return res.status(400).json({ success: false, message: validation.error });
      }
      const settings = await SalesAgentSettings.findOneAndUpdate(
        { key: "global" },
        {
          $set: { ...validation.update, updatedBy: req.adminUser._id },
          $setOnInsert: { key: "global" },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      ).lean();
      return res.json({ success: true, settings });
    }
  );

  return router;
}

module.exports = {
  DEFAULT_QUEUED_TIMEOUT_MS,
  DEFAULT_WORKER_START_GRACE_MS,
  workerStartGraceMs,
  buildActiveRunDiagnostics,
  workerDiagnosticReason,
  createSalesAgentRouter,
  overlayCanonicalLatest,
  queuedTimeoutMs,
  redactFailureLog,
  recoverStaleQueuedRun,
  validateSettingsUpdate,
  opportunitySelectionPolicy,
  serializeOpportunity,
  validateManualOverrides,
  validateRecordReferences,
};
