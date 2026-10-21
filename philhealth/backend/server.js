import Fastify from 'fastify';
import argon2 from 'argon2';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createDatabase } from './db.js';
import { schemas, validate } from './routes/schemas.js';
import { appendAudit, attachAuth, canAccessClaim, clearSessionCookie, issuePreAuthSession, isLockedOut, recordLoginAttempt, requireCsrf, signIn } from './auth.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const frontendDir = resolve(here, '../frontend');
const money = value => `₱${Number(value).toLocaleString('en-PH')}`;
const staticTypes = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.html': 'text/html; charset=utf-8' };

function mustBeSignedIn(request, reply) {
  if (!request.user) { reply.code(401).send({ error: 'Authentication required.' }); return false; }
  return true;
}

function guarded(roles, action) {
  return (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return false;
    if (roles && !roles.includes(request.user.role)) { reply.code(403).send({ error: 'Your role is not allowed to perform this action.' }); return false; }
    return action ? action(request, reply) : true;
  };
}

function event(db) { return db.prepare('SELECT * FROM calamity_events ORDER BY id LIMIT 1').get(); }
function regions(db, eventId) {
  return db.prepare(`SELECT b.region, b.allocation, COALESCE(SUM(CASE WHEN c.status IN ('Approved', 'Paid') THEN c.approved_amount END), 0) AS approved,
    COALESCE(SUM(CASE WHEN c.status = 'Paid' THEN c.approved_amount END), 0) AS paid
    FROM region_budgets b LEFT JOIN claims c ON c.event_id = b.event_id AND c.region = b.region
    WHERE b.event_id = ? GROUP BY b.region, b.allocation ORDER BY b.region`).all(eventId)
    .map(row => ({ ...row, level: row.approved > row.allocation ? 'CRITICAL' : row.approved / row.allocation >= .8 ? 'WARNING' : 'OK' }));
}
function claimRow(db, ref) {
  return db.prepare('SELECT ref, event_id, region, patient_token AS token, claim_type AS type, status, claimed_amount AS claimed, approved_amount AS approved, created_at FROM claims WHERE ref = ?').get(ref);
}
function auditChain(rows) {
  let previous = null;
  return rows.every(row => {
    const hash = createHash('sha256').update([previous || '', row.occurred_at, row.actor_id || '', row.action, row.record_type, row.record_id, row.reason, row.old_json, row.new_json].join('|')).digest('hex');
    const valid = row.previous_hash === previous && hash === row.entry_hash;
    previous = row.entry_hash;
    return valid;
  });
}

