'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOilProfessor, assessOilWindow } = require('../oil-professor');

test('veredito diferencia movimento favorável, falso e inconclusivo no fechamento', () => {
  const t = Date.now() - 2 * 3600000;
  const entry = { candleClose: t, price: 100, direction: 'SHORT', atrPct: 0.20 };
  const row = [{ end: t + 900000, high: 100.5, low: 97, close: 98 }];
  const result = assessOilWindow(entry, row, 15);
  assert.equal(result.verdict, 'CONFIRMADO');
  assert.equal(result.favorableClosePct, 2);
  assert.equal(result.mfePct, 3);
  assert.equal(result.maePct, 0.5);
  assert.equal(assessOilWindow({ ...entry, direction: 'LONG' }, row, 15).verdict, 'FALSO');
  assert.equal(assessOilWindow(entry, [{ end: t + 900000, high: 100.05, low: 99.95, close: 99.98 }], 15).verdict, 'INCONCLUSIVO');
  assert.equal(assessOilWindow(entry, [], 15), null);
});

test('registra sem duplicar, não mistura instrumentos, restaura 15/30/60m', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egi-oil-professor-'));
  try {
    const engine = createOilProfessor({ dataDir: dir });
    const t = Date.now() - 70 * 60000;
    const signal = {
      candleClose: t, price: 100, direction: 'SHORT', level: 'STRONG',
      score: 84, volumeRatio: 1.69, atrPct: 0.21, context4h: 'NEUTRAL',
      reasons: ['MME9/21', 'volume alto']
    };
    assert.equal(engine.record(signal, 'MEXC UKOIL_USDT'), true);
    assert.equal(engine.record(signal, 'MEXC UKOIL_USDT'), false);
    const rows = [15, 30, 45, 60].map((minutes, i) => [
      t + (minutes - 15) * 60000, 100, 100, 99 - i * 0.2,
      99.6 - i * 0.2, 1000, t + minutes * 60000
    ]);
    assert.equal(engine.update(rows, 'Brent BZ=F'), false);
    assert.equal(engine.snapshot().completed60m, 0);
    assert.equal(engine.update(rows, 'MEXC UKOIL_USDT'), true);
    const stats = engine.snapshot();
    assert.equal(stats.total, 1);
    assert.equal(stats.completed60m, 1);
    assert.equal(stats.outcomes.CONFIRMADO, 1);
    assert.deepEqual(Object.keys(stats.events[0].results), ['15', '30', '60']);
    assert.equal(createOilProfessor({ dataDir: dir }).snapshot().completed60m, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
