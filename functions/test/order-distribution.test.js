const test = require('node:test');
const assert = require('node:assert/strict');
const {calculate} = require('../../order-distribution');

const partners = [
  {id: 'p1', name: 'Ana', capitalPct: 0.5, pointsPct: 0.5, points: 10},
  {id: 'p2', name: 'Luis', capitalPct: 0.5, pointsPct: 0.5, points: 10}
];

test('distribuye la ganancia neta entre aportantes del pedido y puntos', () => {
  const result = calculate({
    orders: [{id: 'o1', name: 'Pedido 1', date: '2026-01-01', totalCost: 100, contributions: [
      {partnerId: 'p1', amount: 75},
      {partnerId: 'p2', amount: 25}
    ]}],
    sales: [{orderId: 'o1', productId: 'item1', qty: 1, total: 200}],
    products: [{id: 'item1', cost: 100}],
    expenses: [{amount: 20}],
    partnerShares: partners,
    pool: 30,
    companyProfit: 80
  });

  const order = result.groups[0];
  assert.equal(order.netProfit, 80);
  assert.equal(order.payoutProfit, 80);
  assert.equal(order.partners[0].capitalPayout, 42);
  assert.equal(order.partners[0].pointsPayout, 12);
  assert.equal(order.partners[0].totalPayout, 54);
  assert.equal(order.partners[1].totalPayout, 26);
  assert.equal(result.totalPayout, 80);
});

test('prorratea gastos generales por ventas y distribuye el neto histórico solo entre pedidos rentables', () => {
  const result = calculate({
    orders: [
      {id: 'o1', name: 'Pedido 1', totalCost: 100, contributions: [{partnerId: 'p1', amount: 100}]},
      {id: 'o2', name: 'Pedido 2', totalCost: 100, contributions: [{partnerId: 'p2', amount: 100}]}
    ],
    sales: [
      {orderId: 'o1', productId: 'item1', qty: 1, total: 200},
      {orderId: 'o2', productId: 'item2', qty: 1, total: 100}
    ],
    products: [{id: 'item1', cost: 100}, {id: 'item2', cost: 100}],
    expenses: [{amount: 30}],
    partnerShares: partners,
    pool: 0,
    companyProfit: 70
  });

  assert.equal(result.groups[0].expenses, 20);
  assert.equal(result.groups[0].netProfit, 80);
  assert.equal(result.groups[1].expenses, 10);
  assert.equal(result.groups[1].netProfit, -10);
  assert.equal(result.groups[0].payoutProfit, 70);
  assert.equal(result.groups[1].payoutProfit, 0);
  assert.equal(result.totalPayout, 70);
});

test('calcula el costo de pedidos anteriores y no genera entregas si el neto histórico es negativo', () => {
  const result = calculate({
    orders: [{id: 'legacy', name: 'Pedido anterior', qty: 2, unitCost: 50, fInt: 10, fNat: 0}],
    sales: [{orderId: 'legacy', qty: 1, total: 100}],
    products: [],
    expenses: [{amount: 55}],
    partnerShares: partners,
    pool: 30,
    companyProfit: -10
  });

  assert.equal(result.groups[0].purchaseCost, 110);
  assert.equal(result.groups[0].costOfGoodsSold, 55);
  assert.equal(result.groups[0].netProfit, -10);
  assert.equal(result.groups[0].payoutProfit, 0);
  assert.equal(result.totalPayout, 0);
});

test('usa el costo guardado en el pedido cuando falta el documento de producto', () => {
  const result = calculate({
    orders: [{id: 'o1', totalCost: 80, items: [
      {productId: 'missing-product', name: 'Camiseta', qty: 2, landedUnitCost: 40}
    ]}],
    sales: [{orderId: 'o1', productName: 'Camiseta', qty: 1, total: 100}],
    products: [],
    expenses: [],
    partnerShares: partners,
    pool: 0
  });

  assert.equal(result.totalCostOfGoodsSold, 40);
  assert.equal(result.calculatedProfit, 60);
  assert.equal(result.uncostedSales, 0);
});

test('no convierte ventas sin costo identificable en ganancias estimadas', () => {
  const result = calculate({
    orders: [
      {id: 'known', items: [{productId: 'p1', name: 'Camiseta', qty: 1, landedUnitCost: 50}]},
      {id: 'unknown', items: [
        {productId: 'p2', name: 'Gorra', qty: 1, landedUnitCost: 20},
        {productId: 'p3', name: 'Chaqueta', qty: 1, landedUnitCost: 40}
      ]}
    ],
    sales: [
      {orderId: 'known', productId: 'p1', qty: 1, total: 150},
      {orderId: 'unknown', qty: 1, total: 100}
    ],
    products: [{id: 'p1', cost: 50}],
    expenses: [],
    partnerShares: partners,
    pool: 0,
    companyProfit: 100
  });

  assert.equal(result.totalCostOfGoodsSold, 150);
  assert.equal(result.calculatedProfit, 100);
  assert.equal(result.uncostedSales, 1);
  assert.equal(result.totalPayout, 0);
});
