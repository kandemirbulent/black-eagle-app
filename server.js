// 🌍 ENV ayarları
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcryptjs");
const fs = require("fs");
const crypto = require("crypto");

const Order = require("./models/order");
const Customer = require("./models/customer");
const Staff = require("./models/staff");
const AdminUser = require("./models/adminUser");
const Event = require("./models/event");
const EventApplication = require("./models/eventApplication");
const EventAssignment = require("./models/eventAssignment");
const staffEvents = require("./routes/staffEvents");
const {
  normalizeEmail,
  getBaseUrl,
  serializeCustomer,
} = require("./utils/customer-utils");
const {
  normalizeRole,
  buildRoleRequirementsFromOrder,
  getRequiredQuantityForRole,
  canAutoApprovalStart,
} = require("./utils/event-utils");
const {
  calculateOrderFinancials,
} = require("./utils/order-utils");
const {
  approveCustomer,
  rejectCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  registerCustomer,
  loginCustomer,
} = require("./services/customer-service");
const {
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
} = require("./services/staff-service");

const app = express();

// 📨 Nodemailer
const emailPort = Number.parseInt(process.env.EMAIL_PORT || "587", 10);
const smtpPort = Number.isNaN(emailPort) ? 587 : emailPort;
const useSecureEmail = smtpPort === 465;

const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: smtpPort,
  secure: useSecureEmail,
  requireTLS: !useSecureEmail,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// Environment sanity check without exposing secret values in logs
console.log("Environment ready:", {
  mongo: !!process.env.MONGO_URI,
  stripeSecret: !!process.env.STRIPE_SECRET_KEY,
  stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET,
  emailHost: !!process.env.EMAIL_HOST,
  emailPort: smtpPort,
  emailUser: !!process.env.EMAIL_USER,
  emailPass: !!process.env.EMAIL_PASS,
  smsAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
  smsAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
  smsVerifyServiceSid: !!process.env.TWILIO_VERIFY_SERVICE_SID,
  smsFromNumber: !!process.env.TWILIO_FROM_NUMBER,
});

async function sendStaffPhoneOtpSms({ to, body }) {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const verifyServiceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();
  const fromNumber = String(process.env.TWILIO_FROM_NUMBER || "").trim();

  if (!accountSid || !authToken || (!verifyServiceSid && !fromNumber)) {
    throw new Error("SMS provider is not configured.");
  }

  if (typeof fetch !== "function") {
    throw new Error("Fetch API is not available in this runtime.");
  }

  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  let response;

  if (verifyServiceSid) {
    response = await fetch(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(verifyServiceSid)}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          To: to,
          Channel: "sms",
        }),
      }
    );
  } else {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: body,
        }),
      }
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio send failed: ${response.status} ${errorText}`);
  }
}

async function verifyStaffPhoneOtpCode({ to, code }) {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const verifyServiceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();

  if (!verifyServiceSid) {
    return null;
  }

  if (!accountSid || !authToken) {
    throw new Error("Twilio Verify is not configured.");
  }

  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(verifyServiceSid)}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({
        To: to,
        Code: code,
      }),
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Twilio verify failed: ${response.status} ${JSON.stringify(payload || {})}`
    );
  }

  return payload?.status === "approved";
}

const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getAdminJwtSecret() {
  return String(process.env.JWT_SECRET || "").trim();
}

function encodeTokenPayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signAdminToken(payload) {
  const secret = getAdminJwtSecret();

  if (!secret) {
    throw new Error("JWT_SECRET is required for admin authentication.");
  }

  const encodedPayload = encodeTokenPayload(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function verifyAdminToken(token) {
  const secret = getAdminJwtSecret();

  if (!secret || !token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, providedSignature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (providedSignature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

    if (!payload?.sub || !payload?.exp || Date.now() > Number(payload.exp)) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function buildAdminAuthToken(adminUser) {
  return signAdminToken({
    sub: String(adminUser._id),
    email: adminUser.email,
    role: adminUser.role,
    name: adminUser.name,
    exp: Date.now() + ADMIN_TOKEN_TTL_MS,
  });
}

function serializeAdminUser(adminUser) {
  return {
    id: adminUser._id,
    firstName: adminUser.firstName || "",
    lastName: adminUser.lastName || "",
    name: adminUser.name || "",
    email: adminUser.email || "",
    role: adminUser.role || "admin",
    status: adminUser.status || "active",
    createdBy: adminUser.createdBy || null,
    lastLoginAt: adminUser.lastLoginAt || null,
    createdAt: adminUser.createdAt || null,
    updatedAt: adminUser.updatedAt || null,
  };
}

async function ensureInitialSuperAdmin() {
  const email = normalizeEmail(
    process.env.SUPER_ADMIN_EMAIL || "kandemirbulent@outlook.com"
  );
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "205198Xyz,,>>").trim();

  if (!email || !password) {
    console.warn(
      "⚠️ SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD missing. Initial superadmin seed skipped."
    );
    return;
  }

  const existingAdmin = await AdminUser.findOne({ email });

  if (existingAdmin) {
    let shouldSave = false;

    if (existingAdmin.role !== "superadmin") {
      existingAdmin.role = "superadmin";
      shouldSave = true;
    }

    if (existingAdmin.status !== "active") {
      existingAdmin.status = "active";
      shouldSave = true;
    }

    if (!existingAdmin.passwordHash && password) {
      existingAdmin.password = password;
      shouldSave = true;
    }

    if (shouldSave) {
      await existingAdmin.save();
    }

    return;
  }

  await AdminUser.create({
    firstName: "Black Eagle",
    lastName: "Superadmin",
    email,
    password,
    role: "superadmin",
    status: "active",
    createdBy: null,
  });

  console.log(`✅ Initial superadmin created for ${email}`);
}

async function requireAdminAuth(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const payload = verifyAdminToken(token);

    if (!payload?.sub) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required.",
      });
    }

    const adminUser = await AdminUser.findById(payload.sub);

    if (!adminUser || adminUser.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Admin account is not available.",
      });
    }

    req.adminUser = adminUser;
    next();
  } catch (error) {
    console.error("❌ Admin auth middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while validating admin session.",
    });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.adminUser || req.adminUser.role !== "superadmin") {
    return res.status(403).json({
      success: false,
      message: "Superadmin access is required.",
    });
  }

  return next();
}

function parseAddressSummary(address = "") {
  const segments = String(address || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return {
      city: "",
      region: "",
    };
  }

  return {
    city: segments.length >= 2 ? segments[segments.length - 2] : segments[0],
    region: segments[segments.length - 1] || "",
  };
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows = []) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ];

  return lines.join("\n");
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Atlas connected successfully");
    await ensureInitialSuperAdmin();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
  });

