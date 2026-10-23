/** Freshness follows the business date, even when an old file was imported today. */
export function importFreshness(reportDate: string | null, source: string, today: string): 'missing' | 'stale' | 'current' {
  if (!reportDate) return 'missing';
  const latest = Date.parse(reportDate + 'T00:00:00Z');
  if (!Number.isFinite(latest)) return 'missing';
  const ageDays = (Date.parse(today + 'T00:00:00Z') - latest) / 86400000;
  return ageDays > (source === 'book_stock' ? 0 : 1) ? 'stale' : 'current';
}
