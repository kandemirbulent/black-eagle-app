const test = require("node:test");
const assert = require("node:assert/strict");

const {
  approveCustomer,
  rejectCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  registerCustomer,
  loginCustomer,
} = require("../services/customer-service");

function createCustomerModel({ findByIdImpl, findOneImpl } = {}) {
  const created = [];

  function Customer(data) {
    Object.assign(this, data);
    this.save = async () => {
      this.saved = true;
      return this;
    };
    created.push(this);
  }

  Customer.created = created;
  Customer.findById = findByIdImpl || (async () => null);
  Customer.findOne = findOneImpl || (async () => null);

  return Customer;
}

test("approveCustomer updates customer and sends setup link", async () => {
  const customer = {
    _id: "cust-1",
    email: "customer@example.com",
    firstName: "Jane",
    save: async function () {
      this.saved = true;
    },
  };

  let sent = null;

  const result = await approveCustomer({
    Customer: createCustomerModel({ findByIdImpl: async () => customer }),
    customerId: "cust-1",
    createToken: () => "token-123",
    sendCustomerPasswordLink: async (...args) => {
      sent = args;
    },
    now: () => new Date("2026-04-18T12:00:00Z"),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(customer.status, "approved");
  assert.equal(customer.resetToken, "token-123");
  assert.ok(customer.tokenExpires > Date.now());
  assert.equal(String(customer.approvedAt), String(new Date("2026-04-18T12:00:00Z")));
  assert.equal(sent[0], customer);
  assert.equal(sent[1], "token-123");
  assert.deepEqual(sent[2], { mode: "setup" });
});

test("rejectCustomer clears approval-related fields", async () => {
  const customer = {
    _id: "cust-2",
    status: "approved",
    approvedAt: new Date(),
    resetToken: "x",
    tokenExpires: new Date(),
    save: async function () {
      this.saved = true;
    },
  };

  const result = await rejectCustomer({
    Customer: createCustomerModel({ findByIdImpl: async () => customer }),
    customerId: "cust-2",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(customer.status, "rejected");
  assert.equal(customer.approvedAt, null);
  assert.equal(customer.resetToken, null);
  assert.equal(customer.tokenExpires, null);
});

test("requestCustomerPasswordReset sends mail only for approved customers", async () => {
  const customer = {
    email: "approved@example.com",
    status: "approved",
    save: async function () {
      this.saved = true;
    },
  };

  let sent = false;

  const result = await requestCustomerPasswordReset({
    Customer: createCustomerModel({ findOneImpl: async () => customer }),
    email: " APPROVED@example.com ",
    createToken: () => "reset-token",
    sendCustomerPasswordLink: async () => {
      sent = true;
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(customer.resetToken, "reset-token");
  assert.ok(customer.tokenExpires > Date.now());
  assert.equal(sent, true);
});

test("resetCustomerPassword hashes password and clears reset fields", async () => {
  const customer = {
    email: "customer@example.com",
    resetToken: "abc",
    tokenExpires: new Date("2030-01-01"),
    save: async function () {
      this.saved = true;
    },
  };

  const result = await resetCustomerPassword({
    Customer: createCustomerModel({ findOneImpl: async () => customer }),
    bcrypt: {
      hash: async (value) => `hashed:${value}`,
    },
    token: "abc",
    email: "customer@example.com",
    password: "new-pass",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(customer.password, "hashed:new-pass");
  assert.equal(customer.resetToken, null);
  assert.equal(customer.tokenExpires, null);
});

test("registerCustomer blocks duplicates and creates pending customers", async () => {
  let findOneCall = 0;
  const Customer = createCustomerModel({
    findOneImpl: async () => {
      findOneCall += 1;
      return findOneCall === 1 ? null : null;
    },
  });

  const result = await registerCustomer({
    Customer,
    input: {
      companyName: "Black Eagle Ltd",
      companyAddress: "London",
      postcode: "EC1A 1AA",
      firstName: "Jane",
      lastName: "Doe",
      mobilePhone: "123",
      email: "USER@example.com",
      website: "https://example.com",
      vatNumber: "VAT-1",
      companyNumber: "COMP-1",
    },
    generateApplicationId: () => "BE-CUST-1000",
    generateCustomerCode: () => "BE-123456",
    now: () => new Date("2026-04-18T12:00:00Z"),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.equal(Customer.created.length, 1);
  assert.equal(Customer.created[0].email, "user@example.com");
  assert.equal(Customer.created[0].status, "pending");
});

test("loginCustomer validates approval and password match", async () => {
  const customer = {
    _id: "cust-3",
    firstName: "Jane",
    lastName: "Doe",
    email: "user@example.com",
    applicationId: "BE-CUST-1",
    customerCode: "BE-123456",
    status: "approved",
    password: "stored-hash",
  };

  const result = await loginCustomer({
    Customer: createCustomerModel({ findOneImpl: async () => customer }),
    bcrypt: {
      compare: async (plain, hashed) => plain === "secret" && hashed === "stored-hash",
    },
    email: " USER@example.com ",
    password: "secret",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.customer.applicationId, "BE-CUST-1");
  assert.equal(result.body.customer.customerCode, "BE-123456");
});
