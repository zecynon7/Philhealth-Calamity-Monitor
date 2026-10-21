const transitions = {
  Submitted: ['Under Review'],
  'Under Review': ['Approved', 'Returned (RTH)', 'Denied'],
  'Returned (RTH)': ['Resubmitted'],
  Resubmitted: ['Under Review'],
  Denied: ['Resubmitted'],
  Paid: ['Reconciled']
};

export function hasPermission(db, user, permission) {
  return Boolean(user && db.prepare('SELECT 1 FROM permissions WHERE role = ? AND permission = ?')
    .get(user.role, permission));
}

export function requirePermission(db, permission) {
  return (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required.' });
    if (!hasPermission(db, request.user, permission)) {
      return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    }
  };
}

export function canAccessClaim(user, claim) {
  if (!user || user.role === 'ADM') return false;
  return !['ROS', 'RVP'].includes(user.role) || user.region === claim.region;
}

export function transitionError(db, claim, input, actor) {
  const { status, approved = claim.approved, note = '', reasonCode, overrideReason } = input;
  if (!transitions[claim.status]?.includes(status)) return 'This status transition is not allowed.';
  if (status === 'Paid') return 'Paid status can only be set through a payment.';
  if (['Returned (RTH)', 'Denied'].includes(status) && (!reasonCode || !note.trim())) {
    return 'Returned (RTH) and Denied claims need a reason code and note.';
  }
  if (status === 'Approved' && (!Number.isInteger(approved) || approved <= 0 || approved > claim.claimed)) {
    return 'Approved amount must be greater than zero and no more than the claimed amount.';
  }
  if (status === 'Approved' && claim.encoded_by === actor.id) return 'An encoder cannot approve their own claim.';
  if (status === 'Denied' && !refilingOpen(db, claim)) return 'This denied claim is past the refiling deadline.';
  if (status === 'Approved' && exceedsCeiling(db, claim, approved) && (!overrideReason || !['CFB', 'EXE'].includes(actor.role))) {
    return 'An approval over the event ceiling needs an override reason and a CFB or EXE approver.';
  }
  if (status === 'Reconciled' && paidAmount(db, claim.ref) !== claim.approved && !note.trim()) {
    return 'A reconciliation mismatch needs a note.';
  }
  return null;
}

export function paidAmount(db, ref) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE claim_ref = ?').get(ref).amount;
}

function exceedsCeiling(db, claim, approved) {
  const event = db.prepare('SELECT budget FROM calamity_events WHERE id = ?').get(claim.event_id);
  const used = db.prepare("SELECT COALESCE(SUM(approved_amount), 0) AS amount FROM claims WHERE event_id = ? AND status IN ('Approved', 'Paid', 'Reconciled') AND ref <> ?")
    .get(claim.event_id, claim.ref).amount;
  return used + approved > event.budget;
}

function refilingOpen(db, claim) {
  if (!claim.discharge_date) return true;
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'filing_deadline_days'").get();
  const asOf = db.prepare("SELECT value FROM settings WHERE key = 'as_of_date'").get();
  const deadline = new Date(`${claim.discharge_date}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + Number(setting?.value || 60));
  return deadline >= new Date(`${asOf?.value || '9999-12-31'}T00:00:00Z`);
}
