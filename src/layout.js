// HTML para el navegador de BlackBerry OS 6 (WebKit 534, 2010) con aspecto moderno:
// sin JavaScript, sin flexbox ni grid; esquinas, sombras y degradados con prefijo -webkit-
// (y su versión estándar para navegadores actuales). Pantalla objetivo: 320x240.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const r = (px) => `-webkit-border-radius:${px};border-radius:${px};`;
const sh = (v) => `-webkit-box-shadow:${v};box-shadow:${v};`;
const grad = (a, b) => `background:${a};background:-webkit-gradient(linear,left top,left bottom,from(${a}),to(${b}));background:linear-gradient(${a},${b});`;

export const CSS = `
*{-webkit-box-sizing:border-box;box-sizing:border-box}
body{margin:0;background:#eef1f5;color:#1c2733;font-family:"BBAlpha Sans",Arial,Helvetica,sans-serif;font-size:14px;-webkit-text-size-adjust:none}
a{color:#168acd;text-decoration:none}
.bar{${grad('#253341', '#17212b')}color:#fff;padding:7px 8px;${sh('0 2px 4px rgba(0,0,0,.25)')}overflow:hidden}
.bar .home{color:#fff;font-weight:bold;float:left}
.bar .home i{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;font-style:normal;font-size:11px;margin-right:5px;${r('5px')}${grad('#3bb5f0', '#1c93d6')}}
.bar .tt{float:left;margin-left:8px;color:#8fa6bc;max-width:170px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.bar .back{float:right;color:#fff;background:rgba(255,255,255,.12);padding:1px 8px;${r('10px')}font-size:12px}
.w{padding:8px}
.card{background:#fff;padding:8px;margin:0 0 8px 0;${r('10px')}${sh('0 1px 2px rgba(16,35,47,.12)')}}
.hello{font-size:12px;color:#708499;margin:2px 2px 6px}
.hello b{display:block;font-size:20px;color:#1c2733}
.pill{background:#fff;padding:4px 4px 4px 12px;${r('20px')}${sh('0 1px 2px rgba(16,35,47,.15)')}margin:0 0 8px 0;overflow:hidden}
.pill input.q{border:0;background:transparent;font-size:14px;width:72%;padding:4px 0;outline:none}
.go{float:right;border:0;color:#fff;font-weight:bold;font-size:13px;padding:5px 12px;${r('16px')}${grad('#3bb5f0', '#1c93d6')}}
.tiles{overflow:hidden;margin:0 -3px}
.tile{float:left;width:33.33%;padding:3px}
.tile a{display:block;height:66px;padding:6px;color:#fff;${r('12px')}${sh('0 1px 3px rgba(0,0,0,.2)')}position:relative}
.tile b{display:block;font-size:13px;margin-top:19px;white-space:nowrap;overflow:hidden}
.tile span{font-size:11px;opacity:.85;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile em{position:absolute;top:5px;left:6px;font-style:normal;font-size:11px;background:rgba(0,0,0,.2);padding:0 6px;${r('8px')}}
.tile .n{position:absolute;top:5px;right:5px;background:#fff;color:#e53935;font-weight:bold;font-size:11px;padding:0 6px;${r('9px')}}
.c1 a{${grad('#3bb5f0', '#1c88c9')}}.c2 a{${grad('#ff9f43', '#ee7b1c')}}.c3 a{${grad('#26c6b0', '#139a87')}}
.c4 a{${grad('#9c6ade', '#7442c8')}}.c7 a{${grad('#66bb6a', '#2e8b3e')}}.c8 a{${grad('#f6c445', '#dd9a12')}}.c9 a{${grad('#5c7cfa', '#3b5bdb')}}.c5 a{${grad('#7d8a99', '#5a6775')}}.c6 a{${grad('#ef5d7a', '#d63a5c')}}
.list{background:#fff;${r('10px')}${sh('0 1px 2px rgba(16,35,47,.12)')}overflow:hidden;margin:0 0 8px 0}
.row{display:block;padding:7px 8px;border-bottom:1px solid #edf0f3;color:#1c2733;overflow:hidden}
.row:last-child{border-bottom:0}
.row .av{float:left;margin-right:8px}
.row .tx{overflow:hidden}
.row .nm{font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.row .pv{color:#708499;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.row .tm{float:right;color:#9aa8b5;font-size:11px;margin-left:6px;text-align:right}
.unr{display:inline-block;background:#3bb5f0;color:#fff;font-size:11px;font-weight:bold;padding:0 6px;margin-top:2px;${r('9px')}}
.unr.mute{background:#b6c1cc}
.av{display:inline-block;width:38px;height:38px;line-height:38px;text-align:center;color:#fff;font-weight:bold;font-size:14px;${r('19px')}}
.av.s{width:30px;height:30px;line-height:30px;font-size:12px;${r('15px')}}
.a0{${grad('#ff885e', '#ff516a')}}.a1{${grad('#ffcd6a', '#ffa85c')}}.a2{${grad('#82b1ff', '#665fff')}}.a3{${grad('#a0de7e', '#54cb68')}}
.a4{${grad('#53edd6', '#28c9b7')}}.a5{${grad('#72d5fd', '#2a9ef1')}}.a6{${grad('#e0a2f3', '#d669ed')}}
.muted{color:#708499;font-size:12px}
.err{background:#fdecee;color:#c62f43;padding:8px;margin:0 0 8px 0;${r('10px')}}
.ok{background:#e8f7ec;color:#1f7a3a;padding:8px;margin:0 0 8px 0;${r('10px')}}
input.tx,textarea{width:100%;font-size:14px;border:1px solid #d3dbe3;background:#f7f9fb;padding:6px 8px;${r('8px')}font-family:inherit}
select{font-size:14px;padding:4px;border:1px solid #d3dbe3;-webkit-border-radius:8px;border-radius:8px;background:#f7f9fb}
.btn{display:inline-block;border:0;color:#fff;font-weight:bold;font-size:14px;padding:6px 14px;${r('16px')}${grad('#3bb5f0', '#1c93d6')}}
.lnk{display:inline-block;font-size:12px;padding:3px 9px;margin:0 2px 4px 0;background:#e4eef6;color:#168acd;${r('12px')}}
.comp{background:#fff;padding:6px;margin:0 0 8px 0;${r('12px')}${sh('0 1px 2px rgba(16,35,47,.12)')}}
.comp textarea{border:0;background:#f1f4f7}
.msgs{overflow:hidden}
.b{clear:both;max-width:86%;padding:6px 9px;margin:0 0 6px 0;${r('12px')}${sh('0 1px 1px rgba(16,35,47,.12)')}word-wrap:break-word}
.b.in{float:left;background:#fff;-webkit-border-top-left-radius:3px;border-top-left-radius:3px}
.b.out{float:right;background:#e1f7cf;-webkit-border-top-right-radius:3px;border-top-right-radius:3px}
.b .who{font-size:12px;font-weight:bold;color:#168acd;display:block}
.b .t{font-size:10px;color:#8fa1b3;text-align:right;display:block;margin-top:2px}
.b.out .t{color:#62ac55}
.b img{max-width:100%;${r('8px')}display:block;margin:2px 0}
.b .media{display:block;background:rgba(0,0,0,.05);padding:5px 8px;margin:2px 0;${r('8px')};font-size:13px}
.sys{clear:both;text-align:center;margin:0 0 6px 0}
.sys span{display:inline-block;background:rgba(0,0,0,.18);color:#fff;font-size:11px;padding:2px 9px;${r('10px')}}
.art{background:#fff;padding:10px;line-height:1.45;${r('10px')}${sh('0 1px 2px rgba(16,35,47,.12)')}}
.art img{max-width:100%;${r('6px')}}
.art pre{white-space:pre-wrap;font-size:12px}
.art h3{margin:0 0 6px 0;font-size:17px;line-height:1.25}
.nav{padding:4px 0 8px;overflow:hidden}
.big{font-size:40px;font-weight:bold;line-height:1}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t td{padding:4px 2px;border-bottom:1px solid #edf0f3}
.foot{color:#9aa8b5;font-size:11px;text-align:center;padding:6px 0 10px}
.foot a{color:#708499}
`;

