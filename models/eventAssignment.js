const mongoose = require("mongoose");

const eventAssignmentSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },

    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true,
    },

    role: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    status: {
      type: String,
      enum: ["assigned", "confirmed", "cancelled", "completed", "no_show"],
      default: "assigned",
      index: true,
    },

    assignedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

eventAssignmentSchema.index({ event: 1, staff: 1 }, { unique: true });

module.exports = mongoose.model("EventAssignment", eventAssignmentSchema);