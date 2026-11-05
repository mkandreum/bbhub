// Noticias (RSS), tiempo (Open-Meteo, sin clave) y asistente IA (Gemini, opcional).
import { XMLParser } from 'fast-xml-parser';
import { safeFetch } from './web.js';

// ---------- noticias ----------
const DEFAULT_FEEDS = [
  'El País|https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada',
  '20minutos|https://www.20minutos.es/rss/',
  'Xataka|https://www.xataka.com/feedburner.xml',
].join(',');
export const feeds = (process.env.NEWS_FEEDS || DEFAULT_FEEDS).split(',').map((s) => {
  const [name, url] = s.split('|');
  return { name: name.trim(), url: (url || '').trim() };
}).filter((f) => f.url);

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const txt = (v) => (typeof v === 'object' ? v?.['#text'] ?? '' : v ?? '').toString().replace(/<[^>]+>/g, '').trim();

export function getFeed(i) {
  const f = feeds[i];
  if (!f) throw new Error('Fuente no encontrada');
  return cached(`feed:${i}`, 10 * 60_000, async () => {
    const r = await safeFetch(f.url, { accept: 'application/rss+xml,application/xml,*/*' });
    const doc = xml.parse(r.buf.toString('utf8'));
    let items = doc?.rss?.channel?.item || doc?.feed?.entry || [];
    if (!Array.isArray(items)) items = [items];
    return items.slice(0, 40).map((it) => ({
      title: txt(it.title),
      link: typeof it.link === 'string' ? it.link : (Array.isArray(it.link) ? it.link[0]?.href : it.link?.href) || txt(it.guid),
      date: it.pubDate || it.updated || it.published || '',
      summary: txt(it.description || it.summary).slice(0, 220),
    }));
  });
}

// ---------- tiempo ----------
const WMO = {
  0: 'Despejado', 1: 'Casi despejado', 2: 'Parcialmente nuboso', 3: 'Nublado', 45: 'Niebla', 48: 'Niebla helada',
  51: 'Llovizna débil', 53: 'Llovizna', 55: 'Llovizna intensa', 61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia fuerte',
  66: 'Lluvia helada', 67: 'Lluvia helada fuerte', 71: 'Nieve débil', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Granizo fino',
  80: 'Chubascos débiles', 81: 'Chubascos', 82: 'Chubascos fuertes', 85: 'Chubascos de nieve', 86: 'Nevadas fuertes',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta fuerte con granizo',
};
export const wmo = (c) => WMO[c] || '—';

export function getWeather(city) {
  return cached(`wx:${city.toLowerCase()}`, 15 * 60_000, async () => {
    const g = JSON.parse((await safeFetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(city)}`)).buf);
    const p = g.results?.[0];
    if (!p) throw new Error(`No encuentro "${city}"`);
    const q = new URLSearchParams({
      latitude: p.latitude, longitude: p.longitude, timezone: 'auto', forecast_days: '6',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation',
      hourly: 'temperature_2m,weather_code,precipitation_probability', forecast_hours: '12',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    });
    const w = JSON.parse((await safeFetch(`https://api.open-meteo.com/v1/forecast?${q}`)).buf);
    return { place: [p.name, p.admin1, p.country].filter(Boolean).join(', '), ...w };
  });
}

// ---------- IA (Gemini con búsqueda en Google para información actual) ----------
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
export const aiEnabled = () => !!GEMINI_KEY;

const SYSTEM = 'Eres un asistente que responde en una BlackBerry antigua con pantalla de 320x240. '
  + 'Responde en español, en texto plano sin Markdown (nada de asteriscos ni almohadillas), breve y directo. '
  + 'Usa listas con guiones si hace falta. Hoy es ' + new Date().toISOString().slice(0, 10) + '.';

export async function gemini(contents, { search = true } = {}) {
  if (!GEMINI_KEY) throw new Error('Falta GEMINI_API_KEY');
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Gemini HTTP ${res.status}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '') || '(sin respuesta)';
}

export const transcribe = (buf, mime) => gemini([{
  role: 'user',
  parts: [{ inline_data: { mime_type: (mime || 'audio/ogg').split(';')[0], data: buf.toString('base64') } },
    { text: 'Transcribe literalmente esta nota de voz. Devuelve solo el texto.' }],
}], { search: false });
