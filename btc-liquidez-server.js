'use strict';

// Radar de liquidez BTC: profundidade visível Binance Spot, NÃO liquidações de futuros.
// O token do Telegram continua exclusivamente no server.js / ambiente Render.
module.exports = function installBtcLiquidity({ app, upstreamFirst, binanceBases, telegram, fs, path, dataDir, telegramConfigured }) {
  const stateFile = path.join(dataDir, 'btc-liquidez-estado.json');
  const intervalMs = Math.max(60000, Math.min(600000, Number(process.env.BTC_LIQUIDITY_INTERVAL_MS) || 90000));
  const thresholdPct = Math.max(0.1, Math.min(2, Number(process.env.BTC_LIQUIDITY_ALERT_PCT) || 0.4));
  const cooldownMs = Math.max(30, Math.min(1440, Number(process.env.BTC_LIQUIDITY_COOLDOWN_MIN) || 90)) * 60000;
  const enabled = String(process.env.BTC_LIQUIDITY_ALERTS_ENABLED || 'true').toLowerCase() !== 'false';
  const zoneStep = 100;
  let busy = false;
  let checkedAt = 0;
  let lastError = '';
  let snapshot = null;
  let lastNotify = { bid: { armed: true, time: 0, key: '' }, ask: { armed: true, time: 0, key: '' } };
  let history = [];

  function saveState() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const temp = stateFile + '.tmp';
      fs.writeFileSync(temp, JSON.stringify({ lastNotify, history }, null, 2));
      fs.renameSync(temp, stateFile);
    } catch (err) { console.warn('BTC Liquidez: histórico não persistido:', err.message); }
  }
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (const key of ['bid', 'ask']) {
      const s = saved?.lastNotify?.[key];
      if (s && typeof s === 'object') {
        lastNotify[key] = { armed: s.armed !== false, time: Number(s.time) || 0, key: String(s.key || '') };
      }
    }
    if (Array.isArray(saved?.history)) history = saved.history.slice(-20);
  } catch (_) { /* Primeira execução ou armazenamento efêmero */ }

  function money(n) {
    return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
  function median(values) {
    const a = values.filter(v => v > 0).sort((x, y) => x - y);
    return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0;
  }
  function wall(rows, side, mid) {
    const buckets = new Map();
    let nearValue = 0;
    let coverage = 0;
    let visibleValue = 0;
    for (const [priceText, qtyText] of rows) {
      const price = Number(priceText), qty = Number(qtyText);
      if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
      const dist = Math.abs(price / mid - 1) * 100;
      if ((side === 'bid' && price >= mid) || (side === 'ask' && price <= mid)) continue;
      coverage = Math.max(coverage, dist);
      if (dist > 2) continue; // comparar apenas a mesma faixa percentual dos dois lados
      const notional = price * qty;
      visibleValue += notional;
      if (dist <= 0.5) nearValue += notional;
      const bucket = (side === 'bid' ? Math.floor(price / zoneStep) : Math.ceil(price / zoneStep)) * zoneStep;
      buckets.set(bucket, (buckets.get(bucket) || 0) + notional);
    }
    const eligible = [...buckets.entries()].filter(([price, value]) => value > 0 && Math.abs(price / mid - 1) * 100 <= 2);
    if (!eligible.length) return { zone: null, nearValue, visibleValue, coveragePct: coverage };
    const baseline = median(eligible.map(z => z[1]));
    eligible.sort((a, b) => b[1] - a[1]);
    const [bucket, notional] = eligible[0];
    const low = side === 'bid' ? bucket : Math.max(mid, bucket - zoneStep);
    const high = side === 'bid' ? Math.min(mid, bucket + zoneStep) : bucket;
    const center = Number(((low + high) / 2).toFixed(2));
    const distancePct = (side === 'bid' ? Math.max(0, mid - high) : Math.max(0, low - mid)) / mid * 100;
    return {
      zone: {
        center, low: Number(low.toFixed(2)), high: Number(high.toFixed(2)),
        distancePct: Number(distancePct.toFixed(3)),
        notionalUsd: Math.round(notional),
        relativeStrength: Number((notional / Math.max(1, baseline)).toFixed(2)),
        bucketUsd: zoneStep,
        type: side === 'bid' ? 'PAREDE_COMPRA' : 'PAREDE_VENDA'
      },
      nearValue, visibleValue, coveragePct: Number(coverage.toFixed(3))
    };
  }
  async function scan() {
    if (busy) return;
    busy = true;
    checkedAt = Date.now();
    try {
      const data = await upstreamFirst(
        binanceBases.map(base => base + '/api/v3/depth?symbol=BTCUSDT&limit=1000'),
        x => Array.isArray(x?.bids) && x.bids.length && Array.isArray(x?.asks) && x.asks.length
      );
      const bestBid = Number(data.bids[0][0]), bestAsk = Number(data.asks[0][0]);
      if (!(bestBid > 0 && bestAsk > bestBid)) throw new Error('Livro de ofertas BTC inválido');
      const price = (bestBid + bestAsk) / 2;
      const bid = wall(data.bids, 'bid', price), ask = wall(data.asks, 'ask', price);
      const totalNear = bid.nearValue + ask.nearValue;
      const next = {
        symbol: 'BTCUSDT', source: 'Binance Spot REST /api/v3/depth (1000 níveis por lado)',
        kind: 'visible_orderbook_not_liquidations', scannedAt: Date.now(),
        price: Number(price.toFixed(2)), bestBid, bestAsk,
        spreadPct: Number(((bestAsk - bestBid) / price * 100).toFixed(4)),
        bid: bid.zone, ask: ask.zone,
        depthCoveragePct: { bid: bid.coveragePct, ask: ask.coveragePct },
        visibleNotionalUsd: { bid: Math.round(bid.visibleValue), ask: Math.round(ask.visibleValue) },
        nearHalfPctNotionalUsd: { bid: Math.round(bid.nearValue), ask: Math.round(ask.nearValue) },
        imbalancePct: totalNear > 0 ? Number(((bid.nearValue - ask.nearValue) / totalNear * 100).toFixed(1)) : 0
      };
      const previous = snapshot;
      snapshot = next;
      lastError = '';
      // São alertas de aproximação a ordens visíveis, nunca sinais de entrada.
      let dirty = false;
      for (const side of ['bid', 'ask']) {
        const z = next[side], n = lastNotify[side];
        if (!z) continue;
        if (z.distancePct >= thresholdPct * 1.8 && !n.armed) { n.armed = true; dirty = true; }
        const wasStable = previous && previous[side] && previous[side].center === z.center;
        const isNear = z.distancePct <= thresholdPct;
        if (!enabled || !telegramConfigured || !wasStable || !isNear || z.relativeStrength < 2 || !n.armed || Date.now() - n.time < cooldownMs) continue;
        const text = [
          (side === 'bid' ? '🟢 BTC — APROXIMANDO DA PAREDE DE COMPRA' : '🔴 BTC — APROXIMANDO DA PAREDE DE VENDA'),
          'Binance Spot BTC/USDT — ordens visíveis, NÃO mapa de liquidações',
          'BTC: US$ ' + money(next.price),
          'Zona: US$ ' + money(z.low) + '–' + money(z.high),
          'Distância: ' + money(z.distancePct) + '% | concentração: US$ ' + money(z.notionalUsd),
          'Força relativa ao livro observado: ' + money(z.relativeStrength) + '×',
          'Desequilíbrio próximo (±0,5%): ' + money(next.imbalancePct) + '%',
          'Horário da leitura: ' + new Date(next.scannedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          '⚠️ Parede pode ser retirada. Apenas alerta de estudo; não confirma LONG/SHORT nem entrada.'
        ].join('\n');
        try {
          await telegram(text);
          n.armed = false;
          n.time = Date.now();
          n.key = String(z.center);
          history.push({ at: n.time, side, zone: z.center, price: next.price, status: 'SENT' });
          history = history.slice(-20);
          dirty = true;
        } catch (e) {
          lastError = 'Alerta Telegram: ' + String(e.message || e);
          console.warn('BTC Liquidez:', lastError);
        }
      }
      if (dirty) saveState();
    } catch (e) {
      lastError = 'Dados indisponíveis: ' + String(e.message || e);
      console.warn('BTC Liquidez:', lastError);
    } finally { busy = false; }
  }

  app.get('/api/btc-liquidity', (_req, res) => {
    res.set('cache-control', 'no-store');
    res.json({
      ok: Boolean(snapshot && Date.now() - snapshot.scannedAt < intervalMs * 3),
      snapshot,
      checkedAt,
      stale: !snapshot || Date.now() - snapshot.scannedAt >= intervalMs * 3,
      error: lastError,
      scanning: busy,
      telegram: { configured: Boolean(telegramConfigured), enabled, thresholdPct, cooldownMinutes: cooldownMs / 60000 },
      history: history.slice(-8).reverse(),
      intervalSeconds: intervalMs / 1000,
      disclaimer: 'Book Binance Spot apenas; ordens podem desaparecer. Não representa liquidações de alavancagem nem gatilho de trade.'
    });
  });
  setInterval(scan, intervalMs).unref();
  setTimeout(scan, 6500).unref();
  return { scan };
};