// 🔔 STRIPE WEBHOOK
// DİKKAT: bodyParser.json() ÖNCESİNDE olmalı
app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  console.log("🔥 WEBHOOK HIT");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("📩 Webhook event type:", event.type);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      console.log("✅ PAYMENT SUCCESS (WEBHOOK)");
      console.log("Metadata:", session.metadata);

      const appId = session.metadata?.appId || "";
      const mode = session.metadata?.mode || "";
      const orderIdsRaw = session.metadata?.orderIds || "";
      const paymentType = session.metadata?.paymentType || "";
      const chargedAmount = Number(session.metadata?.chargedAmount || 0);
      const singleOrderId = session.metadata?.orderId || "";

      console.log("🧾 appId:", appId);
      console.log("🧾 mode:", mode);
      console.log("🧾 orderIdsRaw:", orderIdsRaw);
      console.log("🧾 chargedAmount:", chargedAmount);
      console.log("🧾 singleOrderId:", singleOrderId);
      console.log("🧾 paymentType:", paymentType);

      // ✅ KRİTİK FIX
      const orderIds = orderIdsRaw
        ? orderIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
        : [];

      console.log("🧾 parsed orderIds:", orderIds);

      // 🟢 DASHBOARD ÖDEMELERİ
      // Pay This Event / Pay Selected / Pay All
      if (appId && orderIds.length > 0) {
        const orders = await Order.find({
          customerApplicationId: appId,
          orderId: { $in: orderIds },
        });

        console.log("🧾 Orders found for webhook:", orders.length);

        for (const order of orders) {
          const total = Number(order.totalWithVat || order.totalAmount || 0);
          const paid = Number(order.amountPaid || 0);
          const remaining = Math.max(total - paid, 0);

          console.log(
            `💷 Updating order ${order.orderId} | total=${total} | paid=${paid} | remaining=${remaining}`
          );

          order.amountPaid = paid + remaining;

          if (order.amountPaid >= total) {
            order.status = "Paid";
            order.paymentStatus = "Paid";
          } else if (order.amountPaid > 0) {
            order.status = "Deposit Paid";
            order.paymentStatus = "Deposit Paid";
          } else {
            order.status = "Pending";
            order.paymentStatus = "Pending";
          }

          if (typeof order.isVisibleToCustomer !== "undefined") {
            order.isVisibleToCustomer = true;
          }

          await order.save();
          await ensureEventForOrder(order);
          console.log(`💰 Order updated via webhook: ${order.orderId}`);
        }
      }

      // 🟡 CREATE ORDER / PAYMENT.HTML DEPOSIT FLOW
      else if (appId && chargedAmount > 0) {
        let latestOrder = null;

        if (singleOrderId) {
          latestOrder = await Order.findOne({
            customerApplicationId: appId,
            orderId: singleOrderId,
          });
        }

        if (!latestOrder) {
          latestOrder = await Order.findOne({
            customerApplicationId: appId,
          }).sort({ createdAt: -1 });
        }

        if (latestOrder) {
          const beforePaid = Number(latestOrder.amountPaid || 0);
          latestOrder.amountPaid = beforePaid + chargedAmount;

          const total = Number(latestOrder.totalWithVat || latestOrder.totalAmount || 0);

          console.log(
            `💷 Deposit updating latest order ${latestOrder.orderId} | beforePaid=${beforePaid} | charged=${chargedAmount} | total=${total}`
          );

          if (latestOrder.amountPaid >= total) {
            latestOrder.status = "Paid";
            latestOrder.paymentStatus = "Paid";
          } else if (latestOrder.amountPaid > 0) {
            latestOrder.status = "Deposit Paid";
            latestOrder.paymentStatus = "Deposit Paid";
          } else {
            latestOrder.status = "Pending";
            latestOrder.paymentStatus = "Pending";
          }

          if (typeof latestOrder.isVisibleToCustomer !== "undefined") {
            latestOrder.isVisibleToCustomer = true;
          }

          await latestOrder.save();
          await ensureEventForOrder(latestOrder);
          console.log(`💰 Deposit updated via webhook: ${latestOrder.orderId}`);
        } else {
          console.warn(`⚠️ No order found for appId ${appId} during webhook update.`);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("❌ Webhook processing error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Bunlar webhook'tan SONRA gelmeli
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use("/api/staff-events", staffEvents);

app.get("/delete-account.html", (req, res) => {
  res.status(200).type("html").send(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Delete Your Black Eagle Staffing Account</title></head>
<body>
<h1>Delete Your Black Eagle Staffing Account</h1>
<p>If you would like to delete your Black Eagle Staffing account and associated personal data, please email support@blackeagleuk.com with your registered email address.</p>
<p>We will verify your request and delete your account and associated personal data within 7 days, unless retention is required for legal, security, or fraud prevention reasons.</p>
</body>
</html>`);
});

async function sendCustomerPasswordLink(customer, token, options = {}) {
  const mode = options.mode === "reset" ? "reset" : "setup";
  const baseUrl = getBaseUrl();
  const pagePath =
    mode === "reset"
      ? "/Customer-logins/reset.html"
      : "/Customer-logins/set-password.html";

  const query =
    mode === "reset"
      ? `?token=${encodeURIComponent(token)}&email=${encodeURIComponent(
          customer.email || ""
        )}`
      : `?token=${encodeURIComponent(token)}`;

  const actionLink = `${baseUrl}${pagePath}${query}`;
  const title =
    mode === "reset"
      ? "Reset your Black Eagle password"
      : "Your Black Eagle Account Has Been Approved";
  const intro =
    mode === "reset"
      ? "We received a request to reset your password. Use the link below to set a new password."
      : "Your application has been approved. Please create your password to access your customer dashboard.";
  const actionText =
    mode === "reset" ? "Reset Your Password" : "Create Your Password";

  await mailer.sendMail({
    from: `"Black Eagle Services" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: title,
    html: `
      <div style="font-family:Arial,sans-serif;padding:20px;">
        <h2>Hello ${customer.firstName || "there"}!</h2>
        <p>${intro}</p>
        <p>
          <a href="${actionLink}" style="background:#000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">
            ${actionText}
          </a>
        </p>
        <p>This link will expire in 24 hours.</p>
      </div>
    `,
  });
}

async function sendStaffPasswordLink(staff, token) {
  const baseUrl = getBaseUrl();
  const actionLink =
    `${baseUrl}/staff-logins/staff-reset-password.html?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(staff.email || "")}`;

  await mailer.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: staff.email,
    subject: "Reset your Black Eagle staff password",
    html: `
      <div style="font-family:Arial,sans-serif;padding:20px;">
        <h2>Hello ${staff.firstName || "there"},</h2>
        <p>We received a request to reset your Black Eagle staff password.</p>
        <p>Use the secure link below to set a new password:</p>
        <p style="margin:24px 0;">
          <a href="${actionLink}" style="background:#111827;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;">
            Reset Staff Password
          </a>
        </p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p style="word-break:break-all;">${actionLink}</p>
        <p>This link will expire in 24 hours.</p>
      </div>
    `,
  });
}

async function ensureEventForOrder(order) {
  if (!order || !order._id) return;

  const existing = await Event.findOne({ order: order._id });
  if (existing) return;

  const firstStaff = Array.isArray(order.staff) ? order.staff[0] : null;
  if (!firstStaff?.date) return;

  const roles = buildRoleRequirementsFromOrder(order);
  if (!roles.length) return;

  const primaryRole = normalizeRole(firstStaff.service || roles[0]?.role || "");
  const readableRole = primaryRole
    ? primaryRole.charAt(0).toUpperCase() + primaryRole.slice(1)
    : "Staff";

  const eventTitle =
    String(order.eventName || "").trim() ||
    String(order.companyName || "").trim() ||
    `${readableRole} Event`;

  const eventDate = new Date(firstStaff.date);

  await Event.create({
    order: order._id,
    title: eventTitle,
    description: order.description || "",
    location: order.location || "",
    eventDate,
    applicationDeadline: order.applicationDeadline
      ? new Date(order.applicationDeadline)
      : eventDate,
    startTime: firstStaff.startTime || "",
    endTime: firstStaff.endTime || "",
    status: "open",
    roleRequirements: roles,
    autoApprovalProcessed: false,
    autoApprovalProcessedAt: null,
    notes: order.notes || "",
  });

  console.log("✅ Event created for order:", order.orderId);
}

async function autoApproveApplicationsForEvent(eventId) {
  if (!eventId) return;

  const event = await Event.findById(eventId).lean();
  if (!event) return;

  if (normalizeRole(event.status) !== "open") {
    console.log("ℹ️ Event is not open, skipping auto-approval:", event._id);
    return;
  }

  const now = new Date();

  if (event.applicationDeadline && new Date(event.applicationDeadline) < now) {
    console.log("ℹ️ Application deadline passed, skipping auto-approval:", event._id);
    return;
  }

  if (event.eventDate && new Date(event.eventDate) < now) {
    console.log("ℹ️ Event date passed, skipping auto-approval:", event._id);
    return;
  }

  if (!canAutoApprovalStart(event)) {
    console.log("⏳ Auto-approval waiting period not finished yet for event:", event._id);
    return;
  }

  const roleRequirements = Array.isArray(event.roleRequirements) ? event.roleRequirements : [];
  if (!roleRequirements.length) {
    console.log("ℹ️ No role requirements found for event:", event._id);
    return;
  }

  for (const requirement of roleRequirements) {
    const role = normalizeRole(requirement.role);
    const quantityRequired = Number(requirement.quantityRequired || 0);

    if (!role || quantityRequired <= 0) continue;

    const approvedCount = await EventApplication.countDocuments({
      event: event._id,
      role,
      status: "approved",
    });

    const remainingSlots = Math.max(quantityRequired - approvedCount, 0);

    if (remainingSlots <= 0) {
      console.log(`✅ Role already full for ${role} on event ${event._id}`);
      continue;
    }

    const pendingApplications = await EventApplication.find({
      event: event._id,
      role,
      status: "pending",
    })
      .populate({
        path: "staff",
        select: "averageRating feedbackCount status positions firstName lastName name",
      })
      .sort({ appliedAt: 1, createdAt: 1 });

    if (!pendingApplications.length) {
      console.log(`ℹ️ No pending applications for role ${role} on event ${event._id}`);
      continue;
    }

    const eligibleApplications = pendingApplications
      .filter((app) => {
        const staff = app.staff;
        if (!staff) return false;
        if (normalizeRole(staff.status) !== "active") return false;

        const positions = Array.isArray(staff.positions)
          ? staff.positions.map((item) => normalizeRole(item))
          : [];

        return positions.includes(role);
      })
      .sort((a, b) => {
        const ratingA = Number(a.staff?.averageRating || 0);
        const ratingB = Number(b.staff?.averageRating || 0);

        if (ratingB !== ratingA) return ratingB - ratingA;

        const feedbackA = Number(a.staff?.feedbackCount || 0);
        const feedbackB = Number(b.staff?.feedbackCount || 0);

        if (feedbackB !== feedbackA) return feedbackB - feedbackA;

        const appliedA = new Date(a.appliedAt || a.createdAt || 0).getTime();
        const appliedB = new Date(b.appliedAt || b.createdAt || 0).getTime();

        return appliedA - appliedB;
      });

    const toApprove = eligibleApplications.slice(0, remainingSlots);

    if (!toApprove.length) {
      console.log(`ℹ️ No eligible applications to approve for role ${role} on event ${event._id}`);
      continue;
    }

    const idsToApprove = toApprove.map((item) => item._id);

    await EventApplication.updateMany(
      { _id: { $in: idsToApprove } },
      { $set: { status: "approved" } }
    );

    console.log(
      `✅ Auto-approved ${idsToApprove.length} application(s) for role ${role} on event ${event._id}`
    );
  }

  await Event.findByIdAndUpdate(event._id, {
    $set: {
      autoApprovalProcessed: true,
      autoApprovalProcessedAt: new Date(),
    },
  });
}

// 🧠 Test kullanıcıları
const users = [
  { id: 1, name: "Bülent Kandemir", email: "bulent@blackeagle.co.uk", role: "superadmin" },
  { id: 2, name: "James Walker", email: "james@blackeagle.co.uk", role: "admin" },
  { id: 3, name: "Sarah Lee", email: "sarah@blackeagle.co.uk", role: "staff" },
  { id: 4, name: "Michael Brown", email: "michael@customer.com", role: "customer" },
];

// ✅ Basit role endpoint (dashboard için)
app.get("/get-user-role", requireAdminAuth, (req, res) => {
  res.json({
    role: req.adminUser.role,
    user: serializeAdminUser(req.adminUser),
  });
});

// ✅ Get pending customers (for dashboard)
app.get("/get-pending-customers", requireAdminAuth, async (req, res) => {
  try {
    const pendingCustomers = await Customer.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(pendingCustomers.map(serializeCustomer));
  } catch (err) {
    console.error("❌ Error fetching pending customers:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/test-email", async (req, res) => {
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "✅ Black Eagle Email Test",
      text: "Outlook SMTP bağlantısı başarıyla çalışıyor.",
    });
    res.send("✅ Test mail sent successfully!");
  } catch (err) {
    console.error("❌ Email test error:", err);
    res.status(500).send("❌ Email sending failed. Check console for details.");
  }
});

// ✅ Approve customer and send email with password setup link
app.post("/approve-customer/:id", requireAdminAuth, async (req, res) => {
  try {
    const result = await approveCustomer({
      Customer,
      customerId: req.params.id,
      createToken: () => crypto.randomBytes(24).toString("hex"),
      sendCustomerPasswordLink,
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error approving customer:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/reject-customer/:id", requireAdminAuth, async (req, res) => {
  try {
    const result = await rejectCustomer({
      Customer,
      customerId: req.params.id,
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error rejecting customer:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while rejecting customer.",
    });
  }
});

// 📩 Get customer info by email
app.get("/get-customer-by-email/:email", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.params.email);
    const customer = await Customer.findOne({ email: normalizedEmail });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.json({ success: true, customer: serializeCustomer(customer) });
  } catch (err) {
    if (err && err.code === 11000) {
      const dupField =
        (err.keyPattern && Object.keys(err.keyPattern)[0]) ||
        (err.keyValue && Object.keys(err.keyValue)[0]) ||
        "field";

      return res.status(409).json({
        success: false,
        message: `⚠️ This ${dupField} is already registered. Please use a different one.`,
        error: "DUPLICATE_KEY",
      });
    }

    console.error("❌ Error fetching customer:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 🔑 Login simülasyonu
app.post("/login", handleAdminLogin);

async function handleAdminLogin(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    if (!getAdminJwtSecret()) {
      return res.status(500).json({
        success: false,
        message: "Admin authentication is not configured. Please set JWT_SECRET.",
      });
    }

    const adminUser = await AdminUser.findOne({ email });

    if (!adminUser || adminUser.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials.",
      });
    }

    const isMatch = await adminUser.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials.",
      });
    }

    adminUser.lastLoginAt = new Date();
    await adminUser.save();

    return res.json({
      success: true,
      token: buildAdminAuthToken(adminUser),
      redirect: "/dashboard.html",
      user: serializeAdminUser(adminUser),
    });
  } catch (error) {
    console.error("❌ Admin login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while logging in admin user.",
    });
  }
}

