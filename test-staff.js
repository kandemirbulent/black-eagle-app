// test-staff.js
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const mongoose = require("mongoose");
const Staff = require("./models/Staff");

(async () => {
  try {
    console.log("🔌 Connecting to MongoDB using:", process.env.MONGO_URI);
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB test DB");

    const newStaff = new Staff({
      name: "Test User",
      email: "test@example.com",
      password: "123456",
    });

    await newStaff.save();
    console.log("✅ Staff saved successfully");

    const saved = await Staff.findOne({ email: "test@example.com" });
    console.log("📦 Saved user:", saved);

    const match = await saved.comparePassword("123456");
    console.log("🔐 Password match:", match);

    await mongoose.disconnect();
    console.log("🔌 MongoDB connection closed");
  } catch (err) {
    console.error("❌ DB error:", err.message);
  }
})();
