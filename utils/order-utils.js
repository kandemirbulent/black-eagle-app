const CLEANING_SERVICES = new Set([
  "House Cleaning",
  "Office Cleaning",
  "Deep Cleaning",
  "End of Tenancy Cleaning",
  "Window Cleaner",
]);

const STANDARD_SHIFT_HOURS = 8;

function getMinimumHoursForService(service = "") {
  return CLEANING_SERVICES.has(String(service || "").trim()) ? 3 : 6;
}

function normalizeStaffLineItem(item = {}) {
  const quantity = Number(item.quantity || 0);
  const rate = Number(item.rate || 0);
  const requestedDays = Number(item.days || 0);
  const pricingUnit = String(item.pricingUnit || "").trim().toLowerCase();

  if (pricingUnit === "day" || requestedDays > 0) {
    const billableDays = Math.max(requestedDays, 1);
    const total = Number((quantity * billableDays * rate).toFixed(2));

    return {
      ...item,
      quantity,
      days: billableDays,
      hours: Number(item.hours || STANDARD_SHIFT_HOURS) || STANDARD_SHIFT_HOURS,
      originalHours:
        Number(item.originalHours || STANDARD_SHIFT_HOURS) || STANDARD_SHIFT_HOURS,
      rate,
      pricingUnit: "day",
      total,
    };
  }

  const requestedHours = Number(item.hours || item.originalHours || 0);
  const minimumHours = getMinimumHoursForService(item.service);
  const billableHours = Math.max(requestedHours, minimumHours);
  const total = Number((quantity * billableHours * rate).toFixed(2));

  return {
    ...item,
    quantity,
    days: Number(item.days || 0) > 0 ? Number(item.days) : 1,
    hours: billableHours,
    originalHours:
      Number.isFinite(requestedHours) && requestedHours > 0 ? requestedHours : billableHours,
    rate,
    pricingUnit: pricingUnit || "hour",
    total,
  };
}

function calculateLineTotal(item = {}) {
  return normalizeStaffLineItem(item).total;
}

function calculateOrderFinancials(orderLike = {}) {
  const sourceStaff = Array.isArray(orderLike.staff) ? orderLike.staff : [];
  const staff = sourceStaff.map((item) => normalizeStaffLineItem(item));

  const computedSubtotal = staff.reduce(
    (sum, item) => sum + Number(item.total || 0),
    0
  );

  const subtotalAmount =
    Number(orderLike.subtotalAmount || 0) > 0
      ? Number(orderLike.subtotalAmount)
      : computedSubtotal;

  const totalAmount =
    Number(orderLike.totalAmount || 0) > 0
      ? Number(orderLike.totalAmount)
      : subtotalAmount;

  const vatRate = Number(orderLike.vatRate || 0);
  const vatAmount =
    Number(orderLike.vatAmount || -1) >= 0
      ? Number(orderLike.vatAmount)
      : Number((totalAmount * vatRate).toFixed(2));

  const totalWithVat =
    Number(orderLike.totalWithVat || 0) > 0
      ? Number(orderLike.totalWithVat)
      : Number((totalAmount + vatAmount).toFixed(2));

  const minimumPaymentAmount =
    Number(orderLike.minimumPaymentAmount || 0) > 0
      ? Number(orderLike.minimumPaymentAmount)
      : Number((totalWithVat * 0.33).toFixed(2));

  return {
    staff,
    subtotalAmount,
    totalAmount,
    vatRate,
    vatAmount,
    totalWithVat,
    minimumPaymentAmount,
  };
}

module.exports = {
  CLEANING_SERVICES,
  STANDARD_SHIFT_HOURS,
  calculateLineTotal,
  calculateOrderFinancials,
  getMinimumHoursForService,
  normalizeStaffLineItem,
};
