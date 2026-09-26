const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const TIMEOUT_MS = 15000;
const markets = new Set(['binance', 'mexc_spot', 'mexc_futures', 'mexc_stocks']);
const timeframes = new Set(['15m', '1h', '4h', '1d']);
const futuresTf = { '15m': 'Min15', '1h': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const mexcSpotTf = { '15m': '15m', '1h': '60m', '4h': '4h', '1d': '1d' };
const tfMs = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const fs = require('fs');
const DATA_DIR = process.env.SETUPDT_DATA_DIR || path.join(__dirname, 'data');
const TRADES_FILE = path.join(DATA_DIR, 'simulated-trades.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'server-watchlist.json');
const MONITOR_MS = Math.max(15000, Number(process.env.MONITOR_INTERVAL_MS) || 30000);
const SIGNAL_SCAN_MS = Math.max(60000, Number(process.env.SIGNAL_SCAN_INTERVAL_MS) || 300000);
const ENTRY_WAIT_MS = Math.max(5 * 60 * 1000, Number(process.env.ENTRY_WAIT_MS) || 60 * 60 * 1000);
const TELEGRAM_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const TELEGRAM_CHAT_IDS = [...new Set([
  TELEGRAM_CHAT_ID,
  ...String(process.env.TELEGRAM_CHAT_IDS || '').split(',').map(value => value.trim())
].filter(Boolean))];
const activeTrades = new Map();
let monitorRunning = false;
let signalScanRunning = false;
let lastSignalScan = { startedAt: 0, finishedAt: 0, total: 0, checked: 0, signals: 0, errors: 0, running: false };
let watchRevision = 0;
let serverWatch = { market: 'mexc_stocks', assets: [], updatedAt: 0 };
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

function contractSymbols(market, asset) {
  if (market === 'mexc_stocks') return [`${asset}STOCK_USDT`, `${asset}_USDT`, `${asset}USDT`];
  return [`${asset}_USDT`];
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

async function upstreamFirst(urls, validate = () => true) {
  let lastError;
  for (const url of urls) {
    try {
      const data = await upstream(url);
      if (!validate(data)) throw new Error('Símbolo não disponível nesta tentativa');
      return data;
    } catch (error) { lastError = error; }
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
  return upstreamFirst(
    contractSymbols(market, asset).map(symbol => `https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(symbol)}`),
    data => data?.success === true && Number(data?.data?.lastPrice) > 0
  );
}

function tickerPrice(market, data) {
  const value = (market === 'mexc_futures' || market === 'mexc_stocks') ? data?.data?.lastPrice : data?.price;
  const price = Number(value);
  if (!(price > 0)) throw new Error('Preço inválido');
  return price;
}

function loadWatchlist() {
  try {
    const value = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    if (markets.has(value?.market) && Array.isArray(value?.assets)) serverWatch = { market: value.market, assets: value.assets.map(clean).filter(Boolean).slice(0, 100), updatedAt: Number(value.updatedAt) || 0 };
  } catch (error) { if (error.code !== 'ENOENT') console.error('Falha ao restaurar lista monitorada:', error.message); }
}

function saveWatchlist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = WATCHLIST_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(serverWatch, null, 2));
  fs.renameSync(temp, WATCHLIST_FILE);
}

function sma(values, period) { return values.length < period ? null : values.slice(-period).reduce((a, b) => a + b, 0) / period; }
function rsi(values, period = 14) { if (values.length <= period) return null; let gains = 0, losses = 0; for (let i = values.length - period; i < values.length; i++) { const d = values[i] - values[i - 1]; if (d > 0) gains += d; else losses -= d; } return losses === 0 ? (gains === 0 ? 50 : 100) : 100 - 100 / (1 + (gains / period) / (losses / period)); }
function atr(highs, lows, closes, period = 14) { if (closes.length <= period) return null; const values = []; for (let i = 1; i < closes.length; i++) values.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))); return sma(values, period); }
function snapshot(rows) { const closes = rows.map(x => x[4]), highs = rows.map(x => x[2]), lows = rows.map(x => x[3]), vols = rows.map(x => x[5]), price = closes.at(-1), m20 = sma(closes, 20), m50 = sma(closes, 50), m200 = sma(closes, 200), rv = sma(vols, 20), rr = rsi(closes), aa = atr(highs, lows, closes); let trend = 'Lateral'; if (m200 !== null && price > m20 && m20 > m50 && m50 > m200) trend = 'Alta forte'; else if (price > m20 && m20 > m50) trend = 'Alta'; else if (m200 !== null && price < m20 && m20 < m50 && m50 < m200) trend = 'Baixa forte'; else if (price < m20 && m20 < m50) trend = 'Baixa'; let score = 0; if (price > m20) score++; else score--; if (m20 > m50) score++; else score--; if (m200 !== null) { if (price > m200) score++; else score--; } if (rr < 35) score++; if (rr > 70) score--; if (rv && vols.at(-1) > rv * 1.2) score += Math.sign(price - closes.at(-2)); let signal = 'N'; if (score >= 3) signal = 'L+'; else if (score >= 1) signal = 'L'; else if (score <= -3) signal = 'S+'; else if (score <= -1) signal = 'S'; if (!(aa > 0)) throw new Error('ATR indisponível'); return { price, trend, score, signal, dir: signal.startsWith('L') ? 'LONG' : signal.startsWith('S') ? 'SHORT' : 'NEUTRO', r: rr, atr: aa, volRatio: rv ? vols.at(-1) / rv : 0, candle: rows.at(-1)[6] }; }

