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

async function applyDerivedAdminFields(adminUser) {
  adminUser.firstName = String(adminUser.firstName || "").trim();
  adminUser.lastName = String(adminUser.lastName || "").trim();
  adminUser.name = `${adminUser.firstName} ${adminUser.lastName}`.trim();
  adminUser.email = String(adminUser.email || "").trim().toLowerCase();

  if (typeof adminUser._plainPassword === "string" && adminUser._plainPassword.trim()) {
    adminUser.passwordHash = await bcrypt.hash(adminUser._plainPassword.trim(), 10);
    adminUser._plainPassword = "";
  }
}

adminUserSchema.pre("validate", async function (next) {
  try {
    await applyDerivedAdminFields(this);
    next();
  } catch (error) {
    next(error);
  }
});

adminUserSchema.pre("save", async function (next) {
  try {
    await applyDerivedAdminFields(this);
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