async function ensureAnotherActiveSuperAdminExists(excludedAdminId) {
  const count = await AdminUser.countDocuments({
    _id: { $ne: excludedAdminId },
    role: "superadmin",
    status: "active",
  });

  return count > 0;
}

app.post("/admin/login", handleAdminLogin);

app.get("/admin/users", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const users = await AdminUser.find().sort({ role: 1, createdAt: -1 });
    return res.json(users.map(serializeAdminUser));
  } catch (error) {
    console.error("❌ Error loading admin users:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while loading admin users.",
    });
  }
});

app.post("/admin/users", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const role = req.body?.role === "superadmin" ? "superadmin" : "admin";

    if (!firstName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "First name, email and password are required.",
      });
    }

    const existing = await AdminUser.findOne({ email });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An admin user with this email already exists.",
      });
    }

    const adminUser = await AdminUser.create({
      firstName,
      lastName,
      email,
      password,
      role,
      status: "active",
      createdBy: req.adminUser?._id || null,
    });

    return res.status(201).json({
      success: true,
      user: serializeAdminUser(adminUser),
    });
  } catch (error) {
    console.error("❌ Error creating admin user:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while creating admin user.",
    });
  }
});

app.patch("/admin/users/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const adminUser = await AdminUser.findById(req.params.id);

    if (!adminUser) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found.",
      });
    }

    const nextRole =
      typeof req.body?.role === "string" && ["admin", "superadmin"].includes(req.body.role)
        ? req.body.role
        : adminUser.role;
    const nextStatus =
      typeof req.body?.status === "string" && ["active", "disabled"].includes(req.body.status)
        ? req.body.status
        : adminUser.status;

    const wouldRemoveLastSuperAdmin =
      adminUser.role === "superadmin" &&
      (nextRole !== "superadmin" || nextStatus !== "active") &&
      !(await ensureAnotherActiveSuperAdminExists(adminUser._id));

    if (wouldRemoveLastSuperAdmin) {
      return res.status(400).json({
        success: false,
        message: "At least one active superadmin must remain.",
      });
    }

    if (typeof req.body?.firstName === "string") {
      adminUser.firstName = req.body.firstName.trim() || adminUser.firstName;
    }

    if (typeof req.body?.lastName === "string") {
      adminUser.lastName = req.body.lastName.trim();
    }

    if (typeof req.body?.email === "string" && normalizeEmail(req.body.email)) {
      const nextEmail = normalizeEmail(req.body.email);
      const duplicate = await AdminUser.findOne({
        _id: { $ne: adminUser._id },
        email: nextEmail,
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Another admin user already uses this email.",
        });
      }

      adminUser.email = nextEmail;
    }

    if (typeof req.body?.password === "string" && req.body.password.trim()) {
      adminUser.password = req.body.password.trim();
    }

    adminUser.role = nextRole;
    adminUser.status = nextStatus;

    await adminUser.save();

    return res.json({
      success: true,
      user: serializeAdminUser(adminUser),
    });
  } catch (error) {
    console.error("❌ Error updating admin user:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating admin user.",
    });
  }
});