function trackerStrength(snaps) {
  const dirs = snaps.map(x => x.trend.startsWith('Alta') ? 1 : x.trend.startsWith('Baixa') ? -1 : 0);
  const weighted = dirs[0] + dirs[1] * 2 + dirs[2] * 3 + dirs[3] * 4;
  const direction = Math.sign(weighted), agreement = Math.abs(weighted) / 10;
  const strongCount = snaps.filter(x => x.trend.includes('forte')).length;
  const force = Math.min(99, Math.round(45 + agreement * 45 + strongCount * 2));
  let signal = 'NEUTRO';
  if (direction > 0 && force >= 80) signal = 'LONG FORTE'; else if (direction > 0 && force >= 62) signal = 'LONG';
  else if (direction < 0 && force >= 80) signal = 'SHORT FORTE'; else if (direction < 0 && force >= 62) signal = 'SHORT';
  return { force, signal };
}

async function serverCandles(market, asset, tf) {
  if (asset === 'OIL') return (await oilCandles(tf)).rows;
  if (market === 'binance') return upstreamFirst(binanceBases.map(base => `${base}/api/v3/klines?symbol=${encodeURIComponent(asset + 'USDT')}&interval=${encodeURIComponent(tf)}&limit=220`));
  if (market === 'mexc_spot') return upstream(`https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(asset + 'USDT')}&interval=${encodeURIComponent(mexcSpotTf[tf])}&limit=220`);
  const data = await upstreamFirst(
    contractSymbols(market, asset).map(symbol => `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(futuresTf[tf])}`),
    value => value?.success === true && Array.isArray(value?.data?.time) && value.data.time.length >= 50
  );
  if (!data?.success || !Array.isArray(data?.data?.time)) throw new Error('Candles MEXC inválidos');
  return data.data.time.map((time, i) => { const start = Number(time) * 1000; return [start, Number(data.data.open[i]), Number(data.data.high[i]), Number(data.data.low[i]), Number(data.data.close[i]), Number(data.data.vol?.[i] || 0), start + tfMs[tf] - 1]; });
}

