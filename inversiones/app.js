// Mis Inversiones: registra tus compras y ventas y valúa el portafolio con precios reales.
// Todo se guarda en este dispositivo (localStorage). Usa Ajustes → Respaldo para no perder tus datos.
'use strict';

/* ───────────── Estado y almacenamiento ───────────── */
const LKEY = 'misInversiones.v1';
const CLASES = { accion: 'Acción', etf: 'ETF', cripto: 'Cripto', otro: 'Otro' };
const COLORES = ['#4338ca', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#ca8a04', '#7c3aed', '#0d9488', '#dc2626', '#64748b'];
const AUTO_MS = 60_000;

const VACIO = () => ({
  version: 1,
  ops: [],            // operaciones: {id, tipo, clase, simbolo, nombre, fecha, cantidad, precio, moneda, comision, mult, nota, creado}
  precios: {},        // clave → {p, prev, moneda, ts, fuente}
  manual: {},         // clave → precio fijado a mano
  cg: {},             // símbolo cripto → id de CoinGecko
  fx: { USDMXN: null, ts: 0 },
  hist: {},           // 'AAAA-MM-DD' → {MXN, USD}: valor del portafolio ese día
  cfg: { base: 'MXN', finnhubKey: '', proxyUrl: '', auto: true },
});

let D = cargar();
const UI = { vista: 'portafolio', grafica: 'activo', cargando: false, tipo: 'compra', editando: null, charts: {} };

function cargar() {
  try {
    const x = JSON.parse(localStorage.getItem(LKEY));
    if (x && x.version === 1) { const v = VACIO(); return { ...v, ...x, cfg: { ...v.cfg, ...x.cfg }, fx: { ...v.fx, ...x.fx } }; }
  } catch (e) {}
  return VACIO();
}
function guardar() { try { localStorage.setItem(LKEY, JSON.stringify(D)); } catch (e) { toast('No se pudo guardar en este dispositivo'); } }

/* ───────────── Utilidades ───────────── */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(/,/g, '.')); return isFinite(n) ? n : NaN; };
const hoy = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clave = (clase, simbolo) => clase + ':' + simbolo;
const EPS = 1e-9;