app.delete("/admin/users/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const adminUser = await AdminUser.findById(req.params.id);

    if (!adminUser) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found.",
      });
    }

    const removingLastSuperAdmin =
      adminUser.role === "superadmin" &&
      !(await ensureAnotherActiveSuperAdminExists(adminUser._id));

    if (removingLastSuperAdmin) {
      return res.status(400).json({
        success: false,
        message: "At least one active superadmin must remain.",
      });
    }

    await AdminUser.findByIdAndDelete(adminUser._id);

    return res.json({
      success: true,
      message: "Admin user deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting admin user:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting admin user.",
    });
  }
});

app.get("/admin/customers", requireAdminAuth, async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    return res.json(customers.map(serializeCustomer));
  } catch (error) {
    console.error("❌ Error loading customers list:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while loading customers.",
    });
  }
});

app.get("/admin/staff", requireAdminAuth, async (req, res) => {
  try {
    const staffMembers = await Staff.find().sort({ createdAt: -1 }).lean();
    return res.json(
      staffMembers.map((staffMember) => ({
        id: String(staffMember._id),
        fullName:
          staffMember.name ||
          `${staffMember.firstName || ""} ${staffMember.lastName || ""}`.trim(),
        firstName: staffMember.firstName || "",
        lastName: staffMember.lastName || "",
        email: staffMember.email || "",
        mobile: staffMember.mobile || "",
        postcode: staffMember.postcode || "",
        address: staffMember.address || "",
        positions: Array.isArray(staffMember.positions) ? staffMember.positions : [],
        status: staffMember.status || "",
        createdAt: staffMember.createdAt || null,
      }))
    );
  } catch (error) {
    console.error("❌ Error loading staff list:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while loading staff.",
    });
  }
});

app.get("/admin/orders", requireAdminAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    return res.json(orders);
  } catch (error) {
    console.error("❌ Error loading orders list:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while loading orders.",
    });
  }
});

app.get("/admin/dashboard-summary", requireAdminAuth, async (req, res) => {
  try {
    const [customers, staffMembers, orders] = await Promise.all([
      Customer.find().lean(),
      Staff.find().lean(),
      Order.find().lean(),
    ]);

    const pendingCustomers = customers.filter((item) => item.status === "pending").length;
    const pendingStaff = staffMembers.filter((item) => item.status === "pending").length;
    const activeOrders = orders.filter((item) => {
      const status = String(item.orderStatus || item.status || "").toLowerCase();
      return status.includes("pending") || status.includes("draft") || status.includes("deposit");
    }).length;
    const completedOrders = orders.filter((item) => {
      const status = String(item.orderStatus || item.status || item.paymentStatus || "").toLowerCase();
      return status.includes("completed") || status === "paid";
    }).length;

    const professionCounts = {};
    const cityCounts = {};

    for (const staffMember of staffMembers) {
      const addressSummary = parseAddressSummary(staffMember.address);
      const cityKey = addressSummary.city || "Unknown";
      cityCounts[cityKey] = Number(cityCounts[cityKey] || 0) + 1;

      for (const position of Array.isArray(staffMember.positions) ? staffMember.positions : []) {
        const key = String(position || "").trim() || "Unknown";
        professionCounts[key] = Number(professionCounts[key] || 0) + 1;
      }
    }

    return res.json({
      success: true,
      totals: {
        customers: customers.length,
        staff: staffMembers.length,
        orders: orders.length,
        pendingCustomers,
        pendingStaff,
        activeOrders,
        completedOrders,
      },
      staffByCity: cityCounts,
      staffByProfession: professionCounts,
    });
  } catch (error) {
    console.error("❌ Error loading dashboard summary:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while loading dashboard summary.",
    });
  }
});

app.get("/admin/customer-orders/:applicationId", requireAdminAuth, async (req, res) => {
  try {
    const appId = String(req.params.applicationId || "").trim();
    const orders = await Order.find({ customerApplicationId: appId }).sort({ createdAt: -1 });
    return res.json(orders);
  } catch (error) {
    console.error("❌ Error loading admin customer orders:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load customer orders.",
    });
  }
});

app.get("/admin/staff-report", requireAdminAuth, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const position = String(req.query.position || "").trim();
    const city = String(req.query.city || "").trim().toLowerCase();
    const region = String(req.query.region || "").trim().toLowerCase();
    const format = String(req.query.format || "json").trim().toLowerCase();
    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (position) {
      filter.positions = position;
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
        { mobile: searchRegex },
        { postcode: searchRegex },
        { address: searchRegex },
        { positions: searchRegex },
      ];
    }

    const [staffMembers, applicationStats, assignmentStats] = await Promise.all([
      Staff.find(filter).sort({ createdAt: -1 }).lean(),
      EventApplication.aggregate([
        {
          $group: {
            _id: "$staff",
            applicationsCount: { $sum: 1 },
            approvedApplicationsCount: {
              $sum: {
                $cond: [{ $eq: ["$status", "approved"] }, 1, 0],
              },
            },
          },
        },
      ]),
      EventAssignment.aggregate([
        {
          $group: {
            _id: "$staff",
            assignmentsCount: { $sum: 1 },
            completedAssignmentsCount: {
              $sum: {
                $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const applicationMap = new Map(
      applicationStats.map((item) => [String(item._id), item])
    );
    const assignmentMap = new Map(
      assignmentStats.map((item) => [String(item._id), item])
    );

    const rows = staffMembers.map((staffMember) => {
      const applicationRow = applicationMap.get(String(staffMember._id)) || {};
      const assignmentRow = assignmentMap.get(String(staffMember._id)) || {};
      const addressSummary = parseAddressSummary(staffMember.address);

      return {
        staffId: String(staffMember._id),
        fullName:
          staffMember.name ||
          `${staffMember.firstName || ""} ${staffMember.lastName || ""}`.trim(),
        email: staffMember.email || "",
        mobile: staffMember.mobile || "",
        status: staffMember.status || "",
        profession: Array.isArray(staffMember.positions)
          ? staffMember.positions.join(", ")
          : "",
        postcode: staffMember.postcode || "",
        city: addressSummary.city,
        region: addressSummary.region,
        address: staffMember.address || "",
        experience: Number(staffMember.experience || 0),
        averageRating: Number(staffMember.averageRating || 0),
        feedbackCount: Number(staffMember.feedbackCount || 0),
        applicationsCount: Number(applicationRow.applicationsCount || 0),
        approvedApplicationsCount: Number(applicationRow.approvedApplicationsCount || 0),
        assignmentsCount: Number(assignmentRow.assignmentsCount || 0),
        completedAssignmentsCount: Number(assignmentRow.completedAssignmentsCount || 0),
        createdAt: staffMember.createdAt || null,
      };
    }).filter((row) => {
      if (city && String(row.city || "").trim().toLowerCase() !== city) return false;
      if (region && String(row.region || "").trim().toLowerCase() !== region) return false;
      return true;
    });

    const summary = {
      totalStaff: rows.length,
      byProfession: {},
      byCity: {},
    };

    for (const row of rows) {
      const cityKey = row.city || "Unknown";
      summary.byCity[cityKey] = Number(summary.byCity[cityKey] || 0) + 1;

      const professionList = String(row.profession || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (!professionList.length) {
        summary.byProfession.Unknown = Number(summary.byProfession.Unknown || 0) + 1;
      } else {
        for (const professionName of professionList) {
          summary.byProfession[professionName] =
            Number(summary.byProfession[professionName] || 0) + 1;
        }
      }
    }

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=black-eagle-staff-report.csv"
      );
      return res.send(buildCsv(rows));
    }

    return res.json({
      success: true,
      count: rows.length,
      summary,
      rows,
    });
  } catch (error) {
    console.error("❌ Error generating staff report:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while generating staff report.",
    });
  }
});

async function handleCustomerForgotPassword(req, res) {
  try {
    const result = await requestCustomerPasswordReset({
      Customer,
      email: req.body?.email,
      createToken: () => crypto.randomBytes(24).toString("hex"),
      sendCustomerPasswordLink,
    });

    console.log(`🔐 Password reset requested for: ${normalizeEmail(req.body?.email)}`);

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Customer forgot password error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while sending reset link.",
    });
  }
}

app.post("/customer-forgot-password", handleCustomerForgotPassword);
app.post("/customer-forgot", handleCustomerForgotPassword);

async function handleStaffForgotPassword(req, res) {
  try {
    const result = await requestStaffPasswordReset({
      Staff,
      email: req.body?.email,
      createToken: () => crypto.randomBytes(24).toString("hex"),
      sendStaffPasswordLink,
    });

    console.log(`🔐 Staff password reset requested for: ${normalizeEmail(req.body?.email)}`);

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Staff forgot password error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while sending reset link.",
    });
  }
}

