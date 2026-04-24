const { normalizeEmail } = require("../utils/customer-utils");

function createStaffSetupToken({ crypto, ttlMs = 1000 * 60 * 15 }) {
  return {
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt: Date.now() + ttlMs,
  };
}

function validateStaffPasswordSetup({ staff, token, password, now = Date.now() }) {
  const normalizedToken = String(token || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedToken) {
    return {
      ok: false,
      statusCode: 400,
      body: { success: false, message: "Activation token is required." },
    };
  }

  if (!normalizedPassword) {
    return {
      ok: false,
      statusCode: 400,
      body: { success: false, message: "Password is required." },
    };
  }

  if (normalizedPassword.length < 6) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        success: false,
        message: "Password must be at least 6 characters.",
      },
    };
  }

  if (!staff) {
    return {
      ok: false,
      statusCode: 404,
      body: { success: false, message: "Staff account not found." },
    };
  }

  if (!staff.isVerified) {
    return {
      ok: false,
      statusCode: 403,
      body: { success: false, message: "Please verify your phone number first." },
      };
  }

  if (staff.isPasswordSet || staff.password) {
    return {
      ok: false,
      statusCode: 409,
      body: {
        success: false,
        message: "Password has already been created for this account. Please log in.",
      },
    };
  }

  if (!staff.setupToken || staff.setupToken !== normalizedToken) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        success: false,
        message: "Invalid activation link. Please complete phone verification again.",
      },
    };
  }

  if (!staff.setupTokenExpires || staff.setupTokenExpires < now) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        success: false,
        message: "Activation link has expired. Please complete phone verification again.",
      },
    };
  }

  return {
    ok: true,
    normalizedPassword,
  };
}

function normalizePhoneNumber(phone) {
  const rawValue = String(phone || "").trim();

  if (!rawValue) {
    return "";
  }

  if (rawValue.startsWith("00")) {
    return normalizePhoneNumber(`+${rawValue.slice(2)}`);
  }

  const digits = rawValue.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (rawValue.startsWith("+")) {
    return `+${digits}`;
  }

  // Default local UK mobile numbers like 07... to E.164 for Twilio delivery.
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+44${digits.slice(1)}`;
  }

  // Accept already international-looking numbers without the plus sign.
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return digits;
}

function maskPhoneNumber(phone) {
  const normalizedPhone = normalizePhoneNumber(phone);

  if (!normalizedPhone) {
    return "";
  }

  const prefix = normalizedPhone.startsWith("+") ? "+" : "";
  const digits = normalizedPhone.replace(/\D/g, "");

  if (digits.length <= 4) {
    return `${prefix}${digits}`;
  }

  return `${prefix}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

async function sendStaffPhoneVerificationCode({
  sendSms,
  mobile,
  firstName,
  verifyCode,
}) {
  try {
    await sendSms({
      to: mobile,
      body: `Black Eagle verification code for ${firstName || "your account"}: ${verifyCode}. This code expires in 15 minutes.`,
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      statusCode: 503,
      body: {
        success: false,
        message:
          "Phone verification code could not be sent right now. Please try again shortly.",
      },
      error,
    };
  }
}

async function sendStaffVerificationEmail({ mailer, email, firstName, verifyCode }) {
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: "Verify your staff account",
      html: `
        <div style="font-family:Arial,sans-serif;padding:20px;">
          <h2>Hello ${firstName || "there"},</h2>
          <p>Please use the verification code below to verify your email:</p>
          <div style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:20px 0;">
            ${verifyCode}
          </div>
          <p>This code will expire in 15 minutes.</p>
        </div>
      `,
    });

    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 503,
      body: {
        success: false,
        message:
          "Verification email could not be sent right now. Please try again shortly.",
      },
      error,
    };
  }
}

async function requestStaffPasswordReset({
  Staff,
  email,
  createToken,
  sendStaffPasswordLink,
}) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      statusCode: 400,
      body: { success: false, message: "Email is required." },
    };
  }

  const staff = await Staff.findOne({ email: normalizedEmail });

  if (staff && staff.isVerified && staff.isPasswordSet && staff.status === "active") {
    const token = createToken();

    staff.resetToken = token;
    staff.resetTokenExpires = Date.now() + 1000 * 60 * 60 * 24;
    await staff.save();
    await sendStaffPasswordLink(staff, token);
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "If this email exists, a reset link has been sent.",
    },
  };
}

