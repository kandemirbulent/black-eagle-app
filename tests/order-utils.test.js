const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateLineTotal,
  calculateOrderFinancials,
} = require("../utils/order-utils");

test("calculateLineTotal prefers explicit total or computes from quantity, hours and rate", () => {
  assert.equal(calculateLineTotal({ quantity: 2, hours: 5, rate: 15 }), 150);
  assert.equal(calculateLineTotal({ quantity: 2, hours: 5, rate: 15, total: 99 }), 99);
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
    [150, 160]
  );
  assert.equal(result.subtotalAmount, 310);
  assert.equal(result.totalAmount, 310);
  assert.equal(result.vatAmount, 62);
  assert.equal(result.totalWithVat, 372);
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
