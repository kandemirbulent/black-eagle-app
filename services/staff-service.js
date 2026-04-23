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
      body: { success: false, message: "Please verify your email first." },
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
        message: "Invalid activation link. Please verify your email again.",
      },
    };
  }

  if (!staff.setupTokenExpires || staff.setupTokenExpires < now) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        success: false,
        message: "Activation link has expired. Please verify your email again.",
      },
    };
  }

  return {
    ok: true,
    normalizedPassword,
  };
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
  mailer,
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
        message: "This email is already verified.",
      },
    };
  }

  const verifyCode = generateCode();

  staff.verifyCode = verifyCode;
  staff.verifyCodeExpires = Date.now() + 1000 * 60 * 15;
  await staff.save();

  await mailer.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: staff.email,
    subject: "Verify your staff account",
    html: `
      <div style="font-family:Arial,sans-serif;padding:20px;">
        <h2>Hello ${staff.firstName || "there"},</h2>
        <p>Please use the verification code below to verify your email:</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:20px 0;">
          ${verifyCode}
        </div>
        <p>This code will expire in 15 minutes.</p>
      </div>
    `,
  });

  return {
    statusCode: 200,
    body: { success: true, message: "New verification code sent." },
  };
}

module.exports = {
  createStaffSetupToken,
  requestStaffPasswordReset,
  resetStaffPassword,
  resendStaffVerificationCode,
  validateStaffPasswordSetup,
};