async function inspectSignal(asset) {
  const market = serverWatch.market;
  const sets = await Promise.all(['15m', '1h', '4h', '1d'].map(tf => serverCandles(market, asset, tf)));
  const snaps = sets.map(rows => snapshot(rows.filter(row => Number(row[6]) < Date.now() - 1000).slice(-220)));
  const [m15, h1, h4, d1] = snaps;
  const tracker = trackerStrength([m15, h1, h4, d1]);
  const align = h4.dir !== 'NEUTRO' && h4.dir === h1.dir;
  const direction = align && m15.dir === h4.dir ? h4.dir : 'NEUTRO';
  const trackerDirection = tracker.signal.startsWith('LONG') ? 'LONG' : tracker.signal.startsWith('SHORT') ? 'SHORT' : 'NEUTRO';
  const conflict = direction !== 'NEUTRO' && trackerDirection !== direction;
  const tradable = direction !== 'NEUTRO' && m15.volRatio >= .8 && m15.r >= 30 && m15.r <= 70 && !conflict;
  if (!tradable || Date.now() - m15.candle > 60 * 60 * 1000) return false;
  const sign = direction === 'LONG' ? 1 : -1, entry = m15.price, risk = m15.atr * 1.2;
  const levels = { entry, stop: entry - sign * risk, t1: entry + sign * risk * 1.5, t2: entry + sign * risk * 2, t3: entry + sign * risk * 3 };
  const result = await registerTradeCandidate({
    market,
    marketLabel: market === 'mexc_stocks' ? 'MEXC Futuros — Ações' : market,
    asset,
    direction,
    candle: m15.candle,
    ...levels,
    source: 'Varredura automática do servidor'
  });
  return Boolean(result.created);
}

async function monitorSignals() {
  if (signalScanRunning || !serverWatch.assets.length) return;
  signalScanRunning = true;
  const revisionAtStart = watchRevision, marketAtStart = serverWatch.market, assets = [...serverWatch.assets];
  lastSignalScan = { startedAt: Date.now(), finishedAt: 0, total: assets.length, checked: 0, signals: 0, errors: 0, running: true };
  let index = 0;
  const worker = async () => {
    while (index < assets.length && serverWatch.market === marketAtStart) {
      const asset = assets[index++];
      try { if (await inspectSignal(asset)) lastSignalScan.signals++; }
      catch (error) { lastSignalScan.errors++; console.warn(`Sinal ${asset}:`, error.message); }
      finally { lastSignalScan.checked++; }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(3, assets.length) }, () => worker())); }
  finally { lastSignalScan.running = false; lastSignalScan.finishedAt = Date.now(); signalScanRunning = false; if (watchRevision !== revisionAtStart) setImmediate(monitorSignals); }
}

function loadTrades() {
  try {
    const rows = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
    let migrated = false;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row?.key) continue;
        // V2.1: não herda operações OPEN antigas que não possuíam confirmação real de entrada.
        if (row.status === 'OPEN' && !row.activatedAt && !row.events?.entry) {
          row.status = 'LEGACY_CLOSED';
          row.migratedAt = Date.now();
          migrated = true;
        }
        activeTrades.set(row.key, row);
      }
    }
    if (migrated) saveTrades();
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
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_IDS.length) throw new Error('Telegram não configurado no Render');
  const results = [];
  for (const chatId of TELEGRAM_CHAT_IDS) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
      results.push({ chatId, ok: true });
    } catch (error) {
      results.push({ chatId, ok: false, error: String(error.message || error) });
    }
  }
  const sent = results.filter(result => result.ok).length;
  if (!sent) throw new Error(results.map(result => result.error).filter(Boolean).join('; ') || 'Falha no Telegram');
  const failed = results.filter(result => !result.ok);
  if (failed.length) console.warn('Falha parcial no Telegram:', failed);
  return { ok: true, sent, failed: failed.length };
}

async function notifyTradeOpened(trade) {
  const icon = trade.direction === 'LONG' ? '🟢' : '🔴';
  await telegram(`${icon} SETUPDT — ENTRADA CONFIRMADA
SIMULAÇÃO ${trade.direction} • ${trade.asset}/USDT • ${trade.marketLabel}
Entrada: $ ${money(trade.entry)}
Preço de ativação: $ ${money(trade.lastPrice ?? trade.entry)}
STOP: $ ${money(trade.stop)}
Alvos: $ ${money(trade.t1)} | $ ${money(trade.t2)} | $ ${money(trade.t3)}
Checklist 6/6 • 15m, 1h e 4h
Não é ordem real.`);
}

