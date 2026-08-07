import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  postgresClient: ReturnType<typeof postgres> | undefined;
  drizzleDb: Db | undefined;
};

function createPostgresClient(url: string) {
  return postgres(url, {
    // Dev uses 1 by default in older builds; need >1 if a transaction awaits other queries on `db`.
    max: process.env.NODE_ENV === "production" ? 10 : 5,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
}

export function createDb(connectionString?: string): Db {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.",
    );
  }

  if (!globalForDb.postgresClient) {
    globalForDb.postgresClient = createPostgresClient(url);
  }

  if (!globalForDb.drizzleDb) {
    globalForDb.drizzleDb = drizzle(globalForDb.postgresClient, { schema });
  }

  return globalForDb.drizzleDb;
}

export function getDb(): Db {
  return createDb();
}

export type Database = Db;
