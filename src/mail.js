// Correo por IMAP (leer) y SMTP (enviar). Con Gmail hace falta una "contraseña de aplicación".
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

const USER = process.env.MAIL_USER || '';
const PASS = process.env.MAIL_PASSWORD || '';
const IMAP_HOST = process.env.MAIL_IMAP_HOST || 'imap.gmail.com';
const IMAP_PORT = Number(process.env.MAIL_IMAP_PORT || 993);
const SMTP_HOST = process.env.MAIL_SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.MAIL_SMTP_PORT || 465);
const FROM_NAME = process.env.MAIL_FROM_NAME || '';

export const mailEnabled = () => !!(USER && PASS);
export const mailUser = USER;

let client = null;
let connecting = null;
let special = null; // { sent, trash }

async function imap() {
  if (client?.usable) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_PORT === 993, auth: { user: USER, pass: PASS }, logger: false, emitLogs: false });
    c.on('error', () => { /* se reconecta en la siguiente petición */ });
    await c.connect();
    if (!special) {
      special = {};
      for (const box of await c.list()) {
        if (box.specialUse === '\\Sent') special.sent = box.path;
        if (box.specialUse === '\\Trash') special.trash = box.path;
      }
    }
    client = c;
    return c;
  })();
  try { return await connecting; } finally { connecting = null; }
}

async function withBox(path, fn) {
  const c = await imap();
  const lock = await c.getMailboxLock(path);
  try { return await fn(c); } finally { lock.release(); }
}

export const folderPath = (f) => (f === 'sent' ? special?.sent || '[Gmail]/Sent Mail' : 'INBOX');

const addr = (a) => (a?.name || a?.address || '').trim();

export async function list(folder = 'inbox', { page = 0, per = 20, q } = {}) {
  await imap();
  return withBox(folderPath(folder), async (c) => {
    let uids;
    if (q) {
      uids = (await c.search({ or: [{ from: q }, { subject: q }, { to: q }] }, { uid: true })) || [];
      uids = uids.sort((a, b) => b - a);
    } else {
      const total = c.mailbox.exists;
      const hi = total - page * per;
      if (hi < 1) return { items: [], total, more: false };
      const lo = Math.max(1, hi - per + 1);
      const items = [];
      for await (const m of c.fetch(`${lo}:${hi}`, { envelope: true, flags: true, uid: true, bodyStructure: true })) items.push(m);
      return { items: items.reverse().map(row), total, more: lo > 1 };
    }
    const slice = uids.slice(page * per, page * per + per);
    const items = [];
    if (slice.length) for await (const m of c.fetch(slice.join(','), { envelope: true, flags: true, uid: true, bodyStructure: true }, { uid: true })) items.push(m);
    items.sort((a, b) => b.uid - a.uid);
    return { items: items.map(row), total: uids.length, more: uids.length > (page + 1) * per };
  });
}

function hasAttachment(s) {
  if (!s) return false;
  if (s.disposition === 'attachment') return true;
  return (s.childNodes || []).some(hasAttachment);
}

function row(m) {
  return {
    uid: m.uid, subject: m.envelope?.subject || '(sin asunto)', date: m.envelope?.date,
    from: addr(m.envelope?.from?.[0]), to: addr(m.envelope?.to?.[0]),
    seen: m.flags?.has('\\Seen'), flagged: m.flags?.has('\\Flagged'), attach: hasAttachment(m.bodyStructure),
  };
}

export async function read(folder, uid) {
  return withBox(folderPath(folder), async (c) => {
    const m = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
    if (!m) throw new Error('Mensaje no encontrado');
    const p = await simpleParser(m.source);
    c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
    return {
      uid, subject: p.subject || '(sin asunto)', date: p.date,
      from: p.from?.value?.[0] || {}, fromText: p.from?.text || '', to: p.to?.text || '', cc: p.cc?.text || '',
      messageId: p.messageId, references: [].concat(p.references || []),
      text: p.text || '', html: p.html || '',
      attachments: (p.attachments || []).map((a, i) => ({ i, name: a.filename || `adjunto-${i + 1}`, type: a.contentType, size: a.size })),
    };
  });
}

export async function attachment(folder, uid, i) {
  return withBox(folderPath(folder), async (c) => {
    const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
    const a = (await simpleParser(m.source)).attachments?.[Number(i)];
    if (!a) throw new Error('Adjunto no encontrado');
    return { name: a.filename || 'adjunto', type: a.contentType, content: a.content };
  });
}

export async function setFlag(folder, uid, flag, on) {
  return withBox(folderPath(folder), (c) => (on ? c.messageFlagsAdd : c.messageFlagsRemove).call(c, String(uid), [flag], { uid: true }));
}

// Mueve a la papelera (no borra definitivamente).
export async function trash(folder, uid) {
  await imap();
  return withBox(folderPath(folder), (c) => c.messageMove(String(uid), special.trash || '[Gmail]/Trash', { uid: true }));
}

const smtp = () => nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: USER, pass: PASS } });

export async function send({ to, cc, subject, text, inReplyTo, references }) {
  if (!to) throw new Error('Falta el destinatario');
  await smtp().sendMail({
    from: FROM_NAME ? { name: FROM_NAME, address: USER } : USER,
    to, cc: cc || undefined, subject: subject || '(sin asunto)', text,
    inReplyTo: inReplyTo || undefined, references: references?.length ? references : undefined,
  });
}

export async function unseen() {
  const c = await imap();
  return (await c.status('INBOX', { unseen: true })).unseen || 0;
}
