const express = require("express");
const nodemailer = require("nodemailer");
const router = express.Router();
const Staff = require("../models/staff");

// ✅ Mail transporter
const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ✅ Verification mail helper
async function sendVerificationEmail(email, firstName, verifyCode) {
  await mailer.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: "Verify your staff account",
    html: `
      <div style="font-family:Arial,sans-serif;padding:20px;">
        <h2>Hello ${firstName || "there"},</h2>
        <p>Your staff account request has been received.</p>
        <p>Please use the verification code below to verify your email:</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:20px 0;">
          ${verifyCode}
        </div>
        <p>This code will expire in 15 minutes.</p>
      </div>
    `,
  });
}

// 🔹 CREATE STAFF (register)
router.post("/create", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      dob,
      mobile,
      email,
      postcode,
      address,
      niNumber,
      experience,
      availability,
      positions,
      emergencyContact,
      selfieData,
    } = req.body;

    if (
      !firstName ||
      !lastName ||
      !dob ||
      !email ||
      !postcode ||
      !address ||
      !niNumber ||
      !availability ||
      !selfieData
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required staff fields.",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await Staff.findOne({ email: normalizedEmail });

    // ✅ Eğer kayıtlı ama verify edilmemişse yeni kod gönder
    if (existing) {
      if (!existing.isVerified) {
        const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

        existing.verifyCode = verifyCode;
        existing.verifyCodeExpires = Date.now() + 1000 * 60 * 15;

        await existing.save();

        try {
          await sendVerificationEmail(existing.email, existing.firstName, verifyCode);
        } catch (mailErr) {
          console.error("❌ Resend verification email failed:", mailErr);
        }

        return res.status(200).json({
          success: true,
          message: "Account already exists but is not verified. A new verification code has been sent.",
        });
      }

      return res.status(409).json({
        success: false,
        message: "This email is already registered",
      });
    }

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    const staff = new Staff({
      firstName,
      lastName,
      dob,
      mobile: mobile || "",
      email: normalizedEmail,
      postcode,
      address,
      niNumber,
      experience: Number(experience || 0),
      availability: availability || "",
      positions: Array.isArray(positions) ? positions : [],
      emergencyContact: {
        name: emergencyContact?.name || "",
        phone: emergencyContact?.phone || "",
      },
      selfieData,
      verifyCode,
      verifyCodeExpires: Date.now() + 1000 * 60 * 15,
      isVerified: false,
      isPasswordSet: false,
      status: "pending",
      role: "staff",
    });

    await staff.save();

    try {
      await sendVerificationEmail(staff.email, staff.firstName, verifyCode);
    } catch (mailErr) {
      console.error("❌ Staff verification email send failed:", mailErr);
    }

    return res.status(201).json({
      success: true,
      message: "Staff created. Please verify your email.",
    });
  } catch (err) {
    console.error("❌ Staff create error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔹 VERIFY EMAIL
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and code are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!staff.verifyCode || staff.verifyCode !== String(code).trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid code",
      });
    }

    if (!staff.verifyCodeExpires || staff.verifyCodeExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Code expired",
      });
    }

    staff.isVerified = true;
    staff.verifyCode = "";
    staff.verifyCodeExpires = null;

    await staff.save();

    return res.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    console.error("❌ Verify email error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🔹 RESEND CODE
router.post("/resend-code", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (staff.isVerified) {
      return res.status(400).json({
        success: false,
        message: "This email is already verified",
      });
    }

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    staff.verifyCode = verifyCode;
    staff.verifyCodeExpires = Date.now() + 1000 * 60 * 15;

    await staff.save();

    try {
      await sendVerificationEmail(staff.email, staff.firstName, verifyCode);
    } catch (mailErr) {
      console.error("❌ Resend verification email failed:", mailErr);
      return res.status(500).json({
        success: false,
        message: "Verification email could not be sent",
      });
    }

    return res.json({
      success: true,
      message: "New verification code sent",
    });
  } catch (err) {
    console.error("❌ Resend code error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🔹 SET PASSWORD + BANK DETAILS
router.post("/set-password", async (req, res) => {
  try {
    const { email, password, bank_details } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff account not found",
      });
    }

    if (!staff.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Verify email first",
      });
    }

    staff.password = password;
    staff.isPasswordSet = true;
    staff.status = "active";

    staff.bankDetails = {
      accountHolder: bank_details?.account_holder || "",
      bankName: bank_details?.bank_name || "",
      sortCode: bank_details?.sort_code || "",
      accountNumber: bank_details?.account_number || "",
      iban: bank_details?.iban || "",
    };

    await staff.save();

    return res.json({
      success: true,
      message: "Password and bank details saved successfully",
    });
  } catch (err) {
    console.error("❌ Set password error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🔹 LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = String(email).toLowerCase().trim();
    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!staff.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email first",
      });
    }

    if (!staff.isPasswordSet) {
      return res.status(403).json({
        success: false,
        message: "Please create your password first",
      });
    }

    const isMatch = await staff.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Wrong password",
      });
    }

    return res.json({
      success: true,
      message: "Login successful",
      staffId: staff._id,
      redirect: "/staff-logins/staff-dashboard.html",
    });
  } catch (err) {
    console.error("❌ Staff login error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;