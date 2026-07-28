const express = require("express");
const mongoose = require("mongoose");

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
}) {
  const router = express.Router();

  router.post("/admin/sales-agent/runs", requireAdminAuth, async (req, res) => {
    try {
      const run = await SalesAgentRun.create({
        status: "QUEUED",
        activeLock: "global",
        triggeredBy: req.adminUser._id,
        triggeredByRole: req.adminUser.role,
      });
      return res.status(201).json({ success: true, run });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          code: "SALES_AGENT_RUN_ALREADY_ACTIVE",
          message: "A Sales Agent run is already queued or running.",
        });
      }
      return res.status(500).json({ success: false, message: "Could not create Sales Agent run." });
    }
  });

  router.get("/admin/sales-agent/runs", requireAdminAuth, async (req, res) => {
    const runs = await SalesAgentRun.find({}).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ success: true, runs });
  });

  router.get("/admin/sales-agent/runs/:runId", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
      return res.status(400).json({ success: false, code: "INVALID_RUN_ID" });
    }
    const run = await SalesAgentRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).json({ success: false, code: "SALES_AGENT_RUN_NOT_FOUND" });
    return res.json({ success: true, run });
  });

  router.get("/admin/sales-agent/runs/:runId/results", requireAdminAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
      return res.status(400).json({ success: false, code: "INVALID_RUN_ID" });
    }
    const run = await SalesAgentRun.findById(req.params.runId).select("_id").lean();
    if (!run) return res.status(404).json({ success: false, code: "SALES_AGENT_RUN_NOT_FOUND" });
    const results = await SalesAgentOpportunityResult.find({ runId: req.params.runId })
      .sort({ createdAt: 1 }).lean();
    if (req.query.canonicalLatest !== "true" || !results.length) {
      return res.json({ success: true, results });
    }
    const keys = results.map((result) => ({
      platform: result.platform,
      opportunityId: result.opportunityId,
    }));
    const allResults = await SalesAgentOpportunityResult.find({ $or: keys })
      .sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, results: overlayCanonicalLatest(results, allResults) });
  });

  router.get("/admin/sales-agent/status", requireAdminAuth, async (req, res) => {
    const run = await SalesAgentRun.findOne({ status: { $in: ["QUEUED", "RUNNING"] } })
      .sort({ createdAt: -1 }).lean();
    return res.json({ success: true, status: run?.status || "IDLE", run: run || null });
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
  createSalesAgentRouter,
  overlayCanonicalLatest,
  validateSettingsUpdate,
};
