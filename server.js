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
const fs = require('fs');
const DATA_DIR = process.env.SETUPDT_DATA_DIR || path.join(__dirname, 'data');
const TRADES_FILE = path.join(DATA_DIR, 'simulated-trades.json');
const MONITOR_MS = Math.max(15000, Number(process.env.MONITOR_INTERVAL_MS) || 30000);
const TELEGRAM_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const activeTrades = new Map();
let monitorRunning = false;
const binanceBases = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
  'https://data-api.binance.vision'
];

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

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

async function yahooOilCandles(tf) {
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

async function oilCandles(tf) {
  try {
    const url = `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent('UKOIL_USDT')}?interval=${encodeURIComponent(futuresTf[tf])}`;
    const json = await upstream(url);
    const data = json?.data;
    if (!json?.success || !Array.isArray(data?.time)) throw new Error('UKOIL indisponível');
    const rows = data.time.map((time, i) => {
      const start = Number(time) * 1000;
      return [start, Number(data.open[i]), Number(data.high[i]), Number(data.low[i]), Number(data.close[i]), Number(data.vol?.[i] || 0), start + tfMs[tf] - 1];
    }).filter(row => row.every(Number.isFinite));
    if (rows.length < 200) throw new Error(`UKOIL forneceu somente ${rows.length} candles`);
    return { rows: rows.slice(-220), source: 'MEXC UKOIL_USDT' };
  } catch (_) {
    return { rows: await yahooOilCandles(tf), source: 'Brent BZ=F' };
  }
}

async function oilTicker(market) {
  try {
    const json = await upstream(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent('UKOIL_USDT')}`);
    const price = Number(json?.data?.lastPrice);
    if (!json?.success || !(price > 0)) throw new Error('Cotação UKOIL indisponível');
    return { symbol: market === 'mexc_futures' ? 'OIL_USDT' : 'OILUSDT', price: String(price), time: Number(json.data.timestamp) || Date.now(), source: 'MEXC UKOIL_USDT' };
  } catch (_) {
    const oil = await oilCandles('15m');
    return { symbol: market === 'mexc_futures' ? 'OIL_USDT' : 'OILUSDT', price: String(oil.rows.at(-1)[4]), time: Date.now(), source: oil.source };
  }
}

async function marketTicker(market, asset) {
  if (asset === 'OIL') return oilTicker(market);
  if (market === 'binance') {
    const suffix = `/api/v3/ticker/price?symbol=${encodeURIComponent(asset + 'USDT')}`;
    return upstreamFirst(binanceBases.map(base => base + suffix));
  }
  if (market === 'mexc_spot') {
    return upstream(`https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(asset + 'USDT')}`);
  }
  return upstream(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(asset + '_USDT')}`);
}

function tickerPrice(market, data) {
  const value = market === 'mexc_futures' ? data?.data?.lastPrice : data?.price;
  const price = Number(value);
  if (!(price > 0)) throw new Error('Preço inválido');
  return price;
}

function loadTrades() {
  try {
    const rows = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    if (Array.isArray(rows)) for (const row of rows) if (row?.key) activeTrades.set(row.key, row);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Falha ao restaurar simulações:', error.message);
  }
}

function saveTrades() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = TRADES_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify([...activeTrades.values()], null, 2));
  fs.renameSync(temp, TRADES_FILE);
}

function money(value) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
}

async function telegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) throw new Error('Telegram não configurado no Render');
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
  return data;
}

async function notifyTradeOpened(trade) {
  const icon = trade.direction === 'LONG' ? '🟢' : '🔴';
  await telegram(`${icon} SETUPDT — SIMULAÇÃO ${trade.direction}\n${trade.asset}/USDT • ${trade.marketLabel}\nEntrada: $ ${money(trade.entry)}\nSTOP: $ ${money(trade.stop)}\nAlvos: $ ${money(trade.t1)} | $ ${money(trade.t2)} | $ ${money(trade.t3)}\nChecklist 6/6 • 15m, 1h e 4h\nNão é ordem real.`);
}

async function closeEvent(trade, label, price) {
  const icon = label === 'STOP' ? '🛑' : '🎯';
  await telegram(`${icon} SETUPDT — ${label} ACIONADO\nSIMULAÇÃO ${trade.direction} • ${trade.asset}/USDT\nPreço monitorado: $ ${money(price)}\nEntrada: $ ${money(trade.entry)}${label === 'STOP' ? '\nSimulação encerrada no STOP.' : ''}`);
}

