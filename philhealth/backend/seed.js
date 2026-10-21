import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './db.js';

process.env.SEED_DEMO = '1';
const here = fileURLToPath(new URL('.', import.meta.url));
const db = await createDatabase(join(here, 'data', 'calamity.db'));
db.close();