const fmtCache = {};
function money(v, mon = D.cfg.base, dec) {
  if (v == null || !isFinite(v)) return '—';
  const d = dec ?? (Math.abs(v) < 1 && v !== 0 ? 4 : 2);
  const k = mon + d;
  fmtCache[k] ||= new Intl.NumberFormat('es-MX', { style: 'currency', currency: mon, minimumFractionDigits: d, maximumFractionDigits: d });
  return fmtCache[k].format(v);
}
const signo = (v, mon) => (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v), mon);
const pct = v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(2) + '%';
const cls = v => v > EPS ? 'up' : v < -EPS ? 'down' : 'muted';
function cant(v) { return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 8 }).format(v); }
function fechaLarga(f) { return new Date(f + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function haceCuanto(ts) {
  if (!ts) return 'nunca';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('es-MX');
}
let toastT;
function toast(m, ms = 2800) { const t = $('#toast'); t.textContent = m; t.classList.add('ver'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('ver'), ms); }

// Conversión entre USD y MXN con el tipo de cambio guardado.
function conv(v, de, a) {
  if (de === a || !v) return v;
  const r = D.fx.USDMXN;
  if (!r) return NaN;
  return de === 'USD' ? v * r : v / r;
}

/* ───────────── Cálculo de posiciones (costo promedio) ───────────── */
function posiciones() {
  const g = {};
  const ops = [...D.ops].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado - b.creado);
  for (const o of ops) {
    const k = clave(o.clase, o.simbolo);
    const P = g[k] ||= { k, clase: o.clase, simbolo: o.simbolo, nombre: '', moneda: o.moneda, mult: o.mult || 1, q: 0, avg: 0, realizado: 0, comisiones: 0, invertido: 0, ops: [] };
    if (o.nombre) P.nombre = o.nombre;
    const s = (o.tipo === 'compra' ? 1 : -1) * o.cantidad, p = o.precio, m = P.mult;
    const com = o.comision || 0;
    P.comisiones += com; P.realizado -= com;
    if (Math.abs(P.q) < EPS || Math.sign(s) === Math.sign(P.q)) {
      // Abre o aumenta la posición: nuevo costo promedio.
      P.avg = (P.avg * Math.abs(P.q) + p * Math.abs(s)) / (Math.abs(P.q) + Math.abs(s));
      P.q += s;
    } else {
      // Reduce o cierra (o voltea) la posición: realiza ganancia/pérdida.
      const cerrado = Math.min(Math.abs(s), Math.abs(P.q));
      P.realizado += (p - P.avg) * cerrado * Math.sign(P.q) * m;
      const antes = P.q; P.q += s;
      if (Math.abs(P.q) < EPS) { P.q = 0; P.avg = 0; }
      else if (Math.sign(P.q) !== Math.sign(antes)) P.avg = p;
    }
    P.ops.push(o);
  }
  return Object.values(g).map(valuar);
}

function precioDe(P) {
  const man = D.manual[P.k];
  if (man != null) return { p: man, prev: null, moneda: P.moneda, ts: null, fuente: 'manual' };
  const x = D.precios[P.k];
  if (!x || !isFinite(x.p)) return null;
  // Si la fuente cotiza en otra moneda, la llevamos a la del activo.
  if (x.moneda && x.moneda !== P.moneda) return { ...x, p: conv(x.p, x.moneda, P.moneda), prev: x.prev != null ? conv(x.prev, x.moneda, P.moneda) : null, moneda: P.moneda };
  return x;
}

function valuar(P) {
  const base = D.cfg.base, m = P.mult;
  const pr = P.q !== 0 ? precioDe(P) : null;
  const costoL = P.avg * P.q * m;                                  // capital invertido (moneda del activo)
  const pnlL = pr ? (pr.p - P.avg) * P.q * m : 0;                  // ganancia no realizada
  const valorL = pr ? pr.p * P.q * m : costoL;
  const hoyL = pr && pr.prev ? (pr.p - pr.prev) * P.q * m : 0;
  const c = v => conv(v, P.moneda, base);
  return {
    ...P, pr, sinPrecio: P.q !== 0 && !pr,
    costo: c(costoL), valor: c(valorL), pnl: c(pnlL), hoy: c(hoyL), realizadoB: c(P.realizado),
    pnlPct: pr && P.avg ? (pr.p - P.avg) / P.avg * Math.sign(P.q) : null,
    hoyPct: pr && pr.prev ? (pr.p - pr.prev) / pr.prev : null,
  };
}

function resumen(ps) {
  const abiertas = ps.filter(p => p.q !== 0);
  const s = k => abiertas.reduce((a, p) => a + (isFinite(p[k]) ? p[k] : 0), 0);
  const valor = s('valor'), costo = s('costo'), pnl = s('pnl'), hoyV = s('hoy');
  const realizado = ps.reduce((a, p) => a + (isFinite(p.realizadoB) ? p.realizadoB : 0), 0);
  return { valor, costo, pnl, hoy: hoyV, realizado, pnlPct: costo ? pnl / costo : null, hoyPct: valor - hoyV ? hoyV / (valor - hoyV) : null, abiertas };
}

/* ───────────── Precios reales ───────────── */
// Criptos comunes → id de CoinGecko (las demás se buscan automáticamente).
const CG_IDS = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', BNB: 'binancecoin', DOT: 'polkadot', AVAX: 'avalanche-2', LINK: 'chainlink', LTC: 'litecoin', TRX: 'tron', POL: 'polygon-ecosystem-token', MATIC: 'matic-network', SHIB: 'shiba-inu', XLM: 'stellar', ATOM: 'cosmos', BCH: 'bitcoin-cash', TON: 'the-open-network', SUI: 'sui', NEAR: 'near', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', UNI: 'uniswap', AAVE: 'aave', HBAR: 'hedera-hashgraph' };

async function getJSON(url, opts) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function actualizarFx() {
  if (D.fx.USDMXN && Date.now() - D.fx.ts < 30 * 60_000) return;
  const fuentes = [
    async () => (await getJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN')).rates.MXN,
    async () => (await getJSON('https://open.er-api.com/v6/latest/USD')).rates.MXN,
  ];
  for (const f of fuentes) {
    try { const r = await f(); if (r > 0) { D.fx = { USDMXN: r, ts: Date.now() }; return; } } catch (e) {}
  }
}

async function idCoinGecko(sim) {
  if (D.cg[sim]) return D.cg[sim];
  if (CG_IDS[sim]) return (D.cg[sim] = CG_IDS[sim]);
  const r = await getJSON('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(sim));
  const c = (r.coins || []).filter(x => x.symbol.toUpperCase() === sim).sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9))[0];
  if (!c) throw new Error('No encontré ' + sim + ' en CoinGecko');
  return (D.cg[sim] = c.id);
}

async function preciosCripto(ps) {
  const fallos = [], ids = {};
  for (const P of ps) { try { ids[P.k] = await idCoinGecko(P.simbolo); } catch (e) { fallos.push(P.simbolo); } }
  const lista = [...new Set(Object.values(ids))];
  if (!lista.length) return fallos;
  try {
    const r = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${lista.join(',')}&vs_currencies=usd,mxn&include_24hr_change=true`);
    for (const P of ps) {
      const x = r[ids[P.k]]; const mon = P.moneda.toLowerCase();
      if (!x || x[mon] == null) { if (ids[P.k]) fallos.push(P.simbolo); continue; }
      const ch = x[mon + '_24h_change'];
      D.precios[P.k] = { p: x[mon], prev: ch != null ? x[mon] / (1 + ch / 100) : null, moneda: P.moneda, ts: Date.now(), fuente: 'CoinGecko' };
    }
  } catch (e) { fallos.push(...ps.filter(P => ids[P.k]).map(P => P.simbolo)); }
  return fallos;
}

async function preciosFinnhub(ps) {
  const key = D.cfg.finnhubKey.trim(), fallos = [];
  await Promise.all(ps.map(async P => {
    try {
      const r = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(P.simbolo)}&token=${encodeURIComponent(key)}`);
      if (!r || !r.c) throw new Error('sin dato');
      D.precios[P.k] = { p: r.c, prev: r.pc || null, moneda: 'USD', ts: Date.now(), fuente: 'Finnhub' };
    } catch (e) { fallos.push(P); }
  }));
  return fallos;
}

