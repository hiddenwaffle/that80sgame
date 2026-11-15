/**
 * The browser's own right-click (and long-press) menu stays off the game, so a stray right click doesn't bring it up
 * over play (the owner, 2026-10-23). Text fields keep it: the save code's field is pasted into through that menu.
 */
export function blockContextMenu(target: Pick<EventTarget, 'addEventListener'>): void {
  target.addEventListener('contextmenu', (e) => {
    const el = e.target as { matches?: (selector: string) => boolean } | null;
    if (!el?.matches?.('textarea, input, [contenteditable]')) e.preventDefault();
  });
}
