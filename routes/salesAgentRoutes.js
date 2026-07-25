const express = require("express");
const mongoose = require("mongoose");

const SETTINGS_FIELDS = new Set([
  "autoRunEnabled",
  "autoSubmitEnabled",
  "maxOpenAiCallsPerRun",
  "maxOpenAiCallsPerDay",
]);

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
    return res.json({ success: true, results });
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

module.exports = { createSalesAgentRouter, validateSettingsUpdate };
