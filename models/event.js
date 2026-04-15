const mongoose = require("mongoose");

const EventRoleRequirementSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    quantityRequired: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    location: {
      type: String,
      default: "",
      trim: true,
    },

    eventDate: {
      type: Date,
      required: true,
      index: true,
    },

    startTime: {
      type: String,
      default: "",
    },

    endTime: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: ["draft", "open", "closed", "cancelled", "completed"],
      default: "draft",
      index: true,
    },

    roleRequirements: {
      type: [EventRoleRequirementSchema],
      default: [],
    },

    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Event", eventSchema);