app.post("/api/staff/forgot-password", handleStaffForgotPassword);
app.post("/staff-forgot-password", handleStaffForgotPassword);

app.post("/api/staff/reset-password", async (req, res) => {
  try {
    const result = await resetStaffPassword({
      Staff,
      email: req.body?.email,
      token: req.body?.token,
      password: req.body?.password ?? req.body?.newPassword,
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Staff reset password error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while resetting password.",
    });
  }
});

// 🧾 Yeni sipariş
app.post("/orders", async (req, res) => {
  try {
    const financials = calculateOrderFinancials({
      ...req.body,
      staff: req.body?.staff,
      subtotalAmount: req.body?.subtotalAmount,
      totalAmount: req.body?.totalAmount,
      vatRate: req.body?.vatRate,
      vatAmount: req.body?.vatAmount,
      totalWithVat: req.body?.totalWithVat,
      minimumPaymentAmount: req.body?.minimumPaymentAmount,
    });

    const newOrder = new Order({
      ...req.body,
      ...financials,
    });
    await newOrder.save();

    // 🔥 EKLEDİĞİN SATIR
    await ensureEventForOrder(newOrder);

    res.status(201).json({ success: true, orderId: newOrder.orderId });
  } catch (err) {
    console.error("❌ Error saving order:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📋 Tüm siparişleri getir
app.get("/get-orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// ✅ Get all orders for current customer
app.get("/get-my-orders", async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 });

    res.json({
      success: true,
      orders: orders.map((o) => ({
        orderId: o.orderId,
        eventName: o.eventName || o.description || o.companyName || "Untitled",
        category: o.category || "-",
        amount: o.totalWithVat || o.totalAmount || o.amount || 0,
        status: o.status || "pending",
        createdAt: o.createdAt,
        description: o.description,
      })),
    });
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🧾 Belirli müşteriye ait siparişleri getir
app.get("/get-customer-orders/:applicationId", async (req, res) => {
  try {
    const appId = req.params.applicationId;
    const orders = await Order.find({ customerApplicationId: appId }).sort({ createdAt: -1 });

    if (!orders.length) {
      return res.json([]);
    }

    res.json(orders);
  } catch (err) {
    console.error("❌ Error loading customer orders:", err);
    res.status(500).json({ error: "Failed to load customer orders" });
  }
});

// ✅ Approved müşterileri getir
app.get("/getApprovedCustomers", requireAdminAuth, async (req, res) => {
  try {
    const customers = await Customer.find({ status: "approved" }).sort({ createdAt: -1 });
    res.json(customers.map(serializeCustomer));
  } catch (err) {
    console.error("❌ Error fetching approved customers:", err);
    res.status(500).json({ error: "Failed to load approved customers" });
  }
});

// 🔍 Eski çalışan route: applicationId ile customer details
// ORDER FLOW bunu kullanıyorsa bozulmasın diye aynen bırakıldı
app.get("/get-customer-details/:appId", async (req, res) => {
  try {
    const customer = await Customer.findOne({ applicationId: req.params.appId });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.json(serializeCustomer(customer));
  } catch (err) {
    console.error("❌ Error fetching customer details:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔍 Yeni route: dashboard View butonu için _id ile customer details
app.get("/get-customer-details-by-id/:id", requireAdminAuth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.json(serializeCustomer(customer));
  } catch (err) {
    console.error("❌ Error fetching customer details by id:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🗑️ Delete customer by Mongo _id
app.delete("/delete-customer/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedCustomer = await Customer.findByIdAndDelete(id);

    if (!deletedCustomer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    res.json({
      success: true,
      message: "Customer deleted successfully.",
    });
  } catch (err) {
    console.error("❌ Error deleting customer:", err);
    res.status(500).json({
      success: false,
      message: "Server error while deleting customer.",
    });
  }
});

app.delete("/admin/staff/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const staffMember = await Staff.findByIdAndDelete(req.params.id);

    if (!staffMember) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found.",
      });
    }

    await Promise.all([
      EventApplication.deleteMany({ staff: staffMember._id }),
      EventAssignment.deleteMany({ staff: staffMember._id }),
    ]);

    return res.json({
      success: true,
      message: "Staff member deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting staff member:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting staff member.",
    });
  }
});

app.delete("/admin/orders/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const event = await Event.findOneAndDelete({ order: order._id });

    if (event?._id) {
      await Promise.all([
        EventApplication.deleteMany({ event: event._id }),
        EventAssignment.deleteMany({ event: event._id }),
      ]);
    }

    return res.json({
      success: true,
      message: "Order deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting order:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting order.",
    });
  }
});

// 🧾 Tekil sipariş
app.get("/get-order/:orderId", async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error("❌ Error fetching order:", err);
    res.status(500).json({ success: false, message: "Error fetching order" });
  }
});

// 👥 Customer event applicants - event detail popup/detail için
app.get("/customer/events/:orderId/applications", async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // 1) Önce order'ı bul
    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 2) Bu order için oluşturulan event'i bul
    const event = await Event.findOne({ order: order._id }).lean();

    if (!event) {
      return res.json({
        success: true,
        event: {
          orderId: order.orderId,
          title: order.eventName || order.companyName || order.description || "Untitled Event",
          date: order.eventDate || null,
          category: order.category || "-",
          location: order.location || "",
        },
        totalApplicants: 0,
        approvedCount: 0,
        pendingCount: 0,
        applicants: [],
      });
    }

    // 3) Event'e yapılan başvuruları staff bilgileriyle çek
    const applications = await EventApplication.find({ event: event._id })
      .populate({
        path: "staff",
        select: "firstName lastName name selfieData profileImage photo image averageRating feedbackCount",
      })
      .sort({ appliedAt: -1, createdAt: -1 })
      .lean();

    const applicants = applications.map((app) => {
      const staff = app.staff || {};

      return {
        applicationId: app._id,
        status: app.status || "pending",
        appliedAt: app.appliedAt || app.createdAt || null,
        staff: {
          _id: staff._id || null,
          firstName: staff.firstName || "",
          lastName: staff.lastName || "",
          name:
            staff.name ||
            `${staff.firstName || ""} ${staff.lastName || ""}`.trim() ||
            "Unknown Staff",
          profileImage:
            staff.selfieData ||
            staff.profileImage ||
            staff.photo ||
            staff.image ||
            "",
          role: app.role || "",
          averageRating: Number(staff.averageRating || 0),
          feedbackCount: Number(staff.feedbackCount || 0),
        },
      };
    });

    const approvedCount = applicants.filter((item) =>
      ["approved", "confirmed"].includes(String(item.status).toLowerCase())
    ).length;

    const pendingCount = applicants.filter(
      (item) => String(item.status).toLowerCase() === "pending"
    ).length;

    return res.json({
      success: true,
      event: {
        orderId: order.orderId,
        title: order.eventName || order.companyName || order.description || "Untitled Event",
        date: event.eventDate || order.eventDate || null,
        category: order.category || "-",
        location: event.location || order.location || "",
      },
      totalApplicants: applicants.length,
      approvedCount,
      pendingCount,
      applicants,
    });
  } catch (err) {
    console.error("❌ Error loading customer event applicants:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while loading applicants",
    });
  }
});

