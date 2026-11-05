import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import sharp from 'sharp';
import { page, esc, when, hour, richText, avatar, CSS } from './layout.js';
import * as T from './tg.js';
import * as M from './mail.js';
import * as N from './notes.js';
import { readPage, search, safeFetch, shrinkImage, lightHtml, assertPublic } from './web.js';
import { feeds, getFeed, getWeather, wmo, aiEnabled, gemini, transcribe, peek } from './extras.js';
import * as X from './tools.js';

const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || './data';
const PASSWORD = process.env.APP_PASSWORD;
if (!PASSWORD || PASSWORD.length < 6) {
  console.error('APP_PASSWORD es obligatorio (mínimo 6 caracteres)');
  process.exit(1);
}
const TOKEN = crypto.createHash('sha256').update(`${PASSWORD}:bbhub`).digest('hex');
const CITY = process.env.WEATHER_CITY || 'Madrid';
const TZ = process.env.TZ || 'Europe/Madrid';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const html = (res, title, body, opts) => res.type('html').set('cache-control', 'no-store').send(page(title, body, opts));
const q = encodeURIComponent;
const flash = (req) => `${req.query.e ? `<div class="err">${esc(req.query.e)}</div>` : ''}${req.query.ok ? `<div class="ok">${esc(req.query.ok)}</div>` : ''}`;
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------- acceso ----------
app.get('/app.css', (_req, res) => res.type('css').set('cache-control', 'public, max-age=31536000, immutable').send(CSS));
app.get('/api/health', (_req, res) => res.json({ ok: true, telegram: T.tg.status }));

function authed(req) {
  const m = /(?:^|;\s*)bb=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(TOKEN));
}
const loginForm = (err) => `<div class="hello"><b>Hola de nuevo</b>Tu BlackBerry, al día.</div>
${err ? `<div class="err">${esc(err)}</div>` : ''}
<form method="post" action="/login" class="card">Contraseña<br><input class="tx" type="password" name="p"><br><br>
<input class="btn" type="submit" value="Entrar"></form>`;

app.get('/login', (_req, res) => html(res, 'Entrar', loginForm(), { bare: true }));
app.post('/login', wrap(async (req, res) => {
  const ok = crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(req.body.p || '')).digest(),
    crypto.createHash('sha256').update(PASSWORD).digest());
  if (!ok) { await new Promise((r) => setTimeout(r, 1500)); return html(res, 'Entrar', loginForm('Contraseña incorrecta'), { bare: true }); }
  res.set('set-cookie', `bb=${TOKEN}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  res.redirect('/');
}));
app.get('/logout', (_req, res) => { res.set('set-cookie', 'bb=; Path=/; Max-Age=0'); res.redirect('/login'); });

// Enlaces firmados para audio y radio: el reproductor multimedia de la BlackBerry
// puede pedir el archivo sin la cookie del navegador.
const sig = (p) => crypto.createHmac('sha256', TOKEN).update(p).digest('hex').slice(0, 32);
const sign = (p) => `${p}${p.includes('?') ? '&' : '?'}k=${sig(p)}`;
function signedOk(req) {
  const m = /^(.*)[?&]k=([a-f0-9]{32})$/.exec(req.originalUrl);
  return m && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sig(m[1])));
}
app.use((req, res, next) => (authed(req) || signedOk(req) ? next() : res.redirect('/login')));

// ---------- inicio ----------
let mailUnseen = null;
async function refreshCounters() {
  if (T.tg.status === 'conectado') T.dialogs().catch(() => {});
  if (M.mailEnabled()) M.unseen().then((n) => { mailUnseen = n; }).catch(() => {});
  getWeather(CITY).catch(() => {});
}
setInterval(refreshCounters, 120_000).unref();

app.get('/', (_req, res) => {
  refreshCounters();
  const now = new Date();
  const h = Number(now.toLocaleString('es-ES', { hour: 'numeric', hour12: false, timeZone: TZ }));
  const greet = h < 7 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const date = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  const wx = peek(`wx:${CITY.toLowerCase()}`);
  const tgN = T.unreadTotal();
  const notes = N.all();
  const tile = (c, key, href, title, sub, n) => `<div class="tile ${c}"><a href="${href}" accesskey="${key}"><em>${key}</em>${n ? `<span class="n">${n > 99 ? '99+' : n}</span>` : ''}<b>${title}</b><span>${esc(sub)}</span></a></div>`;
  html(res, 'Inicio', `
<div class="hello"><b>${greet}</b>${esc(date)}${wx ? ` &middot; ${Math.round(wx.current.temperature_2m)}° ${esc(wmo(wx.current.weather_code))}` : ''}</div>
<form action="/go" class="pill"><input class="q" name="q" placeholder="Buscar en la web o escribir dirección"><input class="go" type="submit" value="Ir"></form>
<div class="tiles">
${tile('c1', 1, '/tg', 'Telegram', T.configured() ? T.tg.status === 'conectado' ? (tgN ? `${tgN} sin leer` : 'Al día') : T.tg.status : 'Sin configurar', tgN)}
${tile('c6', 2, '/mail', 'Correo', M.mailEnabled() ? (mailUnseen ? `${mailUnseen} sin leer` : M.mailUser) : 'Sin configurar', mailUnseen)}
${tile('c4', 3, '/ai', 'Gemini', aiEnabled() ? 'Pregunta lo que sea' : 'Sin configurar')}
${tile('c3', 4, '/weather', 'Tiempo', wx ? `${CITY}: ${Math.round(wx.daily.temperature_2m_min[0])}°/${Math.round(wx.daily.temperature_2m_max[0])}°` : CITY)}
${tile('c2', 5, '/notes', 'Notas', notes.length ? `${notes.length} nota${notes.length > 1 ? 's' : ''}` : 'Apunta algo')}
${tile('c7', 6, '/maps', 'Mapas', 'Lugares y rutas')}
${tile('c8', 7, '/radio', 'Radio', X.radioFavs().length ? `${X.radioFavs().length} favoritas` : 'Emisoras en directo')}
${tile('c9', 8, '/tr', 'Traductor', 'Cualquier idioma')}
${tile('c5', 9, '/news', 'Noticias', feeds.map((f) => f.name).join(', '))}
</div>
<div class="foot"><a href="/logout">Cerrar sesión</a></div>`, { refresh: 180, bare: true });
});

app.get('/go', (req, res) => {
  const s = String(req.query.q || '').trim();
  if (!s) return res.redirect('/');
  if (/^https?:\/\//i.test(s)) return res.redirect(`/web?u=${q(s)}`);
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return res.redirect(`/web?u=${q('https://' + s)}`);
  res.redirect(`/search?q=${q(s)}`);
});

// ---------- utilidades multimedia ----------
// Convierte notas de voz (Opus/OGG) a MP3, que la 9300 sí reproduce.
function toMp3(buf) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '22050', '-b:a', '48k', '-f', 'mp3', 'pipe:1']);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', () => reject(new Error('ffmpeg no está instalado')));
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('No se pudo convertir el audio'))));
    ff.stdin.on('error', () => {});
    ff.stdin.end(buf);
  });
}
const mediaCache = new Map();
function cacheMedia(key, t, b) {
  if (b.length > 400_000) return;
  mediaCache.set(key, { t, b });
  if (mediaCache.size > 150) mediaCache.delete(mediaCache.keys().next().value);
}

// ---------- Telegram ----------
function tgLogin(req, res) {
  const st = T.tg.status;
  let form;
  if (!T.configured()) {
    form = `<div class="card"><b>Falta configurar Telegram</b><br><span class="muted">Crea una app en my.telegram.org &gt; API development tools y pon <b>TG_API_ID</b> y <b>TG_API_HASH</b> en las variables de Coolify.</span></div>`;
  } else if (st === 'esperando código') {
    form = `<form method="post" action="/tg/code" class="card"><b>Código de verificación</b><br><span class="muted">${T.tg.pending?.viaApp ? 'Te lo ha enviado Telegram a otra sesión abierta (busca el chat «Telegram»).' : 'Te ha llegado por SMS.'}</span><br><br>
<input class="tx" name="c" inputmode="numeric" maxlength="8"><br><br><input class="btn" type="submit" value="Entrar"> <a class="lnk" href="/tg/reset">Cambiar número</a></form>`;
  } else if (st === 'esperando contraseña') {
    form = `<form method="post" action="/tg/password" class="card"><b>Verificación en dos pasos</b><br><span class="muted">Tu cuenta tiene contraseña adicional.</span><br><br>
<input class="tx" type="password" name="p"><br><br><input class="btn" type="submit" value="Entrar"></form>`;
  } else if (st === 'sin sesión') {
    form = `<form method="post" action="/tg/phone" class="card"><b>Inicia sesión en Telegram</b><br><span class="muted">Número con prefijo de país.</span><br><br>
<input class="tx" name="phone" value="+34" inputmode="tel"><br><br><input class="btn" type="submit" value="Enviar código"></form>`;
  } else {
    form = `<div class="card">Estado: <b>${esc(st)}</b>${T.tg.error ? `<br><span class="muted">${esc(T.tg.error)}</span>` : ''}</div>`;
  }
  html(res, 'Telegram', flash(req) + form, { back: '/', refresh: /conectando|iniciando/.test(st) ? 5 : undefined });
}
const tgFail = (res, e) => res.redirect(`/tg?e=${q(e.message)}`);
app.post('/tg/phone', wrap(async (req, res) => { try { await T.sendCode(req.body.phone); res.redirect('/tg'); } catch (e) { tgFail(res, e); } }));
app.post('/tg/code', wrap(async (req, res) => { try { await T.signIn(req.body.c); res.redirect('/tg'); } catch (e) { tgFail(res, e); } }));
app.post('/tg/password', wrap(async (req, res) => { try { await T.signInPassword(req.body.p); res.redirect('/tg'); } catch (e) { tgFail(res, e); } }));
app.get('/tg/reset', (_req, res) => { T.tg.pending = null; T.tg.status = 'sin sesión'; res.redirect('/tg'); });

app.get('/tg', wrap(async (req, res) => {
  if (T.tg.status !== 'conectado') return tgLogin(req, res);
  const filter = String(req.query.v || 'all');
  let list = await T.dialogs({ fresh: !!req.query.r });
  if (filter === 'unread') list = list.filter((d) => d.unread);
  if (filter === 'chats') list = list.filter((d) => !d.isChannel);
  if (filter === 'channels') list = list.filter((d) => d.isChannel);
  const tab = (v, label) => `<a class="lnk" href="/tg?v=${v}"${filter === v ? ' style="background:#168acd;color:#fff"' : ''}>${label}</a>`;
  const rows = list.map((d) => `<a class="row" href="/tg/c?id=${q(d.id)}#end">${avatar(d.title, d.id)}
<span class="tm">${when(d.date)}<br>${d.unread ? `<span class="unr${d.muted ? ' mute' : ''}">${d.unread > 999 ? '999+' : d.unread}</span>` : ''}</span>
<span class="tx"><span class="nm">${esc(d.title)}</span><span class="pv">${d.fromMe ? 'Tú: ' : d.sender ? esc(d.sender) + ': ' : ''}${esc(d.preview.slice(0, 80))}</span></span></a>`).join('');
  html(res, 'Telegram', `${flash(req)}
<div class="nav">${tab('all', 'Todos')}${tab('unread', 'Sin leer')}${tab('chats', 'Chats')}${tab('channels', 'Canales')}<a class="lnk" href="/tg?r=1&amp;v=${filter}" accesskey="r">Actualizar</a><a class="lnk" href="/tg/new">Nuevo</a></div>
<div class="list">${rows || '<div class="row muted">No hay chats aquí.</div>'}</div>
<p class="muted">Conectado como ${esc([T.tg.me?.firstName, T.tg.me?.lastName].filter(Boolean).join(' '))}. <a href="/tg/logout">Cerrar sesión de Telegram</a></p>`, { back: '/', refresh: 60 });
}));

app.get('/tg/new', (req, res) => html(res, 'Nuevo chat', `${flash(req)}<form action="/tg/open" class="card"><b>Abrir chat</b><br>
<span class="muted">@usuario, o teléfono con prefijo si está en tus contactos.</span><br><br><input class="tx" name="u"><br><br><input class="btn" type="submit" value="Abrir"></form>`, { back: '/tg' }));
app.get('/tg/open', wrap(async (req, res) => {
  try { res.redirect(`/tg/c?id=${q(await T.resolve(req.query.u))}#end`); } catch { res.redirect(`/tg/new?e=${q('No encuentro ese usuario')}`); }
}));

