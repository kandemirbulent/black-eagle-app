const mongoose = require("mongoose");
const { calculateOrderFinancials } = require("../utils/order-utils");

const StaffSchema = new mongoose.Schema({
  staffId: { type: String, default: "" },
  staffName: { type: String, default: "" },
  service: { type: String, default: "" },
  quantity: { type: Number, default: 0 },
  hours: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  date: { type: String, default: "" },
  startTime: { type: String, default: "" },
  endTime: { type: String, default: "" },
});

const orderSchema = new mongoose.Schema({
  customerApplicationId: { type: String, default: "", index: true },
  customerCode: { type: String, default: "" },
  customerName: { type: String, default: "" },
  companyName: { type: String, default: "" },
  orderId: { type: String, unique: true, index: true },

  clientRef: { type: String, default: "" },
  eventName: { type: String, default: "" },
  category: { type: String, default: "" },
  eventDate: { type: Date, default: null },
  phone: { type: String, default: "" },
  email: { type: String, default: "", trim: true, lowercase: true },
  location: { type: String, default: "" },
  description: { type: String, default: "Event Staff Service" },
  staff: { type: [StaffSchema], default: [] },

  subtotalAmount: { type: Number, default: 0 },
  vatRate: { type: Number, default: 0.2 },
  vatAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  totalWithVat: { type: Number, default: 0 },
  minimumPaymentAmount: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },

  status: { type: String, default: "Pending" },
  paymentStatus: { type: String, default: "Pending" },
  orderStatus: { type: String, default: "Pending" },
  isVisibleToCustomer: { type: Boolean, default: false },
  applicationDeadline: { type: Date, default: null },
  notes: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

async function generateUniqueOrderId(OrderModel) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = "BE" + Math.floor(100000 + Math.random() * 900000);
    const exists = await OrderModel.exists({ orderId: candidate });

    if (!exists) {
      return candidate;
    }
  }

  return "BE" + Date.now();
}

orderSchema.pre("save", async function (next) {
  try {
    const financials = calculateOrderFinancials({
      staff: this.staff,
      subtotalAmount: this.subtotalAmount,
      totalAmount: this.totalAmount,
      vatRate: this.vatRate,
      vatAmount: this.vatAmount,
      totalWithVat: this.totalWithVat,
    });

    this.staff = financials.staff;
    this.subtotalAmount = financials.subtotalAmount;
    this.totalAmount = financials.totalAmount;
    this.vatRate = financials.vatRate;
    this.vatAmount = financials.vatAmount;
    this.totalWithVat = financials.totalWithVat;

    if (!this.orderId) {
      this.orderId = await generateUniqueOrderId(this.constructor);
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Order", orderSchema);