async function notifyWaitingEntry(trade) {
  const icon = trade.direction === 'LONG' ? '🟢' : '🔴';
  await telegram(`🔵 SETUPDT — SINAL ${trade.direction} DETECTADO
${trade.asset}/USDT • ${trade.marketLabel}
Entrada planejada: $ ${money(trade.entry)}
Preço atual: $ ${money(trade.lastPrice)}
${icon} Situação: AGUARDANDO ENTRADA/PULLBACK
Os alvos só serão monitorados depois que a entrada for tocada/confirmada.
Não perseguir o preço.`);
}

async function notifyMissedEntry(trade) {
  await telegram(`🔵 SETUPDT — ENTRADA PERDIDA / NÃO ENTRAR
${trade.asset}/USDT • ${trade.marketLabel}
Sinal: ${trade.direction}
Entrada planejada: $ ${money(trade.entry)}
Preço atual: $ ${money(trade.lastPrice)}
Alvo 1: $ ${money(trade.t1)}
Movimento já avançou além do Alvo 1 antes da ativação. Aguardar novo pullback/gatilho.`);
}

async function notifyEntryExpired(trade) {
  await telegram(`⚪ SETUPDT — SINAL EXPIRADO
${trade.asset}/USDT • ${trade.marketLabel}
${trade.direction} não tocou a entrada dentro da janela de ${Math.round(ENTRY_WAIT_MS / 60000)} min.
Entrada planejada: $ ${money(trade.entry)}
Aguardar novo gatilho.`);
}

async function notifySignalInvalidated(trade) {
  await telegram(`⚠️ SETUPDT — SINAL INVALIDADO ANTES DA ENTRADA
${trade.asset}/USDT • ${trade.marketLabel}
Sinal: ${trade.direction}
Entrada planejada: $ ${money(trade.entry)}
Preço atual: $ ${money(trade.lastPrice)}
O preço atingiu a região de invalidação/STOP antes da entrada.`);
}

async function closeEvent(trade, label, price) {
  const icon = label === 'STOP' ? '🛑' : '🎯';
  await telegram(`${icon} SETUPDT — ${label} ACIONADO
SIMULAÇÃO ${trade.direction} • ${trade.asset}/USDT
Preço monitorado: $ ${money(price)}
Entrada: $ ${money(trade.entry)}${label === 'STOP' ? '\nSimulação encerrada no STOP.' : ''}`);
}

function sameAssetActiveTrade(market, asset) {
  return [...activeTrades.values()].find(row =>
    row.market === market &&
    row.asset === asset &&
    (row.status === 'WAITING_ENTRY' || row.status === 'OPEN')
  ) || null;
}

function classifyBeforeEntry(trade, price) {
  const isLong = trade.direction === 'LONG';
  const invalid = isLong ? price <= trade.stop : price >= trade.stop;
  if (invalid) return 'INVALIDATED';
  const missed = isLong ? price >= trade.t1 : price <= trade.t1;
  if (missed) return 'MISSED';
  const touched = isLong ? price <= trade.entry : price >= trade.entry;
  return touched ? 'OPEN' : 'WAITING_ENTRY';
}

