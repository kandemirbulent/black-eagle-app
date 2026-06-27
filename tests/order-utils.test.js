const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateLineTotal,
  calculateOrderFinancials,
} = require("../utils/order-utils");

test("calculateLineTotal applies minimum-hour billing for hourly services", () => {
  assert.equal(calculateLineTotal({ quantity: 2, hours: 5, rate: 15 }), 180);
  assert.equal(calculateLineTotal({ quantity: 2, hours: 5, rate: 15, total: 99 }), 180);
});

test("calculateOrderFinancials computes subtotal, vat and totalWithVat from staff rows", () => {
  const result = calculateOrderFinancials({
    staff: [
      { service: "waiter", quantity: 2, hours: 5, rate: 15 },
      { service: "chef", quantity: 1, hours: 8, rate: 20 },
    ],
    vatRate: 0.2,
  });

  assert.deepEqual(
    result.staff.map((item) => item.total),
    [180, 160]
  );
  assert.equal(result.subtotalAmount, 340);
  assert.equal(result.totalAmount, 340);
  assert.equal(result.vatAmount, 68);
  assert.equal(result.totalWithVat, 408);
});

test("calculateOrderFinancials preserves provided totals when they already exist", () => {
  const result = calculateOrderFinancials({
    staff: [{ quantity: 1, hours: 4, rate: 25 }],
    subtotalAmount: 400,
    totalAmount: 450,
    vatRate: 0.2,
    vatAmount: 90,
    totalWithVat: 540,
  });

  assert.equal(result.subtotalAmount, 400);
  assert.equal(result.totalAmount, 450);
  assert.equal(result.vatAmount, 90);
  assert.equal(result.totalWithVat, 540);
});

test("calculateOrderFinancials supports manual daily-priced line items", () => {
  const result = calculateOrderFinancials({
    staff: [{ service: "Waiter", quantity: 3, days: 2, hours: 8, rate: 120, pricingUnit: "day" }],
    vatRate: 0.2,
  });

  assert.equal(result.staff[0].total, 720);
  assert.equal(result.subtotalAmount, 720);
  assert.equal(result.vatAmount, 144);
  assert.equal(result.totalWithVat, 864);
});
