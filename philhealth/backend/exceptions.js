const openStatuses = ['Submitted', 'Under Review', 'Returned (RTH)', 'Resubmitted'];

function add(db, ref, type, reason) {
  db.prepare(`INSERT INTO exceptions(claim_ref, type, reason) VALUES (?, ?, ?)
    ON CONFLICT(claim_ref, type) DO UPDATE SET reason = excluded.reason`).run(ref, type, reason);
}

function daysBetween(start, end) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function percentile(sorted, value) {
  const index = (sorted.length - 1) * value;
  const low = Math.floor(index); const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function scanExceptions(db) {
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.key === 'as_of_date' ? row.value : Number(row.value)]));
  const claims = db.prepare('SELECT * FROM claims').all();
  const amounts = claims.map(row => row.claimed_amount).sort((a, b) => a - b);
  const mean = amounts.reduce((sum, value) => sum + value, 0) / (amounts.length || 1);
  const sd = Math.sqrt(amounts.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (amounts.length || 1));
  const q1 = percentile(amounts, .25) || 0; const q3 = percentile(amounts, .75) || 0;
  const lower = q1 - 1.5 * (q3 - q1); const upper = q3 + 1.5 * (q3 - q1);
  const duplicates = new Map();
  for (const claim of claims) {
    const key = [claim.provider_id || '', claim.patient_token, claim.discharge_date || '', claim.claimed_amount].join('|');
    duplicates.set(key, [...(duplicates.get(key) || []), claim]);
  }
  for (const claim of claims) {
    if (openStatuses.includes(claim.status) && claim.created_at.slice(0, 10) &&
      daysBetween(claim.created_at.slice(0, 10), String(settings.as_of_date)) > settings.aging_days) {
      add(db, claim.ref, 'Late', 'Claim remains open beyond the aging threshold.');
    }
    if (claim.discharge_date && claim.filing_date && daysBetween(claim.discharge_date, claim.filing_date) > settings.filing_deadline_days) {
      add(db, claim.ref, 'LateFiling', 'Filing exceeded the deadline.');
    }
    const duplicateKey = [claim.provider_id || '', claim.patient_token, claim.discharge_date || '', claim.claimed_amount].join('|');
    if ((duplicates.get(duplicateKey) || []).length > 1) add(db, claim.ref, 'Duplicate', 'Provider, token, discharge date, and amount match another claim.');
    const z = sd ? Math.abs((claim.claimed_amount - mean) / sd) : 0;
    if (z > settings.z_threshold || claim.claimed_amount < lower || claim.claimed_amount > upper) add(db, claim.ref, 'Outlier', 'Claimed amount is outside the population distribution.');
    const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE claim_ref = ?').get(claim.ref).amount;
    if (['Paid', 'Reconciled'].includes(claim.status) && paid !== claim.approved_amount) add(db, claim.ref, 'Mismatch', 'Paid amount does not equal approved amount.');
  }
}
