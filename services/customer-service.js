const { normalizeEmail } = require("../utils/customer-utils");

function buildCustomerLoginPayload(customer) {
  return {
    id: customer._id,
    name: `${customer.firstName} ${customer.lastName}`.trim(),
    email: customer.email,
    applicationId: customer.applicationId,
    customerCode: customer.customerCode,
  };
}

async function approveCustomer({
  Customer,
  customerId,
  createToken,
  sendCustomerPasswordLink,
  now = () => new Date(),
}) {
  const customer = await Customer.findById(customerId);

  if (!customer) {
    return {
      statusCode: 404,
      body: { success: false, message: "Customer not found" },
    };
  }

  const token = createToken();

  customer.status = "approved";
  customer.resetToken = token;
  customer.tokenExpires = Date.now() + 1000 * 60 * 60 * 24;
  customer.approvedAt = now();

  await customer.save();
  await sendCustomerPasswordLink(customer, token, { mode: "setup" });

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Customer approved and email sent with setup link.",
      updatedStatus: "approved",
      customerId: customer._id,
    },
  };
}

async function rejectCustomer({ Customer, customerId }) {
  const customer = await Customer.findById(customerId);

  if (!customer) {
    return {
      statusCode: 404,
      body: { success: false, message: "Customer not found" },
    };
  }

  customer.status = "rejected";
  customer.approvedAt = null;
  customer.resetToken = null;
  customer.tokenExpires = null;

  await customer.save();

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Customer rejected successfully.",
      updatedStatus: "rejected",
      customerId: customer._id,
    },
  };
}

async function requestCustomerPasswordReset({
  Customer,
  email,
  createToken,
  sendCustomerPasswordLink,
}) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      statusCode: 400,
      body: { success: false, message: "Email is required." },
    };
  }

  const customer = await Customer.findOne({ email: normalizedEmail });

  if (customer && customer.status === "approved") {
    const token = createToken();

    customer.resetToken = token;
    customer.tokenExpires = Date.now() + 1000 * 60 * 60 * 24;
    await customer.save();
    await sendCustomerPasswordLink(customer, token, { mode: "reset" });
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "If this email exists, a reset link has been sent.",
    },
  };
}

async function resetCustomerPassword({
  Customer,
  bcrypt,
  token,
  email,
  password,
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

  const query = {
    resetToken: normalizedToken,
    tokenExpires: { $gt: Date.now() },
  };

  if (normalizedEmail) {
    query.email = normalizedEmail;
  }

  const customer = await Customer.findOne(query);

  if (!customer) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: "Invalid or expired reset link.",
        redirect: "/Customer-logins/customer-login.html",
      },
    };
  }

  customer.password = await bcrypt.hash(normalizedPassword, 10);
  customer.resetToken = null;
  customer.tokenExpires = null;

  await customer.save();

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Password updated successfully.",
      redirect: "/Customer-logins/customer-login.html",
    },
  };
}

async function registerCustomer({
  Customer,
  input,
  generateApplicationId,
  generateCustomerCode,
  now = () => new Date(),
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedCompanyName = String(input.companyName || "").trim();

  const blocked = await Customer.findOne({
    $or: [{ email: normalizedEmail }, { companyName: normalizedCompanyName }],
    status: { $in: ["rejected", "banned"] },
  });

  if (blocked) {
    return {
      statusCode: 200,
      body: {
        success: false,
        message:
          "🚫 This customer is blocked from registering again. Contact support.",
      },
    };
  }

  const existing = await Customer.findOne({
    $or: [{ companyName: normalizedCompanyName }, { email: normalizedEmail }],
  });

  if (existing) {
    return {
      statusCode: 200,
      body: {
        success: false,
        message:
          "⚠️ This company or email is already registered or awaiting approval.",
      },
    };
  }

  const applicationId = generateApplicationId();
  const customerCode = generateCustomerCode();

  const newCustomer = new Customer({
    applicationId,
    customerCode,
    companyName: normalizedCompanyName,
    companyAddress: String(input.companyAddress || "").trim(),
    postcode: String(input.postcode || "").trim(),
    firstName: String(input.firstName || "").trim(),
    lastName: String(input.lastName || "").trim(),
    mobilePhone: String(input.mobilePhone || "").trim(),
    email: normalizedEmail,
    website: String(input.website || "").trim(),
    vatNumber: String(input.vatNumber || "").trim(),
    companyNumber: String(input.companyNumber || "").trim(),
    status: "pending",
    createdAt: now(),
  });

  await newCustomer.save();

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "✅ Registration received and pending approval.",
      applicationId,
      customerCode,
    },
    customer: newCustomer,
  };
}

async function loginCustomer({ Customer, bcrypt, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const customer = await Customer.findOne({ email: normalizedEmail });

  if (!customer) {
    return {
      statusCode: 200,
      body: { success: false, message: "Customer not found." },
    };
  }

  if (customer.status !== "approved") {
    return {
      statusCode: 200,
      body: { success: false, message: "Your account is not approved yet." },
    };
  }

  if (!customer.password) {
    return {
      statusCode: 200,
      body: {
        success: false,
        message: "No password set. Please use the link in your email.",
      },
    };
  }

  const isMatch = await bcrypt.compare(password, customer.password);

  if (!isMatch) {
    return {
      statusCode: 200,
      body: {
        success: false,
        message: "Login failed. Please check your credentials.",
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Login successful",
      redirect: "/Customer-logins/customer-dashboard.html",
      customer: buildCustomerLoginPayload(customer),
    },
  };
}

module.exports = {
  approveCustomer,
  rejectCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  registerCustomer,
  loginCustomer,
};
