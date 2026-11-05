// HTML pensado para el navegador de BlackBerry OS 6 (WebKit de 2010, pantalla 320x240):
// sin JavaScript, CSS2 sencillo, páginas pequeñas y atajos de teclado (accesskey).

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
body{margin:0;padding:0;background:#f2f2f2;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:14px}
a{color:#0a58b0}
.top{background:#1b1b1b;color:#fff;padding:5px 6px;border-bottom:3px solid #2ba84a}
.top a{color:#fff;text-decoration:none;font-weight:bold}
.top .t{color:#9fd8ad;font-weight:normal}
.top .r{float:right;font-size:12px}
.w{padding:6px}
.box{background:#fff;border:1px solid #d5d5d5;margin:0 0 6px 0;padding:6px}
.menu a{display:block;background:#fff;border:1px solid #d5d5d5;border-left:4px solid #2ba84a;margin:0 0 4px 0;padding:8px 6px;text-decoration:none;color:#111;font-weight:bold}
.menu a span{color:#777;font-weight:normal;font-size:12px}
.k{display:inline-block;background:#1b1b1b;color:#fff;font-size:11px;padding:0 4px;margin-right:4px}
.list a.i{display:block;background:#fff;border-bottom:1px solid #e1e1e1;padding:6px;text-decoration:none;color:#111}
.list a.i b{display:block}
.list a.i span{color:#666;font-size:12px}
.badge{background:#2ba84a;color:#fff;font-size:11px;padding:0 5px;font-weight:bold}
.muted{color:#777;font-size:12px}
.err{background:#fde8e8;border:1px solid #e0a0a0;color:#900;padding:6px;margin:0 0 6px 0}
.ok{background:#e6f5ea;border:1px solid #9fd8ad;padding:6px;margin:0 0 6px 0}
input.tx,textarea{width:96%;font-size:14px;border:1px solid #aaa;padding:3px}
input.bt{font-size:14px;font-weight:bold;background:#2ba84a;color:#fff;border:1px solid #1e7a35;padding:3px 8px}
.msg{padding:5px 6px;margin:0 0 4px 0;border:1px solid #ddd;background:#fff}
.me{background:#dcf8c6;border-color:#b5dfa0;margin-left:24px}
.them{margin-right:24px}
.msg .h{font-size:11px;color:#666}
.msg .h b{color:#0a7a35}
.art{background:#fff;padding:6px;line-height:1.4}
.art img{max-width:100%}
.art pre{white-space:pre-wrap;font-size:12px}
.nav{padding:4px 0}
.nav a{margin-right:8px}
.foot{color:#999;font-size:11px;text-align:center;padding:8px}
`;

export function page(title, body, { refresh, back } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=yes">
<meta name="HandheldFriendly" content="true">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="top">${back ? `<span class="r"><a href="${esc(back)}" accesskey="9">&laquo; Atrás</a></span>` : ''}<a href="/" accesskey="0">BBHub</a> <span class="t">${esc(title)}</span></div>
<div class="w">${body}</div>
<div class="foot"><a href="/">Inicio</a> &middot; 0 inicio &middot; 9 atrás</div>
</body></html>`;
}

export function when(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * (Number(ts) < 1e12 ? 1000 : 1));
  const now = new Date();
  const tz = process.env.TZ || 'Europe/Madrid';
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString('es-ES', sameDay
    ? { hour: '2-digit', minute: '2-digit', timeZone: tz }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz });
}

// Convierte texto plano en HTML con saltos de línea y enlaces abiertos a través del lector.
export function richText(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="/web?u=${encodeURIComponent(u.replace(/&amp;/g, '&'))}">${u}</a>`)
    .replace(/\n/g, '<br>');
}
