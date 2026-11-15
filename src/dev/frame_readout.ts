import type { FrameDivider } from '../engine/frame_divider.ts';

/**
 * The frame readout (battery card battery_frame_readout, 2026-11-14): with `?fps` in the address, a corner of the screen shows how
 * many frames a second the screen offers and how many the game draws, once a second, so a playtester on a phone, with no keyboard
 * or console, can report them, with Low Power Mode on and off (WebKit then holds a phone to 30). Players never see it.
 */
export function installFrameReadout(frames: FrameDivider, params = new URLSearchParams(location.search)): void {
  if (!params.has('fps')) return;
  const el = document.createElement('div');
  el.id = 'frame-readout';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:calc(6px + env(safe-area-inset-left));bottom:calc(6px + env(safe-area-inset-bottom));z-index:1000;'
    + 'padding:2px 6px;border-radius:3px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.4 ui-monospace,monospace;pointer-events:none';
  el.textContent = 'screen -/s, drawn -/s';
  document.body.appendChild(el);
  let at = performance.now(), screen = frames.screenFrames, drawn = frames.drawnFrames;
  window.setInterval(() => {
    const now = performance.now(), s = (now - at) / 1000;
    el.textContent = `screen ${Math.round((frames.screenFrames - screen) / s)}/s, drawn ${Math.round((frames.drawnFrames - drawn) / s)}/s`;
    at = now;
    screen = frames.screenFrames;
    drawn = frames.drawnFrames;
  }, 1000);
}