// Símbolo tal como lo usa Yahoo Finance (ej. AAPL, AMXL.MX).
const simYahoo = P => P.simbolo;

async function preciosProxy(ps) {
  const url = D.cfg.proxyUrl.trim();
  if (!url || !ps.length) return ps;
  const fallos = [];
  try {
    const sims = ps.map(simYahoo);
    const r = await getJSON(url + (url.includes('?') ? '&' : '?') + 's=' + encodeURIComponent(sims.join(',')));
    ps.forEach((P, i) => {
      const x = r[sims[i]];
      if (!x || !isFinite(x.precio)) return fallos.push(P);
      D.precios[P.k] = { p: x.precio, prev: x.previo || null, moneda: x.moneda === 'MXN' ? 'MXN' : x.moneda === 'USD' ? 'USD' : P.moneda, ts: Date.now(), fuente: 'Yahoo' };
      if (!P.nombre && x.nombre) nombreAuto(P.k, x.nombre);
    });
  } catch (e) { return ps; }
  return fallos;
}

function nombreAuto(k, nombre) {
  const o = D.ops.find(o => clave(o.clase, o.simbolo) === k);
  if (o && !D.ops.some(x => clave(x.clase, x.simbolo) === k && x.nombre)) o.nombre = nombre;
}

async function actualizarPrecios({ silencioso = false } = {}) {
  if (UI.cargando) return;
  const ps = posiciones().filter(p => p.q !== 0 && D.manual[p.k] == null);
  UI.cargando = true; $('#btnRefrescar').classList.add('gira');
  try {
    await actualizarFx();
    const cripto = ps.filter(p => p.clase === 'cripto');
    const mercado = ps.filter(p => p.clase !== 'cripto');
    // Finnhub (gratis) cubre acciones y ETFs de EE. UU.; lo demás (BMV .MX, otras bolsas) va al proxy de Yahoo.
    const usaFinn = D.cfg.finnhubKey.trim() ? mercado.filter(p => (p.clase === 'accion' || p.clase === 'etf') && !p.simbolo.includes('.')) : [];
    const resto = mercado.filter(p => !usaFinn.includes(p));
    const [fCripto, fFinn] = await Promise.all([preciosCripto(cripto), preciosFinnhub(usaFinn)]);
    const fProxy = await preciosProxy([...resto, ...fFinn]);
    const fallos = [...fCripto, ...fProxy.map(p => p.simbolo)];
    guardarHistorial();
    guardar(); render();
    if (fallos.length && !silencioso) {
      const sinFuente = fProxy.length && !D.cfg.proxyUrl.trim() && (!D.cfg.finnhubKey.trim() || fProxy.some(p => p.clase !== 'accion' && p.clase !== 'etf'));
      toast(`Sin precio para ${[...new Set(fallos)].join(', ')}${sinFuente ? ' — configura una fuente en Ajustes' : ''}`, 5000);
    } else if (!silencioso) toast('Precios actualizados');
  } finally { UI.cargando = false; $('#btnRefrescar').classList.remove('gira'); }
}

function guardarHistorial() {
  const ps = posiciones(); if (!ps.some(p => p.q !== 0)) return;
  const b = D.cfg.base, r = resumen(ps); if (!isFinite(r.valor)) return;
  const otro = b === 'MXN' ? 'USD' : 'MXN';
  D.hist[hoy()] = { [b]: r.valor, [otro]: conv(r.valor, b, otro) };
}

/* ───────────── Render ───────────── */
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === UI.vista));
  document.querySelectorAll('.vista').forEach(v => v.hidden = v.id !== 'v-' + UI.vista);
  $('#titulo').textContent = { portafolio: 'Portafolio', operaciones: 'Operaciones', ajustes: 'Ajustes' }[UI.vista];
  $('#fab').hidden = UI.vista === 'ajustes';
  if (UI.vista === 'portafolio') renderPortafolio();
  if (UI.vista === 'operaciones') renderOperaciones();
  if (UI.vista === 'ajustes') renderAjustes();
}

function icono(P) { return esc(P.simbolo.slice(0, 5)); }

