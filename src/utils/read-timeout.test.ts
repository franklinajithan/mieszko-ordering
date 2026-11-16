import { describe, expect, it, vi } from 'vitest';
import {withReadTimeout} from './read-timeout';
describe('bounded read requests', () => {
  it('aborts a stalled read and reports a retryable error', async () => {
    vi.useFakeTimers();
    try {
      let signal!: AbortSignal;
      const read = withReadTimeout(s => { signal=s; return new Promise(() => {}); }, {timeoutMs:100});
      const check=expect(read).rejects.toThrow('server took too long');
      await vi.advanceTimersByTimeAsync(100); await check;
      expect(signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });
  it('propagates caller cancellation and releases the timeout after success', async () => {
    const parent=new AbortController();
    let signal!:AbortSignal;
    const pending=withReadTimeout(async s => {signal=s;parent.abort();return 42;}, {signal:parent.signal});
    expect(await pending).toBe(42);expect(signal.aborted).toBe(true);
    expect(await withReadTimeout(async()=>7)).toBe(7);
  });
});