async function registerTradeCandidate(input) {
  const key = `${input.market}|${input.asset}|${input.direction}|${input.candle}`;
  const previous = activeTrades.get(key);
  if (previous) return { ok: true, duplicate: true, key, status: previous.status, created: false };

  const active = sameAssetActiveTrade(input.market, input.asset);
  if (active) {
    return { ok: true, duplicate: true, key: active.key, status: active.status, created: false, reason: 'asset-already-active' };
  }

  const raw = await marketTicker(input.market, input.asset);
  const price = tickerPrice(input.market, raw);
  const trade = {
    key,
    market: input.market,
    marketLabel: String(input.marketLabel || input.market).slice(0, 40),
    asset: input.asset,
    direction: input.direction,
    candle: input.candle,
    entry: input.entry,
    stop: input.stop,
    t1: input.t1,
    t2: input.t2,
    t3: input.t3,
    source: String(input.source || 'Sinal').slice(0, 80),
    status: 'WAITING_ENTRY',
    openedAt: Date.now(),
    waitStartedAt: Date.now(),
    lastPrice: price,
    lastCheckedAt: Date.now(),
    events: {}
  };

  trade.status = classifyBeforeEntry(trade, price);
  activeTrades.set(key, trade);
  saveTrades();

  try {
    if (trade.status === 'OPEN') {
      trade.activatedAt = Date.now();
      trade.events.entry = trade.activatedAt;
      await notifyTradeOpened(trade);
      trade.events.open = Date.now();
    } else if (trade.status === 'WAITING_ENTRY') {
      await notifyWaitingEntry(trade);
      trade.events.waiting = Date.now();
    } else if (trade.status === 'MISSED') {
      await notifyMissedEntry(trade);
      trade.events.missed = Date.now();
    } else if (trade.status === 'INVALIDATED') {
      await notifySignalInvalidated(trade);
      trade.events.invalidated = Date.now();
    }
  } catch (error) {
    trade.lastError = String(error.message || error);
  }
  saveTrades();
  return { ok: true, key, status: trade.status, created: true, price };
}

async function inspectTrade(trade) {
  const raw = await marketTicker(trade.market, trade.asset);
  const price = tickerPrice(trade.market, raw);
  trade.lastPrice = price;
  trade.lastCheckedAt = Date.now();

  if (trade.status === 'WAITING_ENTRY') {
    if (Date.now() - Number(trade.waitStartedAt || trade.openedAt || Date.now()) >= ENTRY_WAIT_MS) {
      trade.status = 'EXPIRED';
      if (!trade.events.expired) {
        await notifyEntryExpired(trade);
        trade.events.expired = Date.now();
      }
      return;
    }
    const next = classifyBeforeEntry(trade, price);
    if (next === 'MISSED') {
      trade.status = 'MISSED';
      if (!trade.events.missed) {
        await notifyMissedEntry(trade);
        trade.events.missed = Date.now();
      }
      return;
    }
    if (next === 'INVALIDATED') {
      trade.status = 'INVALIDATED';
      if (!trade.events.invalidated) {
        await notifySignalInvalidated(trade);
        trade.events.invalidated = Date.now();
      }
      return;
    }
    if (next === 'OPEN') {
      trade.status = 'OPEN';
      trade.activatedAt = Date.now();
      trade.events.entry = trade.activatedAt;
      if (!trade.events.open) {
        await notifyTradeOpened(trade);
        trade.events.open = Date.now();
      }
      return; // não checa alvo no mesmo ciclo da ativação
    }
    return;
  }

  if (trade.status !== 'OPEN') return;

  const isLong = trade.direction === 'LONG';
  const stopped = isLong ? price <= trade.stop : price >= trade.stop;
  if (stopped) {
    if (!trade.events.stop) {
      await closeEvent(trade, 'STOP', price);
      trade.events.stop = Date.now();
    }
    trade.status = 'STOPPED';
    return;
  }

  const sequence = [
    ['t1', 'ALVO 1'],
    ['t2', 'ALVO 2'],
    ['t3', 'ALVO 3']
  ];
  for (const [field, label] of sequence) {
    if (trade.events[field]) continue;
    const hit = isLong ? price >= trade[field] : price <= trade[field];
    if (hit) {
      await closeEvent(trade, label, price);
      trade.events[field] = Date.now();
      if (field === 't3') trade.status = 'TARGET3';
    }
    break; // apenas o próximo alvo pendente por ciclo
  }
}

