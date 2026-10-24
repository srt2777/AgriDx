export interface TelemetrySseSink {
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  on(event: 'drain', callback: () => void): unknown;
  off(event: 'drain', callback: () => void): unknown;
  readonly writableLength: number;
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
}

/** Respect drain with a bounded queue; a slow client cannot grow server memory indefinitely. */
export function createTelemetrySseWriter(sink: TelemetrySseSink, onClose: () => void, maxBytes = 262144) {
  const queue: string[] = [];
  let bytes = 0, waiting = false, closed = false;
  function close(force = false) {
    if (closed) return;
    closed = true;
    sink.off('drain', drain);
    queue.length = 0; bytes = 0;
    onClose();
    if (force) sink.destroy();
    else if (!sink.destroyed && !sink.writableEnded) sink.end();
  }
  function drain() { sink.off('drain', drain); waiting = false; flush(); }
  function flush() {
    if (closed) return;
    if (sink.destroyed || sink.writableEnded) { close(); return; }
    while (queue.length > 0 && !waiting && !closed) {
      const chunk = queue.shift()!; bytes -= Buffer.byteLength(chunk);
      try {
        if (!sink.write(chunk)) { waiting = true; sink.on('drain', drain); }
      } catch { close(true); }
    }
  }
  return {
    get closed() { return closed; }, close,
    send(event: 'catalog' | 'telemetry' | 'heartbeat' | 'reset', data: unknown, cursor?: string) {
      if (closed) return false;
      let chunk: string;
      try { chunk = `${event === 'catalog' ? 'retry: 3000\n' : ''}${cursor ? `id: ${cursor}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
      catch { close(true); return false; }
      const length = Buffer.byteLength(chunk);
      if (queue.length >= 64 || length + bytes + sink.writableLength > maxBytes) { close(true); return false; }
      queue.push(chunk); bytes += length; flush();
      return !closed;
    },
  };
}
