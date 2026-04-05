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
const fs = require("fs"); // 🦅 header/logo için eklendi
const crypto = require("crypto");

const Order = require("./models/order");
const Customer = require("./models/Customer");

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

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Atlas connected successfully");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
  });

app.use(cors());
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
        eventName: o.eventName || o.description || "Untitled",
        category: o.category || "-",
        amount: o.totalAmount || o.amount || 0,
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

// 🔍 Get customer details by applicationId
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
    const { appId, totalAmount, orderId, email } = req.body;

    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const amountInPence = Math.round(totalAmount * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email || undefined,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Deposit for Order ${orderId || "BlackEagle"}`,
              description: `Application ID: ${appId || "N/A"}`,
            },
            unit_amount: amountInPence,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.STRIPE_SUCCESS_URL}?appId=${encodeURIComponent(
        appId
      )}&amount=${totalAmount}`,
      cancel_url: `${process.env.STRIPE_CANCEL_URL}?appId=${encodeURIComponent(appId)}`,
    });

    try {
      const latestOrder = await Order.findOne({ customerApplicationId: appId }).sort({
        createdAt: -1,
      });

      if (latestOrder) {
        latestOrder.amountPaid = (latestOrder.amountPaid || 0) + totalAmount;
        await latestOrder.save();
        console.log(`💰 Deposit of £${totalAmount} added to order ${latestOrder.orderId}`);
      } else {
        console.warn(`⚠️ No existing order found for ${appId} to update payment.`);
      }
    } catch (updateErr) {
      console.error("❌ Error updating order payment after checkout creation:", updateErr);
    }

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
app.post("/update-payment-status", async (req, res) => {
  try {
    const { appId, amountPaid } = req.body;

    const latestOrder = await Order.findOne({ customerApplicationId: appId }).sort({
      createdAt: -1,
    });

    if (!latestOrder) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    latestOrder.amountPaid = (latestOrder.amountPaid || 0) + amountPaid;

    if (latestOrder.amountPaid >= latestOrder.totalAmount) {
      latestOrder.status = "Paid";
    } else {
      latestOrder.status = "Deposit Paid";
    }

    await latestOrder.save();

    res.json({
      success: true,
      message: "Payment updated successfully",
      orderId: latestOrder.orderId,
      amountPaid: latestOrder.amountPaid,
    });
  } catch (err) {
    console.error("❌ Error updating payment:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🚀 Server start
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});