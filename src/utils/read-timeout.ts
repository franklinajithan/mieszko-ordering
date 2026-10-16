/** Bound read requests; mutations intentionally keep their existing semantics. */
export async function withReadTimeout<T>(read: (signal: AbortSignal) => Promise<T>, options: {signal?: AbortSignal; timeoutMs?: number} = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, {once: true});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('The server took too long to respond. Retry the read; queued imports remain on the server.'));
          controller.abort();
        }, options.timeoutMs ?? 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
