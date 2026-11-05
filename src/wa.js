// Puente de WhatsApp: el servidor actúa como "dispositivo vinculado" (igual que WhatsApp Web)
// y guarda chats y últimos mensajes para servirlos a la BlackBerry como HTML.
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage,
  BufferJSON, normalizeMessageContent, getContentType, Browsers, jidNormalizedUser,
} from '@whiskeysockets/baileys';

const DATA = process.env.DATA_DIR || './data';
const AUTH = path.join(DATA, 'wa-auth');
const STORE = path.join(DATA, 'wa-store.json');
const MAX_MSGS = Number(process.env.WA_MAX_MSGS || 80);
const logger = pino({ level: process.env.WA_LOG || 'warn' });

export const wa = { status: 'iniciando', qr: null, me: null, sock: null, error: null };
const chats = new Map();     // jid -> { id, name, ts, unread }
const msgs = new Map();      // jid -> WAMessage[] (antiguo -> reciente)
const names = new Map();     // jid -> nombre de contacto
let dirty = false;

const SKIP = new Set(['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage',
  'messageContextInfo', 'pollUpdateMessage', 'keepInChatMessage', 'encReactionMessage']);

// ---------- persistencia ----------
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'), BufferJSON.reviver);
    for (const c of raw.chats || []) chats.set(c.id, c);
    for (const [k, v] of raw.msgs || []) msgs.set(k, v);
    for (const [k, v] of raw.names || []) names.set(k, v);
  } catch { /* primer arranque */ }
}
function save() {
  if (!dirty) return;
  dirty = false;
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ chats: [...chats.values()], msgs: [...msgs], names: [...names] }, BufferJSON.replacer));
  fs.renameSync(tmp, STORE);
}
setInterval(() => { try { save(); } catch (e) { logger.error(e, 'save'); } }, 10_000).unref();
process.on('SIGTERM', () => { try { dirty = true; save(); } finally { process.exit(0); } });

// ---------- utilidades de mensajes ----------
export function content(m) {
  const c = normalizeMessageContent(m.message);
  const type = c ? getContentType(c) : null;
  return { c, type };
}

export function describe(m) {
  const { c, type } = content(m);
  if (!c || !type) return null;
  const x = c[type];
  switch (type) {
    case 'conversation': return { kind: 'text', text: c.conversation };
    case 'extendedTextMessage': return { kind: 'text', text: x.text };
    case 'imageMessage': return { kind: 'image', text: x.caption || '', label: 'Foto' };
    case 'videoMessage': return { kind: 'video', text: x.caption || '', label: x.gifPlayback ? 'GIF' : `Vídeo ${x.seconds || ''}s` };
    case 'audioMessage': return { kind: 'audio', text: '', label: `${x.ptt ? 'Nota de voz' : 'Audio'} ${x.seconds || ''}s` };
    case 'stickerMessage': return { kind: 'sticker', text: '', label: 'Sticker' };
    case 'documentMessage': return { kind: 'doc', text: x.caption || '', label: `Documento: ${x.fileName || ''}` };
    case 'locationMessage': return { kind: 'text', text: `📍 Ubicación: https://maps.google.com/?q=${x.degreesLatitude},${x.degreesLongitude}` };
    case 'contactMessage': return { kind: 'text', text: `Contacto: ${x.displayName || ''}` };
    case 'pollCreationMessage': case 'pollCreationMessageV3':
      return { kind: 'text', text: `Encuesta: ${x.name}\n${(x.options || []).map((o) => '- ' + o.optionName).join('\n')}` };
    default: return SKIP.has(type) ? null : { kind: 'text', text: `[${type.replace('Message', '')}]` };
  }
}

export const isGroup = (jid) => jid?.endsWith('@g.us');
export function nameOf(jid) {
  const c = chats.get(jid);
  return c?.name || names.get(jid) || (jid || '').split('@')[0];
}

function chat(jid) {
  let c = chats.get(jid);
  if (!c) { c = { id: jid, name: names.get(jid) || null, ts: 0, unread: 0 }; chats.set(jid, c); }
  return c;
}

function addMessage(m, { notify } = {}) {
  const jid = m.key?.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  if (!describe(m)) return;
  const list = msgs.get(jid) || [];
  const i = list.findIndex((x) => x.key.id === m.key.id);
  if (i >= 0) list[i] = m; else list.push(m);
  list.sort((a, b) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0));
  if (list.length > MAX_MSGS) list.splice(0, list.length - MAX_MSGS);
  msgs.set(jid, list);
  const c = chat(jid);
  c.ts = Math.max(c.ts || 0, Number(m.messageTimestamp || 0));
  if (notify && !m.key.fromMe && i < 0) c.unread = (c.unread || 0) + 1;
  if (!m.key.fromMe && m.pushName && !isGroup(jid) && !names.has(jid)) names.set(jid, m.pushName);
  if (m.key.participant && m.pushName && !names.has(m.key.participant)) names.set(m.key.participant, m.pushName);
  dirty = true;
}