export const CSS_V = (() => { let h = 0; for (const c of CSS) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); })();

export function page(title, body, { refresh, back, bare } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=yes">
<meta name="HandheldFriendly" content="true"><meta name="theme-color" content="#17212b">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)}</title><link rel="stylesheet" href="/app.css?v=${CSS_V}"></head><body>
<div class="bar">${back ? `<a class="back" href="${esc(back)}" accesskey="9">&#8249; Atrás</a>` : ''}<a class="home" href="/" accesskey="0"><i>BB</i>Hub</a>${bare ? '' : `<span class="tt">${esc(title)}</span>`}</div>
<div class="w">${body}</div>
<div class="foot"><a href="/">Inicio</a> &middot; tecla 0 inicio &middot; 9 atrás</div>
</body></html>`;
}

// Avatar redondo con iniciales y color estable según el id, como en Telegram.
export function avatar(name, id, small) {
  const words = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/);
  const ini = ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
  let h = 0;
  for (const ch of String(id ?? name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="av a${h % 7}${small ? ' s' : ''}">${esc(ini)}</span>`;
}

export function when(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * (Number(ts) < 1e12 ? 1000 : 1));
  const tz = process.env.TZ || 'Europe/Madrid';
  const sameDay = d.toLocaleDateString('es-ES', { timeZone: tz }) === new Date().toLocaleDateString('es-ES', { timeZone: tz });
  return d.toLocaleString('es-ES', sameDay
    ? { hour: '2-digit', minute: '2-digit', timeZone: tz }
    : { day: '2-digit', month: '2-digit', timeZone: tz });
}

export const hour = (ts) => new Date(Number(ts) * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Madrid' });

// Texto plano a HTML con saltos de línea y enlaces abiertos a través del lector.
export function richText(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="/web?u=${encodeURIComponent(u.replace(/&amp;/g, '&'))}">${u}</a>`)
    .replace(/\n/g, '<br>');
}