function bubble(id, m, info) {
  const d = T.describe(m);
  if (d.system) return `<div class="sys"><span>${esc(d.text)}</span></div>`;
  const link = `id=${q(id)}&amp;m=${m.id}`;
  let media = '';
  if (d.kind === 'image') media = `<a href="/tg/m?${link}&amp;full=1"><img src="/tg/m?${link}" alt="${esc(d.label)}"${m.sticker ? ' width="96"' : ''}></a>`;
  else if (d.kind === 'audio') media = `<span class="media">${esc(d.label)}<br><a href="${esc(sign(`/tg/m?id=${q(id)}&m=${m.id}`))}">Escuchar</a>${aiEnabled() && m.voice ? ` &middot; <a href="/tg/t?${link}">Transcribir</a>` : ''}</span>`;
  else if (d.kind === 'file') media = `<span class="media">${esc(d.label)}<br><a href="/tg/m?${link}">Descargar${m.file?.size ? ` (${kb(Number(m.file.size))})` : ''}</a></span>`;
  else if (d.kind === 'geo') media = `<span class="media"><a href="/web?u=${q(`https://www.openstreetmap.org/?mlat=${m.geo.lat}&mlon=${m.geo.long}#map=16/${m.geo.lat}/${m.geo.long}`)}">Ver ubicación</a></span>`;
  else if (d.label) media = `<span class="media">${esc(d.label)}</span>`;
  const who = !m.out && (info.isGroup) ? `<span class="who">${esc([m.sender?.firstName, m.sender?.lastName].filter(Boolean).join(' ') || m.sender?.title || '')}</span>` : '';
  const canReply = info.canWrite;
  return `<div class="b ${m.out ? 'out' : 'in'}">${who}${media}${richText(d.text)}<span class="t">${canReply ? `<a href="/tg/c?id=${q(id)}&amp;r=${m.id}#end">responder</a> &middot; ` : ''}${hour(m.date)}${m.editDate ? ' &middot; editado' : ''}</span></div>`;
}

