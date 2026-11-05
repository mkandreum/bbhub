import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { page, esc, when, richText } from './layout.js';
import * as W from './wa.js';
import { readPage, search, safeFetch, shrinkImage } from './web.js';
import { feeds, getFeed, getWeather, wmo, aiEnabled, gemini, transcribe } from './extras.js';

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.APP_PASSWORD;
if (!PASSWORD || PASSWORD.length < 6) {
  console.error('APP_PASSWORD es obligatorio (mínimo 6 caracteres)');
  process.exit(1);
}
const TOKEN = crypto.createHash('sha256').update(`${PASSWORD}:bbhub`).digest('hex');
const CITY = process.env.WEATHER_CITY || 'Madrid';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const html = (res, title, body, opts) => res.type('html').set('cache-control', 'no-store').send(page(title, body, opts));

// ---------- acceso ----------
app.get('/api/health', (_req, res) => res.json({ ok: true, whatsapp: W.wa.status }));

function authed(req) {
  const m = /(?:^|;\s*)bb=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(TOKEN));
}
const loginForm = (err) => `${err ? `<div class="err">${esc(err)}</div>` : ''}
<form method="post" action="/login" class="box">Contraseña:<br>
<input class="tx" type="password" name="p"><br><br><input class="bt" type="submit" value="Entrar"></form>`;

