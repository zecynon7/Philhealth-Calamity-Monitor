import { createHash, randomBytes } from 'node:crypto';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const SESSION_DURATION = 8 * 60 * 60 * 1000;
const cookieName = 'phcm_session';
const token = () => randomBytes(32).toString('base64url');
const expires = ms => new Date(Date.now() + ms).toISOString();
const now = () => new Date().toISOString();
const sessionTimes = () => ({
  lastSeen: now(),
  expiresAt: expires(FIFTEEN_MINUTES),
  capAt: expires(SESSION_DURATION)
});

function sessionId(request) {
  const cookies = Object.fromEntries((request.headers.cookie || '').split(';').map(v => v.trim().split('=')));
  return cookies[cookieName];
}

export function setSessionCookie(reply, id) {
  reply.header('Set-Cookie', `${cookieName}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`);
}

export function clearSessionCookie(reply) {
  reply.header('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function attachAuth(db) {
  return async (request, reply) => {
    purgeExpired(db);
    const id = sessionId(request);
    if (!id) return;
    const row = db.prepare(`SELECT s.id, s.csrf_token, s.expires_at, s.cap_at, u.id AS user_id, u.username, u.role, u.region
      FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
    if (!row || Date.parse(row.expires_at) <= Date.now() || Date.parse(row.cap_at) <= Date.now()) {
      if (row) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      clearSessionCookie(reply);
      return;
    }
    const idleExpiry = Math.min(Date.now() + FIFTEEN_MINUTES, Date.parse(row.cap_at));
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now(), new Date(idleExpiry).toISOString(), id);
    request.session = row;
    request.user = row.user_id ? { id: row.user_id, username: row.username, role: row.role, region: row.region } : null;
  };
}

export function requireUser(request, reply) {
  if (!request.user) return reply.code(401).send({ error: 'Authentication required.' });
}

export async function requireCsrf(request, reply) {
  if (!request.session || request.headers['x-csrf-token'] !== request.session.csrf_token) return reply.code(403).send({ error: 'Invalid CSRF token.' });
}

export function issuePreAuthSession(db, reply) {
  const id = token(); const csrf = token(); const times = sessionTimes();
  db.prepare('INSERT INTO sessions(id, user_id, csrf_token, expires_at, last_seen_at, cap_at) VALUES (?, NULL, ?, ?, ?, ?)')
    .run(id, csrf, times.expiresAt, times.lastSeen, times.capAt);
  setSessionCookie(reply, id);
  return csrf;
}

export function signIn(db, request, reply, user) {
  if (request.session) db.prepare('DELETE FROM sessions WHERE id = ?').run(request.session.id);
  const id = token(); const csrf = token(); const times = sessionTimes();
  db.prepare('INSERT INTO sessions(id, user_id, csrf_token, expires_at, last_seen_at, cap_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, user.id, csrf, times.expiresAt, times.lastSeen, times.capAt);
  setSessionCookie(reply, id);
  return csrf;
}

export function assertRole(request, reply, roles) {
  if (!roles.includes(request.user.role)) return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
}

export function canAccessClaim(user, claim) { return user.role !== 'ROS' || user.region === claim.region; }

export function isLockedOut(db, username, ip) {
  return db.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE username = ? AND successful = 0 AND attempted_at >= datetime('now', '-15 minutes')")
    .get(username).count >= 5;
}

export function recordLoginAttempt(db, username, ip, successful) {
  db.prepare('INSERT INTO login_attempts(username, ip, successful) VALUES (?, ?, ?)').run(username, ip, successful ? 1 : 0);
}

export function purgeExpired(db) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR cap_at <= ?").run(now(), now());
  db.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-15 minutes')").run();
}

export function appendAudit(db, actorId, action, recordType, recordId, reason, oldValue = {}, newValue = {}) {
  const previous = db.prepare('SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1').get()?.entry_hash || '';
  const occurredAt = new Date().toISOString();
  const oldJson = JSON.stringify(oldValue);
  const newJson = JSON.stringify(newValue);
  const entryHash = createHash('sha256').update([previous, occurredAt, actorId || '', action, recordType, recordId, reason, oldJson, newJson].join('|')).digest('hex');
  db.prepare(`INSERT INTO audit_log(occurred_at, actor_id, action, record_type, record_id, reason, old_json, new_json, previous_hash, entry_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(occurredAt, actorId, action, recordType, recordId, reason, oldJson, newJson, previous || null, entryHash);
}
