const mongoose = require("mongoose");

const salesAgentRunSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["IDLE", "QUEUED", "RUNNING", "COMPLETED", "FAILED"],
      default: "QUEUED",
      required: true,
      index: true,
    },
    activeLock: {
      type: String,
      default: "global",
      required: true,
    },
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    triggeredByRole: {
      type: String,
      enum: ["admin", "superadmin"],
      required: true,
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    workerId: { type: String, default: "", trim: true, index: true },
    heartbeatAt: { type: Date, default: null, index: true },
    attempt: { type: Number, min: 0, default: 0 },
    failureCode: { type: String, default: "", trim: true },
    errorSummary: { type: String, default: "", trim: true },
    totals: {
      opportunitiesFound: { type: Number, min: 0, default: 0 },
      quotesSubmitted: { type: Number, min: 0, default: 0 },
      manualReview: { type: Number, min: 0, default: 0 },
      skipped: { type: Number, min: 0, default: 0 },
      failed: { type: Number, min: 0, default: 0 },
      openAiCalls: { type: Number, min: 0, default: 0 },
      platformActions: { type: Number, min: 0, default: 0 },
    },
  },
  { timestamps: true }
);

salesAgentRunSchema.index(
  { activeLock: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["QUEUED", "RUNNING"] },
    },
    name: "one_active_sales_agent_run",
  }
);
salesAgentRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model("SalesAgentRun", salesAgentRunSchema);
