/* Painel BTC Liquidez EGI — livro Binance Spot, sem ordens automáticas */
(() => {
  'use strict';
  const root = document.getElementById('btcLiquidityPanel');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const fmt = (n, digits = 2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('pt-BR', {minimumFractionDigits: digits,maximumFractionDigits: digits}) : '—';
  const us = n => 'US$ ' + fmt(n);
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  let loading = false;
  const wall = (side, z) => {
    const p = side === 'bid' ? 'btcLiqBuy' : 'btcLiqSell';
    set(p + 'Zone', z ? us(z.low) + ' – ' + us(z.high) : 'Sem parede medida');
    set(p + 'Distance', z ? fmt(z.distancePct, 3) + '% até a faixa' : 'Distância indisponível');
    set(p + 'Power', z ? 'US$ ' + fmt(z.notionalUsd, 0) + ' em ordens • força ' + fmt(z.relativeStrength, 1) + '×' : 'Poucos dados de profundidade');
  };
  async function update() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/btc-liquidity?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Servidor HTTP ' + response.status);
      const d = await response.json();
      if (!d.snapshot || d.stale) throw new Error(d.error || 'Aguardando novo livro de ofertas do servidor');
      const s = d.snapshot;
      set('btcLiqPrice', us(s.price));
      set('btcLiqTime', new Date(s.scannedAt).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}));
      set('btcLiqImbalance', fmt(s.imbalancePct, 1) + '% (compras − vendas, ±0,5%)');
      wall('bid', s.bid); wall('ask', s.ask);
      const t = d.telegram || {};
      set('btcLiqTg', t.configured ? (t.enabled ? '✅ Telegram ativo • alerta ≤ ' + fmt(t.thresholdPct, 2) + '% • intervalo mínimo ' + t.cooldownMinutes + ' min' : '🔕 Telegram desativado no Render') : '⚠️ Bot/Chat ID ainda não configurados no Render');
      const recent = Array.isArray(d.history) ? d.history : [];
      set('btcLiqHistory', recent.length ? 'Último alerta: ' + (recent[0].side === 'bid' ? 'compra' : 'venda') + ' em ' + us(recent[0].zone) + ' • ' + new Date(recent[0].at).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}) : 'Nenhum aviso de aproximação registrado.');
      set('btcLiqStatus', '✅ Livro de ofertas consultado • Binance Spot • 1.000 níveis por lado' + (d.error ? ' • aviso: ' + d.error : ''));
    } catch (err) {
      set('btcLiqStatus', '⚠️ Liquidez indisponível: ' + err.message + '. Não usar valores antigos.');
      set('btcLiqPrice', '—');
      wall('bid', null); wall('ask', null);
      set('btcLiqImbalance', '—');
    } finally { loading = false; }
  }
  $('btcLiqRefresh')?.addEventListener('click', update);
  update();
  setInterval(() => { if (!document.hidden) update(); }, 60000);
})();