app.get('/login', (_req, res) => html(res, 'Entrar', loginForm()));
app.post('/login', wrap(async (req, res) => {
  const ok = crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(req.body.p || '')).digest(),
    crypto.createHash('sha256').update(PASSWORD).digest());
  if (!ok) { await new Promise((r) => setTimeout(r, 1500)); return html(res, 'Entrar', loginForm('Contraseña incorrecta')); }
  res.set('set-cookie', `bb=${TOKEN}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  res.redirect('/');
}));
app.get('/logout', (_req, res) => { res.set('set-cookie', 'bb=; Path=/; Max-Age=0'); res.redirect('/login'); });
app.use((req, res, next) => (authed(req) ? next() : res.redirect('/login')));

// ---------- inicio ----------
app.get('/', (_req, res) => {
  const unread = W.totalUnread();
  html(res, 'Inicio', `
<form action="/go" class="box"><input class="tx" name="q" placeholder="Buscar o escribir web"> <input class="bt" type="submit" value="Ir"></form>
<div class="menu">
<a href="/wa" accesskey="1"><span class="k">1</span>WhatsApp ${unread ? `<span class="badge">${unread}</span>` : ''}<br><span>${esc(W.wa.status)}</span></a>
<a href="/news" accesskey="2"><span class="k">2</span>Noticias<br><span>${feeds.map((f) => esc(f.name)).join(', ')}</span></a>
<a href="/weather" accesskey="3"><span class="k">3</span>Tiempo<br><span>${esc(CITY)}</span></a>
<a href="/ai" accesskey="4"><span class="k">4</span>Asistente IA<br><span>${aiEnabled() ? 'Pregunta lo que quieras, con datos actuales' : 'Falta GEMINI_API_KEY'}</span></a>
<a href="/web?u=${encodeURIComponent('https://es.wikipedia.org/wiki/Wikipedia:Portada')}" accesskey="5"><span class="k">5</span>Wikipedia</a>
</div>
<p class="muted">Pulsa el número en el teclado para ir directo. <a href="/logout">Salir</a></p>`, { refresh: 120 });
});

app.get('/go', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.redirect('/');
  if (/^https?:\/\//i.test(q)) return res.redirect(`/web?u=${encodeURIComponent(q)}`);
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q)) return res.redirect(`/web?u=${encodeURIComponent('https://' + q)}`);
  res.redirect(`/search?q=${encodeURIComponent(q)}`);
});

// ---------- WhatsApp ----------
app.get('/wa', (req, res) => {
  if (W.wa.status !== 'conectado') {
    const body = W.wa.qr
      ? `<div class="box"><b>Vincula WhatsApp</b><br>En tu móvil principal: WhatsApp &gt; Dispositivos vinculados &gt; Vincular dispositivo, y escanea este código (ábrelo en otra pantalla si hace falta).<br><br>
<img src="/wa/qr.png?t=${Date.now()}" width="240" height="240" alt="QR"></div><p class="muted">El código cambia cada ~20 s; esta página se recarga sola.</p>`
      : `<div class="box">Estado: <b>${esc(W.wa.status)}</b>${W.wa.error ? `<br><span class="muted">${esc(W.wa.error)}</span>` : ''}</div>`;
    return html(res, 'WhatsApp', body, { refresh: 15, back: '/' });
  }
  const all = W.listChats();
  const p = Math.max(0, Number(req.query.p) || 0);
  const per = 25;
  const items = all.slice(p * per, p * per + per).map((c) => {
    W.ensureGroupName(c.id);
    const last = W.getMessages(c.id).at(-1);
    const d = last && W.describe(last);
    const prev = d ? (d.label ? `[${d.label}] ` : '') + (d.text || '') : '';
    return `<a class="i" href="/wa/c?j=${encodeURIComponent(c.id)}"><b>${esc(W.nameOf(c.id))} ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</b>
<span>${last?.key.fromMe ? 'Tú: ' : ''}${esc(prev.slice(0, 60))} &middot; ${when(c.ts)}</span></a>`;
  }).join('');
  html(res, 'WhatsApp', `
<div class="nav"><a href="/wa" accesskey="r">Actualizar</a> <a href="/wa/new" accesskey="n">Nuevo chat</a></div>
<div class="list">${items || '<p class="muted">Sincronizando chats... espera un momento.</p>'}</div>
<div class="nav">${p > 0 ? `<a href="/wa?p=${p - 1}">&laquo; Anteriores</a>` : ''} ${all.length > (p + 1) * per ? `<a href="/wa?p=${p + 1}">Más &raquo;</a>` : ''}</div>
<p class="muted">Vinculado como ${esc((W.wa.me || '').split('@')[0])}. <a href="/wa/unlink">Desvincular</a></p>`, { refresh: 60, back: '/' });
});

app.get('/wa/qr.png', wrap(async (_req, res) => {
  if (!W.wa.qr) return res.status(404).end();
  res.type('png').set('cache-control', 'no-store').send(await QRCode.toBuffer(W.wa.qr, { width: 240, margin: 2 }));
}));

app.get('/wa/new', (_req, res) => html(res, 'Nuevo chat', `
<form action="/wa/open" class="box">Número con prefijo de país (ej. 34600111222):<br>
<input class="tx" name="n"><br><br><input class="bt" type="submit" value="Abrir chat"></form>`, { back: '/wa' }));
app.get('/wa/open', (req, res) => {
  const j = W.toJid(req.query.n);
  res.redirect(j ? `/wa/c?j=${encodeURIComponent(j)}` : '/wa/new');
});

function renderMsg(jid, m) {
  const d = W.describe(m);
  if (!d) return '';
  const me = m.key.fromMe;
  const who = me ? 'Tú' : W.isGroup(jid) ? (m.pushName || W.nameOf(m.key.participant)) : W.nameOf(jid);
  const link = `j=${encodeURIComponent(jid)}&amp;id=${encodeURIComponent(m.key.id)}`;
  let media = '';
  if (d.kind === 'image' || d.kind === 'sticker') {
    media = `<a href="/wa/m?${link}&amp;full=1"><img src="/wa/m?${link}" alt="${esc(d.label)}" ${d.kind === 'sticker' ? 'width="96"' : ''}></a><br>`;
  } else if (d.kind === 'audio') {
    media = `[${esc(d.label)}] <a href="/wa/m?${link}">Escuchar</a>${aiEnabled() ? ` &middot; <a href="/wa/t?${link}">Transcribir</a>` : ''}<br>`;
  } else if (d.kind === 'video' || d.kind === 'doc') {
    media = `[${esc(d.label)}] <a href="/wa/m?${link}">Descargar</a><br>`;
  }
  return `<div class="msg ${me ? 'me' : 'them'}"><div class="h"><b>${esc(who)}</b> ${when(m.messageTimestamp)}</div>${media}${richText(d.text)}</div>`;
}

app.get('/wa/c', wrap(async (req, res) => {
  const jid = String(req.query.j || '');
  if (!jid) return res.redirect('/wa');
  W.ensureGroupName(jid);
  await W.markRead(jid);
  const n = Math.min(200, Number(req.query.n) || 20);
  const list = W.getMessages(jid);
  const shown = list.slice(-n).reverse();
  const flash = req.query.e ? `<div class="err">${esc(req.query.e)}</div>` : '';
  html(res, W.nameOf(jid), `${flash}
<form method="post" action="/wa/send" class="box"><input type="hidden" name="j" value="${esc(jid)}">
<textarea name="t" rows="2" accesskey="m"></textarea><br><input class="bt" type="submit" value="Enviar">
<a href="/wa/c?j=${encodeURIComponent(jid)}" accesskey="r">Actualizar</a> &middot; <a href="/wa/photo?j=${encodeURIComponent(jid)}">Enviar foto</a></form>
${shown.map((m) => renderMsg(jid, m)).join('') || '<p class="muted">Sin mensajes todavía.</p>'}
${list.length > n ? `<div class="nav"><a href="/wa/c?j=${encodeURIComponent(jid)}&amp;n=${n + 30}">Ver más antiguos</a></div>` : ''}`, { back: '/wa' });
}));

app.post('/wa/send', wrap(async (req, res) => {
  const jid = String(req.body.j || '');
  const t = String(req.body.t || '').trim();
  try { if (t) await W.sendText(jid, t); }
  catch (e) { return res.redirect(`/wa/c?j=${encodeURIComponent(jid)}&e=${encodeURIComponent(e.message)}`); }
  res.redirect(`/wa/c?j=${encodeURIComponent(jid)}`);
}));

app.get('/wa/photo', (req, res) => html(res, 'Enviar foto', `
<form method="post" action="/wa/photo" enctype="multipart/form-data" class="box">
<input type="hidden" name="j" value="${esc(req.query.j)}">Foto:<br><input type="file" name="f" accept="image/*"><br><br>
Texto (opcional):<br><input class="tx" name="t"><br><br><input class="bt" type="submit" value="Enviar"></form>`, { back: `/wa/c?j=${encodeURIComponent(req.query.j || '')}` }));
app.post('/wa/photo', upload.single('f'), wrap(async (req, res) => {
  const jid = String(req.body.j || '');
  try {
    if (!req.file) throw new Error('No has elegido ninguna foto');
    const img = await sharp(req.file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    await W.sendImage(jid, img, String(req.body.t || '').trim());
  } catch (e) { return res.redirect(`/wa/c?j=${encodeURIComponent(jid)}&e=${encodeURIComponent(e.message)}`); }
  res.redirect(`/wa/c?j=${encodeURIComponent(jid)}`);
}));

// Convierte notas de voz (Opus/OGG) a MP3, que la 9300 sí reproduce.
function toMp3(buf) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '22050', '-b:a', '48k', '-f', 'mp3', 'pipe:1']);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg falló'))));
    ff.stdin.on('error', () => {});
    ff.stdin.end(buf);
  });
}

const mediaCache = new Map(); // pequeñas miniaturas en memoria
app.get('/wa/m', wrap(async (req, res) => {
  const m = W.findMessage(String(req.query.j), String(req.query.id));
  if (!m) return res.status(404).send('No encontrado');
  const { c, type } = W.content(m);
  const x = c[type];
  const key = `${req.query.id}:${req.query.full ? 1 : 0}`;
  if (mediaCache.has(key)) return res.type(mediaCache.get(key).t).send(mediaCache.get(key).b);
  const buf = await W.download(m);
  let out, t;
  if (type === 'imageMessage' || type === 'stickerMessage') {
    out = await shrinkImage(buf, req.query.full ? 480 : (type === 'stickerMessage' ? 96 : 220)); t = 'image/jpeg';
  } else if (type === 'audioMessage') {
    out = await toMp3(buf); t = 'audio/mpeg';
    res.set('content-disposition', `inline; filename="audio-${m.key.id}.mp3"`);
  } else {
    out = buf; t = x.mimetype || 'application/octet-stream';
    res.set('content-disposition', `attachment; filename="${(x.fileName || `${m.key.id}.${t.split('/')[1] || 'bin'}`).replace(/"/g, '')}"`);
  }
  if (out.length < 300_000) {
    mediaCache.set(key, { t, b: out });
    if (mediaCache.size > 200) mediaCache.delete(mediaCache.keys().next().value);
  }
  res.type(t).send(out);
}));

