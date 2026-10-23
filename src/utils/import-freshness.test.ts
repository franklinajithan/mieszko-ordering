import { describe, expect, it } from 'vitest';
import { importFreshness } from './import-freshness';

describe('report freshness', () => {
  it('flags old business dates even when the worker has just imported them', () => {
    expect(importFreshness('2026-08-20', 'book_stock', '2026-10-23')).toBe('stale');
    expect(importFreshness('2026-10-20', 'normal_sales', '2026-10-23')).toBe('stale');
  });
  it('accepts yesterday’s movement report across month and DST boundaries', () => {
    expect(importFreshness('2026-09-30', 'rtc', '2026-10-01')).toBe('current');
    expect(importFreshness('2026-10-25', 'wastage', '2026-10-26')).toBe('current');
  });
  it('requires today’s book stock and distinguishes missing reports', () => {
    expect(importFreshness('2026-10-22', 'book_stock', '2026-10-23')).toBe('stale');
    expect(importFreshness('2026-10-23', 'book_stock', '2026-10-23')).toBe('current');
    expect(importFreshness(null, 'wastage', '2026-10-23')).toBe('missing');
    expect(importFreshness('invalid', 'rtc', '2026-10-23')).toBe('missing');
  });
});
