/** Share concurrent reads only. Completed/failed reads are never cached. */
const pending = new Map<string, Promise<unknown>>();
export function shareInFlight<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const result = Promise.resolve().then(read);
  pending.set(key, result);
  const clear = () => { if (pending.get(key) === result) pending.delete(key); };
  void result.then(clear, clear);
  return result;
}
