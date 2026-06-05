const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminUserSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: "", trim: true },
    name: { type: String, default: "", trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["superadmin", "admin"],
      default: "admin",
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

adminUserSchema.pre("save", async function (next) {
  try {
    this.firstName = String(this.firstName || "").trim();
    this.lastName = String(this.lastName || "").trim();
    this.name = `${this.firstName} ${this.lastName}`.trim();
    this.email = String(this.email || "").trim().toLowerCase();

    if (this.isModified("password")) {
      this.password = await bcrypt.hash(String(this.password), 10);
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("AdminUser", adminUserSchema);