app.get('/tg/c', wrap(async (req, res) => {
  if (T.tg.status !== 'conectado') return res.redirect('/tg');
  const id = String(req.query.id || '');
  const info = await T.chatInfo(id);
  const msgs = await T.messages(id, { limit: 25, before: req.query.before });
  const oldest = msgs.at(-1)?.id;
  const replyTo = req.query.r ? msgs.find((m) => String(m.id) === String(req.query.r)) : null;
  const body = [...msgs].reverse().map((m) => bubble(id, m, info)).join('');
  const composer = info.canWrite ? `<form method="post" action="/tg/send" class="comp"><input type="hidden" name="id" value="${esc(id)}">
${replyTo ? `<input type="hidden" name="r" value="${replyTo.id}"><div class="muted">Respondiendo a: ${esc((replyTo.message || T.describe(replyTo).label || '').slice(0, 60))} <a href="/tg/c?id=${q(id)}#end">cancelar</a></div>` : ''}
<textarea name="t" rows="2" accesskey="m" placeholder="Mensaje"></textarea>
<div style="margin-top:5px"><input class="btn" type="submit" value="Enviar"> <a class="lnk" href="/tg/photo?id=${q(id)}">Foto</a> <a class="lnk" href="/tg/c?id=${q(id)}#end" accesskey="r">Actualizar</a></div></form>`
    : `<div class="nav"><a class="lnk" href="/tg/c?id=${q(id)}#end" accesskey="r">Actualizar</a></div>`;
  html(res, info.title, `${flash(req)}
${msgs.length === 25 ? `<div class="nav" style="text-align:center"><a class="lnk" href="/tg/c?id=${q(id)}&amp;before=${oldest}#end">Ver anteriores</a></div>` : ''}
<div class="msgs">${body || '<p class="muted">Sin mensajes.</p>'}</div><a name="end"></a>${composer}`, { back: '/tg' });
}));

app.post('/tg/send', wrap(async (req, res) => {
  const id = String(req.body.id || '');
  const t = String(req.body.t || '').trim();
  try { if (t) await T.sendText(id, t, req.body.r); } catch (e) { return res.redirect(`/tg/c?id=${q(id)}&e=${q(e.errorMessage || e.message)}#end`); }
  res.redirect(`/tg/c?id=${q(id)}#end`);
}));

