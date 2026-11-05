// Lector web: descarga la página en el servidor, extrae el contenido legible y lo devuelve
// como HTML mínimo. Los enlaces e imágenes vuelven a pasar por aquí (imágenes reducidas).
import dns from 'node:dns/promises';
import net from 'node:net';
import sharp from 'sharp';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { esc } from './layout.js';

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const MAX_BYTES = 6 * 1024 * 1024;
export const IMG_WIDTH = Number(process.env.IMG_WIDTH || 300);

// ---------- descarga segura (sin acceso a la red interna del servidor) ----------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Solo se admiten enlaces http y https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('Dirección no permitida');
}

export async function safeFetch(url, { accept = '*/*', headers = {} } = {}) {
  let u = new URL(url);
  for (let i = 0; i < 6; i++) {
    await assertPublic(u);
    const res = await fetch(u, {
      redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': UA, accept, 'accept-language': 'es-ES,es;q=0.9,en;q=0.6', ...headers },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location'), u);
      continue;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('Archivo demasiado grande');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Archivo demasiado grande');
    return { status: res.status, url: u.href, type: res.headers.get('content-type') || '', buf };
  }
  throw new Error('Demasiadas redirecciones');
}

export async function shrinkImage(buf, width = IMG_WIDTH) {
  return sharp(buf, { animated: false, failOn: 'none' })
    .rotate().resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' })
    .jpeg({ quality: 60, mozjpeg: true }).toBuffer();
}

// ---------- conversión a HTML ligero ----------
const KEEP = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A', 'B', 'STRONG', 'I', 'EM',
  'BLOCKQUOTE', 'PRE', 'CODE', 'BR', 'IMG', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD', 'DL', 'DT', 'DD', 'HR', 'SMALL', 'SUB', 'SUP', 'FIGCAPTION']);
const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'CANVAS', 'TEMPLATE', 'OBJECT', 'EMBED']);

const proxied = (href, base) => {
  try {
    const abs = new URL(href, base);
    if (!/^https?:$/.test(abs.protocol)) return null;
    return abs.href;
  } catch { return null; }
};

function render(node, base, opts) {
  let out = '';
  for (const ch of node.childNodes) {
    if (ch.nodeType === 3) { out += esc(ch.textContent); continue; }
    if (ch.nodeType !== 1) continue;
    const tag = ch.tagName.toUpperCase();
    if (DROP.has(tag)) continue;
    if (tag === 'IMG') {
      if (!opts.images) continue;
      const src = ch.getAttribute('data-src') || ch.getAttribute('src') || (ch.getAttribute('srcset') || '').split(/[\s,]+/)[0];
      const abs = src && proxied(src, base);
      if (abs && !abs.startsWith('data:')) out += `<img src="/img?u=${encodeURIComponent(abs)}" alt="${esc(ch.getAttribute('alt') || '')}"><br>`;
      continue;
    }
    const inner = render(ch, base, opts);
    if (tag === 'A') {
      const abs = proxied(ch.getAttribute('href') || '', base);
      out += abs ? `<a href="/web?u=${encodeURIComponent(abs)}">${inner}</a>` : inner;
    } else if (KEEP.has(tag)) {
      const t = tag.toLowerCase();
      out += (tag === 'BR' || tag === 'HR') ? `<${t}>` : `<${t}>${inner}</${t}>`;
    } else if (/^(DIV|SECTION|ARTICLE|FIGURE|HEADER|FOOTER|MAIN|ASIDE|NAV)$/.test(tag)) {
      out += inner.trim() ? `<div>${inner}</div>` : '';
    } else {
      out += inner;
    }
  }
  return out;
}

// Parte el HTML en trozos de ~40 KB para que el navegador antiguo no se ahogue.
function paginate(html, size = 40000) {
  const blocks = html.split(/(?=<(?:p|h[1-6]|div|ul|ol|table|blockquote|pre)>)/);
  const pages = [''];
  for (const b of blocks) {
    if (pages[pages.length - 1].length + b.length > size && pages[pages.length - 1]) pages.push('');
    pages[pages.length - 1] += b;
  }
  return pages;
}

export async function readPage(url, { mode = 'read', images = true } = {}) {
  const r = await safeFetch(url, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
  if (r.type.startsWith('image/')) return { kind: 'image', url: r.url };
  if (r.type.includes('text/plain')) {
    return { kind: 'html', url: r.url, title: r.url, pages: paginate(`<pre>${esc(r.buf.toString('utf8'))}</pre>`) };
  }
  if (!r.type.includes('html') && !r.type.includes('xml')) return { kind: 'file', url: r.url, type: r.type, size: r.buf.length };

  const charset = (r.type.match(/charset=([\w-]+)/i) || [])[1] || (r.buf.toString('latin1', 0, 2048).match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(r.buf); } catch { text = r.buf.toString('utf8'); }

  const { document } = parseHTML(text);
  const title = (document.querySelector('title')?.textContent || r.url).trim();

  if (mode === 'links') {
    const seen = new Set();
    let out = '';
    for (const a of document.querySelectorAll('a[href]')) {
      const abs = proxied(a.getAttribute('href'), r.url);
      const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!abs || !label || label.length < 2 || seen.has(abs)) continue;
      seen.add(abs);
      out += `<li><a href="/web?u=${encodeURIComponent(abs)}">${esc(label.slice(0, 120))}</a></li>`;
    }
    return { kind: 'html', url: r.url, title, pages: paginate(`<ul>${out}</ul>`) };
  }

  let html = '';
  try {
    const doc2 = parseHTML(text).document;
    const art = new Readability(doc2, { charThreshold: 300 }).parse();
    if (art?.content && art.textContent.trim().length > 200) {
      const holder = parseHTML(`<div id="x">${art.content}</div>`).document.getElementById('x');
      html = render(holder, r.url, { images });
    }
  } catch { /* fallback */ }
  if (!html) html = render(document.body || document.documentElement, r.url, { images });
  return { kind: 'html', url: r.url, title, pages: paginate(html) };
}

// ---------- buscador (DuckDuckGo HTML, sin JavaScript) ----------
export async function search(q) {
  const r = await safeFetch(`https://html.duckduckgo.com/html/?kl=es-es&q=${encodeURIComponent(q)}`);
  const { document } = parseHTML(r.buf.toString('utf8'));
  const out = [];
  for (const res of document.querySelectorAll('.result')) {
    const a = res.querySelector('a.result__a');
    if (!a) continue;
    let href = a.getAttribute('href') || '';
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch { continue; }
    if (/duckduckgo\.com\/y\.js|bing\.com\/aclick/.test(href) || !/^https?:/.test(href)) continue; // anuncios
    out.push({
      title: a.textContent.trim(),
      url: href,
      snippet: (res.querySelector('.result__snippet')?.textContent || '').trim(),
    });
  }
  return out;
}
