CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CFB', 'ACT', 'EXE', 'AUD', 'ADM', 'ROS', 'RVP')),
  region TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  successful INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE calamity_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  budget INTEGER NOT NULL CHECK (budget >= 0)
);

CREATE TABLE region_budgets (
  event_id TEXT NOT NULL REFERENCES calamity_events(id),
  region TEXT NOT NULL,
  allocation INTEGER NOT NULL CHECK (allocation >= 0),
  PRIMARY KEY (event_id, region)
);

CREATE TABLE claims (
  ref TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calamity_events(id),
  region TEXT NOT NULL,
  patient_token TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Submitted', 'Under review', 'Approved', 'Paid')),
  claimed_amount INTEGER NOT NULL CHECK (claimed_amount >= 0),
  approved_amount INTEGER NOT NULL CHECK (approved_amount >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE claim_history (
  id INTEGER PRIMARY KEY,
  claim_ref TEXT NOT NULL REFERENCES claims(ref) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('Submitted', 'Under review', 'Approved', 'Paid')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id INTEGER REFERENCES users(id)
);

CREATE TABLE exceptions (
  id INTEGER PRIMARY KEY,
  claim_ref TEXT NOT NULL REFERENCES claims(ref) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Late', 'LateFiling', 'Duplicate', 'Outlier', 'Mismatch')),
  reason TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_login_attempts_key ON login_attempts(username, ip, attempted_at);
CREATE INDEX idx_claims_region ON claims(region);
CREATE INDEX idx_exceptions_open ON exceptions(resolved_at);
