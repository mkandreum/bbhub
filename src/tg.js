// Telegram como cliente de usuario (tu cuenta, no un bot) mediante GramJS/MTProto.
// La sesión se guarda en DATA_DIR; los chats y mensajes se piden a Telegram en cada vista.
import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient, Api, utils } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import { computeCheck } from 'telegram/Password.js';

const DATA = process.env.DATA_DIR || './data';
const SESSION_FILE = path.join(DATA, 'tg-session.txt');
const API_ID = Number(process.env.TG_API_ID || 0);
const API_HASH = process.env.TG_API_HASH || '';
const creds = { apiId: API_ID, apiHash: API_HASH };

export const tg = { status: 'iniciando', error: null, me: null, client: null, pending: null };
export const configured = () => !!(API_ID && API_HASH);

const entities = new Map(); // id (string) -> entidad
let dialogCache = { t: 0, list: [] };

function saveSession() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SESSION_FILE, tg.client.session.save(), { mode: 0o600 });
}

export async function startTelegram() {
  if (!configured()) { tg.status = 'sin configurar'; return; }
  let saved = '';
  try { saved = fs.readFileSync(SESSION_FILE, 'utf8').trim(); } catch { /* sin sesión */ }
  const client = new TelegramClient(new StringSession(saved), API_ID, API_HASH, {
    connectionRetries: 10, autoReconnect: true, deviceModel: 'BlackBerry Curve 9300', systemVersion: 'BBHub', appVersion: '2.0',
  });
  client.setLogLevel('error');
  tg.client = client;
  tg.status = 'conectando';
  await client.connect();
  if (await client.checkAuthorization()) await onLoggedIn();
  else tg.status = 'sin sesión';
}

async function onLoggedIn() {
  tg.me = await tg.client.getMe();
  tg.status = 'conectado';
  tg.pending = null;
  tg.error = null;
  saveSession();
}

// ---------- inicio de sesión en tres pasos: teléfono, código y (si hay) contraseña 2FA ----------
export async function sendCode(phone) {
  phone = String(phone || '').replace(/[^\d+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  const r = await tg.client.sendCode(creds, phone);
  tg.pending = { phone, hash: r.phoneCodeHash, viaApp: r.isCodeViaApp };
  tg.status = 'esperando código';
}

export async function signIn(code) {
  if (!tg.pending) throw new Error('Primero pide el código');
  try {
    await tg.client.invoke(new Api.auth.SignIn({
      phoneNumber: tg.pending.phone, phoneCodeHash: tg.pending.hash, phoneCode: String(code).replace(/\D/g, ''),
    }));
  } catch (e) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') { tg.status = 'esperando contraseña'; return 'password'; }
    throw new Error(e.errorMessage === 'PHONE_CODE_INVALID' ? 'Código incorrecto' : e.errorMessage || e.message);
  }
  await onLoggedIn();
  return 'ok';
}

export async function signInPassword(password) {
  const info = await tg.client.invoke(new Api.account.GetPassword());
  try {
    await tg.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(info, String(password)) }));
  } catch (e) {
    throw new Error(e.errorMessage === 'PASSWORD_HASH_INVALID' ? 'Contraseña incorrecta' : e.errorMessage || e.message);
  }
  await onLoggedIn();
}

export async function logout() {
  try { await tg.client.invoke(new Api.auth.LogOut()); } catch { /* ignorar */ }
  fs.rmSync(SESSION_FILE, { force: true });
  entities.clear();
  dialogCache = { t: 0, list: [] };
  try { await tg.client.disconnect(); } catch { /* ignorar */ }
  await startTelegram();
}

// ---------- chats ----------
const fullName = (e) => (e ? e.title || [e.firstName, e.lastName].filter(Boolean).join(' ') || (e.username ? '@' + e.username : '') : '');

export function describe(m) {
  if (!m) return { text: '' };
  if (m.action) return { system: true, text: serviceText(m) };
  let label = null;
  if (m.voice) label = `Nota de voz ${m.voice.attributes?.find((a) => a.duration)?.duration || ''}s`;
  else if (m.videoNote) label = 'Vídeo redondo';
  else if (m.sticker) label = 'Sticker';
  else if (m.gif) label = 'GIF';
  else if (m.photo) label = 'Foto';
  else if (m.video) label = 'Vídeo';
  else if (m.audio) label = `Audio: ${m.file?.title || m.file?.name || ''}`;
  else if (m.document) label = `Archivo: ${m.file?.name || ''}`;
  else if (m.geo) label = 'Ubicación';
  else if (m.poll) label = `Encuesta: ${m.poll.poll.question?.text ?? m.poll.poll.question}`;
  else if (m.contact) label = `Contacto: ${m.contact.firstName}`;
  const kind = m.voice || m.audio ? 'audio' : m.photo || m.sticker ? 'image' : m.document || m.video ? 'file' : m.geo ? 'geo' : null;
  return { text: m.message || '', label, kind };
}

