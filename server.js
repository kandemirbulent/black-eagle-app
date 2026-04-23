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
const Event = require("./models/event");
const EventApplication = require("./models/eventApplication");
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
  approveCustomer,
  rejectCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  registerCustomer,
  loginCustomer,
} = require("./services/customer-service");
const {
  createStaffSetupToken,
  requestStaffPasswordReset,
  resetStaffPassword,
  resendStaffVerificationCode,
  validateStaffPasswordSetup,
} = require("./services/staff-service");

const app = express();

// 📨 Nodemailer
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

// Environment sanity check without exposing secret values in logs
console.log("Environment ready:", {
  mongo: !!process.env.MONGO_URI,
  stripeSecret: !!process.env.STRIPE_SECRET_KEY,
  stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET,
  emailUser: !!process.env.EMAIL_USER,
  emailPass: !!process.env.EMAIL_PASS,
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Atlas connected successfully");
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
app.get("/get-user-role", (req, res) => {
  res.json({ role: "admin" });
});

// ✅ Get pending customers (for dashboard)
app.get("/get-pending-customers", async (req, res) => {
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
app.post("/approve-customer/:id", async (req, res) => {
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

app.post("/reject-customer/:id", async (req, res) => {
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
app.post("/login", (req, res) => {
  const { email } = req.body;
  const user = users.find((u) => u.email === email);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  res.json({ success: true, user });
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
    const newOrder = new Order(req.body);
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
app.get("/getApprovedCustomers", async (req, res) => {
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
app.get("/get-customer-details-by-id/:id", async (req, res) => {
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
app.delete("/delete-customer/:id", async (req, res) => {
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

    await newStaff.save();

    try {
      await mailer.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: newStaff.email,
        subject: "Verify your staff account",
        html: `
          <div style="font-family:Arial,sans-serif;padding:20px;">
            <h2>Hello ${newStaff.firstName},</h2>
            <p>Your staff account request has been received.</p>
            <p>Please use the verification code below to verify your email:</p>
            <div style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:20px 0;">
              ${verifyCode}
            </div>
            <p>This code will expire in 15 minutes.</p>
          </div>
        `,
      });
    } catch (mailErr) {
      console.error("❌ Staff verification email send failed:", mailErr);
    }

    return res.status(201).json({
      success: true,
      message: "Staff registered successfully. Please verify your email.",
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
app.post("/api/staff/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const staff = await Staff.findOne({ email: normalizedEmail });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff account not found.",
      });
    }

    if (!staff.verifyCode || staff.verifyCode !== String(code).trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
      });
    }

    if (!staff.verifyCodeExpires || staff.verifyCodeExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired.",
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

    return res.json({
      success: true,
      message: "Email verified successfully.",
      setupToken,
    });
  } catch (err) {
    console.error("❌ Error verifying staff email:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while verifying email.",
    });
  }
});

app.post("/api/staff/resend-code", async (req, res) => {
  try {
    const result = await resendStaffVerificationCode({
      Staff,
      mailer,
      email: req.body?.email,
      generateCode: () =>
        Math.floor(100000 + Math.random() * 900000).toString(),
    });

    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("❌ Error resending staff verification code:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while resending verification code.",
    });
  }
});

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
        message: "Please verify your email first.",
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
      amountToCharge = Number(totalAmount);

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
          staff: Array.isArray(orderDraft.staff) ? orderDraft.staff : [],
          notes: orderDraft.notes || "",
          subtotalAmount: Number(orderDraft.subtotalAmount || 0),
          vatRate: Number(orderDraft.vatRate || 0),
          vatAmount: Number(orderDraft.vatAmount || 0),
          totalAmount: Number(orderDraft.totalAmount || 0),
          totalWithVat: Number(orderDraft.totalWithVat || orderDraft.totalAmount || 0),
          minimumPaymentAmount: Number(orderDraft.minimumPaymentAmount || 0),
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
