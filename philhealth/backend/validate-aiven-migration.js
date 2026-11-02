import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL || !process.env.AIVEN_CA_CERT_PATH) {
  throw new Error('DATABASE_URL and AIVEN_CA_CERT_PATH are required.');
}
const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.searchParams.delete('sslmode');
const client = new pg.Client({
  connectionString: connectionUrl.toString(),
  ssl: { ca: readFileSync(process.env.AIVEN_CA_CERT_PATH, 'utf8'), rejectUnauthorized: true }
});
const migration = readFileSync(join(process.cwd(), 'backend', 'postgres-migrations', '001_security_sessions.sql'), 'utf8')
  .replace(/^BEGIN;\s*/m, '').replace(/\s*COMMIT;\s*$/m, '');

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(migration);
  await client.query('ROLLBACK');
  console.log('Migration syntax and permissions validated; transaction rolled back.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
