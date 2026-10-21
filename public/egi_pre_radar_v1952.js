/* SetupDT Light V1.9.52 — Radar Precoce EGI.
   MODULO INFORMATIVO: nao altera 6/6, ordens, risco, avisos remotos ou sinais HOLD.
   Somente candles fechados, observacao local, historico prospectivo sem P&L. */
(function(){
'use strict';
var KEY='setupdt_egi_v1952_radar_precoce';
var history=[];
try {var stored=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(stored))history=stored.slice(-350);}catch(_){}
var timer=null, lastReport=[];
function $(id){return document.getElementById(id);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(history.slice(-350)));}catch(_){}}
function fmt(n){if(!Number.isFinite(n))return 'n/d';return n.toLocaleString('pt-BR',{maximumFractionDigits:n>=100?2:n>=1?4:8});}
function stamp(t){return Number.isFinite(t)?new Date(t).toLocaleString('pt-BR'):'n/d';}
function add(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e;}
function mount(){
  if($('egiPreRadarPanel')||!$('egiDayRegime'))return;
  var css=document.createElement('style');css.id='egiPreRadarStyle';
  css.textContent='#egiPreRadarPanel{border-color:#468a9a;background:#0d2234}#egiPreRadarPanel h2{margin:0 0 5px}'+
  '#egiPreRadarRows{display:grid;gap:8px;margin-top:10px}#egiPreRadarRows .pre-item{background:#0a192c;border:1px solid #425f7d;border-radius:10px;padding:10px}'+
  '#egiPreRadarRows .pre-head{font-weight:850}#egiPreRadarRows .pre-meta{color:#bdcee4;font-size:12px;line-height:1.5;margin-top:5px;overflow-wrap:anywhere}'+
  '#egiPreRadarRows .pre-break{border-color:#339e82}#egiPreRadarRows .pre-div{color:#ffd387}'+
  '#egiPreRadarPanel .pre-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}'+
  '#egiPreRadarPanel .pre-actions button{font-size:12px;min-height:38px;padding:7px 10px}'+
  '#egiPreRadarPanel .pre-stats{font-size:12px;color:#d4e6fa}'+
  '#egiPreRadarHistory{font-size:12px;line-height:1.5;max-height:160px;overflow:auto;white-space:pre-wrap}';
  document.head.append(css);
  var panel=document.createElement('section');panel.id='egiPreRadarPanel';panel.className='panel';
  panel.innerHTML='<h2>🎯 Radar Precoce EGI • V1.9.52</h2>'+
   '<p class="hint">Aviso de aproximação/rompimento de faixa 4h. Usa somente candles fechados 15m e 4h. <b>Não libera entradas</b> nem altera o SetupDT 6/6.</p>'+
   '<div id="egiPreRadarSummary" class="notice off" role="status">Aguardando análise ou rastreador.</div>'+
   '<div id="egiPreRadarRows" aria-live="polite"></div>'+
   '<div class="pre-actions"><button type="button" id="egiPreRadarRefresh" class="secondary">↻ Recalcular</button>'+
   '<button type="button" id="egiPreRadarExport" class="secondary">💾 Histórico TXT</button>'+
   '<button type="button" id="egiPreRadarClear" class="secondary">🗑 Zerar só este histórico</button></div>'+
   '<details><summary>📓 Auditoria prospectiva (3 / 6 / 12 candles)</summary>'+
   '<p class="hint">Diferença percentual do fechamento posterior em relação ao preço observado, ajustada pela direção. Não representa lucro, acerto estatístico ou operação realizada. Os registros ficam apenas neste navegador.</p>'+
   '<div id="egiPreRadarHistory">Sem registros.</div></details>'+
   '<p class="hint">A referência da faixa é a máxima/mínima dos 20 candles 4h fechados anteriores à leitura, não é o mesmo cálculo de suporte/resistência do Contexto EGI. Proximidade: até 0,50 ATR15m; acima/abaixo da faixa: até 0,35 ATR15m. Volume mínimo para destacar ruptura recente: 1,20×.</p>';
  $('egiDayRegime').insertAdjacentElement('afterend',panel);
  $('egiPreRadarRefresh').onclick=render;
  $('egiPreRadarExport').onclick=exportTxt;
  $('egiPreRadarClear').onclick=function(){
    if(!confirm('Apagar somente os registros do Radar Precoce deste navegador? O histórico principal do SetupDT não será apagado.'))return;
    history=[];save();render();
  };
}
function evaluate(coin,market,result){
  var rows=result&&result.rows, snaps=result&&result.snaps, ev=result&&result.ev;
  var fifteen=rows&&rows['15m'],four=rows&&rows['4h'];
  var s15=snaps&&snaps['15m'],h1=snaps&&snaps['1h'],h4=snaps&&snaps['4h'];
  if(!Array.isArray(fifteen)||fifteen.length<22||!Array.isArray(four)||four.length<21||!s15||!h1||!h4)return null;
  var closeAt=Number(s15.candleClose),now=Date.now();
  if(!Number.isFinite(closeAt)||closeAt>now||now-closeAt>60*60*1000)return null;
  var latest=fifteen[fifteen.length-1],prior=fifteen[fifteen.length-2],price=Number(latest.close),atr=Number(s15.atr);
  if(!(price>0&&atr>0)||Number(latest.end)!==closeAt)return null;
  // Faixa 4h inteiramente encerrada antes do candle 15m observado.
  var earlier=four.filter(function(x){return Number(x.end)<closeAt;}).slice(-20);
  if(earlier.length<20)return null;
  var resistance=Math.max.apply(null,earlier.map(function(x){return Number(x.high);}));
  var support=Math.min.apply(null,earlier.map(function(x){return Number(x.low);}));
  if(!(resistance>support&&support>0))return null;
  var direction=s15.dir;
  if(direction!=='LONG'&&direction!=='SHORT'){
    direction=(Math.abs(resistance-price)<Math.abs(price-support))?'LONG':'SHORT';
  }
  var level=direction==='LONG'?resistance:support;
  var gapAtr=(direction==='LONG'?level-price:price-level)/atr;
  if(gapAtr>0.50||gapAtr< -0.35)return null;
  var freshBreak=direction==='LONG'?(price>level&&Number(prior.close)<=level):(price<level&&Number(prior.close)>=level);
  var vr=Number(s15.volRatio),strongVolume=Number.isFinite(vr)&&vr>=1.20;
  var stage=(gapAtr>=0?'APROXIMAÇÃO':freshBreak&&strongVolume?'ROMPIMENTO 15M':'ALÉM DA FAIXA');
  var priority=stage==='ROMPIMENTO 15M'?3:stage==='ALÉM DA FAIXA'?2:1;
  var count=Number(ev&&ev.count)||0;
  var conflict=(h4.dir!==direction||h1.dir!==direction);
  var explanation=[];
  if(h4.dir!==direction)explanation.push('4h '+String(h4.dir||'neutro')+' diverge');
  if(h1.dir!==direction)explanation.push('1h '+String(h1.dir||'neutro')+' diverge');
  if(conflict)explanation.push('RSI 4h ('+fmt(Number(h4.r))+') não substitui o escore da direção');
  if(stage==='ROMPIMENTO 15M')explanation.push('Rompimento novo em fechamento 15m; sustentação/reteste ainda não confirmados');
  else if(stage==='ALÉM DA FAIXA')explanation.push('Preço além da faixa, sem inferir rompimento novo neste candle');
  else explanation.push('Preço perto da faixa; ainda não houve fechamento além do nível');
  if(!strongVolume)explanation.push('Volume 15m abaixo de 1,20× ou indisponível');
  if(count<6)explanation.push('Checklist '+count+'/6; motor original segue responsável pelo gatilho');
  if(ev&&ev.tradable)explanation.push('Entrada técnica: consultar painel de risco original');
  return {coin:coin,market:market,side:direction,stage:stage,priority:priority,count:count,conflict:conflict,
    price:price,level:level,gapAtr:gapAtr,volume:Number.isFinite(vr)?vr:null,closeAt:closeAt,
    quality:ev&&ev.marketRisk?ev.marketRisk.quality:null,description:explanation.join(' • ')};
}
function updateOutcomes(market,coin,fifteen){
  if(!Array.isArray(fifteen))return false;
  var changed=false;
  for(var i=0;i<history.length;i++){
    var h=history[i];
    if(h.market!==market||h.coin!==coin||!Number.isFinite(h.closeAt)||!(h.price>0))continue;
    var later=fifteen.filter(function(c){return Number(c.end)>h.closeAt;});
    [3,6,12].forEach(function(n){
      var field='delta'+n;
      if(!Number.isFinite(h[field])&&later.length>=n){
        var v=Number(later[n-1].close);
        if(v>0){h[field]=Number((100*(v/h.price-1)*(h.side==='SHORT'?-1:1)).toFixed(3));changed=true;}
      }
    });
  }
  return changed;
}
function record(obs){
  var previous=null;
  for(var i=history.length-1;i>=0;i--){
    if(history[i].market===obs.market&&history[i].coin===obs.coin){previous=history[i];break;}
  }
  // Registra uma transição real, e não outra entrada a cada varredura.
  if(previous&&previous.side===obs.side&&previous.stage===obs.stage&&obs.closeAt-previous.closeAt<6*60*60*1000)return false;
  if(previous&&previous.closeAt===obs.closeAt&&previous.side===obs.side)return false;
  history.push({market:obs.market,coin:obs.coin,side:obs.side,stage:obs.stage,
    closeAt:obs.closeAt,price:obs.price,level:obs.level,volume:obs.volume,
    count:obs.count,delta3:null,delta6:null,delta12:null});
  history=history.slice(-350);
  return true;
}
function sources(market){
  var all=[],used={};
  function take(coin,res){
    if(!coin||used[coin]||!res)return;
    used[coin]=true;all.push({coin:coin,market:market,result:res});
  }
  try{
    if(typeof state!=='undefined'&&state.data&&state.data.market===market)
      take(state.data.asset,state.data);
  }catch(_){}
  try{
    if(typeof scanCache!=='undefined'&&scanCache&&typeof scanCache.values==='function'){
      for(var entry of scanCache.values()){
        if(entry&&entry.result&&entry.scanMarket===market)take(entry.coin,entry.result);
      }
    }
  }catch(_){}
  return all;
}
function render(){
  mount();var summary=$('egiPreRadarSummary'),root=$('egiPreRadarRows'),archive=$('egiPreRadarHistory');
  if(!summary||!root||!archive)return;
  var market='binance';
  try{if(typeof currentMarket==='function')market=currentMarket();}catch(_){}
  var src=sources(market),matches=[],dirty=false;
  src.forEach(function(entry){
    var data=entry.result,rows=data.rows&&data.rows['15m'];
    if(updateOutcomes(market,entry.coin,rows))dirty=true;
    var obs=evaluate(entry.coin,market,data);
    if(obs){matches.push(obs);if(record(obs))dirty=true;}
  });
  if(dirty)save();
  matches.sort(function(a,b){return b.priority-a.priority||b.count-a.count||Math.abs(a.gapAtr)-Math.abs(b.gapAtr)||a.coin.localeCompare(b.coin);});
  lastReport=matches;
  var breakout=matches.filter(function(x){return x.stage==='ROMPIMENTO 15M';}).length;
  var div=matches.filter(function(x){return x.conflict;}).length;
  summary.textContent='Leitura '+new Date().toLocaleTimeString('pt-BR')+' • '+src.length+
    ' ativos com candles disponíveis • '+matches.length+' perto/atravessando faixa • '+breakout+
    ' rompimento(s) recente(s) com volume • '+div+' divergência(s) macro. Nenhum sinal é liberado por este radar.';
  root.replaceChildren();
  if(!matches.length)root.append(add('div','hint','Nenhum ativo dentro da janela de 0,50 ATR abaixo/acima do nível nesta leitura. Rastreie a lista ou analise uma moeda.'));
  matches.slice(0,10).forEach(function(x){
    var box=add('div','pre-item'+(x.priority===3?' pre-break':''));
    var head=add('div','pre-head',(x.side==='LONG'?'🟢 ':'🔴 ')+x.coin+'/USDT • '+x.stage+
      ' • '+x.side+' • '+x.count+'/6');
    var diff=(Math.abs(x.gapAtr)).toFixed(2)+' ATR '+(x.gapAtr<0?'além da faixa':'até o nível');
    var meta=add('div','pre-meta','Fechamento 15m '+fmt(x.price)+' | Nível 4h '+fmt(x.level)+
      ' | '+diff+' | Volume '+(x.volume===null?'n/d':x.volume.toFixed(2)+'×')+
      ' | Qualidade '+(x.quality===null||x.quality===undefined?'n/d':x.quality+'/100')+
      ' | '+stamp(x.closeAt));
    var reason=add('div','pre-meta'+(x.conflict?' pre-div':''),x.description);
    var button=add('button','secondary smallbtn','🔎 Analisar '+x.coin);
    button.type='button';
    button.onclick=function(){
      var input=$('coin');if(input)input.value=x.coin;
      if(typeof loadScanAsset==='function')loadScanAsset(x.coin);
      else if($('apply'))$('apply').click();
    };
    box.append(head,meta,reason,button);root.append(box);
  });
  var a=history.filter(function(h){return h.market===market;}).slice(-12).reverse();
  archive.textContent=a.length?a.map(function(h){
    return stamp(h.closeAt)+' • '+h.coin+' '+h.side+' '+h.stage+' '+fmt(h.price)+
      ' | +3: '+(Number.isFinite(h.delta3)?h.delta3.toFixed(2)+'%':'pendente')+
      ' | +6: '+(Number.isFinite(h.delta6)?h.delta6.toFixed(2)+'%':'pendente')+
      ' | +12: '+(Number.isFinite(h.delta12)?h.delta12.toFixed(2)+'%':'pendente');
  }).join('\n'):'Nenhuma transição registrada neste mercado.';
}
function exportTxt(){
  var market='binance';try{if(typeof currentMarket==='function')market=currentMarket();}catch(_){}
  var rows=history.filter(function(x){return x.market===market;});
  var lines=['RELATÓRIO RADAR PRECOCE EGI V1.9.52 — ESTUDO, NÃO ORDEM',
    'Gerado '+stamp(Date.now())+' | Mercado '+market,
    'Dados deste navegador; candles fechados 15m/4h. Não é P&L, precisão nem operação executada.',
    'Eventos de transição: '+rows.length,''];
  rows.forEach(function(h){lines.push(stamp(h.closeAt)+' | '+h.coin+'/USDT | '+h.side+
   ' | '+h.stage+' | Preço '+fmt(h.price)+' | Faixa '+fmt(h.level)+' | 6/6 '+h.count+
   ' | Δ3 '+(Number.isFinite(h.delta3)?h.delta3+'%':'pendente')+
   ' | Δ6 '+(Number.isFinite(h.delta6)?h.delta6+'%':'pendente')+
   ' | Δ12 '+(Number.isFinite(h.delta12)?h.delta12+'%':'pendente'));});
  var blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});
  var url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='EGI_Radar_Precoce_'+new Date().toISOString().slice(0,10)+'.txt';
  document.body.append(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}
function queue(){if(timer!==null)clearTimeout(timer);timer=setTimeout(function(){timer=null;render();},250);}
function init(){
  mount();render();
  ['scanRows','statusText'].forEach(function(id){
    var node=$(id);
    if(node&&typeof MutationObserver!=='undefined')new MutationObserver(queue).observe(node,{childList:true,subtree:true,characterData:true});
  });
  $('market')&&$('market').addEventListener('change',queue);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)queue();});
  window.addEventListener('focus',queue);
  setInterval(function(){if(!document.hidden)render();},45000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