function filaPos(P) {
  const sub = P.q === 0
    ? `Cerrada · realizado <span class="${cls(P.realizadoB)}">${signo(P.realizadoB)}</span>`
    : `${cant(P.q)} · prom. ${money(P.avg, P.moneda)}${P.pr ? ' · ' + money(P.pr.p, P.moneda) : ''}`;
  const der = P.q === 0 ? '' : P.sinPrecio
    ? `<b>${money(P.valor)}</b><span class="badge warn">sin precio</span>`
    : `<b>${money(P.valor)}</b><span class="small ${cls(P.pnl)}">${signo(P.pnl)} ${P.pnlPct != null ? '(' + pct(P.pnlPct) + ')' : ''}</span>`;
  return `<div class="pos" data-k="${esc(P.k)}">
    <div class="ico">${icono(P)}</div>
    <div class="mid"><b>${esc(P.simbolo)}<span class="badge">${CLASES[P.clase]}</span>${P.pr && P.pr.fuente === 'manual' ? '<span class="badge">manual</span>' : ''}</b>
      <span class="small muted">${esc(P.nombre) ? esc(P.nombre) + ' · ' : ''}${sub}</span></div>
    <div class="der">${der}${P.hoyPct != null ? `<div class="tiny ${cls(P.hoy)}">hoy ${pct(P.hoyPct)}</div>` : ''}</div>
  </div>`;
}

function renderPortafolio() {
  const el = $('#v-portafolio');
  const ps = posiciones(), r = resumen(ps), b = D.cfg.base;
  if (!D.ops.length) {
    el.innerHTML = `<div class="card vacio"><div class="big">📊</div><h2>Empieza tu portafolio</h2>
      <p class="muted">Registra cada compra o venta de acciones, ETFs o criptomonedas. La app calcula tu costo promedio y valúa todo con precios reales.</p>
      <button class="btn" data-nueva>Registrar primera operación</button></div>${avisoFuentes(ps)}`;
    return;
  }
  const precioTs = Math.max(0, ...Object.values(D.precios).map(x => x.ts || 0));
  const abiertas = r.abiertas.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const cerradas = ps.filter(p => p.q === 0);
  const sinFx = ps.some(p => p.q !== 0 && p.moneda !== b) && !D.fx.USDMXN;
  el.innerHTML = `
    ${avisoFuentes(ps)}
    ${sinFx ? '<div class="aviso">Falta el tipo de cambio USD/MXN; los totales pueden estar incompletos. Toca ↻ con internet.</div>' : ''}
    <div class="card">
      <div class="small muted">Valor del portafolio (${b})</div>
      <div class="total">${money(r.valor, b, 2)}</div>
      <div class="${cls(r.hoy)} small">${signo(r.hoy)} hoy ${r.hoyPct != null ? '(' + pct(r.hoyPct) + ')' : ''}</div>
      <div class="kpis">
        <div class="kpi"><span>Invertido</span><b>${money(r.costo, b, 2)}</b></div>
        <div class="kpi"><span>Ganancia no realizada</span><b class="${cls(r.pnl)}">${signo(r.pnl)}</b><span class="${cls(r.pnl)}">${pct(r.pnlPct)}</span></div>
        <div class="kpi"><span>Ganancia realizada</span><b class="${cls(r.realizado)}">${signo(r.realizado)}</b><span>neto de comisiones</span></div>
      </div>
      <div class="tiny muted" style="margin-top:10px">Precios ${haceCuanto(precioTs)}${D.fx.USDMXN ? ` · USD/MXN ${D.fx.USDMXN.toFixed(4)}` : ''}</div>
    </div>
    ${abiertas.length ? `<div class="card">
      <div class="fila-tit"><h2>Distribución</h2>
        <div class="seg"><button data-graf="activo" class="${UI.grafica === 'activo' ? 'on' : ''}">Activo</button><button data-graf="clase" class="${UI.grafica === 'clase' ? 'on' : ''}">Tipo</button></div></div>
      <div class="chart-box"><canvas id="chDist"></canvas></div>
    </div>` : ''}
    ${Object.keys(D.hist).length > 1 ? `<div class="card"><h2>Evolución</h2><div class="chart-box"><canvas id="chHist"></canvas></div>
      <div class="tiny muted">Se guarda un punto por día cada vez que se actualizan los precios.</div></div>` : ''}
    <div class="card"><h2>Posiciones abiertas</h2>
      ${abiertas.length ? abiertas.map(filaPos).join('') : '<p class="muted small">No tienes posiciones abiertas.</p>'}
      ${cerradas.length ? `<details><summary>Posiciones cerradas (${cerradas.length})</summary>${cerradas.map(filaPos).join('')}</details>` : ''}
    </div>`;
  graficas(abiertas);
}

function avisoFuentes(ps) {
  const necesita = ps.some(p => p.q !== 0 && p.clase !== 'cripto' && D.manual[p.k] == null);
  if (!D.ops.length) return '';
  if (!necesita || D.cfg.finnhubKey.trim() || D.cfg.proxyUrl.trim()) return '';
  return `<div class="aviso">Para ver precios reales de acciones y ETFs, agrega una fuente de datos gratuita. <button data-ir="ajustes">Configurar</button></div>`;
}

