import { db } from '../src/db/index.js';
import { apiTokens } from '../src/db/schema.js';

async function main() {
  const tokens = await db.select().from(apiTokens).limit(5);
  console.log(JSON.stringify(tokens, null, 2));
  process.exit(0);
}

main();
