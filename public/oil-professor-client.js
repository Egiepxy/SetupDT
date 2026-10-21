/* Professor de Resultados OIL EGI V1.0 — painel técnico, sem ordens. */
(() => {
  'use strict';
  const anchor = document.getElementById('oilDaytradeCard');
  if (!anchor) return;
  const style = document.createElement('style');
  style.textContent = [
    '#oilProfessorPanel{margin:12px 0;border-left-color:#d4a34b}',
    '#oilProfessorPanel .op-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
    '#oilProfessorPanel .op-head strong{font-size:14px;color:#f3d18d}',
    '#oilProfessorPanel .op-metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}',
    '#oilProfessorPanel .op-metric{flex:1 1 90px;padding:8px;border-radius:7px;background:#16263d;min-width:70px}',
    '#oilProfessorPanel .op-metric b{display:block;font-size:19px;color:#e8f3ff}',
    '#oilProfessorPanel .op-metric span{display:block;font-size:11px;color:#adc1d8}',
    '#oilProfessorPanel .op-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}',
    '#oilProfessorPanel .op-actions button{min-width:115px;flex:1 1 115px}',
    '#oilProfessorPanel .op-item{border-top:1px solid #405475;padding:10px 0}',
    '#oilProfessorPanel .op-item strong{color:#fff}',
    '#oilProfessorPanel .op-minor{color:#adc1d8;margin-top:4px;font-size:11px;line-height:1.6}',
    '#oilProfessorPanel .op-capsule{padding:2px 6px;border-radius:5px;background:#304560}',
    '#oilProfessorPanel .op-foot{font-size:11px;color:#aabbd1;line-height:1.5;margin-top:8px}',
    '#oilProfessorPanel .op-list{max-height:440px;overflow-y:auto}',
    '#oilProfessorPanel .op-state{padding:5px 0;font-size:12px;color:#efcb88}',
    '@media(max-width:560px){#oilProfessorPanel .op-metric{min-width:90px}}'
  ].join('\n');
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'oilProfessorPanel';
  panel.className = 'oil-reason';
  panel.innerHTML = [
    '<div class="op-head"><strong>📓 Professor de Resultados OIL EGI V1.0</strong><span class="op-capsule">15m · 30m · 60m</span></div>',
    '<div class="op-foot">Auditoria dos avisos Day Trade enviados pelo Telegram. Compara o fechamento futuro com o preço de referência do candle do aviso. Não executa ordens.</div>',
    '<div class="op-metrics"><div class="op-metric"><b id="opTotal">—</b><span>Avisos</span></div>',
    '<div class="op-metric"><b id="opDone">—</b><span>60m concluídos</span></div>',
    '<div class="op-metric"><b id="opConfirmed">—</b><span>Favoráveis 60m</span></div>',
    '<div class="op-metric"><b id="opFalse">—</b><span>Contrários 60m</span></div></div>',
    '<div class="op-actions"><button type="button" class="secondary" id="opRefresh">↻ Atualizar auditoria</button>',
    '<button type="button" class="secondary" id="opCopy">📋 Copiar para ChatGPT</button>',
    '<button type="button" class="secondary" id="opTxt">📄 Baixar TXT</button></div>',
    '<div class="op-state" id="opStatus">Aguardando a auditoria do servidor…</div>',
    '<details><summary>Ver histórico de avisos e resultados</summary><div class="op-list" id="opHistory"></div></details>',
    '<div class="op-foot">Critério didático: movimento favorável de fechamento ≥ metade do ATR% do alerta (piso 0,05 ponto percentual) = confirmado; movimento contrário equivalente = falso; outros = inconclusivos. MFE/MAE usam máximas/mínimas dos candles. Fonte OIL deve permanecer igual. Não representa lucro, execução nem probabilidade de acerto.</div>',
    '<div class="op-foot">O histórico fica no servidor e depende de armazenamento persistente. Exporte TXT periodicamente; alertas enviados antes desta versão não são recuperados automaticamente.</div>'
  ].join('');
  anchor.insertAdjacentElement('afterend', panel);
  const el = id => document.getElementById(id);
  const fmt = (value, digits = 2) => Number.isFinite(Number(value)) ?
    Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const clock = ts => Number.isFinite(Number(ts)) ?
    new Date(Number(ts)).toLocaleString('pt-BR') : '—';
  const apiUrl = typeof serverUrl === 'function' ? serverUrl('/api/oil/daytrade/history') :
    '/api/oil/daytrade/history';
  let snapshot = null;
  let inFlight = false;

  function statusText(verdict) {
    return verdict === 'CONFIRMADO' ? '🟢 Confirmado' :
      verdict === 'FALSO' ? '🔴 Contrário' :
        verdict === 'INCONCLUSIVO' ? '🟡 Inconclusivo' : '⏳ Pendente';
  }
  function resultLine(event, minutes) {
    const value = event.results && event.results[minutes];
    return minutes + 'm: ' + (!value ? '⏳ aguardando candle fechado' :
      statusText(value.verdict) + ' · fechamento $' + fmt(value.close, 3) +
      ' · variação direcional ' + (value.favorableClosePct >= 0 ? '+' : '') +
      fmt(value.favorableClosePct, 3) + '%' +
      ' · máx. favorável ' + fmt(value.mfePct, 3) + '%' +
      ' · máx. contrária ' + fmt(value.maePct, 3) + '%');
  }
  function report() {
    if (!snapshot) return 'Professor OIL EGI: ainda sem dados carregados.';
    const stats = snapshot.outcomes || {};
    const out = [
      'PROFESSOR DE RESULTADOS OIL EGI V1.0 — AUDITORIA, NÃO ORDEM',
      'Gerado: ' + clock(snapshot.generatedAt),
      'Total de alertas registrados: ' + snapshot.total,
      'Avaliações completas 60m: ' + snapshot.completed60m,
      'Pendentes 60m: ' + snapshot.pending60m,
      'Favoráveis / contrários / inconclusivos em 60m: ' +
        (stats.CONFIRMADO || 0) + ' / ' + (stats.FALSO || 0) + ' / ' + (stats.INCONCLUSIVO || 0),
      'Fonte: servidor SetupDT; somente candles fechados 15m do mesmo instrumento.',
      'Definição: direção do alerta; limiar = metade do ATR%, piso 0,05 ponto percentual.',
      'MFE e MAE indicam excursões observadas; não são resultados executáveis.',
      'Histórico não recupera automaticamente alertas anteriores à implantação.',
      ''
    ];
    for (const event of snapshot.events || []) {
      out.push('AVISO ' + event.id + ' | ' + clock(event.sentAt) +
        ' | ' + event.direction + ' ' + event.level + ' | índice ' + event.score +
        '/100 | preço $' + fmt(event.price, 3));
      out.push('Candle do alerta: ' + clock(event.candleClose) +
        ' | vol. ' + fmt(event.volumeRatio, 2) + 'x | ATR ' + fmt(event.atrPct, 3) +
        '% | 4h ' + event.context4h + ' | fonte ' + event.source15);
      for (const minutes of [15, 30, 60]) out.push(resultLine(event, minutes));
      out.push('Motivos: ' + (event.reasons || []).join('; '), '');
    }
    out.push('PEDIDO AO CHATGPT: audite os alertas sem tratá-los como ordens; verifique a qualidade por direção, índice, volatilidade e horizonte; destaque armadilhas e amostra pequena.');
    return out.join('\n');
  }
  function render() {
    if (!snapshot) return;
    el('opTotal').textContent = String(snapshot.total || 0);
    el('opDone').textContent = String(snapshot.completed60m || 0);
    el('opConfirmed').textContent = String(snapshot.outcomes?.CONFIRMADO || 0);
    el('opFalse').textContent = String(snapshot.outcomes?.FALSO || 0);
    const list = el('opHistory');
    list.replaceChildren();
    for (const event of (snapshot.events || []).slice(0, 40)) {
      const item = document.createElement('div');
      item.className = 'op-item';
      const heading = document.createElement('strong');
      heading.textContent = (event.direction === 'SHORT' ? '🔴 BAIXA' : '🟢 ALTA') +
        ' • ' + event.level + ' • índice ' + event.score + '/100 • $ ' + fmt(event.price, 3);
      item.appendChild(heading);
      const lines = [
        clock(event.sentAt) + ' • candle ' + clock(event.candleClose) +
          ' • volume ' + fmt(event.volumeRatio) + 'x • ATR ' + fmt(event.atrPct, 3) + '%' +
          ' • 4h ' + event.context4h,
        ...[15, 30, 60].map(minutes => resultLine(event, minutes))
      ];
      for (const line of lines) {
        const small = document.createElement('div');
        small.className = 'op-minor';
        small.textContent = line;
        item.appendChild(small);
      }
      list.appendChild(item);
    }
    if (!(snapshot.events || []).length) {
      const note = document.createElement('p');
      note.textContent = 'Nenhum alerta da nova versão registrado. O primeiro aviso anterior à instalação não entra automaticamente.';
      list.appendChild(note);
    }
    el('opStatus').textContent = 'Última consulta: ' + clock(snapshot.generatedAt) +
      ' • ' + (snapshot.pending60m || 0) + ' aviso(s) aguardando fechamento de 60m.';
  }
  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    el('opRefresh').disabled = true;
    try {
      const response = await fetch(apiUrl, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'HTTP ' + response.status);
      snapshot = data;
      render();
    } catch (error) {
      el('opStatus').textContent = '⚠ Auditoria indisponível ou ainda não publicada no servidor: ' +
        (error.message || String(error));
    } finally {
      inFlight = false;
      el('opRefresh').disabled = false;
    }
  }
  async function copy() {
    const text = report();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível');
      await navigator.clipboard.writeText(text);
      el('opStatus').textContent = '✅ Relatório copiado para o ChatGPT.';
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed'; input.style.left = '-9999px';
      document.body.appendChild(input); input.select();
      const ok = document.execCommand('copy');
      input.remove();
      el('opStatus').textContent = ok ? '✅ Relatório copiado.' : '⚠ Não foi possível copiar; use Baixar TXT.';
    }
  }
  function download() {
    const blob = new Blob([report()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Professor_Resultados_OIL_EGI_' +
      new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  el('opRefresh').addEventListener('click', refresh);
  el('opCopy').addEventListener('click', copy);
  el('opTxt').addEventListener('click', download);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
})();