function serviceText(m) {
  const a = m.action?.className || '';
  const map = {
    MessageActionChatAddUser: 'se unió al grupo', MessageActionChatJoinedByLink: 'se unió con enlace',
    MessageActionChatDeleteUser: 'salió del grupo', MessageActionPinMessage: 'fijó un mensaje',
    MessageActionChatEditTitle: `cambió el nombre a «${m.action.title}»`, MessageActionChatEditPhoto: 'cambió la foto',
    MessageActionPhoneCall: 'Llamada', MessageActionChatCreate: 'creó el grupo', MessageActionChannelCreate: 'Canal creado',
  };
  const who = fullName(m.sender);
  return `${who ? who + ' ' : ''}${map[a] || a.replace('MessageAction', '')}`.trim();
}

export async function dialogs({ fresh = false } = {}) {
  if (tg.status !== 'conectado') return [];
  if (!fresh && Date.now() - dialogCache.t < 10_000) return dialogCache.list;
  const ds = await tg.client.getDialogs({ limit: 60, folder: 0 });
  const list = ds.map((d) => {
    const id = d.id.toString();
    if (d.entity) entities.set(id, d.entity);
    const desc = describe(d.message);
    return {
      id, title: d.title || d.name || 'Sin nombre', unread: d.unreadCount, date: d.date, pinned: d.pinned,
      isChannel: d.isChannel && !d.isGroup, isGroup: d.isGroup,
      muted: !!(d.dialog?.notifySettings?.muteUntil && d.dialog.notifySettings.muteUntil > Date.now() / 1000),
      preview: (desc.label ? desc.label + (desc.text ? ': ' : '') : '') + desc.text,
      fromMe: !!d.message?.out, sender: d.isGroup && !d.message?.out ? (d.message?.sender?.firstName || '') : '',
    };
  });
  dialogCache = { t: Date.now(), list };
  return list;
}

export const unreadTotal = () => dialogCache.list.filter((d) => !d.muted).reduce((n, d) => n + d.unread, 0);

async function peer(id) {
  if (entities.has(id)) return entities.get(id);
  await dialogs({ fresh: true });
  if (entities.has(id)) return entities.get(id);
  const e = await tg.client.getEntity(id.startsWith('@') ? id : BigInt(id));
  entities.set(id, e);
  return e;
}

export async function chatInfo(id) {
  const e = await peer(id);
  return { title: fullName(e) || id, isGroup: !!(e.megagroup || e.className === 'Chat'), isChannel: !!(e.broadcast), canWrite: !(e.broadcast && !e.creator && !e.adminRights) };
}

export async function messages(id, { limit = 20, before } = {}) {
  const e = await peer(id);
  const list = await tg.client.getMessages(e, { limit, offsetId: before ? Number(before) : 0 });
  tg.client.markAsRead(e).catch(() => {});
  dialogCache.t = 0;
  return list;
}

// Abre un chat por @usuario o teléfono (si está en tus contactos).
export async function resolve(q) {
  q = String(q || '').trim();
  const e = await tg.client.getEntity(q.startsWith('+') || q.startsWith('@') ? q : '@' + q);
  const id = utils.getPeerId(e).toString();
  entities.set(id, e);
  return id;
}

export async function sendText(id, text, replyTo) {
  await tg.client.sendMessage(await peer(id), { message: text, replyTo: replyTo ? Number(replyTo) : undefined, parseMode: false, linkPreview: false });
  dialogCache.t = 0;
}

export async function sendPhoto(id, buffer, caption) {
  const file = new CustomFile('foto.jpg', buffer.length, '', buffer);
  await tg.client.sendFile(await peer(id), { file, caption: caption || '', forceDocument: false });
  dialogCache.t = 0;
}

export async function getMessage(id, msgId) {
  const [m] = await tg.client.getMessages(await peer(id), { ids: [Number(msgId)] });
  return m;
}

export const download = (m, opts = {}) => tg.client.downloadMedia(m, opts);
