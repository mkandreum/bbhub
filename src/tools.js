// Mapas (OpenStreetMap + rutas OSRM), traductor (Gemini o MyMemory) y radio (radio-browser.info).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { gemini, aiEnabled } from './extras.js';

const UA = 'BBHub/2.0 (self-hosted personal portal)';
const DATA = process.env.DATA_DIR || './data';
const getJSON = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ======================= MAPAS =======================
const TILE = 256;
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z * TILE;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * TILE; };
const x2lon = (x, z) => (x / (2 ** z * TILE)) * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / (2 ** z * TILE); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

const tiles = new Map();
async function tile(z, x, y) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return sharp({ create: { width: TILE, height: TILE, channels: 3, background: '#dfe6ec' } }).png().toBuffer();
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const r = await fetch(`https://tile.openstreetmap.org/${key}.png`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Tile ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  tiles.set(key, buf);
  if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
  return buf;
}

export const clampZ = (z) => Math.max(3, Math.min(18, Math.round(Number(z) || 15)));

// Desplaza el centro media pantalla en la dirección dada.
export function pan(lat, lon, z, dir, w = 320, h = 220) {
  let x = lon2x(lon, z), y = lat2y(lat, z);
  if (dir === 'n') y -= h / 2; if (dir === 's') y += h / 2;
  if (dir === 'w') x -= w / 2; if (dir === 'e') x += w / 2;
  return { lat: y2lat(y, z), lon: x2lon(x, z) };
}

