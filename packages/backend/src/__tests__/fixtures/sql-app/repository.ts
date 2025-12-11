import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

export async function getUsers() {
  return db.execute`SELECT * FROM users`;
}

export async function getUserById(id: number) {
  return db.execute`SELECT * FROM users WHERE id = ${id}`;
}

export async function createUser(name: string, email: string) {
  return db.execute`INSERT INTO users (name, email) VALUES (${name}, ${email}) RETURNING *`;
}
