const mongoose = require("mongoose");

const salesAgentRunSchema = new mongoose.Schema(
  {
    runType: {
      type: String,
      enum: ["DISCOVERY", "MANUAL_REVIEW_RESUME"],
      default: "DISCOVERY",
      required: true,
      index: true,
    },
    sourceRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesAgentRun",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["IDLE", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELED"],
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
    finishedAt: { type: Date, default: null },
    workerId: { type: String, default: "", trim: true, index: true },
    heartbeatAt: { type: Date, default: null, index: true },
    attempt: { type: Number, min: 0, default: 0 },
    failureCode: { type: String, default: "", trim: true },
    errorSummary: { type: String, default: "", trim: true },
    failedStage: {
      type: String,
      enum: ["", "RENDER_TRIGGER", "WORKER_START", "TOGATHER_LOGIN", "DISCOVERY", "OPENAI", "SUBMISSION"],
      default: "",
      trim: true,
    },
    failureReason: { type: String, default: "", trim: true },
    errorMessage: { type: String, default: "", trim: true },
    failureAt: { type: Date, default: null },
    failureHttpStatus: { type: Number, min: 100, max: 599, default: null },
    failureHttpStatusText: { type: String, default: "", trim: true },
    upstreamErrorCode: { type: String, default: "", trim: true },
    upstreamResponseBody: { type: String, default: "", trim: true },
    failureRequestAt: { type: Date, default: null },
    triggerStatus: {
      type: String,
      enum: ["TRIGGERING", "TRIGGERED", "FAILED"],
      default: "TRIGGERING",
    },
    triggerJobId: { type: String, default: "", trim: true },
    triggeredAt: { type: Date, default: null },
    renderServiceId: { type: String, default: "", trim: true },
    renderJobId: { type: String, default: "", trim: true, index: true },
    renderJobStatus: { type: String, default: "", trim: true },
    renderStartedAt: { type: Date, default: null },
    renderFinishedAt: { type: Date, default: null },
    lastRenderStatusCheckAt: { type: Date, default: null },
    totals: {
      opportunitiesFound: { type: Number, min: 0, default: 0 },
      quotesSubmitted: { type: Number, min: 0, default: 0 },
      manualReview: { type: Number, min: 0, default: 0 },
      skipped: { type: Number, min: 0, default: 0 },
      failed: { type: Number, min: 0, default: 0 },
      openAiCalls: { type: Number, min: 0, default: 0 },
      platformActions: { type: Number, min: 0, default: 0 },
    },
    manualReviewResume: {
      selectedCount: { type: Number, min: 0, default: 0 },
      processed: { type: Number, min: 0, default: 0 },
      submitted: { type: Number, min: 0, default: 0 },
      alreadyQuoted: { type: Number, min: 0, default: 0 },
      remainingManualReview: { type: Number, min: 0, default: 0 },
      failedItems: { type: Number, min: 0, default: 0 },
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
salesAgentRunSchema.index({ runType: 1, sourceRunId: 1, createdAt: -1 });

module.exports = mongoose.model("SalesAgentRun", salesAgentRunSchema);