export async function renderMap({ lat, lon, z, w = 320, h = 220, markers = [], line = [] }) {
  z = clampZ(z);
  const x0 = lon2x(lon, z) - w / 2, y0 = lat2y(lat, z) - h / 2;
  const tx0 = Math.floor(x0 / TILE), ty0 = Math.floor(y0 / TILE);
  const tx1 = Math.floor((x0 + w - 1) / TILE), ty1 = Math.floor((y0 + h - 1) / TILE);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    jobs.push(tile(z, tx, ty).then((input) => ({ input, left: (tx - tx0) * TILE, top: (ty - ty0) * TILE })));
  }
  const parts = await Promise.all(jobs);
  const canvas = await sharp({ create: { width: (tx1 - tx0 + 1) * TILE, height: (ty1 - ty0 + 1) * TILE, channels: 3, background: '#dfe6ec' } })
    .composite(parts).png().toBuffer();
  const px = (la, lo) => [lon2x(lo, z) - x0, lat2y(la, z) - y0];
  const pts = line.map(([la, lo]) => px(la, lo).map((v) => v.toFixed(1)).join(',')).join(' ');
  const pins = markers.map((m) => {
    const [x, y] = px(m.lat, m.lon);
    return `<circle cx="${x}" cy="${y}" r="9" fill="${m.color || '#e53935'}" stroke="#fff" stroke-width="3"/>${m.label ? `<text x="${x}" y="${y + 4}" font-size="11" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${m.label}</text>` : ''}`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${pts ? `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${pts}" fill="none" stroke="#1c88c9" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}${pins}<rect x="${w - 92}" y="${h - 13}" width="92" height="13" fill="#fff" opacity=".7"/><text x="${w - 3}" y="${h - 3}" font-size="9" font-family="Arial" fill="#333" text-anchor="end">© OpenStreetMap</text></svg>`;
  return sharp(canvas)
    .extract({ left: Math.round(x0 - tx0 * TILE), top: Math.round(y0 - ty0 * TILE), width: w, height: h })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}

// Zoom máximo en el que caben todos los puntos.
export function fit(points, w = 320, h = 220, pad = 24) {
  const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
  const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  for (let z = 17; z >= 3; z--) {
    const dx = lon2x(Math.max(...lons), z) - lon2x(Math.min(...lons), z);
    const dy = lat2y(Math.min(...lats), z) - lat2y(Math.max(...lats), z);
    if (dx <= w - pad * 2 && dy <= h - pad * 2) return { ...c, z };
  }
  return { ...c, z: 3 };
}

const geoCache = new Map();
export async function geocode(q) {
  q = String(q || '').trim();
  const ll = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (ll) return [{ name: q, lat: Number(ll[1]), lon: Number(ll[2]) }];
  if (geoCache.has(q.toLowerCase())) return geoCache.get(q.toLowerCase());
  const j = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=es&q=${encodeURIComponent(q)}`);
  const out = j.map((p) => ({ name: p.display_name, short: p.name || p.display_name.split(',')[0], lat: Number(p.lat), lon: Number(p.lon), type: p.type }));
  geoCache.set(q.toLowerCase(), out);
  return out;
}

const DIR = { left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha',
  'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', straight: 'recto', uturn: 'para cambiar de sentido' };
function stepText(s) {
  const m = s.maneuver || {};
  const d = DIR[m.modifier] || '';
  const on = s.name ? ` por ${s.name}` : '';
  switch (m.type) {
    case 'depart': return `Sal${on}`;
    case 'arrive': return 'Has llegado a tu destino';
    case 'roundabout': case 'rotary': case 'roundabout turn': return `En la rotonda, toma la ${m.exit || 1}ª salida${on}`;
    case 'exit roundabout': case 'exit rotary': return `Sal de la rotonda${on}`;
    case 'merge': return `Incorpórate ${d}${on}`.replace('  ', ' ');
    case 'on ramp': return `Toma la entrada ${d}${on}`;
    case 'off ramp': return `Toma la salida ${d}${on}`;
    case 'fork': return `En la bifurcación, ve ${d}${on}`;
    case 'continue': case 'new name': return `Sigue ${d || 'recto'}${on}`;
    default: return `Gira ${d}${on}`;
  }
}

const routeCache = new Map();
export async function route(from, to, mode = 'car') {
  const key = `${mode}:${from.lat},${from.lon}:${to.lat},${to.lon}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const prof = mode === 'foot' ? 'routed-foot/route/v1/foot' : mode === 'bike' ? 'routed-bike/route/v1/bike' : 'routed-car/route/v1/driving';
  const j = await getJSON(`https://routing.openstreetmap.de/${prof}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`);
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('No encuentro ruta entre esos puntos');
  const r = j.routes[0];
  const out = {
    distance: r.distance, duration: r.duration,
    line: r.geometry.coordinates.filter((_, i, a) => a.length < 400 || i % Math.ceil(a.length / 400) === 0 || i === a.length - 1).map(([lo, la]) => [la, lo]),
    steps: r.legs[0].steps.map((s) => ({ text: stepText(s), distance: s.distance })),
  };
  routeCache.set(key, out);
  if (routeCache.size > 50) routeCache.delete(routeCache.keys().next().value);
  return out;
}

// ======================= TRADUCTOR =======================
export const LANGS = { es: 'español', en: 'inglés', fr: 'francés', de: 'alemán', it: 'italiano', pt: 'portugués', ca: 'catalán', eu: 'euskera', gl: 'gallego', nl: 'neerlandés', ro: 'rumano', pl: 'polaco', ru: 'ruso', uk: 'ucraniano', ar: 'árabe', zh: 'chino', ja: 'japonés', ko: 'coreano', tr: 'turco' };

export async function translate(text, to) {
  text = String(text || '').trim().slice(0, 5000);
  if (!text) return '';
  if (!LANGS[to]) to = 'en';
  if (aiEnabled()) {
    return gemini([{ role: 'user', parts: [{ text: `Traduce el siguiente texto al ${LANGS[to]}. Mantén el tono y los saltos de línea. Devuelve solo la traducción, sin comentarios.\n\n${text}` }] }], { search: false });
  }
  const j = await getJSON(`https://api.mymemory.translated.net/get?langpair=Autodetect|${to}&q=${encodeURIComponent(text.slice(0, 480))}`);
  if (j.responseStatus !== 200) throw new Error(j.responseDetails || 'Traductor no disponible');
  return j.responseData.translatedText;
}

// ======================= RADIO =======================
const RB = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info'];
async function rb(p) {
  let last;
  for (const host of RB) {
    try { return await getJSON(host + p); } catch (e) { last = e; }
  }
  throw last;
}
const station = (s) => ({ id: s.stationuuid, name: s.name.trim(), tags: s.tags, country: s.countrycode, codec: s.codec, bitrate: s.bitrate, url: s.url_resolved || s.url, votes: s.clickcount });

export async function radioSearch({ q, country = 'ES', tag } = {}) {
  const p = new URLSearchParams({ order: 'clickcount', reverse: 'true', limit: '40', hidebroken: 'true' });
  if (q) p.set('name', q);
  if (tag) p.set('tag', tag);
  if (country && !q) p.set('countrycode', country);
  return (await rb(`/json/stations/search?${p}`)).map(station);
}
export async function radioStation(id) {
  const [s] = await rb(`/json/stations/byuuid/${encodeURIComponent(id)}`);
  if (!s) throw new Error('Emisora no encontrada');
  rb(`/json/url/${encodeURIComponent(id)}`).catch(() => {}); // cuenta la escucha
  return station(s);
}

const FAV = path.join(DATA, 'radio-favs.json');
let favs = [];
try { favs = JSON.parse(fs.readFileSync(FAV, 'utf8')); } catch { /* vacío */ }
export const radioFavs = () => favs;
export const isFav = (id) => favs.some((f) => f.id === id);
export function toggleFav(s) {
  favs = isFav(s.id) ? favs.filter((f) => f.id !== s.id) : [...favs, { id: s.id, name: s.name, tags: s.tags }];
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FAV, JSON.stringify(favs));
}