// ✅ Staff apply to event
app.post("/api/events/apply", async (req, res) => {
  try {
    const { eventId, staffId, role } = req.body;

    if (!eventId || !staffId || !role) {
      return res.status(400).json({
        success: false,
        message: "eventId, staffId and role are required.",
      });
    }

    const normalizedRole = normalizeRole(role);

    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    if (normalizeRole(event.status) !== "open") {
      return res.status(400).json({
        success: false,
        message: "This event is not open for applications.",
      });
    }

    const now = new Date();

    if (event.applicationDeadline && new Date(event.applicationDeadline) < now) {
      return res.status(400).json({
        success: false,
        message: "Application deadline has passed.",
      });
    }

    if (event.eventDate && new Date(event.eventDate) < now) {
      return res.status(400).json({
        success: false,
        message: "This event has already passed.",
      });
    }

    const requiredQuantity = getRequiredQuantityForRole(event, normalizedRole);

    if (requiredQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "This role is not required for the event.",
      });
    }

    const staff = await Staff.findById(staffId);

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found.",
      });
    }

    if (normalizeRole(staff.status) !== "active") {
      return res.status(400).json({
        success: false,
        message: "Only active staff can apply.",
      });
    }

    const staffPositions = Array.isArray(staff.positions)
      ? staff.positions.map((item) => normalizeRole(item))
      : [];

    if (!staffPositions.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Staff is not registered for this role.",
      });
    }

    const existingApplication = await EventApplication.findOne({
      event: event._id,
      staff: staff._id,
    });

    if (existingApplication) {
      return res.status(409).json({
        success: false,
        message: "You have already applied to this event.",
      });
    }

    const newApplication = new EventApplication({
      event: event._id,
      staff: staff._id,
      role: normalizedRole,
      status: "pending",
      appliedAt: new Date(),
    });

    await newApplication.save();

    await autoApproveApplicationsForEvent(event._id);

    const refreshedApplication = await EventApplication.findById(newApplication._id).lean();

    return res.status(201).json({
      success: true,
      message:
        refreshedApplication?.status === "approved"
          ? "Application submitted and approved."
          : "Application submitted successfully and is pending review.",
      application: refreshedApplication,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You have already applied to this event.",
      });
    }

    console.error("❌ Error applying to event:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while applying to event.",
    });
  }
});

// ✅ STAFF Registration (multi-step form -> email verification)
app.post("/api/staff/create", async (req, res) => {
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
      !mobile ||
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
    const normalizedMobile = normalizePhoneNumber(mobile);

    if (!normalizedMobile || normalizedMobile.replace(/\D/g, "").length < 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid mobile number for phone verification.",
      });
    }

    const existingStaff = await Staff.findOne({ email: normalizedEmail });

    if (existingStaff) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
      });
    }

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    const newStaff = new Staff({
      firstName,
      lastName,
      dob,
      mobile: normalizedMobile,
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

    await newStaff.save();

    const maskedMobile = maskPhoneNumber(newStaff.mobile);

    const smsResult = await sendStaffPhoneVerificationCode({
      sendSms: sendStaffPhoneOtpSms,
      mobile: newStaff.mobile,
      firstName: newStaff.firstName,
      verifyCode,
    });

    if (!smsResult.ok) {
      console.error("❌ Staff phone verification SMS send failed:", smsResult.error);
      return res.status(smsResult.statusCode).json({
        ...smsResult.body,
        email: newStaff.email,
        mobile: maskedMobile,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Do\u011frulama kodu telefonunuza g\u00f6nderildi.",
      email: newStaff.email,
      mobile: maskedMobile,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
      });
    }

    console.error("❌ Error creating staff:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while creating staff.",
    });
  }
});

// ✅ STAFF Email Verification
async function handleStaffPhoneVerification(req, res) {
  try {
    const normalizedEmail = String(req.body?.email || "").toLowerCase().trim();
    const normalizedCode = String(req.body?.code || "").trim();
    const verifyServiceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();

    if (verifyServiceSid) {
      const staff = await Staff.findOne({ email: normalizedEmail });

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "Staff account not found.",
        });
      }

      const isApproved = await verifyStaffPhoneOtpCode({
        to: staff.mobile,
        code: normalizedCode,
      });

      if (!isApproved) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone verification code.",
        });
      }

      const { token: setupToken, expiresAt: setupTokenExpires } =
        createStaffSetupToken({ crypto });

      staff.isVerified = true;
      staff.verifyCode = "";
      staff.verifyCodeExpires = null;
      staff.setupToken = setupToken;
      staff.setupTokenExpires = setupTokenExpires;

      await staff.save();

      return res.status(200).json({
        success: true,
        message: "Phone number verified successfully.",
        setupToken,
      });
    }

    const result = await verifyStaffPhoneOtp({
      Staff,
      email: req.body?.email,
      code: req.body?.code,
      createSetupToken: () => createStaffSetupToken({ crypto }),
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error verifying staff phone OTP:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while verifying phone code.",
    });
  }
}

app.post("/api/staff/verify-phone-otp", handleStaffPhoneVerification);
app.post("/api/staff/verify-email", handleStaffPhoneVerification);

async function handleStaffPhoneOtpResend(req, res) {
  try {
    const result = await resendStaffVerificationCode({
      Staff,
      sendSms: sendStaffPhoneOtpSms,
      email: req.body?.email,
      generateCode: () =>
        Math.floor(100000 + Math.random() * 900000).toString(),
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error resending staff phone verification code:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while resending phone verification code.",
    });
  }
}

app.post("/api/staff/resend-phone-otp", handleStaffPhoneOtpResend);
app.post("/api/staff/resend-code", handleStaffPhoneOtpResend);

// ✅ STAFF Set Password
app.post("/api/staff/set-password", async (req, res) => {
  try {
    const { email, password, token } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const staff = await Staff.findOne({ email: normalizedEmail });

    const validation = validateStaffPasswordSetup({
      staff,
      token,
      password,
    });

    if (!validation.ok) {
      return res.status(validation.statusCode).json(validation.body);
    }

    staff.password = validation.normalizedPassword;
    staff.isPasswordSet = true;
    staff.status = "active";
    staff.setupToken = "";
    staff.setupTokenExpires = null;
    staff.resetToken = "";
    staff.resetTokenExpires = null;

    await staff.save();

    return res.json({
      success: true,
      message: "Password created successfully.",
    });
  } catch (err) {
    console.error("❌ Error setting staff password:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while setting password.",
    });
  }
});

// ✅ STAFF Login
app.post("/api/staff/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();

    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found.",
      });
    }

    if (!staff.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your phone number first.",
      });
    }

    if (!staff.isPasswordSet || !staff.password) {
      return res.status(403).json({
        success: false,
        message: "Please create your password first.",
      });
    }

    const isMatch = await staff.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Wrong password.",
      });
    }

    return res.json({
      success: true,
      message: "Login successful",
      redirect: "/staff-logins/staff-dashboard.html",
      staff: {
        id: staff._id,
        name: staff.name,
        email: staff.email,
        firstName: staff.firstName,
        lastName: staff.lastName,
        role: staff.role,
        status: staff.status,
        positions: staff.positions,
        availability: staff.availability,
      },
    });
  } catch (err) {
    console.error("❌ Error during staff login:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while logging in.",
    });
  }
});

