/* Painel Detector de Médias OIL EGI • estudo, sem ordens */
(() => {
'use strict';
const anchor=document.getElementById('oilDaytradeCard');
if(!anchor)return;
const css=document.createElement('style');css.textContent=`
#oilMaPanel{margin:12px 0;border-left:4px solid #e3af62}
#oilMaPanel .ma-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
#oilMaPanel .ma-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:10px}
#oilMaPanel .ma-tf{padding:10px;background:#152840;border:1px solid #30435d;border-radius:9px;min-width:0}
#oilMaPanel .ma-tf strong{display:block;color:#d5e8fc}
#oilMaPanel .ma-tf small{display:block;line-height:1.5;color:#aac1d8;font-size:11px}
#oilMaPanel .ma-info{margin:8px 0;padding:9px;border:1px solid #344960;border-radius:9px;font-size:12px}
#oilMaPanel .ma-warn{color:#f4ce86}#oilMaPanel .ma-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
#oilMaPanel .ma-actions button{flex:1 1 135px}
@media(max-width:690px){#oilMaPanel .ma-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;document.head.appendChild(css);
const panel=document.createElement('section');panel.id='oilMaPanel';panel.className='oil-reason';
panel.innerHTML=`
<div class="ma-head"><strong>📉 Detector OIL EGI — Médias + MACD + Volume</strong><span id="oilMaBadge" class="tag">Aguardando</span></div>
<p class="hint">SMA 5/10/30/60 + MACD (EMA 12/26/9) + volume relativo a 20 candles. Volume em candle vermelho é apenas proxy de participação vendedora, não fluxo líquido ou agressão de venda. Confirmação exige concordância; somente candles fechados e mesma fonte.</p>
<div class="ma-info" id="oilMaStatus" role="status">Aguardando leitura do servidor…</div>
<div id="oilMaCards" class="ma-stats"></div>
<div id="oilMaReasons" class="ma-info">Não existe confirmação de SHORT apenas porque o RSI ou o preço estão elevados.</div>
<div class="ma-actions">
<button type="button" id="oilMaRefresh" class="secondary">↻ Atualizar médias</button>
<button type="button" id="oilMaCopy" class="secondary">📋 Copiar RelChat</button>
<button type="button" id="oilMaTxt" class="secondary">📄 Salvar TXT</button>
</div>
<details style="margin-top:10px"><summary>📓 Histórico dos avisos de médias e auditoria 15/30/60 min</summary><div id="oilMaHistory" class="ma-info">Sem registros.</div></details>
<p class="hint">A fase 4 exige MA em deterioração, MACD vendedor no 15m, 1h enfraquecendo e aumento de volume em candles de queda no 15m ou 1h. Mesmo assim, não garante reversão no 4h. O volume não identifica agressor e pode divergir entre MEXC UKOIL e Brent BZ=F. Avisos via Telegram e histórico no Render dependem de publicação e disco persistente.</p>
`;
anchor.insertAdjacentElement('afterend',panel);
const el=id=>document.getElementById(id);
const fmt=(v,n=2)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toLocaleString('pt-BR',{minimumFractionDigits:n,maximumFractionDigits:n}):'n/d';
const when=v=>v?new Date(v).toLocaleString('pt-BR'):'n/d';
let payload=null;
function report(){
  if(!payload)return 'Detector OIL: ainda não consultado.';
  const s=payload.latest;
  const lines=['DETECTOR DE MÉDIAS OIL EGI — RELCHAT EDUCATIVO','Gerado: '+when(Date.now()),
    'Estado servidor: '+(payload.error?'ERRO / LEITURA EM CACHE: '+payload.error:'coleta válida'),'Última tentativa: '+when(payload.lastAttempt),
    'Telegram: '+(payload.telegramConfigured?'configurado':'não configurado')];
  if(!s){lines.push('Sem leitura atual válida. Não inferir tendência por dados ausentes.');return lines.join('\n');}
  lines.push('Fonte única: '+s.source,'5m fechado: '+when(s.candleClose),'FASE '+s.stage+': '+s.label,
    'Contexto 4h: '+s.trend4h,'Preço de referência 5m: '+fmt(s.price,3),'');
  for(const tf of ['5m','15m','1h','4h']){
    const t=s.t?.[tf];if(!t)continue;
    lines.push(tf+': fechado '+when(t.candleClose)+' | preço '+fmt(t.price,3)+
      ' | MA5 '+fmt(t.ma5,3)+' | MA10 '+fmt(t.ma10,3)+' | MA30 '+fmt(t.ma30,3)+
      ' | MA60 '+fmt(t.ma60,3)+' | distância MA5 '+fmt(t.distanceMA5Pct,2)+'%' +
      ' | inclinação MA5 '+fmt(t.slope5Pct,3)+'%/candle' +
      ' | ATR14 '+fmt(t.atrPct,3)+'% | volume '+fmt(t.volumeRatio,2)+'x'+
      ' | volume recente em queda '+fmt(t.sellVolumeRatio,2)+'x'+
      ' | MACD linha '+fmt(t.macd?.line,5)+' | sinal '+fmt(t.macd?.signal,5)+
      ' | histograma '+fmt(t.macd?.hist,5)+
      ' | hist. caindo '+(t.macd?.histFalling?'sim':'não')+
      ' | MACD vendedor '+(t.macd?.bearish?'sim':'não'));
  }
  lines.push('', 'MOTIVOS',...s.reasons.map(x=>'• '+x),'');
  lines.push('ALERTAS HISTÓRICOS: '+(payload.history||[]).length);
  for(const e of (payload.history||[]).slice(0,30)){
    lines.push('Fase '+e.stage+' | '+when(e.sentAt)+' | '+e.source+' | '+fmt(e.price,3));
    for(const tf of ['5m','15m','1h','4h']){
      const v=e.indicators?.[tf];if(v)lines.push('  '+tf+': MACD hist '+fmt(v.macd?.hist,5)+
        ' | vendedor '+(v.macd?.bearish?'sim':'não')+
        ' | volume '+fmt(v.volumeRatio,2)+'x | volume em queda '+fmt(v.sellVolumeRatio,2)+'x');
    }
    for(const minutes of [15,30,60]){
      const r=e.results?.[minutes];lines.push(' '+minutes+'m: '+(r?(r.state+' '+fmt(r.directionalPct,3)+'% no fechamento'):'PENDENTE'));
    }
  }
  lines.push('Estudo com candles fechados; sem execução de ordens; favorável não é lucro líquido.',
  'Não confundir perda de força no 5m com reversão do 4h. Compare com gráfico da MESMA fonte e mesmo período.');
  return lines.join('\n');
}
function display(p){
  payload=p;
  const s=p.latest,good=p.ok&&s;
  el('oilMaBadge').textContent=s?(p.error?'CACHE • FASE ':'FASE ')+s.stage:'SEM LEITURA';
  el('oilMaStatus').textContent=(p.error?'⚠ '+p.error+' • última leitura em cache (não usar para novo alerta) • ':'')+
    (s?s.label+' • Fonte: '+s.source+' • candle 5m: '+when(s.candleClose):
      'Sem análise válida; confira o servidor e se todos os períodos vieram da mesma fonte.');
  const cards=el('oilMaCards');cards.replaceChildren();
  if(s?.t)for(const tf of ['5m','15m','1h','4h']){
    const t=s.t[tf];if(!t)continue;
    const b=document.createElement('article');b.className='ma-tf';
    const title=document.createElement('strong');title.textContent=tf+' • '+fmt(t.price,3);
    const sub=document.createElement('small');
    sub.textContent='MA5 '+fmt(t.ma5,3)+' | MA10 '+fmt(t.ma10,3)+' | MA30 '+fmt(t.ma30,3)+' | MA60 '+fmt(t.ma60,3)+
    '\nΔ MA5 '+fmt(t.distanceMA5Pct,2)+'% | inclinação '+fmt(t.slope5Pct,3)+'%/candle'+
    '\nVol '+fmt(t.volumeRatio,2)+'x | baixa '+fmt(t.sellVolumeRatio,2)+'x'+
    '\nMACD (12/26/9): hist '+fmt(t.macd?.hist,5)+
    ' • '+(t.macd?.bearish?'vendedor':'comprador')+
    (t.macd?.bearishCross?' • cruzamento vendedor':'')+
    (t.macd?.histFalling?' • impulso enfraquecendo':'');
    sub.style.whiteSpace='pre-line';b.append(title,sub);cards.appendChild(b);
  }
  el('oilMaReasons').textContent=s?('Contexto 4h: '+s.trend4h+' • '+s.reasons.join(' • ')):
    'Sem dados suficientes para diagnosticar médias e tendência.';
  const h=el('oilMaHistory');h.replaceChildren();
  if(!p.history?.length)h.textContent='Nenhum aviso enviado e registrado pelo detector.';
  for(const e of (p.history||[]).slice(0,10)){
    const item=document.createElement('div');item.style.marginBottom='9px';
    item.textContent='Fase '+e.stage+' • '+when(e.sentAt)+' • $ '+fmt(e.price,3)+' • '+[15,30,60].map(m=>{
      const r=e.results?.[m];return m+'m '+(r?r.state+' '+fmt(r.directionalPct,2)+'%':'pendente');
    }).join(' | ');
    h.appendChild(item);
  }
}
async function refresh(){
  el('oilMaRefresh').disabled=true;
  try{
    const base=typeof serverUrl==='function'?serverUrl('/api/oil/ma'):'/api/oil/ma';
    const r=await fetch(base,{cache:'no-store'}),p=await r.json();
    if(!r.ok)throw Error('HTTP '+r.status);
    display(p);
  }catch(e){el('oilMaStatus').textContent='⚠ Detector indisponível: '+(e.message||e)+'. Verifique se a versão nova está publicada no Render.';}
  finally{el('oilMaRefresh').disabled=false;}
}
async function copy(){
  const t=report();try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(t);
    else {const a=document.createElement('textarea');a.value=t;document.body.append(a);a.select();document.execCommand('copy');a.remove();}
    el('oilMaStatus').textContent='RelChat copiado. Cole na conversa.';
  }catch(e){el('oilMaStatus').textContent='Cópia bloqueada pelo navegador. Use Salvar TXT.';}
}
function saveTxt(){
  const blob=new Blob(['\ufeff'+report()],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='RelChat_OIL_Medias_EGI_'+new Date().toISOString().slice(0,10)+'.txt';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
el('oilMaRefresh').addEventListener('click',refresh);
el('oilMaCopy').addEventListener('click',copy);
el('oilMaTxt').addEventListener('click',saveTxt);
setTimeout(refresh,2400);
setInterval(()=>{if(!document.hidden)refresh()},60000);
})();