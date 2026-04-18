const { normalizeEmail } = require("../utils/customer-utils");

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
  resendStaffVerificationCode,
};
