const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createStaffSetupToken,
  maskPhoneNumber,
  normalizePhoneNumber,
  requestStaffPasswordReset,
  resetStaffPassword,
  resendStaffVerificationCode,
  sendStaffPhoneVerificationCode,
  validateStaffPasswordSetup,
  verifyStaffPhoneOtp,
} = require("../services/staff-service");

function createStaffModel(findOneImpl) {
  return {
    findOne: findOneImpl || (async () => null),
  };
}

test("resendStaffVerificationCode rejects missing email", async () => {
  const result = await resendStaffVerificationCode({
    Staff: createStaffModel(),
    sendSms: async () => {},
    email: "",
    generateCode: () => "123456",
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.success, false);
});

test("resendStaffVerificationCode updates staff and sends phone OTP", async () => {
  const staff = {
    mobile: "+447700900123",
    email: "staff@example.com",
    firstName: "Alex",
    isVerified: false,
    save: async function () {
      this.saved = true;
    },
  };

  let smsPayload = null;

  const result = await resendStaffVerificationCode({
    Staff: createStaffModel(async () => staff),
    sendSms: async (payload) => {
      smsPayload = payload;
    },
    email: " STAFF@example.com ",
    generateCode: () => "654321",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(staff.verifyCode, "654321");
  assert.ok(staff.verifyCodeExpires > Date.now());
  assert.equal(result.body.mobile, "+********0123");
  assert.equal(smsPayload.to, "+447700900123");
  assert.match(smsPayload.body, /654321/);
});

test("sendStaffPhoneVerificationCode returns service error when SMS sender fails", async () => {
  const result = await sendStaffPhoneVerificationCode({
    sendSms: async () => {
      throw new Error("sms unavailable");
    },
    mobile: "+447700900123",
    firstName: "Alex",
    verifyCode: "654321",
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 503);
  assert.match(result.body.message, /could not be sent/i);
});

test("resendStaffVerificationCode does not overwrite code when mail sending fails", async () => {
  const staff = {
    mobile: "+447700900123",
    email: "staff@example.com",
    firstName: "Alex",
    isVerified: false,
    verifyCode: "old-code",
    verifyCodeExpires: 111,
    save: async function () {
      this.saved = true;
    },
  };

  const result = await resendStaffVerificationCode({
    Staff: createStaffModel(async () => staff),
    sendSms: async () => {
      throw new Error("sms unavailable");
    },
    email: "staff@example.com",
    generateCode: () => "654321",
  });

  assert.equal(result.statusCode, 503);
  assert.equal(staff.verifyCode, "654321");
  assert.ok(staff.verifyCodeExpires > Date.now());
  assert.equal(result.body.mobile, "+********0123");
  assert.equal(staff.saved, true);
});

test("maskPhoneNumber hides all but the last four digits", () => {
  assert.equal(maskPhoneNumber("+447700900123"), "+********0123");
});

test("normalizePhoneNumber converts local UK numbers to E.164 format", () => {
  assert.equal(normalizePhoneNumber("07700900123"), "+447700900123");
  assert.equal(normalizePhoneNumber("447700900123"), "+447700900123");
});

test("createStaffSetupToken returns a one-time token with expiry", () => {
  const result = createStaffSetupToken({
    crypto: {
      randomBytes(size) {
        return Buffer.alloc(size, 0xab);
      },
    },
    ttlMs: 60 * 1000,
  });

  assert.equal(result.token.length, 64);
  assert.match(result.token, /^[0-9a-f]+$/);
  assert.ok(result.expiresAt > Date.now());
});

test("validateStaffPasswordSetup blocks accounts that already set a password", () => {
  const result = validateStaffPasswordSetup({
    staff: {
      isVerified: true,
      isPasswordSet: true,
      password: "hashed-password",
      setupToken: "token-123",
      setupTokenExpires: Date.now() + 1000,
    },
    token: "token-123",
    password: "secret12",
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 409);
  assert.match(result.body.message, /already been created/i);
});

test("validateStaffPasswordSetup accepts a valid activation token", () => {
  const result = validateStaffPasswordSetup({
    staff: {
      isVerified: true,
      isPasswordSet: false,
      password: null,
      setupToken: "token-123",
      setupTokenExpires: Date.now() + 60 * 1000,
    },
    token: "token-123",
    password: "secret12",
  });

  assert.equal(result.ok, true);
  assert.equal(result.normalizedPassword, "secret12");
});

test("verifyStaffPhoneOtp marks staff verified and returns setup token", async () => {
  const staff = {
    email: "staff@example.com",
    verifyCode: "654321",
    verifyCodeExpires: Date.now() + 60 * 1000,
    isVerified: false,
    save: async function () {
      this.saved = true;
    },
  };

  const result = await verifyStaffPhoneOtp({
    Staff: createStaffModel(async () => staff),
    email: "staff@example.com",
    code: "654321",
    createSetupToken: () => ({
      token: "setup-token-123",
      expiresAt: Date.now() + 60 * 1000,
    }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.setupToken, "setup-token-123");
  assert.equal(staff.isVerified, true);
  assert.equal(staff.verifyCode, "");
  assert.equal(staff.saved, true);
});

test("requestStaffPasswordReset sends link only for active verified staff", async () => {
  const staff = {
    email: "staff@example.com",
    isVerified: true,
    isPasswordSet: true,
    status: "active",
    save: async function () {
      this.saved = true;
    },
  };

  let sentToken = null;

  const result = await requestStaffPasswordReset({
    Staff: createStaffModel(async () => staff),
    email: " staff@example.com ",
    createToken: () => "reset-token-123",
    sendStaffPasswordLink: async (_staff, token) => {
      sentToken = token;
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(staff.resetToken, "reset-token-123");
  assert.ok(staff.resetTokenExpires > Date.now());
  assert.equal(sentToken, "reset-token-123");
});

test("resetStaffPassword clears reset fields after success", async () => {
  const staff = {
    password: null,
    resetToken: "reset-token-123",
    resetTokenExpires: Date.now() + 60 * 1000,
    save: async function () {
      this.saved = true;
    },
  };

  const result = await resetStaffPassword({
    Staff: createStaffModel(async () => staff),
    email: "staff@example.com",
    token: "reset-token-123",
    password: "new-secret",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(staff.password, "new-secret");
  assert.equal(staff.resetToken, "");
  assert.equal(staff.resetTokenExpires, null);
});