function graficas(abiertas) {
  Object.values(UI.charts).forEach(c => c.destroy()); UI.charts = {};
  if (!window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted').trim(), card = css.getPropertyValue('--card').trim();
  const dist = $('#chDist');
  if (dist) {
    const g = {};
    abiertas.filter(p => p.valor > 0).forEach(p => { const k = UI.grafica === 'clase' ? CLASES[p.clase] : p.simbolo; g[k] = (g[k] || 0) + p.valor; });
    let ent = Object.entries(g).sort((a, b) => b[1] - a[1]);
    if (ent.length > 9) ent = [...ent.slice(0, 8), ['Otros', ent.slice(8).reduce((a, x) => a + x[1], 0)]];
    const tot = ent.reduce((a, x) => a + x[1], 0);
    UI.charts.dist = new Chart(dist, {
      type: 'doughnut',
      data: { labels: ent.map(x => x[0]), datasets: [{ data: ent.map(x => x[1]), backgroundColor: COLORES, borderColor: card, borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: {
        legend: { position: 'right', labels: { color: ink, boxWidth: 12, generateLabels: ch => ch.data.labels.map((l, i) => ({ text: `${l}  ${(ent[i][1] / tot * 100).toFixed(1)}%`, fillStyle: COLORES[i % COLORES.length], strokeStyle: card, fontColor: ink, index: i })) } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${money(c.raw)} (${(c.raw / tot * 100).toFixed(1)}%)` } } } },
    });
  }
  const hist = $('#chHist');
  if (hist) {
    const b = D.cfg.base, f = Object.keys(D.hist).sort().filter(k => D.hist[k][b] != null);
    UI.charts.hist = new Chart(hist, {
      type: 'line',
      data: { labels: f.map(x => new Date(x + 'T12:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })), datasets: [{ data: f.map(x => D.hist[x][b]), borderColor: '#4338ca', backgroundColor: 'rgba(67,56,202,.12)', fill: true, tension: .25, pointRadius: f.length > 40 ? 0 : 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + money(c.raw) } } },
        scales: { x: { ticks: { color: ink, maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { color: ink, callback: v => money(v, b, 0) }, grid: { color: 'rgba(128,128,128,.12)' } } } },
    });
  }
}

function renderOperaciones() {
  const el = $('#v-operaciones');
  if (!D.ops.length) { el.innerHTML = '<div class="card vacio"><div class="big">🧾</div><p class="muted">Aún no registras operaciones.</p><button class="btn" data-nueva>Registrar operación</button></div>'; return; }
  const ops = [...D.ops].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
  let html = '', f = '';
  for (const o of ops) {
    if (o.fecha !== f) { html += `${f ? '</div>' : ''}<div class="fecha-g">${fechaLarga(o.fecha)}</div><div class="card" style="padding:4px 16px">`; f = o.fecha; }
    const total = o.cantidad * o.precio * (o.mult || 1);
    html += `<div class="op-row" data-op="${o.id}"><div class="l">
        <b class="${o.tipo === 'compra' ? 'up' : 'down'}">${o.tipo === 'compra' ? 'Compra' : 'Venta'}</b> <b>${esc(o.simbolo)}</b><span class="badge">${CLASES[o.clase]}</span>
        <div class="small muted">${cant(o.cantidad)} × ${money(o.precio, o.moneda)}${o.comision ? ' · comisión ' + money(o.comision, o.moneda) : ''}${o.nota ? ' · ' + esc(o.nota) : ''}</div></div>
        <div class="der"><b>${money(total, o.moneda)}</b></div></div>`;
  }
  el.innerHTML = html + '</div>';
}

function renderAjustes() {
  const c = D.cfg;
  $('#v-ajustes').innerHTML = `
    <div class="card"><h2>Moneda principal</h2>
      <div class="seg"><button data-base="MXN" class="${c.base === 'MXN' ? 'on' : ''}">MXN</button><button data-base="USD" class="${c.base === 'USD' ? 'on' : ''}">USD</button></div>
      <div class="hint">Los totales se muestran en esta moneda usando el tipo de cambio del día.</div></div>
    <div class="card"><h2>Fuentes de precios</h2>
      <p class="small"><b>Cripto:</b> CoinGecko, automático y sin registro.</p>
      <label for="ajFinn"><b>Acciones y ETFs de EE. UU.</b> — llave gratuita de Finnhub</label>
      <input id="ajFinn" value="${esc(c.finnhubKey)}" placeholder="Pega aquí tu API key" autocomplete="off" spellcheck="false">
      <div class="hint">Regístrate gratis en <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io</a> y copia tu “API key”. Se guarda solo en este dispositivo.</div>
      <label for="ajProxy"><b>Bolsa Mexicana (.MX) y otras bolsas</b> — URL de tu proxy de Yahoo Finance (opcional)</label>
      <input id="ajProxy" value="${esc(c.proxyUrl)}" placeholder="https://TU-PROYECTO.supabase.co/functions/v1/cotizaciones" autocomplete="off" spellcheck="false">
      <div class="hint">Yahoo no deja que una página web pida sus precios directamente, así que hace falta un pequeño intermediario. Ver <code>inversiones/proxy/LEEME.md</code>. Si lo configuras, también sirve para acciones y ETFs sin llave de Finnhub.</div>
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="ajAuto" style="width:auto" ${c.auto ? 'checked' : ''}> Actualizar precios cada minuto mientras la app está abierta</label>
      <button class="btn full" id="ajGuardar" style="margin-top:12px">Guardar y actualizar precios</button>
    </div>
    <div class="card lista-aj"><h2>Respaldo</h2>
      <p class="small muted">Tus datos viven solo en este dispositivo. Descarga un respaldo de vez en cuando.</p>
      <button class="btn sec full" id="ajExport">Descargar respaldo (.json)</button>
      <button class="btn sec full" id="ajCsv">Exportar operaciones (.csv)</button>
      <button class="btn sec full" id="ajImport">Restaurar respaldo</button>
      <input type="file" id="ajFile" accept="application/json,.json" hidden>
    </div>
    <div class="card"><h2>Zona de peligro</h2><button class="btn peligro full" id="ajBorrar">Borrar todos los datos</button></div>
    <p class="tiny muted" style="text-align:center">Los precios pueden tener retraso y son solo informativos.</p>`;
}

/* ───────────── Detalle de un activo ───────────── */
function abrirActivo(k) {
  const P = posiciones().find(p => p.k === k); if (!P) return;
  const man = D.manual[k];
  $('#activoCont').innerHTML = `
    <h3><span>${esc(P.simbolo)} <span class="badge">${CLASES[P.clase]}</span></span><button class="x" data-cerrar aria-label="Cerrar">✕</button></h3>
    ${P.nombre ? `<div class="muted small" style="margin-top:-8px">${esc(P.nombre)}</div>` : ''}
    <div class="det-grid">
      <div class="kpi"><span>Posición</span><b>${cant(P.q)}</b></div>
      <div class="kpi"><span>Costo promedio</span><b>${money(P.avg, P.moneda)}</b></div>
      <div class="kpi"><span>Precio actual</span><b>${P.pr ? money(P.pr.p, P.moneda) : '—'}</b><span>${P.pr ? (P.pr.fuente === 'manual' ? 'manual' : P.pr.fuente + ' · ' + haceCuanto(P.pr.ts)) : 'sin dato'}</span></div>
      <div class="kpi"><span>Valor</span><b>${money(P.valor)}</b></div>
      <div class="kpi"><span>No realizado</span><b class="${cls(P.pnl)}">${signo(P.pnl)}</b><span class="${cls(P.pnl)}">${pct(P.pnlPct)}</span></div>
      <div class="kpi"><span>Realizado</span><b class="${cls(P.realizadoB)}">${signo(P.realizadoB)}</b><span>comisiones ${money(conv(P.comisiones, P.moneda, D.cfg.base))}</span></div>
    </div>
    ${P.mult !== 1 ? `<div class="tiny muted">Multiplicador: ${cant(P.mult)} · moneda ${P.moneda}</div>` : ''}
    <label for="manPrecio">Precio manual (${P.moneda})</label>
    <div style="display:flex;gap:8px"><input id="manPrecio" inputmode="decimal" value="${man ?? ''}" placeholder="Usa el precio real"><button class="btn sec" id="manGuardar" data-k="${esc(k)}">Fijar</button></div>
    <div class="hint">Úsalo si no hay fuente para este activo. Déjalo vacío para usar el precio real.</div>
    <h2 style="font-size:15px;margin:16px 0 4px">Operaciones</h2>
    ${[...P.ops].reverse().map(o => `<div class="op-row" data-op="${o.id}"><div class="l"><b class="${o.tipo === 'compra' ? 'up' : 'down'}">${o.tipo === 'compra' ? 'Compra' : 'Venta'}</b>
      <span class="small muted">${new Date(o.fecha + 'T12:00').toLocaleDateString('es-MX')}</span><div class="small muted">${cant(o.cantidad)} × ${money(o.precio, o.moneda)}</div></div>
      <div class="der"><b>${money(o.cantidad * o.precio * (o.mult || 1), o.moneda)}</b></div></div>`).join('')}
    <div class="acciones"><button class="btn sec" data-nueva-de="${esc(k)}">+ Operación de ${esc(P.simbolo)}</button></div>`;
  const d = $('#dlgActivo'); if (!d.open) d.showModal();
}

/* ───────────── Formulario de operación ───────────── */
const HINTS = {
  accion: 'EE. UU.: AAPL, MSFT. Bolsa Mexicana (requiere proxy): AMXL.MX, WALMEX.MX.',
  etf: 'Ej. VOO, QQQ, SPY. En BMV (requiere proxy): NAFTRAC.MX.',
  cripto: 'Ej. BTC, ETH, SOL. Precio automático desde CoinGecko.',
  otro: 'Cualquier símbolo de Yahoo Finance (requiere proxy) o usa precio manual.',
};
function existente(clase, sim) { return D.ops.find(o => o.clase === clase && o.simbolo === sim && o.id !== UI.editando); }

function abrirOp(op, pre) {
  UI.editando = op ? op.id : null;
  const o = op || { tipo: 'compra', clase: 'accion', fecha: hoy(), moneda: 'USD', mult: 1, ...pre };
  UI.tipo = o.tipo;
  $('#opTitulo').textContent = op ? 'Editar operación' : 'Nueva operación';
  $('#opClase').value = o.clase; $('#opFecha').value = o.fecha; $('#opSimbolo').value = o.simbolo || '';
  $('#opNombre').value = o.nombre || ''; $('#opCantidad').value = o.cantidad ?? ''; $('#opPrecio').value = o.precio ?? '';
  $('#opMoneda').value = o.moneda; $('#opComision').value = o.comision || '';
  $('#opNota').value = o.nota || '';
  $('#opBorrar').hidden = !op;
  sincForm();
  $('#dlgActivo').close();
  $('#dlgOp').showModal();
  if (!op && !pre) $('#opSimbolo').focus();
}

function sincForm() {
  const clase = $('#opClase').value, sim = $('#opSimbolo').value.trim().toUpperCase();
  document.querySelectorAll('.tipo-op button').forEach(b => b.classList.toggle('on', b.dataset.tipo === UI.tipo));
  $('#opSimHint').textContent = HINTS[clase];
  $('#listaSimbolos').innerHTML = [...new Set(D.ops.filter(o => o.clase === clase).map(o => o.simbolo))].map(s => `<option value="${esc(s)}">`).join('');
  // Un mismo activo conserva su moneda y multiplicador en todas sus operaciones.
  const ex = sim && existente(clase, sim);
  $('#opMoneda').disabled = !!ex;
  if (ex) { $('#opMoneda').value = ex.moneda; if (!$('#opNombre').value && ex.nombre) $('#opNombre').placeholder = ex.nombre; }
  if (clase === 'cripto' && !ex && !UI.editando) $('#opMoneda').value = $('#opMoneda').value || 'USD';
  const q = num($('#opCantidad').value), p = num($('#opPrecio').value), c = num($('#opComision').value) || 0;
  const m = 1, mon = $('#opMoneda').value;
  if (q > 0 && p >= 0) {
    const bruto = q * p * m, tot = UI.tipo === 'compra' ? bruto + c : bruto - c;
    let extra = '';
    if (ex && UI.tipo === 'venta') {
      const P = posiciones().find(x => x.k === clave(clase, sim));
      if (P && P.q > 0) extra = `<div class="tiny muted">Tienes ${cant(P.q)} · ganancia estimada <b class="${cls((p - P.avg) * Math.min(q, P.q) * m - c)}">${signo((p - P.avg) * Math.min(q, P.q) * m - c, mon)}</b></div>`;
    }
    $('#opResumen').innerHTML = `${UI.tipo === 'compra' ? 'Total pagado' : 'Total recibido'}: <b>${money(tot, mon)}</b>${extra}`;
    $('#opResumen').hidden = false;
  } else $('#opResumen').hidden = true;
}

function guardarOp(e) {
  e.preventDefault();
  const clase = $('#opClase').value, simbolo = $('#opSimbolo').value.trim().toUpperCase().replace(/\s+/g, '');
  const cantidad = num($('#opCantidad').value), precio = num($('#opPrecio').value);
  const comision = num($('#opComision').value) || 0;
  const mult = 1;
  if (!simbolo) return toast('Escribe el símbolo');
  if (!(cantidad > 0)) return toast('La cantidad debe ser mayor a 0');
  if (!(precio >= 0)) return toast('Escribe el precio por unidad');
  if (!$('#opFecha').value) return toast('Elige la fecha');
  const ex = existente(clase, simbolo);
  const o = {
    id: UI.editando || uid(), tipo: UI.tipo, clase, simbolo, nombre: $('#opNombre').value.trim(),
    fecha: $('#opFecha').value, cantidad, precio, moneda: ex ? ex.moneda : $('#opMoneda').value, comision,
    mult: ex ? ex.mult : mult, nota: $('#opNota').value.trim(),
    creado: UI.editando ? (D.ops.find(x => x.id === UI.editando) || {}).creado || Date.now() : Date.now(),
  };
  // Al editar el multiplicador/moneda de la única operación, no hay conflicto.
  const i = D.ops.findIndex(x => x.id === o.id);
  if (i >= 0) D.ops[i] = o; else D.ops.push(o);
  guardar(); $('#dlgOp').close(); render();
  toast(UI.editando ? 'Operación actualizada' : 'Operación guardada');
  if (!D.precios[clave(clase, simbolo)]) actualizarPrecios({ silencioso: true });
}

/* ───────────── Respaldo ───────────── */
function descargar(nombre, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function exportarCsv() {
  const col = ['fecha', 'tipo', 'clase', 'simbolo', 'nombre', 'cantidad', 'precio', 'moneda', 'comision', 'multiplicador', 'nota'];
  const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
  const filas = [...D.ops].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(o => [o.fecha, o.tipo, o.clase, o.simbolo, o.nombre, o.cantidad, o.precio, o.moneda, o.comision, o.mult, o.nota].map(q).join(','));
  descargar(`inversiones-operaciones-${hoy()}.csv`, new Blob(['﻿' + [col.join(','), ...filas].join('\n')], { type: 'text/csv' }));
}
async function importar(f) {
  try {
    const x = JSON.parse(await f.text());
    if (!x || x.version !== 1 || !Array.isArray(x.ops)) throw 0;
    if (!confirm(`¿Reemplazar tus datos actuales con este respaldo (${x.ops.length} operaciones)?`)) return;
    const v = VACIO(); D = { ...v, ...x, cfg: { ...v.cfg, ...x.cfg }, fx: { ...v.fx, ...x.fx } };
    guardar(); render(); toast('Respaldo restaurado'); actualizarPrecios({ silencioso: true });
  } catch (e) { toast('Ese archivo no es un respaldo válido de Mis Inversiones'); }
}

/* ───────────── Eventos ───────────── */
document.addEventListener('click', e => {
  const t = e.target.closest('button, .pos, .op-row'); if (!t) return;
  if (t.matches('.tabs button')) { UI.vista = t.dataset.v; render(); scrollTo(0, 0); return; }
  if (t.matches('[data-cerrar]')) { t.closest('dialog').close(); return; }
  if (t.matches('[data-nueva]') || t.id === 'fab') return abrirOp();
  if (t.matches('[data-nueva-de]')) { const P = posiciones().find(p => p.k === t.dataset.nuevaDe); return abrirOp(null, { clase: P.clase, simbolo: P.simbolo, moneda: P.moneda, mult: P.mult, tipo: P.q > 0 ? 'venta' : 'compra' }); }
  if (t.matches('[data-ir]')) { UI.vista = t.dataset.ir; render(); return; }
  if (t.matches('[data-graf]')) { UI.grafica = t.dataset.graf; render(); return; }
  if (t.matches('[data-base]')) { D.cfg.base = t.dataset.base; guardar(); render(); return; }
  if (t.matches('.tipo-op button')) { UI.tipo = t.dataset.tipo; sincForm(); return; }
  if (t.matches('.pos')) return abrirActivo(t.dataset.k);
  if (t.matches('.op-row')) { const o = D.ops.find(x => x.id === t.dataset.op); if (o) abrirOp(o); return; }
  switch (t.id) {
    case 'btnRefrescar': return actualizarPrecios();
    case 'opBorrar':
      if (!confirm('¿Borrar esta operación?')) return;
      D.ops = D.ops.filter(o => o.id !== UI.editando); guardar(); $('#dlgOp').close(); render(); return toast('Operación borrada');
    case 'manGuardar': {
      const v = num($('#manPrecio').value), k = t.dataset.k;
      if ($('#manPrecio').value.trim() === '') delete D.manual[k]; else if (v >= 0) D.manual[k] = v; else return toast('Precio no válido');
      guardar(); render(); abrirActivo(k); if (D.manual[k] == null) actualizarPrecios({ silencioso: true }); return toast('Listo');
    }
    case 'ajGuardar':
      D.cfg.finnhubKey = $('#ajFinn').value.trim(); D.cfg.proxyUrl = $('#ajProxy').value.trim(); D.cfg.auto = $('#ajAuto').checked;
      guardar(); toast('Ajustes guardados'); return actualizarPrecios();
    case 'ajExport': return descargar(`inversiones-respaldo-${hoy()}.json`, new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' }));
    case 'ajCsv': return exportarCsv();
    case 'ajImport': return $('#ajFile').click();
    case 'ajBorrar':
      if (!confirm('¿Borrar TODAS tus operaciones y ajustes de este dispositivo? No se puede deshacer.')) return;
      D = VACIO(); guardar(); render(); return toast('Datos borrados');
  }
});
document.addEventListener('change', e => { if (e.target.id === 'ajFile' && e.target.files[0]) { importar(e.target.files[0]); e.target.value = ''; } });
$('#formOp').addEventListener('submit', guardarOp);
$('#formOp').addEventListener('input', sincForm);
$('#opClase').addEventListener('change', sincForm);
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

setInterval(() => { if (D.cfg.auto && document.visibilityState === 'visible' && navigator.onLine !== false) actualizarPrecios({ silencioso: true }); }, AUTO_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && D.cfg.auto) actualizarPrecios({ silencioso: true }); });

render();
if (D.ops.length) actualizarPrecios({ silencioso: true });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
