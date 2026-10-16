import { describe, expect, it, vi } from 'vitest';
import { shareInFlight } from './in-flight';
describe('concurrent read sharing', () => {
  it('shares overlapping reads but refreshes completed data', async () => {
    let finish!: (value: number) => void;
    const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = shareInFlight('overview', load);
    expect(shareInFlight('overview', load)).toBe(first);
    await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1);
    finish(1); expect(await first).toBe(1);
    expect(await shareInFlight('overview', async () => 2)).toBe(2);
  });
  it('isolates store/filter scopes and clears failures for retry', async () => {
    const failure = shareInFlight('store:1', async () => { throw new Error('fixture'); });
    expect(await shareInFlight('store:2', async () => 2)).toBe(2);
    await expect(failure).rejects.toThrow('fixture');
    expect(await shareInFlight('store:1', async () => 3)).toBe(3);
  });
});
