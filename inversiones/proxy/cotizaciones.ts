// Proxy de cotizaciones de Yahoo Finance para "Mis Inversiones".
// Supabase Edge Function (Deno). Uso: GET ...?s=ES=F,AAPL,AMXL.MX
// Respuesta: { "ES=F": { precio, previo, moneda, nombre }, ... }
// Solo lee precios públicos; no guarda nada ni necesita llaves.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const simbolos = [...new Set((url.searchParams.get('s') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.=^\-]{1,20}$/.test(s)))].slice(0, 50);
  const out: Record<string, unknown> = {};
  await Promise.all(simbolos.map(async (s) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) throw new Error(String(r.status));
      const m = (await r.json()).chart.result[0].meta;
      out[s] = {
        precio: m.regularMarketPrice,
        previo: m.chartPreviousClose ?? m.previousClose ?? null,
        moneda: m.currency,
        nombre: m.shortName || m.longName || s,
      };
    } catch (_) {
      out[s] = { error: true };
    }
  }));
  return new Response(JSON.stringify(out), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });
});
