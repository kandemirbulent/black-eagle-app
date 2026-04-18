const test = require("node:test");
const assert = require("node:assert/strict");

const { resendStaffVerificationCode } = require("../services/staff-service");

function createStaffModel(findOneImpl) {
  return {
    findOne: findOneImpl || (async () => null),
  };
}

test("resendStaffVerificationCode rejects missing email", async () => {
  const result = await resendStaffVerificationCode({
    Staff: createStaffModel(),
    mailer: { sendMail: async () => {} },
    email: "",
    generateCode: () => "123456",
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.success, false);
});

test("resendStaffVerificationCode updates staff and sends email", async () => {
  const staff = {
    email: "staff@example.com",
    firstName: "Alex",
    isVerified: false,
    save: async function () {
      this.saved = true;
    },
  };

  let mailPayload = null;

  const result = await resendStaffVerificationCode({
    Staff: createStaffModel(async () => staff),
    mailer: {
      sendMail: async (payload) => {
        mailPayload = payload;
      },
    },
    email: " STAFF@example.com ",
    generateCode: () => "654321",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(staff.verifyCode, "654321");
  assert.ok(staff.verifyCodeExpires > Date.now());
  assert.equal(mailPayload.to, "staff@example.com");
  assert.match(mailPayload.html, /654321/);
});
