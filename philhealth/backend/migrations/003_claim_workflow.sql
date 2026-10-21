PRAGMA foreign_keys = OFF;

ALTER TABLE claims RENAME TO claims_legacy;
ALTER TABLE claim_history RENAME TO claim_history_legacy;
ALTER TABLE exceptions RENAME TO exceptions_legacy;
ALTER TABLE payments RENAME TO payments_legacy;

CREATE TABLE claims (
  ref TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calamity_events(id),
  region TEXT NOT NULL,
  patient_token TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Submitted', 'Under Review', 'Approved', 'Returned (RTH)', 'Denied', 'Resubmitted', 'Paid', 'Reconciled')),
  claimed_amount INTEGER NOT NULL CHECK(claimed_amount >= 0),
  approved_amount INTEGER NOT NULL DEFAULT 0 CHECK(approved_amount >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provider_id INTEGER REFERENCES providers(id),
  discharge_date TEXT,
  filing_date TEXT,
  decision_date TEXT,
  reason_code TEXT,
  encoded_by INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT ''
);

INSERT INTO claims SELECT ref, event_id, region, patient_token, claim_type,
  CASE WHEN status = 'Under review' THEN 'Under Review' ELSE status END,
  claimed_amount, approved_amount, created_at, provider_id, discharge_date, filing_date,
  decision_date, reason_code, encoded_by, note FROM claims_legacy;

CREATE TABLE claim_history (
  id INTEGER PRIMARY KEY,
  claim_ref TEXT NOT NULL REFERENCES claims(ref) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT ''
);

INSERT INTO claim_history(id, claim_ref, status, created_at, actor_id)
SELECT id, claim_ref, CASE WHEN status = 'Under review' THEN 'Under Review' ELSE status END, created_at, actor_id
FROM claim_history_legacy;

CREATE TABLE exceptions (
  id INTEGER PRIMARY KEY,
  claim_ref TEXT NOT NULL REFERENCES claims(ref) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('Late', 'LateFiling', 'Duplicate', 'Outlier', 'Mismatch')),
  reason TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolution_note TEXT NOT NULL DEFAULT '',
  UNIQUE(claim_ref, type)
);

INSERT INTO exceptions(id, claim_ref, type, reason, resolved_at, resolved_by)
SELECT id, claim_ref, type, reason, resolved_at, resolved_by FROM exceptions_legacy;

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  claim_ref TEXT NOT NULL REFERENCES claims(ref),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  paid_at TEXT NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT ''
);

INSERT INTO payments SELECT * FROM payments_legacy;
DROP TABLE claim_history_legacy;
DROP TABLE exceptions_legacy;
DROP TABLE payments_legacy;
DROP TABLE claims_legacy;

CREATE TABLE permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY(role, permission)
);

INSERT INTO permissions(role, permission) VALUES
  ('CFB', 'events:read'), ('CFB', 'events:write'), ('CFB', 'analytics:read'), ('CFB', 'exceptions:resolve'), ('CFB', 'claims:read'), ('CFB', 'claims:transition'),
  ('ACT', 'claims:read'), ('ACT', 'payments:write'), ('ACT', 'claims:reconcile'), ('ACT', 'exceptions:resolve'),
  ('ROS', 'claims:read'), ('ROS', 'claims:write'), ('ROS', 'claims:transition'), ('ROS', 'claims:import'), ('ROS', 'exceptions:read'),
  ('RVP', 'claims:read'), ('RVP', 'events:read'), ('RVP', 'dashboard:read'),
  ('EXE', 'claims:read'), ('EXE', 'events:read'), ('EXE', 'events:close'), ('EXE', 'events:revision:approve'), ('EXE', 'analytics:read'), ('EXE', 'dashboard:read'),
  ('AUD', 'claims:read'), ('AUD', 'events:read'), ('AUD', 'audit:read'), ('AUD', 'dashboard:read'),
  ('ADM', 'users:manage'), ('ADM', 'settings:manage');

CREATE INDEX idx_permissions_role ON permissions(role, permission);
CREATE INDEX idx_claims_scope ON claims(event_id, region, status);
PRAGMA foreign_keys = ON;
