import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let database: Db | null = null;

export function createDb(connectionString?: string): Db {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.",
    );
  }

  if (database) return database;

  client = postgres(url, { max: 10 });
  database = drizzle(client, { schema });
  return database;
}

export function getDb(): Db {
  return createDb();
}

export type Database = Db;
