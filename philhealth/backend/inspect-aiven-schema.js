import pg from 'pg';
import { readFileSync } from 'node:fs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!process.env.AIVEN_CA_CERT_PATH) throw new Error('AIVEN_CA_CERT_PATH is required for verified TLS.');
const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.searchParams.delete('sslmode');
const client = new pg.Client({
  connectionString: connectionUrl.toString(),
  ssl: { ca: readFileSync(process.env.AIVEN_CA_CERT_PATH, 'utf8'), rejectUnauthorized: true }
});

await client.connect();
try {
  const tables = await client.query(`SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name`);
  const columns = await client.query(`SELECT table_schema, table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name, ordinal_position`);
  const constraints = await client.query(`SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
    GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
    ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`);
  const summary = await client.query(`SELECT
    (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM roles) AS roles,
    (SELECT count(*) FROM events) AS events,
    (SELECT count(*) FROM claims) AS claims,
    (SELECT count(*) FROM payments) AS payments,
    (SELECT count(*) FROM exceptions) AS exceptions`);
  const roles = await client.query('SELECT role_id, role_code, role_name FROM roles ORDER BY role_id');
  const eventRows = await client.query('SELECT event_id, event_code, event_name, status FROM events ORDER BY event_id');
  console.log(JSON.stringify({ tables: tables.rows, columns: columns.rows, constraints: constraints.rows, summary: summary.rows[0], roles: roles.rows, events: eventRows.rows }, null, 2));
} finally {
  await client.end();
}
