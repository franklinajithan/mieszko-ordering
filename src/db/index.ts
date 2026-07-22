import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let database: Db | null = null;

function getDb(): Db {
  if (database) return database;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.",
    );
  }

  client = postgres(connectionString, { max: 10 });
  database = drizzle(client, { schema });
  return database;
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type Database = Db;
