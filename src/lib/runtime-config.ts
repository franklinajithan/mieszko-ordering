/** UI-only mode when PostgreSQL is not configured. */
export function isDatabaseEnabled(): boolean {
  if (process.env.USE_MOCK_DATA === "true") return false;
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function isDemoMode(): boolean {
  return !isDatabaseEnabled();
}