const transcripts = new Map();
app.get('/wa/t', wrap(async (req, res) => {
  const jid = String(req.query.j);
  const m = W.findMessage(jid, String(req.query.id));
  if (!m) return res.status(404).send('No encontrado');
  let text = transcripts.get(m.key.id);
  if (!text) {
    const { c, type } = W.content(m);
    text = await transcribe(await W.download(m), c[type].mimetype);
    transcripts.set(m.key.id, text);
  }
  html(res, 'Transcripción', `<div class="box">${richText(text)}</div>`, { back: `/wa/c?j=${encodeURIComponent(jid)}` });
}));

app.get('/wa/unlink', (_req, res) => html(res, 'Desvincular', `<form method="post" action="/wa/unlink" class="box">
¿Cerrar la sesión de WhatsApp en este servidor? Tendrás que volver a escanear el QR.<br><br><input class="bt" type="submit" value="Sí, desvincular"></form>`, { back: '/wa' }));
app.post('/wa/unlink', (_req, res) => { W.logout(); res.redirect('/wa'); });

// ---------- web ----------
app.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const results = q ? await search(q) : [];
  html(res, q || 'Buscar', `
<form action="/go" class="box"><input class="tx" name="q" value="${esc(q)}"> <input class="bt" type="submit" value="Buscar"></form>
<div class="list">${results.map((r) => `<a class="i" href="/web?u=${encodeURIComponent(r.url)}"><b>${esc(r.title)}</b><span>${esc(r.snippet.slice(0, 160))}<br>${esc(r.url.replace(/^https?:\/\//, '').slice(0, 50))}</span></a>`).join('') || '<p class="muted">Sin resultados.</p>'}</div>`, { back: '/' });
}));

app.get('/web', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  const mode = req.query.mode === 'links' ? 'links' : 'read';
  const images = req.query.img !== '0';
  const p = Math.max(0, Number(req.query.p) || 0);
  let r;
  try { r = await readPage(u, { mode, images }); } catch (e) {
    return html(res, 'Error', `<div class="err">No se pudo abrir la página: ${esc(e.message)}</div><p>${esc(u)}</p>`, { back: '/' });
  }
  if (r.kind === 'image') return res.redirect(`/img?u=${encodeURIComponent(r.url)}&w=480`);
  if (r.kind === 'file') {
    return html(res, 'Archivo', `<div class="box">Tipo: ${esc(r.type)}<br>Tamaño: ${Math.round(r.size / 1024)} KB<br><br><a href="/raw?u=${encodeURIComponent(r.url)}">Descargar a través del servidor</a></div>`, { back: '/' });
  }
  const base = `/web?u=${encodeURIComponent(r.url)}`;
  const opt = (m, im) => `${base}&amp;mode=${m}&amp;img=${im ? 1 : 0}`;
  const nav = r.pages.length > 1
    ? `<div class="nav">Página ${p + 1}/${r.pages.length} ${p > 0 ? `<a href="${opt(mode, images)}&amp;p=${p - 1}" accesskey="a">&laquo; Ant.</a>` : ''} ${p + 1 < r.pages.length ? `<a href="${opt(mode, images)}&amp;p=${p + 1}" accesskey="s">Sig. &raquo;</a>` : ''}</div>` : '';
  html(res, r.title.slice(0, 60), `
<div class="nav muted">${esc(new URL(r.url).hostname)} &middot;
${mode === 'read' ? `<a href="${opt('links', images)}">Solo enlaces</a>` : `<a href="${opt('read', images)}">Modo lectura</a>`} &middot;
${images ? `<a href="${opt(mode, false)}">Sin imágenes</a>` : `<a href="${opt(mode, true)}">Con imágenes</a>`}</div>
<div class="art"><h3>${esc(r.title)}</h3>${r.pages[p] || ''}</div>${nav}`, { back: '/' });
}));

