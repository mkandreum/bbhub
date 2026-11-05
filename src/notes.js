// Notas guardadas en DATA_DIR/notes.json. Las líneas que empiezan por "[ ]" o "[x]" son tareas marcables.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.join(process.env.DATA_DIR || './data', 'notes.json');
let notes = [];
try { notes = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* vacío */ }

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(notes));
  fs.renameSync(FILE + '.tmp', FILE);
}

export function all(q) {
  const s = String(q || '').toLowerCase();
  return notes
    .filter((n) => !s || n.title.toLowerCase().includes(s) || n.body.toLowerCase().includes(s))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
}
export const get = (id) => notes.find((n) => n.id === id);

export function save({ id, title, body, pinned }) {
  let n = id && get(id);
  if (!n) { n = { id: crypto.randomBytes(5).toString('hex'), created: Date.now() }; notes.push(n); }
  n.title = String(title || '').trim().slice(0, 120) || String(body || '').trim().split('\n')[0].slice(0, 60) || 'Sin título';
  n.body = String(body || '').replace(/\r\n/g, '\n').slice(0, 50_000);
  n.pinned = !!pinned;
  n.updated = Date.now();
  persist();
  return n;
}

export function remove(id) { notes = notes.filter((n) => n.id !== id); persist(); }

export function togglePin(id) { const n = get(id); if (n) { n.pinned = !n.pinned; persist(); } }

// Marca o desmarca la tarea de la línea `line`.
export function toggleTask(id, line) {
  const n = get(id);
  if (!n) return;
  const lines = n.body.split('\n');
  const l = lines[Number(line)];
  if (l === undefined) return;
  lines[Number(line)] = /^\s*\[x\]/i.test(l) ? l.replace(/\[x\]/i, '[ ]') : l.replace(/\[ ?\]/, '[x]');
  n.body = lines.join('\n');
  n.updated = Date.now();
  persist();
}

export function progress(n) {
  const tasks = n.body.split('\n').filter((l) => /^\s*\[( |x)?\]/i.test(l));
  return { total: tasks.length, done: tasks.filter((l) => /^\s*\[x\]/i.test(l)).length };
}
