import { describe, expect, it, vi } from 'vitest';
import { crmStoreSettingsSchema, dailyImportDates, historicalImportDates, historicalImportBatches, londonToday, queueMovementSchema } from './crm-automation';

describe('daily CRM report contracts', () => {
  it('splits the office June to October backfill into bounded daily batches without gaps', () => {
    const days = historicalImportDates('2026-06-03', '2026-10-15');
    expect(days).toHaveLength(135);
    const batches = historicalImportBatches('2026-06-03', '2026-10-15');
    expect(batches).toHaveLength(5);
    expect(batches.flatMap(batch => dailyImportDates(batch.startDate, batch.endDate))).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
    expect(() => historicalImportDates('2025-01-01', '2026-10-15')).toThrow(/366/);
  });
  it.each([
    ['2026-10-25', '2026-10-25', ['2026-10-25']],
    ['2026-10-24', '2026-10-26', ['2026-10-24', '2026-10-25', '2026-10-26']],
    ['2024-02-28', '2024-03-01', ['2024-02-28', '2024-02-29', '2024-03-01']],
  ])('splits %s to %s into daily jobs including DST/leap days', (from, to, days) => {
    expect(dailyImportDates(from, to)).toEqual(days);
  });
  it.each([['2026-02-30','2026-03-01'],['2026-10-03','2026-10-01'],['','2026-10-01'],['2026-01-01','2026-02-01']])('rejects invalid/oversized range %s–%s', (from,to) => {
    expect(() => dailyImportDates(from,to)).toThrow();
  });
  it('uses London midnight and rejects incomplete days and Book Stock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-01T23:30:00Z'));
      expect(londonToday()).toBe('2026-07-02');
      const input = { storeIds:[1],feeds:['normal_sales'],startDate:'2026-07-01',endDate:'2026-07-01' };
      expect(queueMovementSchema.safeParse(input).success).toBe(true);
      expect(queueMovementSchema.safeParse({...input,endDate:'2026-07-02'}).success).toBe(false);
      expect(queueMovementSchema.safeParse({...input,feeds:['book_stock']}).success).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it.each(['http://192.168.1.10:1900/','https://crm.example.test/Views/'])('accepts editable CRM address %s', crmUrl => {
    expect(crmStoreSettingsSchema.safeParse({crmUrl,nightlyEnabled:false}).success).toBe(true);
  });
  it.each(['file:///tmp/report','javascript:alert(1)','http://user:password@crm.example/','http://crm.example/?password=x','http://crm.example/#secret',''])('rejects credentials and invalid URLs', crmUrl => {
    expect(crmStoreSettingsSchema.safeParse({crmUrl,nightlyEnabled:false}).success).toBe(false);
  });
});
