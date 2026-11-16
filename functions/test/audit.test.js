const test = require('node:test');
const assert = require('node:assert/strict');
const {buildAuditEntry, fitAuditEntry, isAuditAdmin, trackedCollections} = require('../audit');

test('registra los valores anteriores y nuevos al editar una venta', () => {
  const entry = buildAuditEntry({
    teamId: 'principal',
    collection: 'sales',
    documentId: 'sale-1',
    before: {total: 120, buyer: 'Ana'},
    after: {total: 150, buyer: 'Ana'},
    authType: 'user',
    authId: 'user-1'
  });

  assert.equal(entry.action, 'updated');
  assert.deepEqual(entry.changes, {total: {before: 120, after: 150}});
  assert.equal(entry.actor.uid, 'user-1');
});

test('registra campos agregados y eliminados con sus valores faltantes', () => {
  const created = buildAuditEntry({
    teamId: 'principal', collection: 'expenses', documentId: 'expense-1',
    before: null, after: {amount: 500}, authType: 'user', authId: 'user-1'
  });
  const deleted = buildAuditEntry({
    teamId: 'principal', collection: 'orders', documentId: 'order-1',
    before: {totalCost: 700}, after: null, authType: 'user', authId: 'user-1'
  });

  assert.deepEqual(created.changes, {amount: {before: null, after: 500}});
  assert.deepEqual(deleted.changes, {totalCost: {before: 700, after: null}});
  assert.equal(created.action, 'created');
  assert.equal(deleted.action, 'deleted');
});

test('limita el acceso administrativo a los correos configurados', () => {
  assert.equal(isAuditAdmin('Admin@Example.com', 'admin@example.com'), true);
  assert.equal(isAuditAdmin('owner@example.com', 'admin@example.com'), false);
  assert.equal(isAuditAdmin('owner@example.com', 'admin@example.com;owner@example.com'), false);
  assert.equal(isAuditAdmin('', 'admin@example.com'), false);
});

test('reduce entradas grandes para evitar exceder el límite de un documento de Firestore', () => {
  const entry = buildAuditEntry({
    teamId: 'principal',
    collection: 'orders',
    documentId: 'order-1',
    before: {items: 'a'.repeat(700_000)},
    after: {items: 'b'.repeat(700_000)},
    authType: 'user',
    authId: 'user-1'
  });

  const bounded = fitAuditEntry(entry);

  assert.equal(bounded.truncated, true);
  assert.equal(bounded.changeCount, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') < 512 * 1024);
  assert.ok(bounded.changes.items.before.length < 520);
});

test('incluye las colecciones del negocio y excluye la colección de auditoría', () => {
  assert.equal(trackedCollections.has('sales'), true);
  assert.equal(trackedCollections.has('orders'), true);
  assert.equal(trackedCollections.has('expenses'), true);
  assert.equal(trackedCollections.has('auditLogs'), false);
});
