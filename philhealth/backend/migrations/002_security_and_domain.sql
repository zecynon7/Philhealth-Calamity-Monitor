ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN cap_at TEXT;
UPDATE sessions
SET last_seen_at = COALESCE(last_seen_at, created_at),
    cap_at = COALESCE(cap_at, datetime(created_at, '+8 hours'));

ALTER TABLE audit_log ADD COLUMN old_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE audit_log ADD COLUMN new_json TEXT NOT NULL DEFAULT '{}';

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;

CREATE TABLE providers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE settings_changes (
  id INTEGER PRIMARY KEY,
  setting_key TEXT NOT NULL REFERENCES settings(key),
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  claim_ref TEXT NOT NULL REFERENCES claims(ref),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  paid_at TEXT NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE event_details (
  event_id TEXT PRIMARY KEY REFERENCES calamity_events(id),
  starts_on TEXT,
  ends_on TEXT,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id)
);

CREATE TABLE event_budgets (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calamity_events(id),
  region TEXT NOT NULL,
  allocation INTEGER NOT NULL CHECK(allocation >= 0),
  revision INTEGER NOT NULL DEFAULT 1,
  proposed_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, region, revision)
);

ALTER TABLE claims ADD COLUMN provider_id INTEGER REFERENCES providers(id);
ALTER TABLE claims ADD COLUMN discharge_date TEXT;
ALTER TABLE claims ADD COLUMN filing_date TEXT;
ALTER TABLE claims ADD COLUMN decision_date TEXT;
ALTER TABLE claims ADD COLUMN reason_code TEXT;
ALTER TABLE claims ADD COLUMN encoded_by INTEGER REFERENCES users(id);
ALTER TABLE claims ADD COLUMN note TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('warning_pct', '80'),
  ('critical_pct', '100'),
  ('aging_days', '60'),
  ('z_threshold', '3'),
  ('filing_deadline_days', '60'),
  ('as_of_date', '2026-10-15');

CREATE INDEX idx_payments_claim ON payments(claim_ref);
CREATE INDEX idx_claims_dates ON claims(discharge_date, filing_date, decision_date);