function setContact(ct) {
  const n = ct.name || ct.notify || ct.verifiedName;
  if (ct.id && n) { names.set(ct.id, n); dirty = true; }
}

// ---------- API para las vistas ----------
export function listChats() {
  return [...chats.values()].filter((c) => msgs.get(c.id)?.length || c.unread).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
export const getMessages = (jid) => msgs.get(jid) || [];
export const findMessage = (jid, id) => getMessages(jid).find((m) => m.key.id === id);
export const totalUnread = () => [...chats.values()].reduce((n, c) => n + (c.unread || 0), 0);

export async function markRead(jid) {
  const c = chats.get(jid);
  if (!c?.unread) return;
  const keys = getMessages(jid).filter((m) => !m.key.fromMe).slice(-c.unread).map((m) => m.key);
  c.unread = 0; dirty = true;
  try { if (keys.length) await wa.sock?.readMessages(keys); } catch { /* no crítico */ }
}

const groupLookups = new Set();
export function ensureGroupName(jid) {
  if (!isGroup(jid) || chats.get(jid)?.name || groupLookups.has(jid) || !wa.sock) return;
  groupLookups.add(jid);
  wa.sock.groupMetadata(jid).then((g) => { chat(jid).name = g.subject; dirty = true; }).catch(() => {});
}

export async function sendText(jid, text) {
  if (wa.status !== 'conectado') throw new Error('WhatsApp no está conectado');
  const m = await wa.sock.sendMessage(jid, { text });
  if (m) addMessage(m);
}
export async function sendImage(jid, buffer, caption) {
  if (wa.status !== 'conectado') throw new Error('WhatsApp no está conectado');
  const m = await wa.sock.sendMessage(jid, { image: buffer, caption: caption || undefined });
  if (m) addMessage(m);
}

export function download(m) {
  return downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: wa.sock?.updateMediaMessage });
}

// Normaliza lo que el usuario teclea como destinatario: número con prefijo (34600...) o jid.
export function toJid(s) {
  s = String(s || '').trim();
  if (s.includes('@')) return s;
  const n = s.replace(/[^\d]/g, '');
  return n ? `${n}@s.whatsapp.net` : null;
}

export function logout() {
  try { wa.sock?.logout(); } catch { /* ignore */ }
}

// ---------- conexión ----------
export async function startWhatsApp() {
  fs.mkdirSync(AUTH, { recursive: true });
  if (!chats.size) load();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* usa la versión por defecto */ }

  const sock = makeWASocket({
    auth: state, version, logger, browser: Browsers.ubuntu('BBHub'),
    syncFullHistory: false, markOnlineOnConnect: false, generateHighQualityLinkPreview: false,
    getMessage: async (key) => findMessage(key.remoteJid, key.id)?.message,
  });
  wa.sock = sock;
  wa.status = 'conectando';

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { wa.qr = u.qr; wa.status = 'esperando QR'; }
    if (u.connection === 'open') {
      wa.status = 'conectado'; wa.qr = null; wa.error = null;
      wa.me = sock.user ? jidNormalizedUser(sock.user.id) : null;
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      wa.error = u.lastDisconnect?.error?.message || null;
      if (code === DisconnectReason.loggedOut) {
        // Sesión cerrada desde el móvil: borramos credenciales y pedimos un QR nuevo.
        wa.status = 'sesión cerrada';
        fs.rmSync(AUTH, { recursive: true, force: true });
        chats.clear(); msgs.clear(); dirty = true; save();
      } else {
        wa.status = 'reconectando';
      }
      setTimeout(() => startWhatsApp().catch((e) => { wa.error = e.message; }), code === DisconnectReason.loggedOut ? 1000 : 3000);
    }
  });

  sock.ev.on('messaging-history.set', ({ chats: cs = [], contacts = [], messages = [] }) => {
    contacts.forEach(setContact);
    for (const c of cs) {
      const x = chat(c.id);
      if (c.name) x.name = c.name;
      if (c.conversationTimestamp) x.ts = Math.max(x.ts || 0, Number(c.conversationTimestamp));
      if (typeof c.unreadCount === 'number') x.unread = Math.max(0, c.unreadCount);
    }
    for (const m of messages) addMessage(m);
    dirty = true;
  });
  sock.ev.on('contacts.upsert', (cs) => cs.forEach(setContact));
  sock.ev.on('contacts.update', (cs) => cs.forEach(setContact));
  sock.ev.on('chats.upsert', (cs) => cs.forEach((c) => { const x = chat(c.id); if (c.name) x.name = c.name; dirty = true; }));
  sock.ev.on('chats.update', (cs) => cs.forEach((c) => {
    if (!chats.has(c.id)) return;
    const x = chats.get(c.id);
    if (c.name) x.name = c.name;
    if (typeof c.unreadCount === 'number' && c.unreadCount >= 0) x.unread = c.unreadCount;
    dirty = true;
  }));
  sock.ev.on('groups.update', (gs) => gs.forEach((g) => { if (g.subject && g.id) { chat(g.id).name = g.subject; dirty = true; } }));
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const m of messages) addMessage(m, { notify: type === 'notify' });
  });
}
