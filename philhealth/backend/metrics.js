const committed = "('Approved', 'Paid', 'Reconciled')";

function days(start, end) {
  return Math.max(0, Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}

export function dashboardMetrics(db, eventId) {
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]));
  const claims = db.prepare('SELECT * FROM claims WHERE event_id = ?').all(eventId);
  const paid = claims.filter(claim => ['Paid', 'Reconciled'].includes(claim.status));
  const closed = claims.filter(claim => claim.decision_date);
  const asOf = settings.as_of_date;
  const aging = [0, 0, 0, 0];
  for (const claim of claims) {
    const age = days(claim.created_at.slice(0, 10), asOf);
    aging[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += 1;
  }
  const statusCounts = Object.fromEntries(claims.reduce((map, claim) => map.set(claim.status, (map.get(claim.status) || 0) + 1), new Map()));
  const exception = type => db.prepare('SELECT COUNT(*) AS count FROM exceptions WHERE type = ?').get(type).count;
  const paymentTotal = paid.reduce((sum, claim) => sum + db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE claim_ref = ?').get(claim.ref).amount, 0);
  return {
    statusCounts,
    aging: { '0-30': aging[0], '31-60': aging[1], '61-90': aging[2], '90+': aging[3] },
    kpis: {
      averageProcessingDays: closed.length ? Number((closed.reduce((sum, claim) => sum + days(claim.created_at.slice(0, 10), claim.decision_date), 0) / closed.length).toFixed(1)) : 0,
      beyondAgingPct: claims.length ? Number((claims.filter(claim => days(claim.created_at.slice(0, 10), asOf) > Number(settings.aging_days)).length / claims.length * 100).toFixed(2)) : 0,
      lateFilingPct: claims.length ? Number((exception('LateFiling') / claims.length * 100).toFixed(2)) : 0,
      denialRthResubmissionPct: claims.length ? Number((claims.filter(claim => ['Denied', 'Returned (RTH)', 'Resubmitted'].includes(claim.status)).length / claims.length * 100).toFixed(2)) : 0,
      matchRate: paid.length ? Number((paid.filter(claim => db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE claim_ref = ?').get(claim.ref).amount === claim.approved_amount).length / paid.length * 100).toFixed(2)) : 100,
      costPerPaidClaim: paid.length ? Math.round(paymentTotal / paid.length) : 0
    },
    committedSql: committed
  };
}

export function regression(series, ceiling) {
  const n = series.length;
  const xMean = (n - 1) / 2; const yMean = series.reduce((sum, value) => sum + value, 0) / n;
  const slope = series.reduce((sum, value, x) => sum + (x - xMean) * (value - yMean), 0) /
    series.reduce((sum, _, x) => sum + (x - xMean) ** 2, 0);
  const nextWeek = yMean + slope * (n - xMean);
  const projected = series.reduce((sum, value) => sum + value, 0) + nextWeek;
  return { nextWeek, projected, overrun: Math.max(0, projected - ceiling) };
}
