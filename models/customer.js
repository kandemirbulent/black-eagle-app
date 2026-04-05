// models/Customer.js
const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  // 🆕 Benzersiz müşteri kimliği (başvuru numarası)
  applicationId: { 
    type: String, 
    unique: true, 
    default: () => "BE-CUST-" + Date.now() 
  },

  // 🆕 Kısa müşteri kodu (örnek: BE-472193)
  customerCode: { 
    type: String, 
    unique: true,
    default: () => "BE-" + Math.floor(100000 + Math.random() * 900000)
  },

  // 📋 Temel şirket bilgileri
  companyName: { type: String, required: true, unique: true },
  companyAddress: { type: String, required: true },
  postcode: { type: String, required: true },

  // 👤 Kişisel bilgiler
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  mobilePhone: { type: String, required: true },
  email: { type: String, required: true, unique: true },

  // 🔐 Şifre (aktif edilince dolacak)
  password: { type: String, required: false },

  // 🌍 Ek bilgiler
  website: { type: String, default: "" },
  vatNumber: { type: String, default: "" },
  companyNumber: { type: String, required: true },

  // ⚙️ Hesap durumu
  status: { type: String, default: "pending" }, // "pending", "approved", "rejected", "banned"
  approvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },

  // 🕒 Şifre oluşturma veya sıfırlama token'ları
  resetToken: { type: String, default: null },
  tokenExpires: { type: Date, default: null },

  // 📝 Notlar (admin veya sistem tarafından eklenebilir)
  notes: { type: String, default: "" },

  // 📅 Müşteriye özel etkinlik tarihi (opsiyonel)
  eventDate: { type: Date, default: null }
});

module.exports = mongoose.model("Customer", customerSchema);
