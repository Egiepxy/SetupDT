'use strict';
// Professor de Resultados OIL EGI V1.0 — auditoria técnica, não execução.
const fs = require('fs');
const path = require('path');
const HORIZONS = [15, 30, 60];
const MAX_EVENTS = 200;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function assessOilWindow(event, candleRows, minutes) {
  const target = event.candleClose + minutes * 60000;
  // Um horário sem candle correspondente permanece pendente; nunca interpolar.
  const final = candleRows.find(row => Math.abs(row.end - target) <= 60000);
  if (!final) return null;
  const windowRows = candleRows.filter(row => row.end > event.candleClose && row.end <= final.end);
  if (!windowRows.length) return null;
  const p = event.price;
  const isLong = event.direction === 'LONG';
  const signedPct = (isLong ? final.close - p : p - final.close) / p * 100;
  const highest = Math.max(...windowRows.map(row => row.high));
  const lowest = Math.min(...windowRows.map(row => row.low));
  const favorablePct = (isLong ? highest - p : p - lowest) / p * 100;
  const adversePct = (isLong ? p - lowest : highest - p) / p * 100;
  // Heurística de sensibilidade (0,5 ATR, piso 0,05 pp); não é taxa de acerto.
  const thresholdPct = Math.max(0.05, (event.atrPct || 0) * 0.5);
  const verdict = signedPct >= thresholdPct ? 'CONFIRMADO' :
    signedPct <= -thresholdPct ? 'FALSO' : 'INCONCLUSIVO';
  return {
    minutes, candleClose: final.end, close: final.close,
    favorableClosePct: Number(signedPct.toFixed(4)),
    mfePct: Number(Math.max(0, favorablePct).toFixed(4)),
    maePct: Number(Math.max(0, adversePct).toFixed(4)),
    thresholdPct: Number(thresholdPct.toFixed(4)), verdict
  };
}

function createOilProfessor(options) {
  const dataDir = options.dataDir;
  const file = path.join(dataDir, 'oil-daytrade-professor.json');
  let events = [];
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(stored)) events = stored.filter(e =>
      e && typeof e.id === 'string' && Number.isFinite(e.candleClose) &&
      Number.isFinite(e.price) && e.price > 0 && ['LONG', 'SHORT'].includes(e.direction)
    ).slice(0, MAX_EVENTS);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Professor OIL: histórico não lido:', error.message);
  }
  function persist() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(events, null, 2));
      fs.renameSync(temp, file);
    } catch (error) {
      console.warn('Professor OIL: falha ao gravar histórico:', error.message);
    }
  }
  function record(reading, source15) {
    if (!reading || !['LONG', 'SHORT'].includes(reading.direction) ||
        !['STRONG', 'ATTENTION'].includes(reading.level)) return false;
    const candleClose = finite(reading.candleClose), price = finite(reading.price);
    if (!candleClose || !price || price <= 0) return false;
    const id = [reading.direction, reading.level, candleClose].join('|');
    if (events.some(e => e.id === id)) return false;
    events.unshift({
      id, sentAt: Date.now(), candleClose, price,
      direction: reading.direction, level: reading.level,
      score: finite(reading.score) || 0,
      atrPct: finite(reading.atrPct) || 0,
      volumeRatio: finite(reading.volumeRatio) || 0,
      context4h: reading.context4h || 'NEUTRAL',
      source15: source15 || 'desconhecida',
      reasons: Array.isArray(reading.reasons) ? reading.reasons.slice(0, 8).map(String) : [],
      results: {}
    });
    events = events.slice(0, MAX_EVENTS);
    persist();
    return true;
  }
  function update(rawRows, source15) {
    const now = Date.now();
    const rows = (Array.isArray(rawRows) ? rawRows : []).filter(row =>
      Array.isArray(row) && row.length >= 7 &&
      Number(row[6]) < now &&
      [row[2], row[3], row[4], row[6]].every(v => Number.isFinite(Number(v)))
    ).map(row => ({ high: +row[2], low: +row[3], close: +row[4], end: +row[6] }))
      .sort((a, b) => a.end - b.end);
    if (!rows.length) return false;
    let changed = false;
    for (const event of events) {
      if (event.source15 !== source15) continue; // Não misturar UKOIL e Brent BZ=F.
      if (!event.results || typeof event.results !== 'object') event.results = {};
      for (const minutes of HORIZONS) {
        if (event.results[minutes]) continue;
        if (now < event.candleClose + minutes * 60000) continue;
        const result = assessOilWindow(event, rows, minutes);
        if (result) {
          event.results[minutes] = result;
          changed = true;
        }
      }
    }
    if (changed) persist();
    return changed;
  }
  function snapshot() {
    const finished = events.filter(e => e.results && e.results[60]);
    const outcomes = { CONFIRMADO: 0, FALSO: 0, INCONCLUSIVO: 0 };
    for (const e of finished) outcomes[e.results[60].verdict]++;
    return {
      generatedAt: Date.now(),
      total: events.length, completed60m: finished.length,
      pending60m: events.length - finished.length,
      outcomes, horizons: HORIZONS,
      persistence: 'Servidor: SETUPDT_DATA_DIR (requer disco persistente para sobreviver a reinstalações)',
      events: events.map(e => ({ ...e, results: { ...(e.results || {}) } }))
    };
  }
  return { record, update, snapshot };
}

module.exports = { createOilProfessor, assessOilWindow };
