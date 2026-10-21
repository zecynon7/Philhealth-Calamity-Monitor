import { appendAudit, requireCsrf } from './auth.js';
import { canAccessClaim, paidAmount, transitionError } from './rules.js';
import { schemas, validate } from './routes/schemas.js';

const authenticated = (request, reply) => {
  if (!request.user) {
    reply.code(401).send({ error: 'Authentication required.' });
    return false;
  }
  return true;
};

const claimFor = (db, ref) => db.prepare(`SELECT ref, event_id, region, status, claimed_amount AS claimed,
  approved_amount AS approved, encoded_by, discharge_date FROM claims WHERE ref = ?`).get(ref);

function currentDate(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'as_of_date'").get().value;
}

function validDate(value, asOf) {
  return !value || value <= asOf;
}

export function registerWorkflowRoutes(app, db) {
  app.post('/api/claims', { preHandler: [validate(schemas.createClaim), requireCsrf] }, async (request, reply) => {
    if (!authenticated(request, reply)) return;
    if (request.user.role !== 'ROS') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const data = request.validated;
    if (data.region !== request.user.region) return reply.code(404).send({ error: 'Claim not found.' });
    const event = db.prepare('SELECT status FROM calamity_events WHERE id = ?').get(data.eventId);
    if (!event || event.status !== 'Active') return reply.code(422).send({ error: 'Claims can only be added to an Active event.' });
    const asOf = currentDate(db);
    if (![data.dischargeDate, data.filingDate].every(value => validDate(value, asOf))) {
      return reply.code(422).send({ error: 'Claim dates cannot be in the future.' });
    }
    db.prepare(`INSERT INTO claims(ref, event_id, region, patient_token, claim_type, status, claimed_amount,
      provider_id, discharge_date, filing_date, encoded_by, note) VALUES (?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, ?, ?)`)
      .run(data.ref, data.eventId, data.region, data.token, data.type, data.claimed, data.providerId || null,
        data.dischargeDate || null, data.filingDate || null, request.user.id, data.note || '');
    db.prepare('INSERT INTO claim_history(claim_ref, status, actor_id, note) VALUES (?, ?, ?, ?)')
      .run(data.ref, 'Submitted', request.user.id, data.note || '');
    appendAudit(db, request.user.id, 'CREATE', 'Claim', data.ref, 'Claim encoded', {}, { status: 'Submitted' });
    return reply.code(201).send(claimFor(db, data.ref));
  });

  app.post('/api/claims/:ref/payment', { preHandler: [validate(schemas.payment), requireCsrf] }, async (request, reply) => {
    if (!authenticated(request, reply)) return;
    if (request.user.role !== 'ACT') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const claim = claimFor(db, request.params.ref);
    if (!claim || !canAccessClaim(request.user, claim)) return reply.code(404).send({ error: 'Claim not found.' });
    if (claim.status !== 'Approved') return reply.code(422).send({ error: 'Only an Approved claim can be paid.' });
    const payment = request.validated;
    if (!validDate(payment.paidAt, currentDate(db))) return reply.code(422).send({ error: 'Payment date cannot be in the future.' });
    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO payments(claim_ref, amount, paid_at, recorded_by, note) VALUES (?, ?, ?, ?, ?)')
        .run(claim.ref, payment.amount, payment.paidAt, request.user.id, payment.note || '');
      db.prepare("UPDATE claims SET status = 'Paid' WHERE ref = ?").run(claim.ref);
      db.prepare("INSERT INTO claim_history(claim_ref, status, actor_id, note) VALUES (?, 'Paid', ?, ?)")
        .run(claim.ref, request.user.id, payment.note || '');
      appendAudit(db, request.user.id, 'PAYMENT', 'Claim', claim.ref, 'Payment recorded', { status: claim.status }, { status: 'Paid', amount: payment.amount });
    });
    transaction();
    return { ref: claim.ref, status: 'Paid', paid: paidAmount(db, claim.ref) };
  });

  app.get('/api/settings', async (request, reply) => {
    if (!authenticated(request, reply)) return;
    if (request.user.role !== 'ADM') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    return db.prepare('SELECT key, value, updated_at AS updatedAt FROM settings ORDER BY key').all();
  });

  app.put('/api/settings/:key', { preHandler: [validate(schemas.settings), requireCsrf] }, async (request, reply) => {
    if (!authenticated(request, reply)) return;
    if (request.user.role !== 'ADM') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const old = db.prepare('SELECT value FROM settings WHERE key = ?').get(request.params.key);
    if (!old) return reply.code(404).send({ error: 'Setting not found.' });
    const { value, reason } = request.validated;
    db.transaction(() => {
      db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE key = ?")
        .run(value, request.user.id, request.params.key);
      db.prepare('INSERT INTO settings_changes(setting_key, old_value, new_value, reason, actor_id) VALUES (?, ?, ?, ?, ?)')
        .run(request.params.key, old.value, value, reason, request.user.id);
      appendAudit(db, request.user.id, 'SETTINGS_CHANGE', 'Setting', request.params.key, reason, { value: old.value }, { value });
    })();
    return { key: request.params.key, value };
  });

  app.post('/api/claims/:ref/reconcile', { preHandler: [validate(schemas.reconcile), requireCsrf] }, async (request, reply) => {
    if (!authenticated(request, reply)) return;
    if (request.user.role !== 'ACT') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const claim = claimFor(db, request.params.ref);
    if (!claim) return reply.code(404).send({ error: 'Claim not found.' });
    const note = request.validated.note || '';
    const error = transitionError(db, claim, { status: 'Reconciled', note }, request.user);
    if (error) return reply.code(422).send({ error });
    db.prepare("UPDATE claims SET status = 'Reconciled', note = ? WHERE ref = ?").run(note, claim.ref);
    db.prepare("INSERT INTO claim_history(claim_ref, status, actor_id, note) VALUES (?, 'Reconciled', ?, ?)").run(claim.ref, request.user.id, note);
    appendAudit(db, request.user.id, 'RECONCILE', 'Claim', claim.ref, 'Claim reconciled', { status: 'Paid' }, { status: 'Reconciled' });
    return { ref: claim.ref, status: 'Reconciled' };
  });
}