// ✅ STAFF PROFILE - get current staff by email
app.get("/api/staff/me", async (req, res) => {
  try {
    const email = String(req.query.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const staff = await Staff.findOne({ email }).select("-password -verifyCode -verifyCodeExpires");

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found.",
      });
    }

    return res.json({
      success: true,
      staff: {
        id: staff._id,
        name: staff.name || `${staff.firstName || ""} ${staff.lastName || ""}`.trim(),
        firstName: staff.firstName || "",
        lastName: staff.lastName || "",
        dob: staff.dob || null,
        mobile: staff.mobile || "",
        email: staff.email || "",
        postcode: staff.postcode || "",
        address: staff.address || "",
        niNumber: staff.niNumber || "",
        experience: Number(staff.experience || 0),
        availability: staff.availability || "",
        positions: Array.isArray(staff.positions) ? staff.positions : [],
        emergencyContact: {
          name: staff.emergencyContact?.name || "",
          phone: staff.emergencyContact?.phone || "",
        },
        bankDetails: {
          accountHolder: staff.bankDetails?.accountHolder || "",
          bankName: staff.bankDetails?.bankName || "",
          sortCode: staff.bankDetails?.sortCode || "",
          accountNumber: staff.bankDetails?.accountNumber || "",
          iban: staff.bankDetails?.iban || "",
        },
        selfieData: staff.selfieData || "",
        role: staff.role || "staff",
        status: staff.status || "pending",
        isVerified: !!staff.isVerified,
        isPasswordSet: !!staff.isPasswordSet,
        averageRating: Number(staff.averageRating || 0),
        feedbackCount: Number(staff.feedbackCount || 0),
        createdAt: staff.createdAt || null,
        updatedAt: staff.updatedAt || null,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching staff profile:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching staff profile.",
    });
  }
});

// ✅ STAFF PROFILE - update editable personal details
app.put("/api/staff/profile", async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      mobile,
      postcode,
      address,
      experience,
      availability,
      positions,
      emergencyContact,
    } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found.",
      });
    }

    if (typeof firstName === "string") {
      staff.firstName = firstName.trim();
    }

    if (typeof lastName === "string") {
      staff.lastName = lastName.trim();
    }

    if (typeof mobile === "string") {
      staff.mobile = mobile.trim();
    }

    if (typeof postcode === "string") {
      staff.postcode = postcode.trim();
    }

    if (typeof address === "string") {
      staff.address = address.trim();
    }

    if (typeof experience !== "undefined") {
      staff.experience = Number(experience || 0);
    }

    if (typeof availability === "string") {
      staff.availability = availability.trim();
    }

    if (Array.isArray(positions)) {
      staff.positions = positions.map((item) => String(item).trim()).filter(Boolean);
    }

    if (emergencyContact && typeof emergencyContact === "object") {
      staff.emergencyContact = {
        name: String(emergencyContact.name || "").trim(),
        phone: String(emergencyContact.phone || "").trim(),
      };
    }

    staff.name = `${staff.firstName || ""} ${staff.lastName || ""}`.trim();

    await staff.save();

    return res.json({
      success: true,
      message: "Staff profile updated successfully.",
      staff: {
        id: staff._id,
        name: staff.name || "",
        firstName: staff.firstName || "",
        lastName: staff.lastName || "",
        mobile: staff.mobile || "",
        email: staff.email || "",
        postcode: staff.postcode || "",
        address: staff.address || "",
        experience: Number(staff.experience || 0),
        availability: staff.availability || "",
        positions: Array.isArray(staff.positions) ? staff.positions : [],
        emergencyContact: {
          name: staff.emergencyContact?.name || "",
          phone: staff.emergencyContact?.phone || "",
        },
        averageRating: Number(staff.averageRating || 0),
        feedbackCount: Number(staff.feedbackCount || 0),
        updatedAt: staff.updatedAt || null,
      },
    });
  } catch (err) {
    console.error("❌ Error updating staff profile:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while updating staff profile.",
    });
  }
});

// ✅ STAFF BANK DETAILS - update bank information
app.put("/api/staff/bank-details", async (req, res) => {
  try {
    const {
      email,
      accountHolder,
      bankName,
      sortCode,
      accountNumber,
      iban,
    } = req.body;

    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found.",
      });
    }

    staff.bankDetails = {
      accountHolder: String(accountHolder || "").trim(),
      bankName: String(bankName || "").trim(),
      sortCode: String(sortCode || "").trim(),
      accountNumber: String(accountNumber || "").trim(),
      iban: String(iban || "").trim(),
    };

    await staff.save();

    return res.json({
      success: true,
      message: "Bank details updated successfully.",
      bankDetails: {
        accountHolder: staff.bankDetails?.accountHolder || "",
        bankName: staff.bankDetails?.bankName || "",
        sortCode: staff.bankDetails?.sortCode || "",
        accountNumber: staff.bankDetails?.accountNumber || "",
        iban: staff.bankDetails?.iban || "",
      },
      updatedAt: staff.updatedAt || null,
    });
  } catch (err) {
    console.error("❌ Error updating staff bank details:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while updating bank details.",
    });
  }
});

