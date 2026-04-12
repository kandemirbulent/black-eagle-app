const express = require("express");
const router = express.Router();
const Staff = require("../models/Staff");

// 🔹 CREATE STAFF (register)
router.post("/create", async (req, res) => {
  try {
    const { email } = req.body;

    const existing = await Staff.findOne({ email: email.toLowerCase().trim() });

    if (existing) {
      return res.status(409).json({
        message: "This email is already registered",
      });
    }

    // verify code üret
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    const staff = new Staff({
      ...req.body,
      email: email.toLowerCase().trim(),
      verifyCode,
      verifyCodeExpires: Date.now() + 1000 * 60 * 15, // 15 dk
    });

    await staff.save();

    // burada ileride mail göndereceksin
    console.log("Verify Code:", verifyCode);

    res.status(201).json({
      message: "Staff created. Please verify your email.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 VERIFY EMAIL
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

    const staff = await Staff.findOne({ email });

    if (!staff) {
      return res.status(404).json({ message: "User not found" });
    }

    if (staff.verifyCode !== code) {
      return res.status(400).json({ message: "Invalid code" });
    }

    if (staff.verifyCodeExpires < Date.now()) {
      return res.status(400).json({ message: "Code expired" });
    }

    staff.isVerified = true;
    staff.verifyCode = "";
    staff.verifyCodeExpires = null;

    await staff.save();

    res.json({ message: "Email verified successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 SET PASSWORD
router.post("/set-password", async (req, res) => {
  try {
    const { email, password } = req.body;

    const staff = await Staff.findOne({ email });

    if (!staff || !staff.isVerified) {
      return res.status(403).json({
        message: "Verify email first",
      });
    }

    staff.password = password;
    staff.isPasswordSet = true;

    await staff.save();

    res.json({ message: "Password set successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const staff = await Staff.findOne({ email });

    if (!staff) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!staff.isVerified) {
      return res.status(403).json({
        message: "Please verify your email first",
      });
    }

    if (!staff.isPasswordSet) {
      return res.status(403).json({
        message: "Please create your password first",
      });
    }

    const isMatch = await staff.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: "Wrong password" });
    }

    res.json({
      message: "Login successful",
      staffId: staff._id,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;