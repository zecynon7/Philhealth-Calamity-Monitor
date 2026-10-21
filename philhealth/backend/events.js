import { appendAudit, requireCsrf } from './auth.js';

const signedIn = (request, reply) => {
  if (!request.user) {
    reply.code(401).send({ error: 'Authentication required.' });
    return false;
  }
  return true;
};

const readBody = body => ({ id: String(body?.id || '').trim(), name: String(body?.name || '').trim(), budget: Number(body?.budget), allocations: body?.allocations || [] });

export function registerEventRoutes(app, db) {
  app.post('/api/events', { preHandler: requireCsrf }, async (request, reply) => {
    if (!signedIn(request, reply)) return;
    if (request.user.role !== 'CFB') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const event = readBody(request.body);
    const allocation = event.allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (!event.id || !event.name || !Number.isInteger(event.budget) || event.budget < 0) return reply.code(400).send({ error: 'Invalid event data.' });
    if (allocation > event.budget) return reply.code(422).send({ error: `Allocations exceed ceiling by ${allocation - event.budget} centavos.` });
    const transaction = db.transaction(() => {
      db.prepare("INSERT INTO calamity_events(id, name, status, budget) VALUES (?, ?, 'Active', ?)").run(event.id, event.name, event.budget);
      const insert = db.prepare('INSERT INTO region_budgets(event_id, region, allocation) VALUES (?, ?, ?)');
      event.allocations.forEach(row => insert.run(event.id, String(row.region).trim(), Number(row.amount)));
      db.prepare('INSERT INTO event_details(event_id) VALUES (?)').run(event.id);
      appendAudit(db, request.user.id, 'CREATE', 'Event', event.id, 'Event created', {}, event);
    });
    transaction();
    return reply.code(201).send({ ...event, status: 'Active' });
  });

  app.post('/api/events/:id/close', { preHandler: requireCsrf }, async (request, reply) => {
    if (!signedIn(request, reply)) return;
    if (request.user.role !== 'EXE') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const result = db.prepare("UPDATE calamity_events SET status = 'Closed' WHERE id = ? AND status = 'Active'").run(request.params.id);
    if (!result.changes) return reply.code(422).send({ error: 'Only an Active event can be closed.' });
    db.prepare('INSERT OR REPLACE INTO event_details(event_id, closed_at, closed_by) VALUES (?, CURRENT_TIMESTAMP, ?)').run(request.params.id, request.user.id);
    appendAudit(db, request.user.id, 'CLOSE', 'Event', request.params.id, 'Event closed');
    return { id: request.params.id, status: 'Closed' };
  });

  app.post('/api/events/:id/revisions', { preHandler: requireCsrf }, async (request, reply) => {
    if (!signedIn(request, reply)) return;
    if (request.user.role !== 'CFB') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const { region, allocation } = request.body || {};
    if (!region || !Number.isInteger(allocation) || allocation < 0) return reply.code(400).send({ error: 'Invalid revision data.' });
    const revision = db.prepare('SELECT COALESCE(MAX(revision), 0) + 1 AS value FROM event_budgets WHERE event_id = ? AND region = ?').get(request.params.id, region).value;
    const row = db.prepare("INSERT INTO event_budgets(event_id, region, allocation, revision, proposed_by, status) VALUES (?, ?, ?, ?, ?, 'Proposed')")
      .run(request.params.id, region, allocation, revision, request.user.id);
    appendAudit(db, request.user.id, 'PROPOSE_REVISION', 'Event', request.params.id, 'Budget revision proposed');
    return reply.code(201).send({ id: row.lastInsertRowid, revision });
  });

  app.post('/api/events/:id/revisions/:revision/approve', { preHandler: requireCsrf }, async (request, reply) => {
    if (!signedIn(request, reply)) return;
    if (request.user.role !== 'EXE') return reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    const row = db.prepare("SELECT * FROM event_budgets WHERE event_id = ? AND revision = ? AND status = 'Proposed'").get(request.params.id, Number(request.params.revision));
    if (!row) return reply.code(404).send({ error: 'Revision not found.' });
    db.transaction(() => {
      db.prepare("UPDATE event_budgets SET status = 'Approved', approved_by = ? WHERE id = ?").run(request.user.id, row.id);
      db.prepare('UPDATE region_budgets SET allocation = ? WHERE event_id = ? AND region = ?').run(row.allocation, row.event_id, row.region);
      appendAudit(db, request.user.id, 'APPROVE_REVISION', 'Event', request.params.id, 'Budget revision approved');
    })();
    return { id: row.id, status: 'Approved' };
  });
}