app.get('/tg/photo', (req, res) => html(res, 'Enviar foto', `<form method="post" action="/tg/photo" enctype="multipart/form-data" class="card">
<input type="hidden" name="id" value="${esc(req.query.id)}"><b>Foto</b><br><input type="file" name="f" accept="image/*"><br><br>
Pie de foto (opcional)<br><input class="tx" name="t"><br><br><input class="btn" type="submit" value="Enviar"></form>`, { back: `/tg/c?id=${q(req.query.id || '')}#end` }));
app.post('/tg/photo', upload.single('f'), wrap(async (req, res) => {
  const id = String(req.body.id || '');
  try {
    if (!req.file) throw new Error('No has elegido ninguna foto');
    const img = await sharp(req.file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    await T.sendPhoto(id, img, String(req.body.t || '').trim());
  } catch (e) { return res.redirect(`/tg/c?id=${q(id)}&e=${q(e.message)}#end`); }
  res.redirect(`/tg/c?id=${q(id)}#end`);
}));

app.get('/tg/m', wrap(async (req, res) => {
  const key = `tg:${req.query.id}:${req.query.m}:${req.query.full ? 1 : 0}`;
  if (mediaCache.has(key)) return res.type(mediaCache.get(key).t).send(mediaCache.get(key).b);
  const m = await T.getMessage(String(req.query.id), req.query.m);
  if (!m?.media) return res.status(404).send('No encontrado');
  if (m.file?.size && Number(m.file.size) > 25 * 1024 * 1024) return res.status(413).send('Archivo demasiado grande para la BlackBerry');
  const buf = await T.download(m);
  if (!buf?.length) return res.status(404).end();
  let out, t;
  if (m.photo || m.sticker) {
    out = await shrinkImage(buf, req.query.full ? 480 : (m.sticker ? 96 : 220)); t = 'image/jpeg';
  } else if (m.voice || m.audio) {
    out = await toMp3(buf); t = 'audio/mpeg';
    res.set('content-disposition', `inline; filename="audio-${m.id}.mp3"`);
  } else {
    out = buf; t = m.file?.mimeType || 'application/octet-stream';
    res.set('content-disposition', `attachment; filename="${(m.file?.name || `archivo-${m.id}`).replace(/"/g, '')}"`);
  }
  cacheMedia(key, t, out);
  res.type(t).send(out);
}));

const transcripts = new Map();
app.get('/tg/t', wrap(async (req, res) => {
  const id = String(req.query.id);
  const k = `${id}:${req.query.m}`;
  if (!transcripts.has(k)) {
    const m = await T.getMessage(id, req.query.m);
    transcripts.set(k, await transcribe(await T.download(m), m.file?.mimeType));
  }
  html(res, 'Transcripción', `<div class="card">${richText(transcripts.get(k))}</div>`, { back: `/tg/c?id=${q(id)}#end` });
}));

app.get('/tg/logout', (_req, res) => html(res, 'Cerrar sesión', `<form method="post" action="/tg/logout" class="card">
¿Cerrar la sesión de Telegram en este servidor? Tendrás que volver a pedir un código.<br><br><input class="btn" type="submit" value="Sí, cerrar sesión"></form>`, { back: '/tg' }));
app.post('/tg/logout', wrap(async (_req, res) => { await T.logout(); res.redirect('/tg'); }));

// ---------- correo ----------
const mailOff = (res) => html(res, 'Correo', `<div class="card"><b>Falta configurar el correo</b><br><span class="muted">Pon <b>MAIL_USER</b> y <b>MAIL_PASSWORD</b> en Coolify. Con Gmail usa una contraseña de aplicación (Cuenta de Google &gt; Seguridad &gt; Contraseñas de aplicaciones).</span></div>`, { back: '/' });

app.get('/mail', wrap(async (req, res) => {
  if (!M.mailEnabled()) return mailOff(res);
  const f = req.query.f === 'sent' ? 'sent' : 'inbox';
  const p = Math.max(0, Number(req.query.p) || 0);
  const s = String(req.query.q || '').trim();
  let r;
  try { r = await M.list(f, { page: p, q: s || undefined }); } catch (e) {
    return html(res, 'Correo', `<div class="err">No puedo conectar con el correo: ${esc(e.message)}</div>`, { back: '/' });
  }
  if (f === 'inbox' && !s && p === 0) mailUnseen = r.items.filter((m) => !m.seen).length || mailUnseen;
  const tab = (v, label) => `<a class="lnk" href="/mail?f=${v}"${f === v ? ' style="background:#168acd;color:#fff"' : ''}>${label}</a>`;
  const rows = r.items.map((m) => {
    const who = f === 'sent' ? `Para: ${m.to}` : m.from;
    return `<a class="row" href="/mail/r?f=${f}&amp;uid=${m.uid}">${avatar(who.replace('Para: ', ''), who)}
<span class="tm">${when(m.date ? new Date(m.date).getTime() : 0)}<br>${m.seen ? '' : '<span class="unr">nuevo</span>'}</span>
<span class="tx"><span class="nm"${m.seen ? ' style="font-weight:normal"' : ''}>${esc(who)}</span><span class="pv"${m.seen ? '' : ' style="color:#1c2733"'}>${m.attach ? '[adjunto] ' : ''}${esc(m.subject)}</span></span></a>`;
  }).join('');
  const more = (n) => `/mail?f=${f}&amp;p=${n}${s ? `&amp;q=${q(s)}` : ''}`;
  html(res, 'Correo', `${flash(req)}
<div class="nav">${tab('inbox', 'Recibidos')}${tab('sent', 'Enviados')}<a class="lnk" href="/mail/new" accesskey="n">Redactar</a><a class="lnk" href="/mail?f=${f}" accesskey="r">Actualizar</a></div>
<form action="/mail" class="pill"><input type="hidden" name="f" value="${f}"><input class="q" name="q" value="${esc(s)}" placeholder="Buscar correo"><input class="go" type="submit" value="Buscar"></form>
<div class="list">${rows || '<div class="row muted">No hay correos.</div>'}</div>
<div class="nav">${p > 0 ? `<a class="lnk" href="${more(p - 1)}">&laquo; Más recientes</a>` : ''}${r.more ? `<a class="lnk" href="${more(p + 1)}">Más antiguos &raquo;</a>` : ''}</div>`, { back: '/' });
}));

app.get('/mail/r', wrap(async (req, res) => {
  if (!M.mailEnabled()) return mailOff(res);
  const f = req.query.f === 'sent' ? 'sent' : 'inbox';
  const uid = Number(req.query.uid);
  const m = await M.read(f, uid);
  if (mailUnseen) mailUnseen = Math.max(0, mailUnseen - 1);
  const images = req.query.img === '1';
  const useHtml = m.html && (req.query.v === 'html' || !m.text.trim());
  const body = useHtml ? lightHtml(m.html, { images }) : richText(m.text.trim());
  const base = `/mail/r?f=${f}&amp;uid=${uid}`;
  const atts = m.attachments.map((a) => `<a class="lnk" href="${esc(sign(`/mail/a?f=${f}&uid=${uid}&i=${a.i}`))}">${esc(a.name)} (${kb(a.size)})</a>`).join('');
  html(res, m.subject, `${flash(req)}
<div class="card"><div style="overflow:hidden">${avatar(m.from.name || m.from.address, m.from.address)}
<div style="margin-left:46px"><b>${esc(m.from.name || m.from.address)}</b><br><span class="muted">${esc(m.from.address || '')}<br>${m.date ? esc(new Date(m.date).toLocaleString('es-ES', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })) : ''}</span></div></div>
<div style="margin-top:6px;font-weight:bold;font-size:15px">${esc(m.subject)}</div>
<span class="muted">Para: ${esc(m.to)}${m.cc ? `<br>CC: ${esc(m.cc)}` : ''}</span></div>
<div class="nav"><a class="lnk" href="/mail/new?reply=${uid}&amp;f=${f}" accesskey="r">Responder</a><a class="lnk" href="/mail/new?reply=${uid}&amp;f=${f}&amp;all=1">Resp. a todos</a><a class="lnk" href="/mail/new?fwd=${uid}&amp;f=${f}">Reenviar</a>
<a class="lnk" href="/mail/unread?f=${f}&amp;uid=${uid}">Marcar no leído</a><a class="lnk" href="/mail/del?f=${f}&amp;uid=${uid}">Papelera</a></div>
${atts ? `<div class="card"><b>Adjuntos</b><br>${atts}</div>` : ''}
${m.html && m.text.trim() ? `<div class="nav">${useHtml ? `<a class="lnk" href="${base}">Ver como texto</a>` : `<a class="lnk" href="${base}&amp;v=html">Ver con formato</a>`}</div>` : ''}
${useHtml && !images ? `<div class="nav"><a class="lnk" href="${base}&amp;v=html&amp;img=1">Mostrar imágenes</a></div>` : ''}
<div class="art">${body || '<span class="muted">(sin contenido)</span>'}</div>`, { back: `/mail?f=${f}` });
}));

app.get('/mail/a', wrap(async (req, res) => {
  const a = await M.attachment(req.query.f === 'sent' ? 'sent' : 'inbox', Number(req.query.uid), req.query.i);
  if (/^image\//.test(a.type) && !req.query.raw) return res.type('jpeg').send(await shrinkImage(a.content, 480));
  if (/^audio\//.test(a.type) && !/mpeg|mp3/.test(a.type)) return res.type('audio/mpeg').send(await toMp3(a.content));
  res.type(a.type || 'application/octet-stream').set('content-disposition', `attachment; filename="${a.name.replace(/"/g, '')}"`).send(a.content);
}));

app.get('/mail/unread', wrap(async (req, res) => {
  const f = req.query.f === 'sent' ? 'sent' : 'inbox';
  await M.setFlag(f, Number(req.query.uid), '\\Seen', false);
  res.redirect(`/mail?f=${f}&ok=${q('Marcado como no leído')}`);
}));
app.get('/mail/del', (req, res) => html(res, 'Papelera', `<form method="post" action="/mail/del" class="card">
<input type="hidden" name="f" value="${esc(req.query.f)}"><input type="hidden" name="uid" value="${esc(req.query.uid)}">
¿Mover este correo a la papelera?<br><br><input class="btn" type="submit" value="Mover a la papelera"></form>`, { back: `/mail/r?f=${q(req.query.f || '')}&uid=${q(req.query.uid || '')}` }));
app.post('/mail/del', wrap(async (req, res) => {
  const f = req.body.f === 'sent' ? 'sent' : 'inbox';
  await M.trash(f, Number(req.body.uid));
  res.redirect(`/mail?f=${f}&ok=${q('Movido a la papelera')}`);
}));

app.get('/mail/new', wrap(async (req, res) => {
  if (!M.mailEnabled()) return mailOff(res);
  const f = req.query.f === 'sent' ? 'sent' : 'inbox';
  let to = String(req.query.to || ''), cc = '', subject = '', body = '', inReplyTo = '', refs = '';
  const src = req.query.reply || req.query.fwd;
  if (src) {
    const m = await M.read(f, Number(src));
    const quote = (m.text || '').trim().slice(0, 4000).split('\n').map((l) => '> ' + l).join('\n');
    const head = `El ${new Date(m.date).toLocaleString('es-ES', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })}, ${m.fromText} escribió:`;
    if (req.query.reply) {
      to = m.from.address || '';
      if (req.query.all) cc = [m.to, m.cc].filter(Boolean).join(', ').split(',').map((x) => x.trim()).filter((x) => x && !x.includes(M.mailUser)).join(', ');
      subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
      body = `\n\n${head}\n${quote}`;
      inReplyTo = m.messageId || '';
      refs = [...m.references, m.messageId].filter(Boolean).join(' ');
    } else {
      subject = /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`;
      body = `\n\n---------- Mensaje reenviado ----------\nDe: ${m.fromText}\nAsunto: ${m.subject}\n\n${(m.text || '').trim().slice(0, 8000)}`;
    }
  }
  html(res, 'Redactar', `${flash(req)}<form method="post" action="/mail/send" class="card">
<input type="hidden" name="irt" value="${esc(inReplyTo)}"><input type="hidden" name="refs" value="${esc(refs)}">
Para<br><input class="tx" name="to" value="${esc(to)}" inputmode="email"><br>
CC<br><input class="tx" name="cc" value="${esc(cc)}"><br>
Asunto<br><input class="tx" name="s" value="${esc(subject)}"><br>
Mensaje<br><textarea name="b" rows="8" accesskey="m">${esc(body)}</textarea><br><br>
<input class="btn" type="submit" value="Enviar"></form>`, { back: '/mail' });
}));
app.post('/mail/send', wrap(async (req, res) => {
  try {
    await M.send({ to: req.body.to, cc: req.body.cc, subject: req.body.s, text: req.body.b,
      inReplyTo: req.body.irt, references: String(req.body.refs || '').split(' ').filter(Boolean) });
  } catch (e) { return res.redirect(`/mail/new?to=${q(req.body.to || '')}&e=${q(e.message)}`); }
  res.redirect(`/mail?ok=${q('Correo enviado')}`);
}));

// ---------- notas ----------
function noteBody(n) {
  return n.body.split('\n').map((l, i) => {
    const t = /^\s*\[( |x)?\]\s?(.*)$/i.exec(l);
    if (!t) return richText(l);
    const done = /x/i.test(t[1] || '');
    return `<a href="/notes/t?id=${n.id}&amp;l=${i}" style="color:${done ? '#9aa8b5' : '#1c2733'};${done ? 'text-decoration:line-through' : ''}"><b style="color:${done ? '#2ba84a' : '#168acd'}">${done ? '[x]' : '[&nbsp;&nbsp;]'}</b> ${esc(t[2])}</a>`;
  }).join('<br>');
}

app.get('/notes', (req, res) => {
  const s = String(req.query.q || '');
  const list = N.all(s);
  const rows = list.map((n) => {
    const p = N.progress(n);
    const prev = n.body.replace(/\[( |x)?\]\s?/gi, '').replace(/\s+/g, ' ').slice(0, 80);
    return `<a class="row" href="/notes/v?id=${n.id}"><span class="tm">${when(n.updated)}${p.total ? `<br><span class="unr${p.done === p.total ? ' mute' : ''}">${p.done}/${p.total}</span>` : ''}</span>
<span class="tx"><span class="nm">${n.pinned ? '<span style="color:#ee7b1c">&#9733;</span> ' : ''}${esc(n.title)}</span><span class="pv">${esc(prev)}</span></span></a>`;
  }).join('');
  html(res, 'Notas', `${flash(req)}
<div class="nav"><a class="lnk" href="/notes/e" accesskey="n" style="background:#168acd;color:#fff">+ Nueva nota</a><a class="lnk" href="/notes/e?list=1">+ Lista de tareas</a></div>
<form action="/notes" class="pill"><input class="q" name="q" value="${esc(s)}" placeholder="Buscar en notas"><input class="go" type="submit" value="Buscar"></form>
<div class="list">${rows || '<div class="row muted">Sin notas todavía.</div>'}</div>`, { back: '/' });
});

app.get('/notes/v', (req, res) => {
  const n = N.get(String(req.query.id));
  if (!n) return res.redirect('/notes');
  const p = N.progress(n);
  html(res, n.title, `${flash(req)}<div class="art"><h3>${n.pinned ? '<span style="color:#ee7b1c">&#9733;</span> ' : ''}${esc(n.title)}</h3>
${p.total ? `<div class="muted" style="margin-bottom:6px">${p.done} de ${p.total} hechas</div>` : ''}${noteBody(n) || '<span class="muted">(vacía)</span>'}
<div class="muted" style="margin-top:8px">Editada ${esc(new Date(n.updated).toLocaleString('es-ES', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }))}</div></div>
<div class="nav"><a class="lnk" href="/notes/e?id=${n.id}" accesskey="e">Editar</a><a class="lnk" href="/notes/pin?id=${n.id}">${n.pinned ? 'Desfijar' : 'Fijar arriba'}</a><a class="lnk" href="/notes/del?id=${n.id}">Borrar</a></div>`, { back: '/notes' });
});

app.get('/notes/e', (req, res) => {
  const n = req.query.id ? N.get(String(req.query.id)) : null;
  const body = n ? n.body : req.query.list ? '[ ] \n[ ] \n[ ] ' : '';
  html(res, n ? 'Editar nota' : 'Nueva nota', `<form method="post" action="/notes/save" class="card">
<input type="hidden" name="id" value="${esc(n?.id || '')}">
Título<br><input class="tx" name="title" value="${esc(n?.title || '')}"><br>
Texto<br><textarea name="body" rows="10" accesskey="m">${esc(body)}</textarea><br>
<label><input type="checkbox" name="pinned" value="1"${n?.pinned ? ' checked' : ''}> Fijar arriba</label><br><br>
<input class="btn" type="submit" value="Guardar"></form>
<p class="muted">Empieza una línea con [ ] para crear una tarea que puedes marcar.</p>`, { back: n ? `/notes/v?id=${n.id}` : '/notes' });
});
app.post('/notes/save', (req, res) => {
  const n = N.save({ id: req.body.id, title: req.body.title, body: req.body.body, pinned: req.body.pinned === '1' });
  res.redirect(`/notes/v?id=${n.id}`);
});
app.get('/notes/t', (req, res) => { N.toggleTask(String(req.query.id), req.query.l); res.redirect(`/notes/v?id=${q(req.query.id || '')}`); });
app.get('/notes/pin', (req, res) => { N.togglePin(String(req.query.id)); res.redirect(`/notes/v?id=${q(req.query.id || '')}`); });
app.get('/notes/del', (req, res) => html(res, 'Borrar nota', `<form method="post" action="/notes/del" class="card"><input type="hidden" name="id" value="${esc(req.query.id)}">
¿Borrar esta nota? No se puede deshacer.<br><br><input class="btn" type="submit" value="Sí, borrar"></form>`, { back: `/notes/v?id=${q(req.query.id || '')}` }));
app.post('/notes/del', (req, res) => { N.remove(String(req.body.id)); res.redirect(`/notes?ok=${q('Nota borrada')}`); });

// ---------- web ----------
app.get('/search', wrap(async (req, res) => {
  const s = String(req.query.q || '').trim();
  const results = s ? await search(s) : [];
  html(res, s || 'Buscar', `
<form action="/go" class="pill"><input class="q" name="q" value="${esc(s)}"><input class="go" type="submit" value="Buscar"></form>
<div class="list">${results.map((r) => `<a class="row" href="/web?u=${q(r.url)}"><span class="nm" style="white-space:normal;color:#168acd">${esc(r.title)}</span><span class="muted">${esc(r.snippet.slice(0, 160))}</span><br><span class="muted" style="color:#2ba84a">${esc(r.url.replace(/^https?:\/\//, '').slice(0, 45))}</span></a>`).join('') || '<div class="row muted">Sin resultados.</div>'}</div>`, { back: '/' });
}));

app.get('/web', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  const mode = req.query.mode === 'links' ? 'links' : 'read';
  const images = req.query.img !== '0';
  const p = Math.max(0, Number(req.query.p) || 0);
  let r;
  try { r = await readPage(u, { mode, images }); } catch (e) {
    return html(res, 'Error', `<div class="err">No se pudo abrir la página: ${esc(e.message)}</div><p class="muted">${esc(u)}</p>`, { back: '/' });
  }
  if (r.kind === 'image') return res.redirect(`/img?u=${q(r.url)}&w=480`);
  if (r.kind === 'file') {
    return html(res, 'Archivo', `<div class="card">Tipo: ${esc(r.type)}<br>Tamaño: ${kb(r.size)}<br><br><a class="btn" href="/raw?u=${q(r.url)}">Descargar</a></div>`, { back: '/' });
  }
  const base = `/web?u=${q(r.url)}`;
  const opt = (m, im) => `${base}&amp;mode=${m}&amp;img=${im ? 1 : 0}`;
  const nav = r.pages.length > 1
    ? `<div class="nav" style="text-align:center">${p > 0 ? `<a class="lnk" href="${opt(mode, images)}&amp;p=${p - 1}" accesskey="a">&laquo; Anterior</a>` : ''} <span class="muted">${p + 1} / ${r.pages.length}</span> ${p + 1 < r.pages.length ? `<a class="lnk" href="${opt(mode, images)}&amp;p=${p + 1}" accesskey="s">Siguiente &raquo;</a>` : ''}</div>` : '';
  html(res, r.title.slice(0, 60), `
<div class="nav"><span class="muted">${esc(new URL(r.url).hostname)}</span><br>
${mode === 'read' ? `<a class="lnk" href="${opt('links', images)}">Solo enlaces</a>` : `<a class="lnk" href="${opt('read', images)}">Modo lectura</a>`}${images ? `<a class="lnk" href="${opt(mode, false)}">Sin imágenes</a>` : `<a class="lnk" href="${opt(mode, true)}">Con imágenes</a>`}${aiEnabled() ? `<a class="lnk" href="/ai/sum?u=${q(r.url)}">Resumir con IA</a>` : ''}</div>
<div class="art"><h3>${esc(r.title)}</h3>${r.pages[p] || ''}</div>${nav}`, { back: '/' });
}));

app.get('/img', wrap(async (req, res) => {
  try {
    const r = await safeFetch(String(req.query.u || ''), { accept: 'image/*' });
    res.type('jpeg').set('cache-control', 'private, max-age=86400').send(await shrinkImage(r.buf, Math.min(640, Number(req.query.w) || 300)));
  } catch { res.status(404).end(); }
}));

app.get('/raw', wrap(async (req, res) => {
  const r = await safeFetch(String(req.query.u || ''));
  const name = decodeURIComponent(new URL(r.url).pathname.split('/').pop() || 'archivo').replace(/"/g, '');
  res.type(r.type || 'application/octet-stream').set('content-disposition', `attachment; filename="${name}"`).send(r.buf);
}));

// ---------- noticias ----------
app.get('/news', (_req, res) => html(res, 'Noticias', `<div class="list">${feeds.map((f, i) => `<a class="row" href="/news/${i}" accesskey="${i + 1}">${avatar(f.name, f.url)}<span class="tx"><span class="nm">${esc(f.name)}</span><span class="pv">Tecla ${i + 1}</span></span></a>`).join('')}</div>`, { back: '/' }));
app.get('/news/:i', wrap(async (req, res) => {
  const i = Number(req.params.i);
  const items = await getFeed(i);
  html(res, feeds[i].name, `<div class="list">${items.map((it) => `<a class="row" href="/web?u=${q(it.link)}"><span class="nm" style="white-space:normal">${esc(it.title)}</span><span class="muted">${it.date ? esc(when(Date.parse(it.date))) + ' &middot; ' : ''}${esc(it.summary.slice(0, 140))}</span></a>`).join('')}</div>`, { back: '/news' });
}));

// ---------- tiempo ----------
app.get('/weather', wrap(async (req, res) => {
  const city = String(req.query.c || CITY).trim().slice(0, 80);
  let body = `<form action="/weather" class="pill"><input class="q" name="c" value="${esc(city)}"><input class="go" type="submit" value="Ver"></form>`;
  try {
    const w = await getWeather(city);
    const c = w.current;
    const hours = w.hourly.time.map((t, k) => `<tr><td>${t.slice(11, 16)}</td><td><b>${Math.round(w.hourly.temperature_2m[k])}°</b></td><td>${wmo(w.hourly.weather_code[k])}</td><td class="muted">${w.hourly.precipitation_probability[k] ?? '-'}%</td></tr>`).join('');
    const days = w.daily.time.map((t, k) => `<tr><td>${k === 0 ? 'Hoy' : new Date(t).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}</td><td><b>${Math.round(w.daily.temperature_2m_max[k])}°</b> <span class="muted">${Math.round(w.daily.temperature_2m_min[k])}°</span></td><td>${wmo(w.daily.weather_code[k])}</td><td class="muted">${w.daily.precipitation_probability_max[k] ?? '-'}%</td></tr>`).join('');
    body += `<div class="card" style="background:#139a87;background:-webkit-gradient(linear,left top,left bottom,from(#26c6b0),to(#139a87));background:linear-gradient(#26c6b0,#139a87);color:#fff">
<span style="font-size:12px;opacity:.85">${esc(w.place)}</span><br><span class="big">${Math.round(c.temperature_2m)}°</span> <b>${wmo(c.weather_code)}</b><br>
<span style="font-size:12px;opacity:.9">Sensación ${Math.round(c.apparent_temperature)}° &middot; Humedad ${c.relative_humidity_2m}% &middot; Viento ${Math.round(c.wind_speed_10m)} km/h<br>Sol ${w.daily.sunrise[0].slice(11)} - ${w.daily.sunset[0].slice(11)}</span></div>
<div class="card"><b>Próximas horas</b><table class="t">${hours}</table></div>
<div class="card"><b>Próximos días</b><table class="t">${days}</table></div>`;
  } catch (e) { body += `<div class="err">${esc(e.message)}</div>`; }
  html(res, 'Tiempo', body, { back: '/' });
}));

// ---------- Gemini ----------
const AI_FILE = path.join(DATA, 'ai.json');
let chatAI = [];
try { chatAI = JSON.parse(fs.readFileSync(AI_FILE, 'utf8')); } catch { /* vacío */ }
const saveAI = () => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(AI_FILE, JSON.stringify(chatAI)); } catch { /* no crítico */ } };

const CHIPS = ['Resumen de las noticias de hoy', '¿Qué tiempo hará este fin de semana?', 'Resultados de fútbol de hoy', 'Dame una receta rápida para cenar'];
const aiPage = (res, err) => html(res, 'Gemini', `${err ? `<div class="err">${esc(err)}</div>` : ''}
${aiEnabled() ? '' : '<div class="err">Configura GEMINI_API_KEY en Coolify para activar el asistente.</div>'}
<div class="msgs">${chatAI.map((m) => `<div class="b ${m.role === 'user' ? 'out' : 'in'}">${m.role === 'user' ? '' : '<span class="who" style="color:#7442c8">Gemini</span>'}${richText(m.text)}</div>`).join('')}</div>
${chatAI.length ? '' : `<div class="card"><b>Pregunta lo que quieras</b><br><span class="muted">Busca en Google para darte información actual.</span><br><br>${CHIPS.map((c) => `<a class="lnk" href="/ai/ask?q=${q(c)}">${esc(c)}</a>`).join(' ')}</div>`}
<a name="end"></a><form method="post" action="/ai" class="comp"><textarea name="q" rows="2" accesskey="m" placeholder="Escribe tu pregunta"></textarea>
<div style="margin-top:5px"><input class="btn" type="submit" value="Preguntar"> ${chatAI.length ? '<a class="lnk" href="/ai/clear">Nueva conversación</a>' : ''}</div></form>`, { back: '/' });

async function askAI(question) {
  chatAI.push({ role: 'user', text: question });
  try {
    const contents = chatAI.slice(-20).map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    chatAI.push({ role: 'model', text: await gemini(contents) });
  } catch (e) { chatAI.pop(); throw e; }
  if (chatAI.length > 40) chatAI.splice(0, chatAI.length - 40);
  saveAI();
}
app.get('/ai', (_req, res) => aiPage(res));
app.get('/ai/clear', (_req, res) => { chatAI = []; saveAI(); res.redirect('/ai'); });
app.post('/ai', wrap(async (req, res) => {
  const s = String(req.body.q || '').trim();
  if (!s) return res.redirect('/ai#end');
  try { await askAI(s); } catch (e) { return aiPage(res, e.message); }
  res.redirect('/ai#end');
}));
app.get('/ai/ask', wrap(async (req, res) => {
  try { await askAI(String(req.query.q || '').slice(0, 500)); } catch (e) { return aiPage(res, e.message); }
  res.redirect('/ai#end');
}));
app.get('/ai/sum', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  let text;
  try {
    const r = await readPage(u, { images: false });
    const plain = (r.pages || []).join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 30000);
    text = await gemini([{ role: 'user', parts: [{ text: `Resume en 5-8 puntos breves este texto de ${u}:\n\n${plain}` }] }], { search: false });
  } catch (e) { text = `No se pudo resumir: ${e.message}`; }
  html(res, 'Resumen', `<div class="card"><span class="who" style="color:#7442c8;font-weight:bold">Resumen con Gemini</span><br>${richText(text)}</div>
<div class="nav"><a class="lnk" href="/web?u=${q(u)}">Leer completo</a></div>`, { back: `/web?u=${q(u)}` });
}));

// ---------- mapas ----------
const ll = (s) => { const [a, b] = String(s || '').split(',').map(Number); return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lon: b } : null; };
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const fmtTime = (s) => { const h = Math.floor(s / 3600), mi = Math.round((s % 3600) / 60); return h ? `${h} h ${mi} min` : `${mi} min`; };
const MODES = { car: 'Coche', foot: 'A pie', bike: 'Bici' };

function routeForm(from = '', to = '', mode = 'car') {
  return `<form action="/maps/route" class="card"><b>Cómo llegar</b><br>
Desde<br><input class="tx" name="from" value="${esc(from)}" placeholder="Dirección o lugar"><br>
Hasta<br><input class="tx" name="to" value="${esc(to)}" placeholder="Dirección o lugar"><br>
<select name="mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${k === mode ? ' selected' : ''}>${v}</option>`).join('')}</select>
<input class="btn" type="submit" value="Ver ruta"></form>`;
}

app.get('/maps', wrap(async (req, res) => {
  const s = String(req.query.q || '').trim();
  let body = `<form action="/maps" class="pill"><input class="q" name="q" value="${esc(s)}" placeholder="Buscar lugar o dirección"><input class="go" type="submit" value="Buscar"></form>`;
  if (s) {
    let results = [];
    try { results = await X.geocode(s); } catch (e) { body += `<div class="err">${esc(e.message)}</div>`; }
    if (results.length === 1) return res.redirect(`/maps/v?lat=${results[0].lat}&lon=${results[0].lon}&n=${q(results[0].short || results[0].name)}`);
    body += `<div class="list">${results.map((r) => `<a class="row" href="/maps/v?lat=${r.lat}&amp;lon=${r.lon}&amp;n=${q(r.short || r.name)}"><span class="nm">${esc(r.short || r.name)}</span><span class="pv">${esc(r.name)}</span></a>`).join('') || '<div class="row muted">No encuentro ese lugar.</div>'}</div>`;
  } else {
    body += routeForm();
  }
  html(res, 'Mapas', body, { back: '/' });
}));

app.get('/maps/v', (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon), z = X.clampZ(req.query.z || 16);
  const n = String(req.query.n || '');
  const mk = req.query.mk ? ll(req.query.mk) : { lat, lon };
  const mkp = `&amp;mk=${mk.lat},${mk.lon}&amp;n=${q(n)}`;
  const at = (p, zz = z) => `/maps/v?lat=${p.lat.toFixed(6)}&amp;lon=${p.lon.toFixed(6)}&amp;z=${zz}${mkp}`;
  const mv = (d) => at(X.pan(lat, lon, z, d));
  html(res, n || 'Mapa', `
<div class="card" style="padding:4px"><img src="/maps/img?lat=${lat}&amp;lon=${lon}&amp;z=${z}&amp;mk=${mk.lat},${mk.lon}" width="100%" alt="Mapa" style="display:block;-webkit-border-radius:8px;border-radius:8px">
<table width="100%" style="margin-top:4px;text-align:center"><tr>
<td><a class="lnk" href="${at({ lat, lon }, X.clampZ(z + 1))}" accesskey="i">+ Acercar</a></td><td><a class="lnk" href="${mv('n')}" accesskey="t">&#9650;</a></td><td><a class="lnk" href="${at({ lat, lon }, X.clampZ(z - 1))}" accesskey="o">- Alejar</a></td></tr><tr>
<td><a class="lnk" href="${mv('w')}" accesskey="f">&#9664;</a></td><td><a class="lnk" href="${at(mk)}">Centrar</a></td><td><a class="lnk" href="${mv('e')}" accesskey="h">&#9654;</a></td></tr><tr>
<td></td><td><a class="lnk" href="${mv('s')}" accesskey="b">&#9660;</a></td><td></td></tr></table></div>
${n ? `<div class="card"><b>${esc(n)}</b><br><span class="muted">${mk.lat.toFixed(5)}, ${mk.lon.toFixed(5)}</span></div>` : ''}
${routeForm('', `${mk.lat.toFixed(6)},${mk.lon.toFixed(6)}`)}
<p class="muted">Teclas: I acercar, O alejar, T/B/F/H mover.</p>`, { back: '/maps' });
});

app.get('/maps/img', wrap(async (req, res) => {
  const mk = ll(req.query.mk);
  const img = await X.renderMap({ lat: Number(req.query.lat), lon: Number(req.query.lon), z: req.query.z, markers: mk ? [mk] : [] });
  res.type('jpeg').set('cache-control', 'private, max-age=3600').send(img);
}));

async function pickPlace(s) {
  const r = await X.geocode(s);
  if (!r.length) throw new Error(`No encuentro «${s}»`);
  return r[0];
}
app.get('/maps/route', wrap(async (req, res) => {
  const from = String(req.query.from || '').trim(), to = String(req.query.to || '').trim();
  const mode = MODES[req.query.mode] ? req.query.mode : 'car';
  if (!from || !to) return html(res, 'Ruta', `<div class="err">Escribe origen y destino.</div>${routeForm(from, to, mode)}`, { back: '/maps' });
  let a, b, r;
  try { a = await pickPlace(from); b = await pickPlace(to); r = await X.route(a, b, mode); } catch (e) {
    return html(res, 'Ruta', `<div class="err">${esc(e.message)}</div>${routeForm(from, to, mode)}`, { back: '/maps' });
  }
  const modes = Object.entries(MODES).map(([k, v]) => `<a class="lnk" href="/maps/route?from=${q(from)}&amp;to=${q(to)}&amp;mode=${k}"${k === mode ? ' style="background:#168acd;color:#fff"' : ''}>${v}</a>`).join('');
  html(res, 'Ruta', `<div class="nav">${modes}</div>
<div class="card" style="padding:4px"><img src="/maps/rimg?f=${a.lat},${a.lon}&amp;t=${b.lat},${b.lon}&amp;mode=${mode}" width="100%" alt="Ruta" style="display:block;-webkit-border-radius:8px;border-radius:8px"></div>
<div class="card"><span class="big" style="font-size:26px">${fmtTime(r.duration)}</span> <b>${fmtKm(r.distance)}</b><br>
<span class="muted">De: ${esc(a.short || a.name)}<br>A: ${esc(b.short || b.name)}</span></div>
<div class="list">${r.steps.map((s, i) => `<div class="row"><span class="tm">${s.distance ? fmtKm(s.distance) : ''}</span><span class="tx"><b style="color:#168acd">${i + 1}.</b> ${esc(s.text)}</span></div>`).join('')}</div>`, { back: '/maps' });
}));
app.get('/maps/rimg', wrap(async (req, res) => {
  const a = ll(req.query.f), b = ll(req.query.t);
  const r = await X.route(a, b, MODES[req.query.mode] ? req.query.mode : 'car');
  const v = X.fit(r.line);
  const img = await X.renderMap({ ...v, line: r.line, markers: [{ ...a, color: '#2ba84a', label: 'A' }, { ...b, color: '#e53935', label: 'B' }] });
  res.type('jpeg').set('cache-control', 'private, max-age=3600').send(img);
}));

// ---------- traductor ----------
function trPage(res, { text = '', to = 'en', out = '', err = '' } = {}) {
  html(res, 'Traductor', `${err ? `<div class="err">${esc(err)}</div>` : ''}
<form method="post" action="/tr" class="card"><textarea name="t" rows="4" accesskey="m" placeholder="Escribe o pega el texto">${esc(text)}</textarea><br>
Traducir a <select name="to">${Object.entries(X.LANGS).map(([k, v]) => `<option value="${k}"${k === to ? ' selected' : ''}>${v}</option>`).join('')}</select>
<input class="btn" type="submit" value="Traducir"></form>
${out ? `<div class="card" style="border-left:4px solid #ef5d7a"><span class="muted">${esc(X.LANGS[to])}</span><br>${richText(out)}</div>
<form method="post" action="/tr" class="nav"><input type="hidden" name="t" value="${esc(out)}"><input type="hidden" name="to" value="es"><input class="btn" type="submit" value="Traducir al español"></form>` : ''}
<p class="muted">${aiEnabled() ? 'Traducción con Gemini.' : 'Traducción con MyMemory (máx. 500 caracteres). Con GEMINI_API_KEY traduce textos largos y mejor.'}</p>`, { back: '/' });
}
app.get('/tr', (req, res) => trPage(res, { to: String(req.query.to || 'en') }));
app.post('/tr', wrap(async (req, res) => {
  const text = String(req.body.t || ''), to = String(req.body.to || 'en');
  try { trPage(res, { text, to, out: await X.translate(text, to) }); } catch (e) { trPage(res, { text, to, err: e.message }); }
}));

// ---------- radio ----------
const TAGS = ['pop', 'rock', 'news', 'talk', 'dance', 'jazz', 'classical', 'flamenco', 'sports', '80s'];
const stationRow = (s) => `<a class="row" href="/radio/p?id=${q(s.id)}">${avatar(s.name, s.id)}<span class="tm">${s.bitrate ? `${s.bitrate}k` : ''}</span>
<span class="tx"><span class="nm">${X.isFav(s.id) ? '<span style="color:#ee7b1c">&#9733;</span> ' : ''}${esc(s.name)}</span><span class="pv">${esc([s.country, (s.tags || '').split(',').slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</span></span></a>`;

app.get('/radio', wrap(async (req, res) => {
  const s = String(req.query.q || '').trim(), tag = String(req.query.tag || '');
  let list = [], err = '';
  try { list = await X.radioSearch({ q: s || undefined, tag: tag || undefined, country: tag ? '' : 'ES' }); } catch (e) { err = e.message; }
  const favs = X.radioFavs();
  html(res, 'Radio', `${err ? `<div class="err">No se pudo cargar la lista: ${esc(err)}</div>` : ''}
<form action="/radio" class="pill"><input class="q" name="q" value="${esc(s)}" placeholder="Buscar emisora"><input class="go" type="submit" value="Buscar"></form>
<div class="nav">${TAGS.map((t) => `<a class="lnk" href="/radio?tag=${t}"${t === tag ? ' style="background:#168acd;color:#fff"' : ''}>${t}</a>`).join('')}</div>
${favs.length && !s && !tag ? `<b class="muted">Favoritas</b><div class="list">${favs.map(stationRow).join('')}</div>` : ''}
<b class="muted">${s ? 'Resultados' : tag ? `Género: ${esc(tag)}` : 'Más escuchadas en España'}</b>
<div class="list">${list.map(stationRow).join('') || '<div class="row muted">Sin emisoras.</div>'}</div>`, { back: '/' });
}));

app.get('/radio/p', wrap(async (req, res) => {
  const st = await X.radioStation(String(req.query.id));
  const stream = (br) => esc(sign(`/radio/s?id=${q(st.id)}&br=${br}`));
  html(res, st.name, `<div class="card" style="text-align:center">${avatar(st.name, st.id)}<br><b style="font-size:16px">${esc(st.name)}</b><br>
<span class="muted">${esc((st.tags || '').split(',').slice(0, 4).join(', '))}</span><br><br>
<a class="btn" href="${stream(64)}" accesskey="p">&#9654; Escuchar</a><br><br>
<a class="lnk" href="${stream(32)}">Calidad baja (3G)</a><a class="lnk" href="${esc(sign(`/radio/m3u?id=${q(st.id)}`))}">Abrir como lista .m3u</a></div>
<div class="nav"><a class="lnk" href="/radio/fav?id=${q(st.id)}">${X.isFav(st.id) ? 'Quitar de favoritas' : '&#9733; Añadir a favoritas'}</a></div>
<p class="muted">El servidor convierte la emisión a MP3 para que la BlackBerry la reproduzca. Si no suena, prueba «Abrir como lista».</p>`, { back: '/radio' });
}));

app.get('/radio/fav', wrap(async (req, res) => {
  X.toggleFav(await X.radioStation(String(req.query.id)));
  res.redirect(`/radio/p?id=${q(req.query.id || '')}`);
}));

app.get('/radio/m3u', wrap(async (req, res) => {
  const st = await X.radioStation(String(req.query.id));
  const url = `${req.protocol}://${req.get('host')}${sign(`/radio/s?id=${q(st.id)}&br=64`)}`;
  res.type('audio/x-mpegurl').set('content-disposition', 'inline; filename="radio.m3u"').send(`#EXTM3U\n#EXTINF:-1,${st.name}\n${url}\n`);
}));

app.get('/radio/s', wrap(async (req, res) => {
  const st = await X.radioStation(String(req.query.id));
  await assertPublic(new URL(st.url));
  const br = Math.max(24, Math.min(128, Number(req.query.br) || 64));
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'http,https,tcp,tls,crypto,hls',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-user_agent', 'BBHub/2.0',
    '-i', st.url, '-vn', '-ac', br <= 48 ? '1' : '2', '-ar', br <= 48 ? '22050' : '44100', '-b:a', `${br}k`, '-f', 'mp3', 'pipe:1']);
  ff.on('error', () => { if (!res.headersSent) res.status(500).send('ffmpeg no está instalado'); });
  res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'icy-name': encodeURIComponent(st.name) });
  ff.stdout.pipe(res);
  req.on('close', () => ff.kill('SIGKILL'));
}));

// ---------- errores ----------
app.use((err, _req, res, _next) => {
  console.error(err);
  html(res.status(500), 'Error', `<div class="err">${esc(err.errorMessage || err.message || 'Error interno')}</div>`, { back: '/' });
});

app.listen(PORT, () => console.log(`BBHub escuchando en :${PORT}`));
T.startTelegram().catch((e) => { T.tg.status = 'error'; T.tg.error = e.message; console.error(e); });
refreshCounters();
