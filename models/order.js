const mongoose = require("mongoose");

// Her personel / görev detayı
const StaffSchema = new mongoose.Schema({
  staffId: { type: String, default: "" },      // Personel kimliği
  staffName: { type: String, default: "" },    // Personel adı
  service: String,
  quantity: Number,
  hours: Number,
  rate: Number,
  total: Number,
  date: String,
  startTime: String,
  endTime: String
});

// Ana sipariş yapısı
const orderSchema = new mongoose.Schema({
  customerApplicationId: { type: String },
  orderId: { type: String, unique: true },

  clientRef: { type: String, default: "" },
  description: { type: String, default: "Event Staff Service" },
  staff: [StaffSchema],
  totalAmount: { type: Number, default: 0 },

  // 💰 Yeni eklenen satır:
  amountPaid: { type: Number, default: 0 },

  vatRate: { type: Number, default: 0.20 },
  status: { type: String, default: "Pending" }, // Paid | Pending | Cancelled
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

// Order kaydedilmeden önce otomatik hesaplamalar
orderSchema.pre("save", async function (next) {
  try {
    // 👇 TEST LOG — sadece teşhis amaçlı
    console.log("💾 [models/order.js] Pre-save triggered for order. Current orderId:", this.orderId);

    // staff kalemlerinden toplam hesapla
    let subtotal = 0;
    if (this.staff && this.staff.length > 0) {
      this.staff.forEach((s) => {
        const qty = s.quantity || 1;
        const hrs = s.hours || 0;
        const rate = s.rate || 0;
        const lineTotal = s.total || qty * hrs * rate;
        s.total = lineTotal;
        subtotal += lineTotal;
      });
    }

    // Eğer toplam manuel girilmediyse otomatik ata
    if (!this.totalAmount || this.totalAmount <= 0) this.totalAmount = subtotal;

    // orderId yoksa oluştur
    if (!this.orderId) {
      const count = await this.constructor.countDocuments();
      this.orderId = "BE" + (1000 + count + 1);
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Order", orderSchema);
