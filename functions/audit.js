const trackedCollections = new Set([
  'orders',
  'sales',
  'expenses',
  'partners',
  'capital',
  'tasks',
  'products',
  'config'
]);

const MAX_AUDIT_BYTES = 512 * 1024;
const MAX_PREVIEW_FIELDS = 50;
const MAX_PREVIEW_CHARS = 512;

function serialize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildAuditEntry({teamId, collection, documentId, before, after, authType, authId}) {
  if (before === null && after === null) return null;

  const action = before === null ? 'created' : after === null ? 'deleted' : 'updated';
  const changes = {};
  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const field of fields) {
    const hasBefore = before !== null && Object.prototype.hasOwnProperty.call(before, field);
    const hasAfter = after !== null && Object.prototype.hasOwnProperty.call(after, field);
    const oldValue = hasBefore ? serialize(before[field]) : null;
    const newValue = hasAfter ? serialize(after[field]) : null;
    if (stableStringify(oldValue) !== stableStringify(newValue)) {
      changes[field] = {before: oldValue, after: newValue};
    }
  }

  return {
    teamId,
    collection,
    documentId,
    action,
    changes,
    actor: {
      uid: authType === 'user' ? authId || null : null,
      email: null,
      displayName: null,
      authType: authType || 'unknown'
    }
  };
}

function fitAuditEntry(entry) {
  if (Buffer.byteLength(JSON.stringify(entry), 'utf8') <= MAX_AUDIT_BYTES) return entry;

  const allChanges = Object.entries(entry.changes);
  const changes = {};
  allChanges.slice(0, MAX_PREVIEW_FIELDS).forEach(([field, change]) => {
    const preview = value => {
      const serialized = stableStringify(value);
      return serialized.length > MAX_PREVIEW_CHARS
        ? `${serialized.slice(0, MAX_PREVIEW_CHARS)}…`
        : serialized;
    };
    changes[field] = {
      before: preview(change.before),
      after: preview(change.after)
    };
  });

  const boundedEntry = {
    ...entry,
    changes,
    truncated: true,
    changeCount: allChanges.length
  };
  while (Buffer.byteLength(JSON.stringify(boundedEntry), 'utf8') > MAX_AUDIT_BYTES) {
    const fields = Object.keys(changes);
    if (!fields.length) break;
    delete changes[fields[fields.length - 1]];
  }
  return boundedEntry;
}

function isAuditAdmin(email, configuredEmail) {
  if (typeof email !== 'string' || !email.trim()) return false;
  return email.trim().toLowerCase() === String(configuredEmail || '').trim().toLowerCase();
}

module.exports = {trackedCollections, serialize, buildAuditEntry, fitAuditEntry, isAuditAdmin};
