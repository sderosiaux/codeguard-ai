import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);

async function main() {
  console.log('Querying database...\n');

  // Get all users
  const users = await sql`SELECT id, email, name FROM users`;
  console.log('Users:');
  users.forEach((u) => console.log(`  - ${u.email} (${u.id})`));

  // Get all workspaces
  const workspaces = await sql`SELECT id, name, owner_id FROM workspaces`;
  console.log('\nWorkspaces:');
  workspaces.forEach((w) => console.log(`  - ${w.name} (${w.id}) - owner: ${w.owner_id}`));

  // Get all repositories
  const repositories = await sql`SELECT id, name, owner, workspace_id FROM repositories`;
  console.log('\nRepositories:');
  repositories.forEach((r) => console.log(`  - ${r.owner}/${r.name} (id: ${r.id}, workspace_id: ${r.workspace_id || 'NULL'})`));

  // Find orphaned repositories (no workspace_id)
  const orphanedRepos = repositories.filter((r) => !r.workspace_id);

  if (orphanedRepos.length === 0) {
    console.log('\nNo orphaned repositories found. All repositories are already assigned to workspaces.');
    await sql.end();
    return;
  }

  console.log(`\nFound ${orphanedRepos.length} orphaned repositories.`);

  // Find the first workspace to assign them to
  if (workspaces.length === 0) {
    console.log('No workspaces found! Cannot migrate repositories.');
    await sql.end();
    return;
  }

  const targetWorkspace = workspaces[0];
  console.log(`\nMigrating orphaned repositories to workspace: "${targetWorkspace.name}" (${targetWorkspace.id})`);

  // Update the repositories
  const result = await sql`
    UPDATE repositories
    SET workspace_id = ${targetWorkspace.id}
    WHERE workspace_id IS NULL
    RETURNING id, name, owner
  `;

  console.log(`\nMigrated ${result.length} repositories:`);
  result.forEach((r) => console.log(`  - ${r.owner}/${r.name} (id: ${r.id})`));

  await sql.end();
  console.log('\nDone!');
}

main().catch(console.error);
