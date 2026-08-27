import { CONFIG } from './config.js';

// The scheduler is injectable so the fixed-timestep maths can be tested with a
// fake clock. Production passes requestAnimationFrame; tests drive it by hand.
export function createLoop({
  ctx,
  onTick,
  onRender,
  schedule = (fn) => requestAnimationFrame(fn),
  cancel = (handle) => cancelAnimationFrame(handle),
}) {
  let accumulator = 0;
  let last = null;
  let handle = null;

  function frame(now) {
    handle = schedule(frame);

    // 0 is a legitimate timestamp, so the first frame is flagged with null, not falsiness.
    if (last === null) { last = now; return; }
    let delta = now - last;
    last = now;
    if (delta > CONFIG.maxFrameMs) delta = CONFIG.maxFrameMs;

    const { state } = ctx;
    if (state.paused) { accumulator = 0; return; }

    accumulator += delta * state.speed;
    let ticked = 0;
    while (accumulator >= CONFIG.tickMs && ticked < CONFIG.maxCatchUpTicks) {
      accumulator -= CONFIG.tickMs;
      onTick();
      ticked++;
    }
    if (accumulator > CONFIG.tickMs * CONFIG.maxCatchUpTicks) accumulator = 0;
    if (ticked > 0) onRender();
  }

  return {
    start() { if (handle == null) handle = schedule(frame); },
    stop() { if (handle != null) { cancel(handle); handle = null; last = null; accumulator = 0; } },
  };
}
