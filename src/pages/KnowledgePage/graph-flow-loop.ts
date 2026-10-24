interface FlowLoopOptions {
  active: () => boolean;
  render: (deltaSeconds: number) => void;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}
/** One cancellable chain; time never catches up after an offscreen/pause interval. */
export function createGraphFlowLoop({ active, render, request, cancel }: FlowLoopOptions) {
  let frame: number | undefined;
  let previous: number | undefined;
  let lastPaint: number | undefined;
  const stop = () => {
    if (frame !== undefined) cancel(frame);
    frame = undefined; previous = undefined; lastPaint = undefined;
  };
  const tick = (now: number) => {
    frame = undefined;
    if (!active()) { stop(); return; }
    if (lastPaint === undefined || now - lastPaint >= 1000 / 30) {
      const delta = previous === undefined ? 0 : Math.min(Math.max(0, (now - previous) / 1000), .06);
      previous = now; lastPaint = now;
      render(delta);
    }
    start();
  };
  const start = () => { if (frame === undefined && active()) frame = request(tick); };
  return { start, stop };
}
