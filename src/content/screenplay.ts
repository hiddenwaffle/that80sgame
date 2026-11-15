/**
 * Reader for the screenplay files in content/script/.
 *
 *   # A comment
 *   == scene_id ==
 *   Speaker: Text of the line, which may continue
 *     on indented lines (joined with a space).
 *   Speaker [shout]: TEXT WITH A TAG
 *   > Narration, shown in a caption box with no speaker.
 *   [command arg arg]
 *
 * Walks of different people written one after another ([walk ...] lines with
 * nothing between them) start together, as stage directions do.
 *
 * Inside text, {pause 0.5} waits, {br} breaks the line, and {speed 20} changes
 * the typing speed in characters a second. The reader keeps file and line
 * numbers so that mistakes can be reported where they are.
 */

export interface Source {
  file: string;
  line: number;
}

export interface LineStep extends Source {
  kind: 'line';
  /** null for narration. */
  speaker: string | null;
  tags: string[];
  text: string;
}

export interface CommandStep extends Source {
  kind: 'command';
  name: string;
  args: string[];
}

export type Step = LineStep | CommandStep;

export interface Scene extends Source {
  id: string;
  steps: Step[];
}

export interface ContentError extends Source {
  message: string;
}

export interface ParseResult {
  scenes: Map<string, Scene>;
  errors: ContentError[];
}

const SCENE_RE = /^==\s*([A-Za-z0-9_]+)\s*==\s*$/;
const COMMAND_RE = /^\[([a-z_]+)((?:\s+[^\]]*)?)\]\s*$/;
const LINE_RE = /^([^:[\]#>{}]+?)\s*(?:\[([a-z_,\s]+)\])?\s*:\s*(.*)$/;

export function parseScreenplay(file: string, source: string, into?: ParseResult): ParseResult {
  const result: ParseResult = into ?? { scenes: new Map(), errors: [] };
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let scene: Scene | null = null;
  let last: LineStep | null = null;

  const error = (line: number, message: string) => result.errors.push({ file, line, message });

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const indented = /^\s+/.test(raw);
    // An indented # under a line read as a comment and vanished; it was most likely meant as more of the line.
    if (trimmed.startsWith('#') && indented && last) error(n, 'An indented line starting with # is read as a comment and dropped. Put comments at the left margin.');
    if (trimmed === '' || trimmed.startsWith('#')) {
      last = trimmed === '' ? null : last;
      continue;
    }

    // Continuation of the previous line: indented text.
    if (indented && last && !trimmed.startsWith('[') && !trimmed.startsWith('==')) {
      last.text += ' ' + trimmed;
      continue;
    }
    // An indented line with no line before it to continue: a scene's lines start at the left margin. A body indented
    // under its heading ran every line after the first into one balloon (Fable review C7, 2026-11-09).
    if (indented && !last && scene && !trimmed.startsWith('==') && !trimmed.startsWith('[')) error(n, 'This line is indented, but there is no line above it to continue. A scene\'s lines start at the left margin; indent only to continue the line above.');

    const sceneMatch = SCENE_RE.exec(trimmed);
    if (sceneMatch) {
      const id = sceneMatch[1]!;
      const existing = result.scenes.get(id);
      if (existing) error(n, `Scene "${id}" is already defined in ${existing.file} at line ${existing.line}.`);
      scene = { id, steps: [], file, line: n };
      result.scenes.set(id, scene);
      last = null;
      continue;
    }

    if (!scene) {
      error(n, 'Text before the first scene heading. Start the file with a line like "== scene_name ==".');
      continue;
    }

    const cmd = COMMAND_RE.exec(trimmed);
    if (cmd) {
      const args = splitArgs(cmd[2] ?? '');
      scene.steps.push({ kind: 'command', name: cmd[1]!, args, file, line: n });
      last = null;
      continue;
    }

    if (trimmed.startsWith('>')) {
      last = { kind: 'line', speaker: null, tags: [], text: trimmed.slice(1).trim(), file, line: n };
      scene.steps.push(last);
      continue;
    }

    const lm = LINE_RE.exec(trimmed);
    if (lm) {
      const tags = (lm[2] ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      last = { kind: 'line', speaker: lm[1]!.trim(), tags, text: lm[3]!.trim(), file, line: n };
      scene.steps.push(last);
      continue;
    }

    error(n, `Could not read this line. Expected "Speaker: text", "> narration", or "[command]": ${trimmed}`);
    last = null;
  }
  return result;
}

/** Splits command arguments on spaces, keeping "quoted text" together. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]!);
  return out;
}

/** A piece of line text: characters to type, or an inline instruction. */
export type TextPiece = { kind: 'text'; text: string } | { kind: 'pause'; seconds: number } | { kind: 'break' } | { kind: 'speed'; cps: number };

export function parseInline(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  const re = /\{(pause|br|speed)(?:\s+([0-9.]+))?\}/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) out.push({ kind: 'text', text: text.slice(lastIndex, m.index) });
    const tag = m[1]!;
    const num = Number(m[2] ?? '0');
    if (tag === 'pause') out.push({ kind: 'pause', seconds: num || 0.5 });
    else if (tag === 'br') out.push({ kind: 'break' });
    else out.push({ kind: 'speed', cps: num || 60 });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) out.push({ kind: 'text', text: text.slice(lastIndex) });
  return out;
}

/** The text of a line with inline instructions removed ({br} becomes a newline). */
export function plainText(text: string): string {
  return parseInline(text)
    .map((p) => (p.kind === 'text' ? p.text : p.kind === 'break' ? '\n' : ''))
    .join('');
}
