function signedIn(request, reply) {
  if (!request.user) {
    reply.code(401).send({ error: 'Authentication required.' });
    return false;
  }
  if (request.user.role === 'ADM') {
    reply.code(403).send({ error: 'Your role is not allowed to perform this action.' });
    return false;
  }
  return true;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function registerReportRoutes(app, db) {
  app.get('/api/reports.csv', async (request, reply) => {
    if (!signedIn(request, reply)) return;
    const event = db.prepare('SELECT * FROM calamity_events ORDER BY id LIMIT 1').get();
    const claims = db.prepare('SELECT ref, region, status, claimed_amount, approved_amount FROM claims WHERE event_id = ? ORDER BY ref').all(event.id);
    const approved = claims.filter(row => ['Approved', 'Paid', 'Reconciled'].includes(row.status)).reduce((sum, row) => sum + row.approved_amount, 0);
    const rows = [['Claim reference', 'Region', 'Status', 'Claimed centavos', 'Approved centavos'],
      ...claims.map(row => [row.ref, row.region, row.status, row.claimed_amount, row.approved_amount]),
      [], ['Footer', 'Budget centavos', event.budget, 'Approved centavos', approved], ['Footer', 'Variance centavos', event.budget - approved]];
    reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="calamity-report.csv"');
    return rows.map(row => row.map(csvCell).join(',')).join('\n');
  });
}