async function inspectTrade(trade) {
  const raw = await marketTicker(trade.market, trade.asset);
  const price = tickerPrice(trade.market, raw);
  trade.lastPrice = price; trade.lastCheckedAt = Date.now();
  const isLong = trade.direction === 'LONG';
  const stopped = isLong ? price <= trade.stop : price >= trade.stop;
  if (stopped) {
    if (!trade.events.stop) { await closeEvent(trade, 'STOP', price); trade.events.stop = Date.now(); }
    trade.status = 'STOPPED'; return;
  }
  for (const [field, label] of [['t1', 'ALVO 1'], ['t2', 'ALVO 2'], ['t3', 'ALVO 3']]) {
    const hit = isLong ? price >= trade[field] : price <= trade[field];
    if (hit && !trade.events[field]) { await closeEvent(trade, label, price); trade.events[field] = Date.now(); }
  }
  if (trade.events.t3) trade.status = 'TARGET3';
}

async function monitorTrades() {
  if (monitorRunning || ![...activeTrades.values()].some(trade => trade.status === 'OPEN')) return;
  monitorRunning = true;
  try {
    for (const trade of [...activeTrades.values()].filter(row => row.status === 'OPEN')) {
      try { await inspectTrade(trade); } catch (error) { trade.lastError = String(error.message || error); }
    }
    saveTrades();
  } finally { monitorRunning = false; }
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
  res.json({ ok: true, service: 'SetupDT Light Multi-Exchange V1.6 Telegram', proxy: true, telegramConfigured: Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID), simulatedTradesOpen: [...activeTrades.values()].filter(row => row.status === 'OPEN').length, monitorSeconds: MONITOR_MS / 1000, binanceFallback: true, oil: 'MEXC UKOIL_USDT + reserva Brent BZ=F', time: new Date().toISOString() });
});

app.post('/api/telegram/test', async (_req, res) => {
  try { await telegram('✅ SetupDT Light V1.6 conectado. Mensagem de teste do Render.'); res.json({ ok: true }); }
  catch (error) { res.status(503).json({ ok: false, error: String(error.message || error) }); }
});

app.post('/api/trades/register', async (req, res) => {
  try {
    const body = req.body || {}, market = String(body.market || ''), asset = clean(body.asset), direction = String(body.direction || '').toUpperCase();
    const candle = Number(body.candle), levels = ['entry', 'stop', 't1', 't2', 't3'].reduce((o, k) => (o[k] = Number(body[k]), o), {});
    if (!markets.has(market) || !/^[A-Z0-9]{2,16}$/.test(asset) || !['LONG', 'SHORT'].includes(direction)) throw new Error('Sinal inválido');
    if (!Number.isFinite(candle) || !Object.values(levels).every(v => Number.isFinite(v) && v > 0)) throw new Error('Níveis inválidos');
    const ordered = direction === 'LONG' ? levels.stop < levels.entry && levels.entry < levels.t1 && levels.t1 < levels.t2 && levels.t2 < levels.t3 : levels.stop > levels.entry && levels.entry > levels.t1 && levels.t1 > levels.t2 && levels.t2 > levels.t3;
    if (!ordered) throw new Error('Ordem dos níveis inválida');
    const key = `${market}|${asset}|${direction}|${candle}`;
    if (activeTrades.has(key)) return res.json({ ok: true, duplicate: true, key });
    const trade = { key, market, marketLabel: String(body.marketLabel || market).slice(0, 40), asset, direction, candle, ...levels, status: 'OPEN', openedAt: Date.now(), events: {} };
    activeTrades.set(key, trade); saveTrades();
    try { await notifyTradeOpened(trade); trade.events.open = Date.now(); saveTrades(); }
    catch (error) { activeTrades.delete(key); saveTrades(); throw error; }
    res.status(201).json({ ok: true, key });
  } catch (error) { res.status(400).json({ ok: false, error: String(error.message || error) }); }
});

app.get('/api/market/klines', async (req, res) => {
  const p = requestParams(req, res, true);
  if (!p) return;
  try {
    if (p.asset === 'OIL') {
      const data = await oilCandles(p.tf);
      res.set('cache-control', 'no-store');
      res.set('x-setupdt-source', data.source);
      return res.json(data.rows);
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
      const ticker = await oilTicker(p.market);
      res.set('cache-control', 'no-store');
      return res.json(ticker);
    }
    const data = await marketTicker(p.market, p.asset);
    res.set('cache-control', 'no-store');
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: 'Cotação externa indisponível', detail: String(error.message || error) });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadTrades();
setInterval(monitorTrades, MONITOR_MS).unref();
app.listen(PORT, '0.0.0.0', () => console.log(`SetupDT Light V1.6 Telegram online na porta ${PORT}`));
