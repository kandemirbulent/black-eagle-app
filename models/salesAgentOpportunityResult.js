const mongoose = require("mongoose");

const staffBreakdownSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const manualOverridesSchema = new mongoose.Schema(
  {
    guestCount: { type: Number, min: 0, default: null },
    startTime: { type: String, trim: true, default: "" },
    endTime: { type: String, trim: true, default: "" },
    durationHours: { type: Number, min: 0, default: null },
    requestedRoles: { type: [String], default: [] },
    staffBreakdown: { type: [staffBreakdownSchema], default: [] },
    travelCharge: { type: Number, min: 0, default: null },
    finalPrice: { type: Number, min: 0, default: null },
    discountType: { type: String, enum: ["", "AMOUNT", "PERCENTAGE"], default: "" },
    discountValue: { type: Number, min: 0, default: 0 },
    discountReason: { type: String, trim: true, default: "" },
    customerMessage: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { _id: false }
);

const quoteSnapshotSchema = new mongoose.Schema(
  {
    calculatedPrice: { type: Number, min: 0, default: 0 },
    estimatedRevenue: { type: Number, default: null },
    estimatedCost: { type: Number, default: null },
    estimatedProfit: { type: Number, default: null },
    estimatedMargin: { type: Number, default: null },
    pricingVersion: { type: Number, min: 1, default: 1 },
    messageVersion: { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

const platformCostEstimateSchema = new mongoose.Schema(
  {
    unit: { type: String, enum: ["CREDITS"], default: "CREDITS" },
    status: { type: String, enum: ["KNOWN", "UNKNOWN"], default: "UNKNOWN" },
    amount: { type: Number, min: 0, default: null },
  },
  { _id: false }
);

const salesAgentOpportunityResultSchema = new mongoose.Schema(
  {
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesAgentRun",
      required: true,
      index: true,
    },
    platform: { type: String, required: true, trim: true, lowercase: true },
    opportunityId: { type: String, required: true, trim: true },
    eventName: { type: String, default: "", trim: true },
    eventDate: { type: Date, default: null },
    location: { type: String, default: "", trim: true },
    analysisStatus: { type: String, default: "", trim: true },
    resultStatus: { type: String, default: "", trim: true, index: true },
    staffBreakdown: { type: [staffBreakdownSchema], default: [] },
    workingHours: { type: Number, min: 0, default: 0 },
    travelHours: { type: Number, min: 0, default: 0 },
    labourSubtotal: { type: Number, min: 0, default: 0 },
    travelLabour: { type: Number, min: 0, default: 0 },
    vehicleCost: { type: Number, min: 0, default: 0 },
    parkingCost: { type: Number, min: 0, default: 0 },
    accommodationCost: { type: Number, min: 0, default: 0 },
    finalPrice: { type: Number, min: 0, default: 0 },
    platformCostEstimate: { type: platformCostEstimateSchema, default: () => ({}) },
    assumptions: { type: [String], default: [] },
    blockingReasons: { type: [String], default: [] },
    reviewCodes: { type: [String], default: [] },
    quoteSubmitted: { type: Boolean, default: false },
    quoteUuid: { type: String, default: "", trim: true },
    platformState: { type: String, default: "", trim: true },
    verifiedStatus: { type: String, default: "", trim: true },
    verifiedQuoteUuid: { type: String, default: "", trim: true },
    verifiedPlatformState: { type: String, default: "", trim: true },
    verifiedAt: { type: Date, default: null },
    aiCallUsed: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ["NOT_REVIEWED", "READY", "NEEDS_REVIEW", "APPROVED", "HOLD", "REJECTED"],
      default: "NOT_REVIEWED",
      index: true,
    },
    manualApprovalRequired: { type: Boolean, default: false },
    manualSubmissionEligible: { type: Boolean, default: false },
    recordVersion: { type: Number, min: 1, default: 1 },
    selectedVersion: { type: Number, min: 1, default: null },
    selectionSelectedAt: { type: Date, default: null },
    selectionSelectedBy: { type: String, trim: true, default: "" },
    lastEditedAt: { type: Date, default: null },
    lastEditedBy: { type: String, trim: true, default: "" },
    manualOverrideApplied: { type: Boolean, default: false },
    manualApprovedAt: { type: Date, default: null },
    manualApprovedBy: { type: String, trim: true, default: "" },
    resolvedBlockingReasons: { type: [String], default: [] },
    resolvedReviewCodes: { type: [String], default: [] },
    manualOverrides: { type: manualOverridesSchema, default: () => ({}) },
    quoteSnapshot: { type: quoteSnapshotSchema, default: () => ({}) },
    expiresAt: { type: Date, default: null },
    unavailable: { type: Boolean, default: false },
    submissionLock: { type: mongoose.Schema.Types.Mixed, default: null },
    submissionStatus: { type: String, default: "", trim: true, index: true },
    submissionAttemptedAt: { type: Date, default: null },
    submissionVerifiedAt: { type: Date, default: null },
    platformQuoteId: { type: String, default: "", trim: true },
    approvedCreditCost: { type: Number, min: 0, default: null },
    creditsConsumed: { type: Number, min: 0, default: null },
    contactDetails: {
      sourcePlatform: { type: String, enum: ["", "addtoevent"], default: "" },
      phone: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },
      contactUnlockedAt: { type: Date, default: null },
      sourceOpportunityId: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true }
);

salesAgentOpportunityResultSchema.index(
  { runId: 1, platform: 1, opportunityId: 1 },
  { unique: true, name: "unique_opportunity_per_run" }
);
salesAgentOpportunityResultSchema.index({ platform: 1, opportunityId: 1 });
salesAgentOpportunityResultSchema.index({ createdAt: -1 });

module.exports = mongoose.model(
  "SalesAgentOpportunityResult",
  salesAgentOpportunityResultSchema
);
