/** True when PostgreSQL is configured via DATABASE_URL. */
export function isDatabaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
