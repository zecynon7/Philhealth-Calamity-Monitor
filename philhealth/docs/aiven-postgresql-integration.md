# Aiven PostgreSQL compatibility plan

## Current safety boundary

SQLite remains the active runtime database. The Aiven service has only been read
with verified TLS. Do not apply the SQL migration or switch `DB_DRIVER` until the
open field mappings below are approved and PostgreSQL endpoint tests pass.

## Confirmed PostgreSQL connection

The service is PostgreSQL. The application should use `pg` with `DATABASE_URL`,
`AIVEN_CA_CERT_PATH`, and `ssl: { ca, rejectUnauthorized: true }`. The supplied
CA is required; disabling certificate verification is not acceptable.

## Confirmed direct or structural mappings

| SQLite application concept | PostgreSQL source | Status |
| --- | --- | --- |
| User credentials | `users.username`, `users.password_hash`, `users.is_active` | Direct, subject to verifying that hashes are Argon2-compatible. |
| User role | `users.role_id -> roles.role_code` | Structural match; application role-code translation needs approval. |
| User region | `users.region_id -> regions.region_code` | Direct structural match. |
| Event | `events.event_id`, `event_code`, `event_name`, `ceiling`, `status` | Direct structural match, with integer database IDs. |
| Regional allocation | `event_allocations -> regions` | Direct structural match. |
| Claim reference and amounts | `claims.claim_ref`, `submitted_amount`, `approved_amount` | Direct structural match; monetary unit is unconfirmed. |
| Claim history | `claim_status_history` | Direct structural match for statuses and actor/time. |
| Payment ledger | `payments` and `v_claim_paid` | Structural match. |
| Exceptions | `exceptions` | Structural match for type/detail/review state. |
| Audit log | `audit_log` | Structural match for actor, action, before/after JSON, reason, and hash chain. |
| Numeric monitoring settings | `app_settings` | Structural match for numeric thresholds only. |

## Required query changes

- Replace `better-sqlite3` synchronous calls (`prepare().get/all/run`,
  `transaction`) with asynchronous `pg` parameterized queries (`$1`, `$2`, ...)
  and `BEGIN`/`COMMIT`/`ROLLBACK` transactions.
- Replace SQLite date expressions (`date('now')`, `datetime(...)`) with
  PostgreSQL `CURRENT_DATE`, `CURRENT_TIMESTAMP`, and interval expressions.
- Replace local string event IDs with the PostgreSQL integer `event_id` while
  continuing to expose `event_code` to the frontend.
- Use PostgreSQL views `v_event_measures`, `v_event_totals`,
  `v_region_totals`, and `v_claim_paid` for reports and dashboard totals where
  their definitions match the approved business rules.
- Do not run local SQLite migrations or seed routines against PostgreSQL.

## Missing security tables (confirmed)

The live database does not contain session or login-attempt storage. The
non-destructive migration in `backend/postgres-migrations/001_security_sessions.sql`
adds application-namespaced `app_sessions` and `app_login_attempts`; it does not
touch existing tables or records. It supports the current secure-cookie, CSRF,
idle-session, absolute-session, and login-lockout behavior.

## Mappings that require approval

1. **Role translation:** confirm that `CENTRAL_FIN`, `REGIONAL_STAFF`,
   `REGIONAL_VP`, `PRESIDENT`, `TREASURY`, `AUDITOR`, and `ADMIN` map to the
   existing application permissions CFB, ROS, RVP, EXE, ACT, AUD, and ADM,
   respectively.
2. **Claims:** PostgreSQL has `case_type`, `service_date`, and `filed_date`, but
   the local API expects claim type, discharge date, and filing date. Confirm the
   intended semantic mapping. There is no PostgreSQL equivalent for local
   `patient_token`, `reason_code`, `decision_date`, or `note`.
3. **Money:** confirm whether PostgreSQL `numeric` amounts are pesos or centavos.
   No conversion will be made until confirmed.
4. **Status vocabulary:** confirm the exact values and transitions permitted by
   the PostgreSQL constraints for claims, events, exceptions, and payments.
5. **Settings:** `app_settings.setting_value` is numeric, so the local
   date-valued `as_of_date` has no confirmed destination.
6. **Audit hash format:** confirm whether `prev_hash`/`row_hash` use the same
   canonical serialization as the local SHA-256 chain before writing audit rows.
7. **Claim creation/import:** PostgreSQL claims require a provider, service and
   filed dates, and a creator. Confirm how the UI obtains a valid provider and
   whether `provider_requests` is part of the claim workflow.

## Verification sequence after approval

1. Take an Aiven backup and apply the security migration in a transaction.
2. Add a PostgreSQL repository beside the SQLite repository; keep SQLite as the
   default driver.
3. Test login, CSRF rejection, lockout, role scope, dashboard, claims, payment,
   exceptions, reports, and audit chain against a non-production Aiven clone.
4. Only after these pass, set `DB_DRIVER=postgres` in the deployment environment.