// ✅ Customer Registration
app.post("/register-customer", async (req, res) => {
  try {
    const result = await registerCustomer({
      Customer,
      input: req.body,
      generateApplicationId: () =>
        `BE-CUST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      generateCustomerCode: () =>
        "BE-" + Math.floor(100000 + Math.random() * 900000),
      now: () => new Date(),
    });

    if (result.customer) {
      try {
        await mailer.sendMail({
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          to: result.customer.email,
          subject: "✅ Black Eagle: Application Received (Pending Approval)",
          html: `
            <div style="font-family:Arial,sans-serif;padding:20px;">
              <h2>Thanks, ${result.customer.firstName}!</h2>
              <p>We received your customer application and it is now <b>pending approval</b>.</p>
              <p><b>Application ID:</b> ${result.body.applicationId}</p>
              <p>We will email you again once your account is approved.</p>
            </div>
          `,
        });
        console.log(`✅ Pending email sent to ${result.customer.email}`);
      } catch (mailErr) {
        console.error("❌ Pending email send failed:", mailErr);
      }

      console.log(
        `🕓 New customer registration pending: ${result.customer.companyName} (${result.body.applicationId}, ${result.body.customerCode})`
      );
    }

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error saving customer:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🔐 Set new password
app.post("/set-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.json({
        success: false,
        message: "❌ Missing token or password.",
      });
    }

    const customer = await Customer.findOne({
      resetToken: token,
      tokenExpires: { $gt: Date.now() },
    });

    if (!customer) {
      return res.json({
        success: false,
        message: "❌ Invalid or expired link.",
        redirect: "/Customer-logins/customer-login.html",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    customer.password = hashedPassword;
    customer.resetToken = null;
    customer.tokenExpires = null;

    await customer.save();

    console.log(`✅ Password set for ${customer.email}`);

    res.json({
      success: true,
      message: "✅ Password set successfully! Redirecting to login...",
      redirect: "/Customer-logins/customer-login.html",
    });
  } catch (err) {
    console.error("❌ Error setting password:", err);
    res.status(500).json({
      success: false,
      message: "❌ Server error. Please try again later.",
    });
  }
});

async function handleCustomerResetPassword(req, res) {
  try {
    const result = await resetCustomerPassword({
      Customer,
      bcrypt,
      token: req.body?.token,
      email: req.body?.email,
      password: req.body?.newPassword || req.body?.password,
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error resetting customer password:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while resetting password.",
    });
  }
}

app.post("/customer-reset-password", handleCustomerResetPassword);

// 🔑 CUSTOMER LOGIN (real one)
app.post("/customer-login", async (req, res) => {
  try {
    const result = await loginCustomer({
      Customer,
      bcrypt,
      email: req.body?.email,
      password: req.body?.password,
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
});

// 💳 Stripe Checkout oturumu oluştur
app.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      appId,
      totalAmount,
      orderId,
      email,
      mode,
      orderIds,
      paymentType,
      orderDraft,
    } = req.body;

    let amountToCharge = 0;
    let paymentTitle = "Black Eagle Payment";
    let paymentDescription = `Application ID: ${appId || "N/A"}`;

    console.log("📦 Incoming checkout payload:", req.body);

    // 🟡 CREATE ORDER / PAYMENT.HTML DEPOSIT FLOW
    if (
      typeof totalAmount !== "undefined" &&
      totalAmount !== null &&
      paymentType === "deposit" &&
      orderDraft
    ) {
      const normalizedDraft = calculateOrderFinancials({
        ...orderDraft,
        staff: Array.isArray(orderDraft.staff) ? orderDraft.staff : [],
        subtotalAmount: Number(orderDraft.subtotalAmount || 0),
        totalAmount: Number(orderDraft.totalAmount || 0),
        vatRate: Number(orderDraft.vatRate || 0.2),
        vatAmount: Number(orderDraft.vatAmount || 0),
        totalWithVat: Number(orderDraft.totalWithVat || orderDraft.totalAmount || 0),
        minimumPaymentAmount: Number(orderDraft.minimumPaymentAmount || 0),
      });

      amountToCharge = Number(normalizedDraft.minimumPaymentAmount || totalAmount);

      paymentTitle = `Deposit for Order ${orderId || "BlackEagle"}`;
      paymentDescription = `Application ID: ${appId || "N/A"} | New Booking Deposit`;

      const existingDraftOrder = await Order.findOne({
        customerApplicationId: orderDraft.customerApplicationId || appId,
        orderId: orderId,
      });

      if (!existingDraftOrder) {
        const firstStaffItem = Array.isArray(orderDraft.staff) && orderDraft.staff.length
          ? orderDraft.staff[0]
          : null;

        const newOrder = new Order({
          orderId: orderId,
          customerApplicationId: orderDraft.customerApplicationId || appId || "",
          customerCode: orderDraft.customerCode || "",
          customerName: orderDraft.customerName || "",
          companyName: orderDraft.companyName || "",
          eventName: orderDraft.companyName || "Untitled Event",
          category: firstStaffItem?.service || "-",
          eventDate: firstStaffItem?.date || null,
          phone: orderDraft.phone || "",
          email: orderDraft.email || email || "",
          location: orderDraft.location || "",
          staff: normalizedDraft.staff,
          notes: orderDraft.notes || "",
          subtotalAmount: normalizedDraft.subtotalAmount,
          vatRate: normalizedDraft.vatRate,
          vatAmount: normalizedDraft.vatAmount,
          totalAmount: normalizedDraft.totalAmount,
          totalWithVat: normalizedDraft.totalWithVat,
          minimumPaymentAmount: normalizedDraft.minimumPaymentAmount,
          amountPaid: 0,
          status: "Pending",
          paymentStatus: orderDraft.paymentStatus || "Awaiting Deposit",
          orderStatus: orderDraft.orderStatus || "Draft - Awaiting Payment",
          isVisibleToCustomer: false,
          applicationDeadline: orderDraft.applicationDeadline
            ? new Date(orderDraft.applicationDeadline)
            : firstStaffItem?.date
              ? new Date(firstStaffItem.date)
              : null,
          createdAt: orderDraft.createdAt ? new Date(orderDraft.createdAt) : new Date(),
        });

        await newOrder.save();
        await ensureEventForOrder(newOrder);
        console.log(`✅ New order created before Stripe checkout: ${newOrder.orderId}`);
      } else {
        console.log(`ℹ️ Draft order already exists, not duplicating: ${orderId}`);
      }
    }

    // 🟢 DASHBOARD ÖDEMELERİ
    else if (mode && Array.isArray(orderIds) && orderIds.length && appId) {
      const orders = await Order.find({
        customerApplicationId: appId,
        orderId: { $in: orderIds },
      });

      if (!orders.length) {
        return res.status(404).json({ error: "Orders not found" });
      }

      amountToCharge = orders.reduce((sum, order) => {
        const total = Number(order.totalWithVat || order.totalAmount || 0);
        const paid = Number(order.amountPaid || 0);
        const remaining = Math.max(total - paid, 0);
        return sum + remaining;
      }, 0);

      if (mode === "single") {
        paymentTitle = "Event Balance Payment";
      } else if (mode === "selected") {
        paymentTitle = "Selected Events Balance Payment";
      } else if (mode === "all") {
        paymentTitle = "Outstanding Balance Payment";
      }

      paymentDescription = `Application ID: ${appId} | Orders: ${orderIds.join(", ")}`;
    } else {
      return res.status(400).json({ error: "Invalid payment request payload" });
    }

    const amountInPence = Math.round(Number(amountToCharge) * 100);

    console.log("💷 Calculated amountToCharge:", amountToCharge);
    console.log("💷 Calculated amountInPence:", amountInPence);

    if (!Number.isFinite(amountInPence) || amountInPence <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email || orderDraft?.email || undefined,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: paymentTitle,
              description: paymentDescription,
            },
            unit_amount: amountInPence,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.STRIPE_SUCCESS_URL}?appId=${encodeURIComponent(
        appId || ""
      )}&amount=${encodeURIComponent(amountToCharge)}`,
      cancel_url: `${process.env.STRIPE_CANCEL_URL}?appId=${encodeURIComponent(appId || "")}`,
      metadata: {
        appId: appId || "",
        mode: mode || "",
        orderIds: Array.isArray(orderIds) ? orderIds.join(",") : "",
        paymentType: paymentType || "",
        orderId: orderId || "",
        chargedAmount: String(amountToCharge),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🦅 Header (Logo) Injection Helper
function renderPageWithHeader(res, pageName) {
  const headerPath = path.join(__dirname, "public", "header.html");
  const pagePath = path.join(__dirname, "public", pageName);

  try {
    const headerHTML = fs.readFileSync(headerPath, "utf8");
    const bodyHTML = fs.readFileSync(pagePath, "utf8");
    const finalHTML = bodyHTML.replace(/<body.*?>/, (match) => `${match}\n${headerHTML}\n`);
    res.send(finalHTML);
  } catch (err) {
    console.error(`❌ Error loading ${pageName}:`, err);
    res.sendFile(pagePath);
  }
}

// 🌐 Default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 💰 Ödeme bilgisi güncelleme
// NOT: Ana ödeme kaynağı webhook olmalı. Bu endpoint'e dokunmuyoruz ama duruyor.
app.post("/update-payment-status", async (req, res) => {
  try {
    const { appId, amountPaid, orderId } = req.body;

    let targetOrder = null;

    if (orderId) {
      targetOrder = await Order.findOne({ orderId, customerApplicationId: appId });
    }

    if (!targetOrder) {
      targetOrder = await Order.findOne({ customerApplicationId: appId }).sort({
        createdAt: -1,
      });
    }

    if (!targetOrder) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    targetOrder.amountPaid = Number(targetOrder.amountPaid || 0) + Number(amountPaid || 0);

    const totalDue = Number(targetOrder.totalWithVat || targetOrder.totalAmount || 0);

    if (targetOrder.amountPaid >= totalDue) {
      targetOrder.status = "Paid";
      targetOrder.paymentStatus = "Paid";
    } else if (targetOrder.amountPaid > 0) {
      targetOrder.status = "Deposit Paid";
      targetOrder.paymentStatus = "Deposit Paid";
    } else {
      targetOrder.status = "Pending";
      targetOrder.paymentStatus = "Pending";
    }

    await targetOrder.save();

    res.json({
      success: true,
      message: "Payment updated successfully",
      orderId: targetOrder.orderId,
      amountPaid: targetOrder.amountPaid,
    });
  } catch (err) {
    console.error("❌ Error updating payment:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🔁 Safety net: open event'leri periyodik olarak tekrar değerlendir
setInterval(async () => {
  try {
    const now = new Date();

    const events = await Event.find({
      status: "open",
      eventDate: { $gte: now },
    }).select("_id");

    for (const event of events) {
      await autoApproveApplicationsForEvent(event._id);
    }
  } catch (err) {
    console.error("❌ Auto-approval interval error:", err);
  }
}, 10 * 60 * 1000);

// 🚀 Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
