import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);

async function main() {
  console.log('Adding NOT NULL constraint to repositories.workspace_id...\n');

  // First check if there are any NULL values
  const nullCheck = await sql`SELECT COUNT(*) as count FROM repositories WHERE workspace_id IS NULL`;
  const nullCount = nullCheck[0].count;

  if (nullCount > 0) {
    console.log(`Error: Found ${nullCount} repositories with NULL workspace_id. Cannot add NOT NULL constraint.`);
    await sql.end();
    return;
  }

  console.log('No NULL values found. Adding constraint...');

  // Add the NOT NULL constraint
  await sql`ALTER TABLE repositories ALTER COLUMN workspace_id SET NOT NULL`;

  console.log('Done! workspace_id is now NOT NULL.');
  await sql.end();
}

main().catch(console.error);