async function monitorTrades() {
  const monitored = [...activeTrades.values()].filter(trade => trade.status === 'OPEN' || trade.status === 'WAITING_ENTRY');
  if (monitorRunning || !monitored.length) return;
  monitorRunning = true;
  try {
    for (const trade of monitored) {
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
  res.json({ ok: true, service: 'SetupDT Light Multi-Exchange V2.1 Proteção de Entrada', proxy: true, telegramConfigured: Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_IDS.length), telegramRecipients: TELEGRAM_CHAT_IDS.length, simulatedTradesOpen: [...activeTrades.values()].filter(row => row.status === 'OPEN').length, waitingEntries: [...activeTrades.values()].filter(row => row.status === 'WAITING_ENTRY').length, monitorSeconds: MONITOR_MS / 1000, signalScanSeconds: SIGNAL_SCAN_MS / 1000, entryWaitMinutes: ENTRY_WAIT_MS / 60000, monitoredMarket: serverWatch.market, monitoredAssets: serverWatch.assets.length, signalScan: lastSignalScan, binanceFallback: true, oil: 'MEXC UKOIL_USDT + reserva Brent BZ=F', time: new Date().toISOString() });
});

app.get('/api/watchlist', (_req, res) => res.json({ ok: true, ...serverWatch, scanSeconds: SIGNAL_SCAN_MS / 1000, scan: lastSignalScan }));
app.post('/api/watchlist', (req, res) => {
  try {
    const market = String(req.body?.market || ''), assets = Array.isArray(req.body?.assets) ? [...new Set(req.body.assets.map(clean).filter(x => /^[A-Z0-9]{2,16}$/.test(x)))].slice(0, 100) : [];
    if (!markets.has(market)) throw new Error('Mercado inválido');
    serverWatch = { market, assets, updatedAt: Date.now() }; watchRevision++; saveWatchlist();
    res.json({ ok: true, ...serverWatch, scanSeconds: SIGNAL_SCAN_MS / 1000, scan: lastSignalScan });
    setImmediate(monitorSignals);
  } catch (error) { res.status(400).json({ ok: false, error: String(error.message || error) }); }
});

app.post('/api/telegram/test', async (_req, res) => {
  try { const result = await telegram('✅ SetupDT Light V2.1 conectado. Proteção de entrada, varredura automática e Telegram ativos.'); res.json(result); }
  catch (error) { res.status(503).json({ ok: false, error: String(error.message || error) }); }
});

app.post('/api/trades/register', async (req, res) => {
  try {
    const body = req.body || {}, market = String(body.market || ''), asset = clean(body.asset), direction = String(body.direction || '').toUpperCase();
    const candle = Number(body.candle), levels = ['entry', 'stop', 't1', 't2', 't3'].reduce((o, k) => (o[k] = Number(body[k]), o), {});
    if (!markets.has(market) || !/^[A-Z0-9]{2,16}$/.test(asset) || !['LONG', 'SHORT'].includes(direction)) throw new Error('Sinal inválido');
    if (!Number.isFinite(candle) || !Object.values(levels).every(v => Number.isFinite(v) && v > 0)) throw new Error('Níveis inválidos');
    const ordered = direction === 'LONG'
      ? levels.stop < levels.entry && levels.entry < levels.t1 && levels.t1 < levels.t2 && levels.t2 < levels.t3
      : levels.stop > levels.entry && levels.entry > levels.t1 && levels.t1 > levels.t2 && levels.t2 > levels.t3;
    if (!ordered) throw new Error('Ordem dos níveis inválida');

    const result = await registerTradeCandidate({
      market,
      marketLabel: String(body.marketLabel || market).slice(0, 40),
      asset,
      direction,
      candle,
      ...levels,
      source: body.source || 'Painel'
    });
    res.status(result.created ? 201 : 200).json(result);
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
      const data = await upstreamFirst(
        contractSymbols(p.market, p.asset).map(symbol => `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(futuresTf[p.tf])}`),
        value => value?.success === true && Array.isArray(value?.data?.time) && value.data.time.length >= 50
      );
      res.set('cache-control', 'no-store');
      return res.json(data);
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
loadWatchlist();
setInterval(monitorTrades, MONITOR_MS).unref();
setInterval(monitorSignals, SIGNAL_SCAN_MS).unref();
setTimeout(monitorSignals, 10000).unref();
app.listen(PORT, '0.0.0.0', () => console.log(`SetupDT Light V2.1 Proteção de Entrada online na porta ${PORT}`));