async function resetStaffPassword({
  Staff,
  email,
  token,
  password,
  loginPath = "/staff-logins/staff-login.html",
  now = Date.now(),
}) {
  const normalizedToken = String(token || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || "");

  if (!normalizedToken || !normalizedPassword) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "Token and password are required.",
      },
    };
  }

  if (normalizedPassword.length < 6) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "Password must be at least 6 characters.",
      },
    };
  }

  const query = {
    resetToken: normalizedToken,
    resetTokenExpires: { $gt: now },
    isVerified: true,
    isPasswordSet: true,
    status: "active",
  };

  if (normalizedEmail) {
    query.email = normalizedEmail;
  }

  const staff = await Staff.findOne(query);

  if (!staff) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "Invalid or expired reset link.",
        redirect: loginPath,
      },
    };
  }

  staff.password = normalizedPassword;
  staff.resetToken = "";
  staff.resetTokenExpires = null;

  await staff.save();

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Password updated successfully.",
      redirect: loginPath,
    },
  };
}

async function resendStaffVerificationCode({
  Staff,
  sendSms,
  email,
  generateCode,
}) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      statusCode: 400,
      body: { success: false, message: "Email is required." },
    };
  }

  const staff = await Staff.findOne({ email: normalizedEmail });

  if (!staff) {
    return {
      statusCode: 404,
      body: { success: false, message: "Staff account not found." },
    };
  }

  if (staff.isVerified) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "This phone number is already verified.",
      },
    };
  }

  if (!normalizePhoneNumber(staff.mobile)) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "A mobile number is required for phone verification.",
      },
    };
  }

  const verifyCode = generateCode();
  staff.verifyCode = verifyCode;
  staff.verifyCodeExpires = Date.now() + 1000 * 60 * 15;
  await staff.save();

  const smsResult = await sendStaffPhoneVerificationCode({
    sendSms,
    mobile: staff.mobile,
    firstName: staff.firstName,
    verifyCode,
  });

  if (!smsResult.ok) {
    return {
      statusCode: smsResult.statusCode,
      body: {
        ...smsResult.body,
        mobile: maskPhoneNumber(staff.mobile),
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "New verification code sent to your phone.",
      mobile: maskPhoneNumber(staff.mobile),
    },
  };
}

async function verifyStaffPhoneOtp({
  Staff,
  email,
  code,
  createSetupToken,
  now = Date.now(),
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();

  if (!normalizedEmail || !normalizedCode) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "Email and phone verification code are required.",
      },
    };
  }

  const staff = await Staff.findOne({ email: normalizedEmail });

  if (!staff) {
    return {
      statusCode: 404,
      body: { success: false, message: "Staff account not found." },
    };
  }

  if (!staff.verifyCode || staff.verifyCode !== normalizedCode) {
    return {
      statusCode: 400,
      body: { success: false, message: "Invalid phone verification code." },
    };
  }

  if (!staff.verifyCodeExpires || staff.verifyCodeExpires < now) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "Phone verification code has expired.",
      },
    };
  }

  const { token: setupToken, expiresAt: setupTokenExpires } = createSetupToken();

  staff.isVerified = true;
  staff.verifyCode = "";
  staff.verifyCodeExpires = null;
  staff.setupToken = setupToken;
  staff.setupTokenExpires = setupTokenExpires;

  await staff.save();

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Phone number verified successfully.",
      setupToken,
    },
  };
}

module.exports = {
  createStaffSetupToken,
  maskPhoneNumber,
  normalizePhoneNumber,
  requestStaffPasswordReset,
  resetStaffPassword,
  resendStaffVerificationCode,
  sendStaffPhoneVerificationCode,
  sendStaffVerificationEmail,
  validateStaffPasswordSetup,
  verifyStaffPhoneOtp,
};
