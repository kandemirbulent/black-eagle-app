const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const staffSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: "",
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    dob: {
      type: Date,
      required: true,
    },

    mobile: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    postcode: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    niNumber: {
      type: String,
      required: true,
      trim: true,
    },

    experience: {
      type: Number,
      default: 0,
      min: 0,
    },

    availability: {
      type: String,
      default: "",
      trim: true,
    },

    positions: {
      type: [String],
      default: [],
    },

    emergencyContact: {
      name: {
        type: String,
        default: "",
        trim: true,
      },
      phone: {
        type: String,
        default: "",
        trim: true,
      },
    },

    bankDetails: {
      accountHolder: {
        type: String,
        default: "",
        trim: true,
      },
      bankName: {
        type: String,
        default: "",
        trim: true,
      },
      sortCode: {
        type: String,
        default: "",
        trim: true,
      },
      accountNumber: {
        type: String,
        default: "",
        trim: true,
      },
      iban: {
        type: String,
        default: "",
        trim: true,
      },
    },

    selfieData: {
      type: String,
      required: true,
    },

    password: {
      type: String,
      default: null,
    },

    verifyCode: {
      type: String,
      default: "",
    },

    verifyCodeExpires: {
      type: Date,
      default: null,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isPasswordSet: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      default: "staff",
    },

    status: {
      type: String,
      enum: ["pending", "active", "inactive", "rejected"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

staffSchema.pre("validate", function (next) {
  if ((!this.name || !this.name.trim()) && (this.firstName || this.lastName)) {
    this.name = `${this.firstName || ""} ${this.lastName || ""}`.trim();
  }
  next();
});

staffSchema.pre("save", async function (next) {
  if (!this.password) return next();
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

staffSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Staff", staffSchema);