# PhilHealth Calamity Claims Monitor

Install dependencies, then run `npm start`. Use `npm run seed` only to populate a new local demo database. Demo credentials are `cfb` / `demo1234` when seeded.

Run the automated checks with `npm test`. Set `TRUST_PROXY=1` only behind a trusted reverse proxy.

## Aiven PostgreSQL preparation

SQLite remains the active database until PostgreSQL field mappings are approved.
Set `DATABASE_URL` and `AIVEN_CA_CERT_PATH` in an untracked `.env`, then run
`npm run db:inspect` to inspect the live schema using verified TLS. Run
`npm run db:validate-migration` to validate (and roll back) the prepared
non-destructive security migration. See `docs/aiven-postgresql-integration.md`
before applying any migration or setting `DB_DRIVER=postgres`.
