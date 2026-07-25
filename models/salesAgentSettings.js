const mongoose = require("mongoose");

const salesAgentSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      immutable: true,
    },
    autoRunEnabled: { type: Boolean, default: false },
    autoSubmitEnabled: { type: Boolean, default: false },
    maxOpenAiCallsPerRun: { type: Number, min: 0, default: 0 },
    maxOpenAiCallsPerDay: { type: Number, min: 0, default: 0 },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SalesAgentSettings", salesAgentSettingsSchema);