export async function buildApp({ database = join(here, 'data', 'calamity.db'), serveFrontend = true } = {}) {
  const db = await createDatabase(database);
  const app = Fastify({ logger: false, trustProxy: process.env.TRUST_PROXY === '1' });
  app.decorate('db', db);
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.addHook('onRequest', attachAuth(db));
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode === 403) {
      appendAudit(db, request.user?.id || null, 'DENIED', 'Request', `${request.method} ${request.url}`, 'Forbidden request');
    }
  });
  app.addHook('onClose', async () => db.close());
  app.setErrorHandler((error, request, reply) => {
    const code = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(code).send({ error: code === 500 ? 'An unexpected error occurred.' : 'Invalid request.' });
  });

  app.get('/api/csrf', { preHandler: validate(schemas.csrf) }, async (request, reply) => {
    if (request.session) return { csrfToken: request.session.csrf_token };
    return { csrfToken: issuePreAuthSession(db, reply) };
  });
  app.post('/api/login', { preHandler: [validate(schemas.login), requireCsrf] }, async (request, reply) => {
    const { username, password } = request.validated;
    const ip = request.ip;
    if (isLockedOut(db, username, ip)) return reply.code(429).send({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const valid = Boolean(user && await argon2.verify(user.password_hash, password));
    recordLoginAttempt(db, username, ip, valid);
    if (!valid) {
      appendAudit(db, user?.id || null, 'LOGIN_FAILED', 'Session', username, 'Invalid credentials');
      return reply.code(401).send({ error: 'Invalid username or password.' });
    }
    const csrfToken = signIn(db, request, reply, user);
    appendAudit(db, user.id, 'LOGIN', 'Session', user.username, 'User signed in');
    return { user: { username: user.username, role: user.role, region: user.region }, csrfToken };
  });
  app.post('/api/logout', { preHandler: [validate(schemas.logout), requireCsrf] }, async (request, reply) => {
    if (request.session) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(request.session.id);
      appendAudit(db, request.user?.id || null, 'LOGOUT', 'Session', request.user?.username || request.session.id, 'User signed out');
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
  app.get('/api/me', { preHandler: validate(schemas.me) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    return { user: request.user, csrfToken: request.session.csrf_token };
  });
  app.get('/api/dashboard', { preHandler: validate(schemas.dashboard) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const current = event(db); const regionRows = regions(db, current.id);
    const totals = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('Approved', 'Paid') THEN approved_amount END), 0) AS committed,
      COALESCE(SUM(CASE WHEN status = 'Paid' THEN approved_amount END), 0) AS paid,
      COUNT(CASE WHEN status = 'Approved' THEN 1 END) AS unpaid FROM claims WHERE event_id = ?`).get(current.id);
    return { event: current, cards: [
      { label: 'Utilization', value: `${((totals.committed / current.budget) * 100).toFixed(2)}%`, level: totals.committed > current.budget ? 'CRITICAL' : totals.committed / current.budget >= .8 ? 'WARNING' : 'OK' },
      { label: 'Variance', value: money(current.budget - totals.committed), note: totals.committed > current.budget ? 'Over budget' : 'Under budget' },
      { label: 'Committed vs budget', value: money(totals.committed), note: `of ${money(current.budget)} allocation` },
      { label: 'Approved but unpaid', value: money(totals.committed - totals.paid), note: `${totals.unpaid} claims awaiting payment` }
    ], regions: regionRows };
  });
  app.get('/api/claims', { preHandler: validate(schemas.claims, 'query') }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const q = `%${request.validated.q || ''}%`;
    const rows = db.prepare(`SELECT ref, region, patient_token AS token, claim_type AS type, status, claimed_amount AS claimed, approved_amount AS approved
      FROM claims WHERE (ref LIKE ? OR patient_token LIKE ? OR region LIKE ? OR status LIKE ?)
      ${request.user.role === 'ROS' ? 'AND region = ?' : ''} ORDER BY ref`).all(...[q, q, q, q, ...(request.user.role === 'ROS' ? [request.user.region] : [])]);
    return rows;
  });
  app.get('/api/claims/:ref', { preHandler: validate(schemas.claim, 'params') }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const claim = claimRow(db, request.validated.ref);
    if (!claim || !canAccessClaim(request.user, claim)) return reply.code(404).send({ error: 'Claim not found.' });
    claim.history = db.prepare('SELECT status, created_at AS at FROM claim_history WHERE claim_ref = ? ORDER BY id').all(claim.ref);
    return claim;
  });
  app.post('/api/claims/:ref/status', { preHandler: [validate(schemas.claimStatus, 'params+body'), requireCsrf] }, async (request, reply) => {
    if (!guarded(['CFB', 'ROS'])(request, reply)) return;
    const claim = claimRow(db, request.validated.ref);
    if (!claim || !canAccessClaim(request.user, claim)) return reply.code(404).send({ error: 'Claim not found.' });
    const { status } = request.validated;
    const transaction = db.transaction(() => {
      db.prepare('UPDATE claims SET status = ? WHERE ref = ?').run(status, claim.ref);
      db.prepare('INSERT INTO claim_history(claim_ref, status, actor_id) VALUES (?, ?, ?)').run(claim.ref, status, request.user.id);
      appendAudit(db, request.user.id, 'UPDATE_STATUS', 'Claim', claim.ref, `Status changed to ${status}`, { status: claim.status }, { status });
    });
    transaction();
    return claimRow(db, claim.ref);
  });
  app.get('/api/exceptions', { preHandler: validate(schemas.exceptions) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    return db.prepare(`SELECT e.id, e.type, e.claim_ref AS claim, e.reason, e.resolved_at AS resolvedAt FROM exceptions e JOIN claims c ON c.ref = e.claim_ref
      ${request.user.role === 'ROS' ? 'WHERE c.region = ?' : ''} ORDER BY e.id`).all(...(request.user.role === 'ROS' ? [request.user.region] : [])).map(row => ({ ...row, resolved: Boolean(row.resolvedAt) }));
  });
  app.post('/api/exceptions/:id/resolve', { preHandler: [validate(schemas.resolveException, 'params'), requireCsrf] }, async (request, reply) => {
    if (!guarded(['CFB', 'ROS'])(request, reply)) return;
    const row = db.prepare('SELECT e.*, c.region FROM exceptions e JOIN claims c ON c.ref = e.claim_ref WHERE e.id = ?').get(request.validated.id);
    if (!row || !canAccessClaim(request.user, row)) return reply.code(404).send({ error: 'Exception not found.' });
    if (!row.resolved_at) {
      db.prepare('UPDATE exceptions SET resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?').run(request.user.id, row.id);
      appendAudit(db, request.user.id, 'RESOLVE', 'Exception', String(row.id), row.reason);
    }
    return { id: row.id, resolved: true };
  });
  app.get('/api/analytics', { preHandler: validate(schemas.analytics) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const current = event(db); const total = db.prepare("SELECT COALESCE(SUM(approved_amount), 0) AS amount FROM claims WHERE event_id = ? AND status IN ('Approved', 'Paid')").get(current.id).amount;
    return { forecast: money(Math.round(total * 1.12)), scenario: '+12%', monteCarlo: money(Math.round(total * 1.09)), allocation: `${regions(db, current.id).length} regions`, caption: `Projected total ${total > current.budget ? 'exceeds' : 'is within'} the event ceiling.` };
  });
  app.get('/api/audit', { preHandler: validate(schemas.audit) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const { page, pageSize } = request.validated;
    const total = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count;
    const allRows = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
    const rows = db.prepare(`SELECT a.*, COALESCE(u.username, 'system') AS username FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
    return {
      chainOk: auditChain(allRows),
      page,
      pageSize,
      total,
      rows: rows.map(row => ({ when: row.occurred_at, user: row.username, action: row.action, record: `${row.record_type} / ${row.record_id}`, reason: row.reason }))
    };
  });
  app.get('/api/events', { preHandler: validate(schemas.events) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const current = event(db); return { ...current, regions: regions(db, current.id) };
  });
  app.get('/api/reports', { preHandler: validate(schemas.reports) }, async (request, reply) => {
    if (!mustBeSignedIn(request, reply)) return;
    const current = event(db); const total = db.prepare("SELECT COALESCE(SUM(approved_amount), 0) AS approved FROM claims WHERE event_id = ? AND status IN ('Approved', 'Paid')").get(current.id).approved;
    return { title: 'Budget vs actual variance', budget: current.budget, approved: total, variance: current.budget - total };
  });
  if (serveFrontend) app.get('/*', async (request, reply) => {
    if (request.hostname === '127.0.0.1') return reply.redirect(`http://localhost:${request.headers.host.split(':')[1] || 3000}${request.raw.url}`);
    const relative = request.params['*'] || 'index.html';
    const file = resolve(frontendDir, relative === '' ? 'index.html' : normalize(relative));
    if (!file.startsWith(frontendDir) || !existsSync(file)) return reply.code(404).send({ error: 'Not found.' });
    reply.type(staticTypes[extname(file)] || 'application/octet-stream');
    return reply.send(readFileSync(file));
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
}
