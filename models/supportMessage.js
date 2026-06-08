const mongoose = require("mongoose");

const supportMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: "",
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    role: {
      type: String,
      enum: ["customer", "staff", ""],
      default: "",
      trim: true,
    },
    userType: {
      type: String,
      enum: ["customer-candidate", "staff-candidate", ""],
      default: "",
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    sourcePage: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["New", "In Progress", "Resolved"],
      default: "New",
    },
    priority: {
      type: String,
      enum: ["Normal", "Urgent"],
      default: "Normal",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("SupportMessage", supportMessageSchema);
