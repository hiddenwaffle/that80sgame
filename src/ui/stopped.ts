/**
 * The page a failed game step leaves up: what happened, that progress up to the last autosave is kept, and Reload. Plain
 * page markup over the game (styled in index.html, #game-stopped), since the game itself has stopped drawing.
 */
export function showStopped(words: { title: string; text: string; reload: string }): void {
  if (document.getElementById('game-stopped')) return;
  const page = document.createElement('div');
  page.id = 'game-stopped';
  page.setAttribute('role', 'alertdialog');
  page.setAttribute('aria-labelledby', 'game-stopped-title');
  page.setAttribute('aria-describedby', 'game-stopped-text');
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const title = document.createElement('h1');
  title.id = 'game-stopped-title';
  title.textContent = words.title;
  const text = document.createElement('p');
  text.id = 'game-stopped-text';
  text.textContent = words.text;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = words.reload;
  reload.addEventListener('click', () => location.reload());
  sheet.append(title, text, reload);
  page.append(sheet);
  document.body.append(page);
  reload.focus();
}
