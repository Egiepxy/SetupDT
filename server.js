const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const TIMEOUT_MS = 15000;
const markets = new Set(['binance', 'mexc_spot', 'mexc_futures']);
const timeframes = new Set(['15m', '1h', '4h', '1d']);
const futuresTf = { '15m': 'Min15', '1h': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const mexcSpotTf = { '15m': '15m', '1h': '60m', '4h': '4h', '1d': '1d' };
const tfMs = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const binanceBases = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
  'https://data-api.binance.vision'
];

app.disable('x-powered-by');

function clean(value) {
  return String(value || '').trim().toUpperCase().replace(/USDT$/, '').replace(/[^A-Z0-9]/g, '');
}

async function upstream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'SetupDT-Light-MultiExchange/1.2' }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('Resposta inválida'); }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function upstreamFirst(urls) {
  let lastError;
  for (const url of urls) {
    try { return await upstream(url); } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Todas as fontes falharam');
}

function aggregate4h(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const start = Math.floor(row[0] / tfMs['4h']) * tfMs['4h'];
    const current = buckets.get(start);
    if (!current) buckets.set(start, [start, row[1], row[2], row[3], row[4], row[5], start + tfMs['4h'] - 1]);
    else {
      current[2] = Math.max(current[2], row[2]);
      current[3] = Math.min(current[3], row[3]);
      current[4] = row[4];
      current[5] += row[5];
    }
  }
  return [...buckets.values()].sort((a, b) => a[0] - b[0]);
}

async function oilCandles(tf) {
  const config = tf === '15m' ? { interval: '15m', range: '60d' }
    : tf === '1d' ? { interval: '1d', range: '2y' }
      : { interval: '60m', range: '1y' };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent('BZ=F')}?interval=${config.interval}&range=${config.range}&includePrePost=false&events=history`;
  const json = await upstream(url);
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = Number(quote.open?.[i]), high = Number(quote.high?.[i]), low = Number(quote.low?.[i]);
    const close = Number(quote.close?.[i]), volume = Number(quote.volume?.[i] || 0);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    const start = Number(timestamps[i]) * 1000;
    rows.push([start, open, high, low, close, Number.isFinite(volume) ? volume : 0, start + tfMs[tf === '4h' ? '1h' : tf] - 1]);
  }
  const finalRows = tf === '4h' ? aggregate4h(rows) : rows;
  if (finalRows.length < 200) throw new Error(`Brent forneceu somente ${finalRows.length} candles em ${tf}`);
  return finalRows.slice(-220);
}

function requestParams(req, res, needsTf = false) {
  const market = String(req.query.market || '');
  const asset = clean(req.query.asset);
  const tf = String(req.query.tf || '');
  if (!markets.has(market)) { res.status(400).json({ error: 'Mercado inválido' }); return null; }
  if (!/^[A-Z0-9]{2,16}$/.test(asset)) { res.status(400).json({ error: 'Ativo inválido' }); return null; }
  if (needsTf && !timeframes.has(tf)) { res.status(400).json({ error: 'Timeframe inválido' }); return null; }
  return { market, asset, tf };
}

app.get('/api/health', (_req, res) => {
  res.set('cache-control', 'no-store');
  res.json({ ok: true, service: 'SetupDT Light Multi-Exchange V1.3', proxy: true, binanceFallback: true, oil: 'Brent BZ=F', time: new Date().toISOString() });
});

app.get('/api/market/klines', async (req, res) => {
  const p = requestParams(req, res, true);
  if (!p) return;
  try {
    if (p.asset === 'OIL') {
      const data = await oilCandles(p.tf);
      res.set('cache-control', 'no-store');
      return res.json(data);
    }
    let url;
    if (p.market === 'binance') {
      const suffix = `/api/v3/klines?symbol=${encodeURIComponent(p.asset + 'USDT')}&interval=${encodeURIComponent(p.tf)}&limit=220`;
      const data = await upstreamFirst(binanceBases.map(base => base + suffix));
      res.set('cache-control', 'no-store');
      return res.json(data);
    } else if (p.market === 'mexc_spot') {
      url = `https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(p.asset + 'USDT')}&interval=${encodeURIComponent(mexcSpotTf[p.tf])}&limit=220`;
    } else {
      url = `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(p.asset + '_USDT')}?interval=${encodeURIComponent(futuresTf[p.tf])}`;
    }
    const data = await upstream(url);
    res.set('cache-control', 'no-store');
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: 'Fonte externa indisponível', detail: String(error.message || error) });
  }
});

app.get('/api/market/ticker', async (req, res) => {
  const p = requestParams(req, res, false);
  if (!p) return;
  try {
    if (p.asset === 'OIL') {
      const rows = await oilCandles('15m');
      const price = rows.at(-1)[4];
      const symbol = p.market === 'mexc_futures' ? 'OIL_USDT' : 'OILUSDT';
      res.set('cache-control', 'no-store');
      return res.json({ symbol, price: String(price), time: Date.now(), source: 'Brent BZ=F' });
    }
    let url;
    if (p.market === 'binance') {
      const suffix = `/api/v3/ticker/price?symbol=${encodeURIComponent(p.asset + 'USDT')}`;
      const data = await upstreamFirst(binanceBases.map(base => base + suffix));
      res.set('cache-control', 'no-store');
      return res.json(data);
    } else if (p.market === 'mexc_spot') {
      url = `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(p.asset + 'USDT')}`;
    } else {
      url = `https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(p.asset + '_USDT')}`;
    }
    const data = await upstream(url);
    res.set('cache-control', 'no-store');
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: 'Cotação externa indisponível', detail: String(error.message || error) });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`SetupDT Light V1.3 online na porta ${PORT}`));