app.get('/img', wrap(async (req, res) => {
  try {
    const r = await safeFetch(String(req.query.u || ''), { accept: 'image/*' });
    const w = Math.min(640, Number(req.query.w) || 300);
    res.type('jpeg').set('cache-control', 'private, max-age=86400').send(await shrinkImage(r.buf, w));
  } catch { res.status(404).end(); }
}));

app.get('/raw', wrap(async (req, res) => {
  const r = await safeFetch(String(req.query.u || ''));
  const name = decodeURIComponent(new URL(r.url).pathname.split('/').pop() || 'archivo').replace(/"/g, '');
  res.type(r.type || 'application/octet-stream').set('content-disposition', `attachment; filename="${name}"`).send(r.buf);
}));

// ---------- noticias ----------
app.get('/news', (_req, res) => html(res, 'Noticias', `<div class="menu">${feeds.map((f, i) => `<a href="/news/${i}" accesskey="${i + 1}"><span class="k">${i + 1}</span>${esc(f.name)}</a>`).join('')}</div>`, { back: '/' }));
app.get('/news/:i', wrap(async (req, res) => {
  const i = Number(req.params.i);
  const items = await getFeed(i);
  html(res, feeds[i].name, `<div class="list">${items.map((it) => `<a class="i" href="/web?u=${encodeURIComponent(it.link)}"><b>${esc(it.title)}</b><span>${it.date ? esc(when(Date.parse(it.date))) + ' &middot; ' : ''}${esc(it.summary)}</span></a>`).join('')}</div>`, { back: '/news' });
}));

// ---------- tiempo ----------
app.get('/weather', wrap(async (req, res) => {
  const city = String(req.query.c || CITY).trim().slice(0, 80);
  let body = `<form action="/weather" class="box"><input class="tx" name="c" value="${esc(city)}"> <input class="bt" type="submit" value="Ver"></form>`;
  try {
    const w = await getWeather(city);
    const c = w.current;
    const hours = w.hourly.time.map((t, k) => `<tr><td>${t.slice(11, 16)}</td><td>${Math.round(w.hourly.temperature_2m[k])}°</td><td>${wmo(w.hourly.weather_code[k])}</td><td>${w.hourly.precipitation_probability[k] ?? '-'}%</td></tr>`).join('');
    const days = w.daily.time.map((t, k) => `<tr><td>${new Date(t).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}</td><td>${Math.round(w.daily.temperature_2m_min[k])}°/${Math.round(w.daily.temperature_2m_max[k])}°</td><td>${wmo(w.daily.weather_code[k])}</td><td>${w.daily.precipitation_probability_max[k] ?? '-'}%</td></tr>`).join('');
    body += `<div class="box"><b>${esc(w.place)}</b><br><span style="font-size:28px;font-weight:bold">${Math.round(c.temperature_2m)}°</span> ${wmo(c.weather_code)}<br>
<span class="muted">Sensación ${Math.round(c.apparent_temperature)}° &middot; Humedad ${c.relative_humidity_2m}% &middot; Viento ${Math.round(c.wind_speed_10m)} km/h</span><br>
<span class="muted">Sol: ${w.daily.sunrise[0].slice(11)} - ${w.daily.sunset[0].slice(11)}</span></div>
<div class="box"><b>Próximas horas</b><table width="100%">${hours}</table></div>
<div class="box"><b>Próximos días</b><table width="100%">${days}</table></div>`;
  } catch (e) { body += `<div class="err">${esc(e.message)}</div>`; }
  html(res, 'Tiempo', body, { back: '/' });
}));

// ---------- asistente IA ----------
const chatAI = []; // [{role, text}]
const aiPage = (res, err) => html(res, 'Asistente', `${err ? `<div class="err">${esc(err)}</div>` : ''}
${aiEnabled() ? '' : '<div class="err">Configura GEMINI_API_KEY en Coolify para activar el asistente.</div>'}
<form method="post" action="/ai" class="box"><textarea name="q" rows="3" accesskey="m"></textarea><br>
<input class="bt" type="submit" value="Preguntar"> <a href="/ai/clear">Nueva conversación</a></form>
${[...chatAI].reverse().map((m) => `<div class="msg ${m.role === 'user' ? 'me' : 'them'}"><div class="h"><b>${m.role === 'user' ? 'Tú' : 'IA'}</b></div>${richText(m.text)}</div>`).join('')}`, { back: '/' });
app.get('/ai', (_req, res) => aiPage(res));
app.get('/ai/clear', (_req, res) => { chatAI.length = 0; res.redirect('/ai'); });
app.post('/ai', wrap(async (req, res) => {
  const q = String(req.body.q || '').trim();
  if (!q) return res.redirect('/ai');
  chatAI.push({ role: 'user', text: q });
  try {
    const contents = chatAI.slice(-20).map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    chatAI.push({ role: 'model', text: await gemini(contents) });
  } catch (e) { chatAI.pop(); return aiPage(res, e.message); }
  if (chatAI.length > 40) chatAI.splice(0, chatAI.length - 40);
  res.redirect('/ai');
}));

// ---------- errores ----------
app.use((err, _req, res, _next) => {
  console.error(err);
  html(res.status(500), 'Error', `<div class="err">${esc(err.message || 'Error interno')}</div>`, { back: '/' });
});

app.listen(PORT, () => console.log(`BBHub escuchando en :${PORT}`));
W.startWhatsApp().catch((e) => { W.wa.status = 'error'; W.wa.error = e.message; console.error(e); });
