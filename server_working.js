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
const Staff = require("./models/Staff");

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

// 🔐 MongoDB
console.log("🔍 MONGO_URI_USED =", process.env.MONGO_URI);
console.log("✅ STRIPE_SECRET_KEY exists:", !!process.env.STRIPE_SECRET_KEY);
console.log("✅ STRIPE_WEBHOOK_SECRET exists:", !!process.env.STRIPE_WEBHOOK_SECRET);
console.log("✅ STRIPE_SUCCESS_URL:", process.env.STRIPE_SUCCESS_URL);
console.log("✅ STRIPE_CANCEL_URL:", process.env.STRIPE_CANCEL_URL);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Atlas connected successfully");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
  });

// ✅ CORS
app.use(cors());

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
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

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
    res.json(pendingCustomers);
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
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const token = crypto.randomBytes(24).toString("hex");

    customer.status = "approved";
    customer.resetToken = token;
    customer.tokenExpires = Date.now() + 1000 * 60 * 60 * 24;
    customer.approvedAt = new Date();
    await customer.save();

    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://blackeagleapp.com"
        : "http://localhost:3000";

    const setupLink = `${baseUrl}/Customer-logins/set-password.html?token=${token}`;

    const mailOptions = {
      from: `"Black Eagle Services" <${process.env.EMAIL_USER}>`,
      to: customer.email,
      subject: "Your Black Eagle Account Has Been Approved",
      html: `
        <div style="font-family:Arial,sans-serif;padding:20px;">
          <h2>Welcome to Black Eagle Services, ${customer.firstName}!</h2>
          <p>Your application has been approved. Please create your password to access your customer dashboard.</p>
          <p>
            <a href="${setupLink}" 
               style="background:#000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">
               Create Your Password
            </a>
          </p>
          <p>This link will expire in 24 hours.</p>
        </div>
      `,
    };

    await mailer.sendMail(mailOptions);

    console.log(`✅ Approval email sent to ${customer.email}`);
    res.json({
      success: true,
      message: "Customer approved and email sent with setup link.",
      updatedStatus: "approved",
      customerId: customer._id,
    });
  } catch (err) {
    console.error("❌ Error approving customer:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 📩 Get customer info by email
app.get("/get-customer-by-email/:email", async (req, res) => {
  try {
    const customer = await Customer.findOne({ email: req.params.email });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.json({ success: true, customer });
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

// 🔐 Forgot password
app.post("/customer-forgot-password", (req, res) => {
  const { email } = req.body;
  console.log(`🔐 Password reset requested for: ${email}`);
  res.json({ message: "If this email exists, a reset link has been sent." });
});

// 🧾 Yeni sipariş
app.post("/orders", async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    await newOrder.save();
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
    res.json(customers);
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
    res.json(customer);
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
    res.json(customer);
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

    staff.isVerified = true;
    staff.verifyCode = "";
    staff.verifyCodeExpires = null;

    await staff.save();

    return res.json({
      success: true,
      message: "Email verified successfully.",
    });
  } catch (err) {
    console.error("❌ Error verifying staff email:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while verifying email.",
    });
  }
});

// ✅ STAFF Set Password
app.post("/api/staff/set-password", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
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

    if (!staff.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email first.",
      });
    }

    staff.password = password;
    staff.isPasswordSet = true;
    staff.status = "active";

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
      redirect: "/Staff-logins/staff-dashboard.html",
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

// ✅ Customer Registration
app.post("/register-customer", async (req, res) => {
  try {
    const blocked = await Customer.findOne({
      $or: [{ email: req.body.email }, { companyName: req.body.companyName }],
      status: { $in: ["rejected", "banned"] },
    });

    if (blocked) {
      return res.json({
        success: false,
        message: "🚫 This customer is blocked from registering again. Contact support.",
      });
    }

    const existing = await Customer.findOne({
      $or: [{ companyName: req.body.companyName }, { email: req.body.email }],
    });

    if (existing) {
      return res.json({
        success: false,
        message: "⚠️ This company or email is already registered or awaiting approval.",
      });
    }

    const applicationId = `BE-CUST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const customerCode = "BE-" + Math.floor(100000 + Math.random() * 900000);

    const newCustomer = new Customer({
      applicationId,
      customerCode,
      companyName: req.body.companyName,
      companyAddress: req.body.companyAddress,
      postcode: req.body.postcode,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      mobilePhone: req.body.mobilePhone,
      email: req.body.email,
      website: req.body.website || "",
      vatNumber: req.body.vatNumber || "",
      companyNumber: req.body.companyNumber,
      status: "pending",
      createdAt: new Date(),
    });

    await newCustomer.save();

    try {
      await mailer.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: newCustomer.email,
        subject: "✅ Black Eagle: Application Received (Pending Approval)",
        html: `
          <div style="font-family:Arial,sans-serif;padding:20px;">
            <h2>Thanks, ${newCustomer.firstName}!</h2>
            <p>We received your customer application and it is now <b>pending approval</b>.</p>
            <p><b>Application ID:</b> ${applicationId}</p>
            <p>We will email you again once your account is approved.</p>
          </div>
        `,
      });
      console.log(`✅ Pending email sent to ${newCustomer.email}`);
    } catch (mailErr) {
      console.error("❌ Pending email send failed:", mailErr);
    }

    console.log(
      `🕓 New customer registration pending: ${newCustomer.companyName} (${applicationId}, ${customerCode})`
    );

    res.json({
      success: true,
      message: "✅ Registration received and pending approval.",
      applicationId,
      customerCode,
    });
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

// 🔑 CUSTOMER LOGIN (real one)
app.post("/customer-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const customer = await Customer.findOne({ email });
    if (!customer) {
      return res.json({
        success: false,
        message: "Customer not found.",
      });
    }

    if (customer.status !== "approved") {
      return res.json({
        success: false,
        message: "Your account is not approved yet.",
      });
    }

    if (!customer.password) {
      return res.json({
        success: false,
        message: "No password set. Please use the link in your email.",
      });
    }

    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.json({
        success: false,
        message: "Login failed. Please check your credentials.",
      });
    }

    return res.json({
      success: true,
      message: "Login successful",
      redirect: "/Customer-logins/customer-dashboard.html",
      customer: {
        id: customer._id,
        name: `${customer.firstName} ${customer.lastName}`,
        email: customer.email,
        applicationId: customer.applicationId,
        customerCode: customer.customerCode,
      },
    });
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
          createdAt: orderDraft.createdAt ? new Date(orderDraft.createdAt) : new Date(),
        });

        await newOrder.save();
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
  renderPageWithHeader(res, path.join("Customer-logins", "customer-login.html"));
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

// 🚀 Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});