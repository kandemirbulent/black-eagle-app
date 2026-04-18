function calculateLineTotal(item = {}) {
  const qty = Number(item.quantity || 0);
  const hrs = Number(item.hours || 0);
  const rate = Number(item.rate || 0);

  return Number(item.total || qty * hrs * rate);
}

function calculateOrderFinancials(orderLike = {}) {
  const sourceStaff = Array.isArray(orderLike.staff) ? orderLike.staff : [];
  const staff = sourceStaff.map((item) => {
    const total = calculateLineTotal(item);
    return { ...item, total };
  });

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

  return {
    staff,
    subtotalAmount,
    totalAmount,
    vatRate,
    vatAmount,
    totalWithVat,
  };
}

module.exports = {
  calculateLineTotal,
  calculateOrderFinancials,
};
