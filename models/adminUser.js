const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
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
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      default: "",
      trim: true,
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminUserSchema.virtual("password")
  .set(function setPassword(password) {
    this._plainPassword = String(password || "");
  });

adminUserSchema.pre("save", async function (next) {
  try {
    this.firstName = String(this.firstName || "").trim();
    this.lastName = String(this.lastName || "").trim();
    this.name = `${this.firstName} ${this.lastName}`.trim();
    this.email = String(this.email || "").trim().toLowerCase();

    if (typeof this._plainPassword === "string" && this._plainPassword.trim()) {
      this.passwordHash = await bcrypt.hash(this._plainPassword.trim(), 10);
      this._plainPassword = "";
    }

    next();
  } catch (error) {
    next(error);
  }
});

adminUserSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(String(candidatePassword || ""), this.passwordHash);
};

module.exports = mongoose.model("AdminUser", adminUserSchema);
