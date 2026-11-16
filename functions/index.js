const {getApps, initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {FieldValue, Timestamp, getFirestore} = require('firebase-admin/firestore');
const {defineString} = require('firebase-functions/params');
const {HttpsError, onCall} = require('firebase-functions/v2/https');
const {onDocumentWrittenWithAuthContext} = require('firebase-functions/v2/firestore');
const {buildAuditEntry, fitAuditEntry, isAuditAdmin, trackedCollections} = require('./audit');

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const adminEmail = defineString('AUDIT_ADMIN_EMAIL');

exports.auditDocumentChanges = onDocumentWrittenWithAuthContext(
  'equipos/{teamId}/{collectionId}/{documentId}',
  async event => {
    const {teamId, collectionId, documentId} = event.params;
    if (teamId !== 'principal' || !trackedCollections.has(collectionId) || !event.data) return;

    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const entry = buildAuditEntry({
      teamId,
      collection: collectionId,
      documentId,
      before,
      after,
      authType: event.authType,
      authId: event.authId
    });
    if (!entry) return;

    if (entry.actor.uid) {
      try {
        const user = await getAuth().getUser(entry.actor.uid);
        entry.actor.email = user.email || null;
        entry.actor.displayName = user.displayName || null;
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        console.warn('No se encontró el usuario que originó un cambio auditado.', entry.actor.uid);
      }
    }

    entry.changedAt = event.time ? Timestamp.fromDate(new Date(event.time)) : FieldValue.serverTimestamp();
    const auditEntry = fitAuditEntry(entry);
    const auditRef = db.collection('equipos').doc(teamId).collection('auditLogs').doc(event.id);
    try {
      await auditRef.create(auditEntry);
    } catch (error) {
      if (error.code === 6 || error.code === 'already-exists') return;
      console.error('No se pudo guardar un cambio en el historial de auditoría.', error);
      throw error;
    }
  }
);

exports.checkAuditAccess = onCall(async request => ({
  allowed: !!request.auth
    && request.auth.token.email_verified === true
    && isAuditAdmin(request.auth.token.email, adminEmail.value())
}));

exports.listAuditLogs = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión para consultar el historial.');
  if (request.auth.token.email_verified !== true || !isAuditAdmin(request.auth.token.email, adminEmail.value())) {
    throw new HttpsError('permission-denied', 'No tienes permiso para consultar el historial.');
  }

  const requestedLimit = Number(request.data && request.data.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const logs = db.collection('equipos').doc('principal').collection('auditLogs');
  let query = logs.orderBy('changedAt', 'desc');

  const cursor = request.data && request.data.before;
  if (cursor && Number.isFinite(cursor.changedAt) && typeof cursor.id === 'string') {
    const cursorDocument = await logs.doc(cursor.id).get();
    if (cursorDocument.exists) query = query.startAfter(cursorDocument);
  }

  const snapshot = await query.limit(limit).get();
  const entries = snapshot.docs.map(document => {
    const entry = document.data();
    return {
      id: document.id,
      teamId: entry.teamId,
      collection: entry.collection,
      documentId: entry.documentId,
      action: entry.action,
      changes: entry.changes,
      truncated: entry.truncated === true,
      changeCount: entry.changeCount || Object.keys(entry.changes || {}).length,
      actor: entry.actor,
      changedAt: entry.changedAt.toMillis()
    };
  });
  const last = snapshot.docs[snapshot.docs.length - 1];

  return {
    entries,
    hasMore: snapshot.docs.length === limit,
    nextBefore: last ? {
      changedAt: last.get('changedAt').toMillis(),
      id: last.id
    } : null
  };
});
