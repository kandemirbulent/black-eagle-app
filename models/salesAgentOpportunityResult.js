const mongoose = require("mongoose");

const staffBreakdownSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
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
    assumptions: { type: [String], default: [] },
    blockingReasons: { type: [String], default: [] },
    reviewCodes: { type: [String], default: [] },
    quoteSubmitted: { type: Boolean, default: false },
    quoteUuid: { type: String, default: "", trim: true },
    platformState: { type: String, default: "", trim: true },
    aiCallUsed: { type: Boolean, default: false },
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
