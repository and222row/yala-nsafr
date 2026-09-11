import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '.env'), 'utf8');
const get = (key) => {
  const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m ? m[1].trim() : '';
};

const client = new pg.Client({
  host: get('DB_HOST'),
  port: parseInt(get('DB_PORT')),
  database: get('DB_NAME'),
  user: get('DB_USER'),
  password: get('DB_PASS'),
});

await client.connect();

// Check current enum values
const { rows: enumRows } = await client.query(`
  SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname = 'bookings_status_enum'
  ORDER BY e.enumsortorder
`);
console.log('Current enum values:', enumRows.map(r => r.enumlabel));

// Add pending_driver_approval to existing enum if missing
const hasPda = enumRows.some(r => r.enumlabel === 'pending_driver_approval');
if (!hasPda) {
  console.log("Adding 'pending_driver_approval' to existing enum...");
  await client.query(`ALTER TYPE bookings_status_enum ADD VALUE 'pending_driver_approval'`);
  console.log('Done.');
}

// Now update the rows
const { rows } = await client.query(
  `SELECT COUNT(*) as count FROM bookings WHERE status = 'pending_payment'`
);
console.log(`Found ${rows[0].count} bookings with status 'pending_payment'`);

if (parseInt(rows[0].count) > 0) {
  const result = await client.query(
    `UPDATE bookings SET status = 'pending_driver_approval' WHERE status = 'pending_payment'`
  );
  console.log(`Updated ${result.rowCount} rows to 'pending_driver_approval'`);
}

await client.end();
console.log('Done. Now restart the backend.');
