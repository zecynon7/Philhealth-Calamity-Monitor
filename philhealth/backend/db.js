import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import argon2 from 'argon2';

const users = [
  ['cfb', 'CFB', 'National'], ['act', 'ACT', 'National'], ['exe', 'EXE', 'National'],
  ['aud', 'AUD', 'National'], ['adm', 'ADM', 'National'], ['ros_iva', 'ROS', 'IVA'],
  ['ros_vii', 'ROS', 'VII'], ['ros_xi', 'ROS', 'XI'], ['rvp_vii', 'RVP', 'VII']
];

export async function createDatabase(filename = join(process.cwd(), 'backend', 'data', 'calamity.db')) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const dir = join(process.cwd(), 'backend', 'migrations');
  for (const name of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) {
      db.exec(readFileSync(join(dir, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);
    }
  }
  await seed(db, filename === ':memory:' || process.env.SEED_DEMO === '1');
  return db;
}

async function seed(db, allowDemo) {
  if (!allowDemo) return;
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO users(username, password_hash, role, region) VALUES (?, ?, ?, ?)');
    for (const [username, role, region] of users) insert.run(username, await argon2.hash('demo1234', { timeCost: 2, memoryCost: 4096 }), role, region);
  }
  if (!db.prepare('SELECT 1 FROM calamity_events LIMIT 1').get()) {
    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO calamity_events(id, name, status, budget) VALUES (?, ?, ?, ?)').run('CE-2026-001', 'Typhoon Daluyong', 'Active', 1300000);
      const budget = db.prepare('INSERT INTO region_budgets(event_id, region, allocation) VALUES (?, ?, ?)');
      [['IVA', 450000], ['VII', 350000], ['XI', 500000]].forEach(row => budget.run('CE-2026-001', ...row));
      const claim = db.prepare(`INSERT INTO claims(ref, event_id, region, patient_token, claim_type, status, claimed_amount, approved_amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
      [
        ['CLM-001-XI-00001', 'CE-2026-001', 'XI', 'PT-1024', 'Inpatient', 'Approved', 342000, 318000],
        ['CLM-001-VII-00012', 'CE-2026-001', 'VII', 'PT-0981', 'Outpatient', 'Paid', 270000, 242000],
        ['CLM-001-IVA-00009', 'CE-2026-001', 'IVA', 'PT-0877', 'Inpatient', 'Under review', 210000, 184000],
        ['CLM-001-XI-00017', 'CE-2026-001', 'XI', 'PT-1146', 'Outpatient', 'Approved', 362000, 350000]
      ].forEach(row => claim.run(...row));
      const history = db.prepare('INSERT INTO claim_history(claim_ref, status) VALUES (?, ?)');
      [['CLM-001-XI-00001', 'Submitted'], ['CLM-001-XI-00001', 'Under review'], ['CLM-001-XI-00001', 'Approved'], ['CLM-001-VII-00012', 'Submitted'], ['CLM-001-VII-00012', 'Approved'], ['CLM-001-VII-00012', 'Paid'], ['CLM-001-IVA-00009', 'Submitted'], ['CLM-001-IVA-00009', 'Under review'], ['CLM-001-XI-00017', 'Submitted'], ['CLM-001-XI-00017', 'Approved']].forEach(row => history.run(...row));
      const exception = db.prepare('INSERT INTO exceptions(claim_ref, type, reason) VALUES (?, ?, ?)');
      [['CLM-001-XI-00001', 'Late', 'Review exceeded target time.'], ['CLM-001-VII-00012', 'Duplicate', 'Similar patient token and amount.'], ['CLM-001-XI-00017', 'Outlier', 'Amount outside normal range.'], ['CLM-001-IVA-00009', 'LateFiling', 'Filing date needs validation.'], ['CLM-001-XI-00017', 'Mismatch', 'Supporting amount differs from claim.']].forEach(row => exception.run(...row));
    });
    transaction();
  }
}
