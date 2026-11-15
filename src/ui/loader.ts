import type { ArtProgress } from '../art/images.ts';
import { motion } from '../render/motion.ts';

/**
 * The loading page: a blue ball with a centred white cross eating along the dots, and under it how much is loaded ("62%
 * loaded") and, while the art loads, about how long is left (the owner, 2026-10-14). It is plain
 * HTML in index.html, so it shows the moment the page opens, before the game's script has arrived. It
 * stays until the title is up, and comes back if play is chosen before the rest of the art has arrived.
 * The ball and cross are inline SVG, so they need no downloaded art. Its course is in the page:
 * `data-from` and `data-to` on #loader-ball. The class `still` (set by
 * the page from the system's setting, and here from the game's Reduce motion) keeps the mouth open and
 * the ball from sliding.
 */

function page(): HTMLElement | null {
  return document.getElementById('loader');
}

/** The share loaded as the page words it: whole percents rounded down, so 100% means all of it. */
export function shareText(share: number): string {
  return `${Math.floor(Math.max(0, Math.min(1, share)) * 100 + 1e-9)}% loaded`;
}

/**
 * The time left as the page words it, rounded more coarsely the longer it is: a few seconds under 10, then to 5
 * seconds, then to minutes. Empty when it cannot be told.
 */
export function timeLeftText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return 'a few seconds left';
  const fives = Math.round(seconds / 5) * 5;
  if (fives < 60) return `about ${fives} seconds left`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'about a minute left' : `about ${minutes} minutes left`;
}

/** When the time left was last worded: it changes at most once a second, as each image's arrival moves the rate. */
let leftAt = -Infinity;

/**
 * Moves the ball to a share (0 to 1) of the way along, eating the dots it passes, and words the share and the
 * seconds left (none given, none shown); with `jump`, at once rather than sliding, as when a new wait starts.
 */
export function loaderProgress(share: number, opts: { jump?: boolean; secondsLeft?: number | null } = {}): void {
  const l = page();
  if (!l) return;
  const s = Math.max(0, Math.min(1, share));
  const jump = opts.jump ?? false;
  l.setAttribute('aria-valuenow', String(Math.floor(s * 100 + 1e-9)));
  const shareLine = l.querySelector<HTMLElement>('#loader-share');
  if (shareLine) shareLine.textContent = shareText(s);
  const leftLine = l.querySelector<HTMLElement>('#loader-left');
  const now = performance.now();
  const left = s < 1 ? timeLeftText(opts.secondsLeft) : '';
  if (leftLine && (jump || !left || !leftLine.textContent || now - leftAt >= 1000)) {
    if (leftLine.textContent !== left) leftAt = now;
    leftLine.textContent = left;
  }
  l.setAttribute('aria-valuetext', [shareText(s), leftLine?.textContent].filter(Boolean).join(', '));
  const ball = l.querySelector<SVGGElement>('#loader-ball');
  if (!ball) return;
  const from = Number(ball.dataset.from);
  const to = Number(ball.dataset.to);
  const x = from + (to - from) * s;
  if (jump) ball.style.transition = 'none';
  ball.style.transform = `translateX(${x - from}px)`;
  if (jump) {
    // Laid out once at the new place before the slide is given back.
    void ball.getBoundingClientRect();
    ball.style.transition = '';
  }
  for (const d of l.querySelectorAll<SVGCircleElement>('#loader-dots circle')) d.style.opacity = Number(d.getAttribute('cx')) <= x ? '0' : '1';
}

/** Follows the art loading behind the title: the share of its bytes in, and the time left. */
export function loaderArtProgress(p: ArtProgress, jump = false): void {
  loaderProgress(p.share, { jump, secondsLeft: p.secondsLeft });
}

const bootTasks = { script: 0, fonts: 0, art: 0, globe: 0 };
/** Startup checkpoints plus the worker's completed rows/columns. No bake-time estimate is shown. */
export function loaderBootProgress(task: keyof typeof bootTasks, share: number): void {
  bootTasks[task] = Math.max(0, Math.min(1, share));
  loaderProgress(.4 * bootTasks.script + .2 * (bootTasks.fonts + bootTasks.art + bootTasks.globe));
}

/** Keeps the ball still, or lets it chomp and slide again. */
export function loaderStill(still: boolean): void {
  const l = page();
  if (!l) return;
  l.classList.toggle('still', still);
  if (!still) (window as unknown as { loaderChomp?: () => void }).loaderChomp?.();
}

/** The phone notice (index.html): open on a small touch screen until its button is pressed. */
interface PhoneNotice {
  open: boolean;
  onClose: (() => void) | null;
  close(): void;
}

function notice(): PhoneNotice | undefined {
  return (window as unknown as { phoneNotice?: PhoneNotice }).phoneNotice;
}

/** Closes the phone notice and drops the wait for it, for when loading fails and the page must show why. */
export function closeNotice(): void {
  const n = notice();
  if (!n?.open) return;
  n.onClose = null;
  n.close();
}

/** Fades the loading page out; while the phone notice is up, once its button has been pressed. */
/** Whether the loading page is up, fading out included (the phone notice holds it up until pressed). */
export function loaderShowing(): boolean {
  if (typeof document === 'undefined') return false;
  const l = page();
  return !!l && !l.hidden;
}

export function hideLoader(): void {
  const l = page();
  if (!l || l.hidden) return;
  const n = notice();
  if (n?.open) {
    n.onClose = hideLoader;
    return;
  }
  l.classList.remove('again');
  l.classList.add('gone');
  window.setTimeout(() => {
    if (l.classList.contains('gone')) l.hidden = true;
  }, 300);
}

/**
 * Brings the loading page back, over the title, at how far the art has come. It takes taps at once but
 * only fades in after a moment, so a wait that ends quickly does not flash it.
 */
export function showLoader(p: ArtProgress): void {
  const l = page();
  if (!l) return;
  loaderArtProgress(p, true);
  l.hidden = false;
  l.classList.remove('gone');
  l.classList.add('again');
  // The chomping stopped when the page was hidden (index.html); it starts again unless motion is reduced.
  loaderStill(motion.reduced);
}
