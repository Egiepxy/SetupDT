'use strict';
// Detector de Médias OIL EGI — estudo, sem execução de ordens.
// Fonte única obrigatória por rodada. Candles estritamente FECHADOS.
const fs = require('fs');
const path = require('path');
const PERIODS = ['5m', '15m', '1h', '4h'];
const HORIZONS = [15, 30, 60];
const round = (v, d = 4) => Number(Number(v).toFixed(d));
const avg = (values, n) => values.slice(-n).reduce((a,b)=>a+b,0)/n;
// EMA clássica: semente SMA(n) e somente fechamentos. A série MACD também precisa de 9 valores válidos.
function emaSeries(values,n){
  const out=Array(values.length).fill(null), alpha=2/(n+1);
  let previous=null,seed=[];
  for(let i=0;i<values.length;i++){
    const v=values[i];
    if(!Number.isFinite(v))continue;
    if(previous===null){
      seed.push(v);
      if(seed.length===n){previous=seed.reduce((a,b)=>a+b,0)/n;out[i]=previous;}
    }else {previous=previous+(v-previous)*alpha;out[i]=previous;}
  }
  return out;
}
// RSI de Wilder. Usa exclusivamente fechamentos completos do instrumento selecionado.
function rsiWilder(closes,n){
  if(closes.length<=n)return null;
  let gains=0,losses=0;
  for(let i=1;i<=n;i++){
    const change=closes[i]-closes[i-1];
    gains+=Math.max(change,0);losses+=Math.max(-change,0);
  }
  gains/=n;losses/=n;
  for(let i=n+1;i<closes.length;i++){
    const change=closes[i]-closes[i-1];
    gains=(gains*(n-1)+Math.max(change,0))/n;
    losses=(losses*(n-1)+Math.max(-change,0))/n;
  }
  if(losses===0)return gains===0?50:100;
  return 100-100/(1+gains/losses);
}
function readTf(raw, now) {
  const rows = (Array.isArray(raw) ? raw : []).filter(r =>
    Array.isArray(r) && r.length >= 7 && Number(r[6]) < now &&
    [r[0],r[1],r[2],r[3],r[4],r[5],r[6]].every(v=>Number.isFinite(Number(v))) &&
    Number(r[4]) > 0 && Number(r[2]) >= Number(r[3])
  ).sort((a,b)=>Number(a[0])-Number(b[0]));
  if (rows.length < 65) throw new Error('É necessário histórico de pelo menos 65 candles fechados por período.');
  const c = rows.map(r=>Number(r[4])), p = c.at(-1), prev = c.at(-2);
  const ma = Object.fromEntries([5,10,30,60].map(n=>[n,avg(c,n)]));
  const pMa5 = avg(c.slice(0,-1),5);
  const trs = rows.slice(-15).map((r,i,a)=>{
    const before = i ? Number(a[i-1][4]) : Number(rows.at(-16)[4]);
    return Math.max(Number(r[2])-Number(r[3]),Math.abs(Number(r[2])-before),Math.abs(Number(r[3])-before));
  });
  const atr = avg(trs.slice(-14),14);
  const volAvg = avg(rows.slice(-21,-1).map(r=>Number(r[5])),20);
  const curr = rows.at(-1);
  const range = Number(curr[2])-Number(curr[3]);
  const upperWick = range>0 ? (Number(curr[2])-Math.max(Number(curr[1]),p))/range : 0;
  const e12=emaSeries(c,12),e26=emaSeries(c,26);
  const macdLine=c.map((_,i)=>Number.isFinite(e12[i])&&Number.isFinite(e26[i])?e12[i]-e26[i]:null);
  const macdSignal=emaSeries(macdLine,9);
  const mh=macdLine.map((x,i)=>Number.isFinite(x)&&Number.isFinite(macdSignal[i])?x-macdSignal[i]:null);
  const lastI=mh.length-1,macdBearish=macdLine[lastI]<macdSignal[lastI];
  const macd={
    line:round(macdLine[lastI],6),signal:round(macdSignal[lastI],6),
    hist:round(mh[lastI],6),previousHist:round(mh[lastI-1],6),
    bearish:macdBearish,bearishCross:macdBearish && macdLine[lastI-1]>=macdSignal[lastI-1],
    histFalling:mh[lastI]<mh[lastI-1] && mh[lastI-1]<mh[lastI-2]
  };
  // Negócios executados não identificam participantes: é volume DIRECIONAL APROXIMADO,
  // classificado pela cor do candle fechado, e não fluxo comprador/vendedor real.
  const recentDown=rows.slice(-3).filter(r=>Number(r[4])<Number(r[1]));
  const sellVolumeRatio=volAvg>0&&recentDown.length?
    Math.max(...recentDown.map(r=>Number(r[5])/volAvg)):null;
  const volumeReliable=Number.isFinite(volAvg)&&volAvg>0 &&
    Number.isFinite(Number(curr[5])) && volAvg>=0.00000001;
  const sellVolumeConfirmed=volumeReliable && sellVolumeRatio>=1.2 && sellVolumeRatio<=20;
  const rsi={rsi6:round(rsiWilder(c,6),2),rsi12:round(rsiWilder(c,12),2),rsi24:round(rsiWilder(c,24),2)};
  const previousLows = rows.slice(-11,-1).map(r=>Number(r[3]));
  const priorHighs = rows.slice(-13,-1).map(r=>Number(r[2]));
  return {
    price:p, prev, candleClose:Number(curr[6]),
    ma5:round(ma[5]),ma10:round(ma[10]),ma30:round(ma[30]),ma60:round(ma[60]),
    slope5Pct:round((ma[5]/pMa5-1)*100),distanceMA5Pct:round((p/ma[5]-1)*100),
    stretchAtr:atr>0?round((p-ma[5])/atr):null,
    atrPct:round(atr/p*100),volumeRatio:volAvg>0?round(Number(curr[5])/volAvg):null,
    sellVolumeRatio:sellVolumeRatio===null?null:round(sellVolumeRatio),
    sellVolumeConfirmed,volumeReliable,downCandle:p<Number(curr[1]),macd,rsi,
    histMexcScale:round(macd.hist*2,6), // MEXC Original costuma exibir 2 x (DIF - DEA); confira convenção no gráfico.
    support10:round(Math.min(...previousLows)),
    below5Two: p<ma[5] && prev<pMa5, below10:p<ma[10],
    brokeLow:p<Math.min(...previousLows),
    upperReject: upperWick>=0.42 && Number(curr[2])>=Math.max(...priorHighs)*0.998,
    alignedUp:p>ma[5] && ma[5]>ma[10] && ma[10]>ma[30] && ma[30]>ma[60],
    alignedDown:p<ma[5] && ma[5]<ma[10] && ma[10]<ma[30] && ma[30]<ma[60]
  };
}
function analyzeOilMA(data, sources, now=Date.now()) {
  if (!PERIODS.every(tf=>data && data[tf])) throw new Error('Faltam timeframes 5m/15m/1h/4h.');
  const sourceNames=PERIODS.map(tf=>sources?.[tf]);
  if(sourceNames.some(s=>!s)||new Set(sourceNames).size!==1)
    throw new Error('FONTES INCOMPATÍVEIS: não misturar UKOIL da MEXC e Brent BZ=F.');
  const t=Object.fromEntries(PERIODS.map(tf=>[tf,readTf(data[tf],now)]));
  // OIL pode parar de negociar: leitura antiga não deve disparar fase como se fosse atual.
  if(now-t['5m'].candleClose>20*60000 || now-t['15m'].candleClose>45*60000)
    throw new Error('CANDLES DESATUALIZADOS: 5m/15m sem fechamento recente; monitor pausado.');
  const m5=t['5m'],m15=t['15m'],h1=t['1h'],h4=t['4h'];
  const weak5=m5.below5Two && m5.slope5Pct<=0;
  const weak15=m15.below5Two && m15.slope5Pct<0;
  const break5=m5.brokeLow || (m5.ma5<m5.ma10 && m5.below10);
  const break15= m15.brokeLow && m15.below10;
  // A perda da MA pode antecipar o movimento; MACD e volume qualificam o sinal.
  // Fase 4 exige MACD vendedor 15m + participação vendedora 15m/1h.
  const volumeSupport=m15.sellVolumeConfirmed || h1.sellVolumeConfirmed;
  const confirmed=weak15 && break15 && h1.price<h1.ma5 && h1.slope5Pct<0 &&
    m15.macd.bearish && volumeSupport;
  const possible=weak5 && break5 && (weak15 || m15.slope5Pct<0) &&
    (m5.macd.bearish || m15.macd.histFalling);
  // Um 15m já vendedor merece alerta informativo, mesmo se o 5m ainda divergir.
  // Sem o 5m concordando, nunca elevar essa condição sozinha para fase 3.
  const early15=m15.price<m15.ma5 && m15.ma5<m15.ma10 && m15.macd.bearish;
  const preliminary=weak5 || early15 || m5.upperReject || m15.upperReject ||
    (m5.macd.histFalling && (m5.slope5Pct<=0 || m5.upperReject)) ||
    (h4.stretchAtr!==null && h4.stretchAtr>=1.5 && m5.price<m5.prev);
  const stage=confirmed?4:possible?3:preliminary?2:1;
  const titles={1:'SEM ALERTA DE REVERSÃO — avaliar contexto 4h',2:'PRÉ-EXAUSTÃO — observar',3:'POSSÍVEL SHORT — não confirmado',4:'BAIXA CONFIRMADA NO INTRADIA — não significa reversão do 4h'};
  const reasons=[];
  if(h4.alignedUp)reasons.push('4h: preço > MA5 > MA10 > MA30 > MA60 (estrutura compradora)');
  else if(h4.alignedDown)reasons.push('4h: médias alinhadas para baixa');
  else reasons.push('4h: médias sem alinhamento completo');
  if(h4.stretchAtr!==null && h4.stretchAtr>=1.5)reasons.push('4h esticado '+h4.stretchAtr+' ATR acima da MA5 — não é venda isoladamente');
  if(m5.upperReject || m15.upperReject)reasons.push('Rejeição de máxima em candle fechado de 5m/15m');
  if(weak5)reasons.push('5m: dois fechamentos abaixo da MA5 e inclinação não positiva');
  if(break5)reasons.push('5m: quebra de fundo recente ou MA5 abaixo da MA10 com preço fraco');
  if(weak15)reasons.push('15m: dois fechamentos abaixo da MA5, com inclinação negativa');
  if(early15 && !possible)reasons.push('15m: MA5 abaixo MA10 e MACD vendedor — pré-aviso, 5m ainda sem confirmação suficiente');
  if(break15)reasons.push('15m: fechamento abaixo de fundo recente e da MA10');
  if(h1.price<h1.ma5 && h1.slope5Pct<0)reasons.push('1h: preço abaixo da MA5 inclinada para baixo');
  if(m5.macd.histFalling)reasons.push('5m: histograma MACD desacelerando por 2 fechamentos');
  if(m5.macd.bearishCross || m15.macd.bearishCross)
    reasons.push('Cruzamento MACD vendedor detectado em candle fechado '+(m5.macd.bearishCross?'5m':'15m'));
  if(m15.macd.bearish)reasons.push('15m: MACD abaixo da linha de sinal');
  if(m15.rsi.rsi6<=25)reasons.push('15m: RSI6 muito pressionado ('+m15.rsi.rsi6+'); cuidado com repique. Não perseguir SHORT.');
  else if(m15.rsi.rsi6<=30)reasons.push('15m: RSI6 abaixo de 30; risco de repique e entrada tardia.');
  if(m15.macd.hist<0 && m15.macd.histFalling)
    reasons.push('15m: histograma MACD negativo e ampliando a pressão vendedora.');
  if(m15.price<m15.ma5 && m15.ma5<m15.ma10)
    reasons.push('15m: preço abaixo da MA5 e MA5 abaixo da MA10.');
  if(m15.price<m15.ma30)reasons.push('15m: fechamento abaixo da MA30.');
  if(m15.price>m15.ma60)reasons.push('15m: ainda acima da MA60; não extrapolar para reversão estrutural.');

  if(m15.sellVolumeConfirmed)
    reasons.push('15m: candle de baixa recente com volume >=1,2x dos 20 candles anteriores');
  else if(h1.sellVolumeConfirmed)
    reasons.push('1h: candle de baixa recente com volume >=1,2x dos 20 candles anteriores');
  else reasons.push('Volume vendedor recente sem confirmação >=1,2x; não afirmar reversão confirmada');
  if(weak15 && break15 && h1.price<h1.ma5 && h1.slope5Pct<0 && !confirmed)
    reasons.push('Perda estrutural observada, porém confirmação de MACD e/ou volume insuficiente para fase 4');
  if(stage===1)reasons.push('Sem conjunto suficiente de perda de impulso nos candles curtos');
  const checklist=[
    {name:'5m: enfraquecimento antecipado (MA5)',ok:weak5},
    {name:'5m: perda de fundo ou MA5/10',ok:break5},
    {name:'15m: MA5 em queda e dois fechamentos abaixo',ok:weak15},
    {name:'15m: perda de fundo e MA10',ok:break15},
    {name:'15m: MACD vendedor',ok:m15.macd.bearish},
    {name:'15m/1h: volume em candles de queda >= 1,2x',ok:volumeSupport},
    {name:'1h: preço abaixo MA5 e inclinação negativa',ok:h1.price<h1.ma5&&h1.slope5Pct<0},
    {name:'4h: '+(h4.alignedUp?'médias alinhadas para alta':h4.alignedDown?'médias alinhadas para baixa':'médias sem alinhamento completo'),ok:h4.alignedUp,contextOnly:true},
    {name:'15m: RSI6 '+m15.rsi.rsi6+(m15.rsi.rsi6<=30?' pressionado (risco de repique)':' sem sobrevenda curta'),ok:m15.rsi.rsi6<=30,contextOnly:true}
  ];
  return {stage,label:titles[stage],trend4h:h4.alignedUp?'ALTA':h4.alignedDown?'BAIXA':'MISTA',
    price:m5.price,candleClose:m5.candleClose,source:sourceNames[0],time:now,reasons,checklist,t};
}
function createOilMaDetector({app,oilCandles,telegram,telegramConfigured,dataDir}) {
  const file=path.join(dataDir,'oil-ma-history.json');
  let stored={source:'',sentStage:0,stageOneSince:0,lastAlertAt:0,lastAlertCandle:0,history:[]};
  try { const p=JSON.parse(fs.readFileSync(file,'utf8'));if(p && typeof p==='object')
    stored={...stored,...p,history:Array.isArray(p.history)?p.history.slice(0,100):[]};
  }catch(e){if(e.code!=='ENOENT')console.warn('Detector MA: falha ao ler arquivo:',e.message);}
  let latest=null,error=null,lastAttempt=0,running=false;
  function save(){try{fs.mkdirSync(dataDir,{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(stored,null,2));fs.renameSync(temp,file);}
    catch(e){console.warn('Detector MA: não foi possível salvar:',e.message);}}
  function evaluateHistory(rows,source,now) {
    let changed=false;
    const closed=rows.filter(r=>Number(r[6])<now).sort((a,b)=>Number(a[6])-Number(b[6]));
    for(const ev of stored.history){
      if(ev.source!==source)continue;
      ev.results=ev.results||{};
      for(const minutes of HORIZONS){
        if(ev.results[minutes]||now<ev.candleClose+minutes*60000)continue;
        const target=ev.candleClose+minutes*60000;
        const hit=closed.find(r=>Number(r[6])>=target && Number(r[6])-target<=60000);
        if(!hit)continue;
        const pct=round((ev.price-Number(hit[4]))/ev.price*100);
        ev.results[minutes]={price:Number(hit[4]),directionalPct:pct,closed:Number(hit[6]),state:pct>0?'FAVORAVEL':pct<0?'CONTRARIO':'NEUTRO'};
        changed=true;
      }
    }
    return changed;
  }
  async function scan(){
    if(running)return;
    running=true;lastAttempt=Date.now();
    try{
      const fetched=await Promise.all(PERIODS.map(tf=>oilCandles(tf)));
      const rows=Object.fromEntries(PERIODS.map((tf,i)=>[tf,fetched[i].rows]));
      const sources=Object.fromEntries(PERIODS.map((tf,i)=>[tf,fetched[i].source]));
      const current=analyzeOilMA(rows,sources,lastAttempt);
      latest=current;error=null;
      let changed=evaluateHistory(rows['5m'],current.source,lastAttempt);
      // Troca de instrumento entre rodadas: recomeçar o estado e aguardar novo 5m.
      if(stored.source!==current.source){
        stored.source=current.source;stored.sentStage=0;stored.stageOneSince=0;
        stored.lastAlertAt=lastAttempt;stored.lastAlertCandle=current.candleClose;changed=true;
      }
      if(current.stage===1){
        if(!stored.stageOneSince){stored.stageOneSince=lastAttempt;changed=true;}
        if(lastAttempt-stored.stageOneSince>=15*60000 && stored.sentStage!==0){
          stored.sentStage=0;changed=true;
        }
      }else if(stored.stageOneSince){stored.stageOneSince=0;changed=true;}
      // Primeiros avisos só após fechamento 5m novo e progressão real de fase.
      const newCandle=current.candleClose>stored.lastAlertCandle;
      const cooldown=lastAttempt-stored.lastAlertAt>=15*60000;
      const escalated=current.stage>stored.sentStage;
      if(current.stage>=2 && escalated && newCandle && (cooldown || current.stage===4) && telegramConfigured) {
        const msg=['🛢️ SETUPDT OIL — DETECTOR DE MÉDIAS EGI',
          'FASE '+current.stage+' — '+current.label,
          'Fonte: '+current.source+' • 5m fechado: '+new Date(current.candleClose).toLocaleString('pt-BR'),
          'Preço 5m: $ '+current.price.toFixed(3)+' • contexto 4h: '+current.trend4h,
          'MACD 5m hist: '+current.t['5m'].macd.hist+' • MACD 15m hist: '+current.t['15m'].macd.hist,
          'RSI 15m: 6='+current.t['15m'].rsi.rsi6+' 12='+current.t['15m'].rsi.rsi12+' 24='+current.t['15m'].rsi.rsi24,
          'Volume 15m: '+current.t['15m'].volumeRatio+'x • pressão vendedora aproximada: '+
            (current.t['15m'].sellVolumeConfirmed?'acima de 1,2x':'sem confirmação'),
          ...current.reasons.slice(0,5).map(x=>'• '+x),
          'Aviso educativo, não é ordem nem confirmação de SHORT.'].join('\n');
        await telegram(msg);
        stored.sentStage=current.stage;stored.lastAlertAt=lastAttempt;stored.lastAlertCandle=current.candleClose;
        stored.history.unshift({stage:current.stage,label:current.label,price:current.price,
          source:current.source,candleClose:current.candleClose,sentAt:lastAttempt,reasons:current.reasons,
          indicators:Object.fromEntries(PERIODS.map(tf=>[tf,{
            macd:{...current.t[tf].macd},rsi:{...current.t[tf].rsi},volumeRatio:current.t[tf].volumeRatio,
            sellVolumeRatio:current.t[tf].sellVolumeRatio,volumeReliable:current.t[tf].volumeReliable
          }])),results:{}});
        stored.history=stored.history.slice(0,100);changed=true;
      }
      if(changed)save();
    }catch(e){error=String(e.message||e);console.warn('Detector de Médias OIL:',error);}
    finally{running=false;}
  }
  app.get('/api/oil/ma',(_req,res)=>{
    res.set('cache-control','no-store');
    res.json({ok:!error,latest,error,lastAttempt,scanSeconds:60,
      telegramConfigured,history:stored.history,persistence:'SETUPDT_DATA_DIR (necessita disco persistente)'});
  });
  const timer=setInterval(scan,60000);timer.unref();
  const initial=setTimeout(scan,25000);initial.unref();
  return {scan,analyzeOilMA};
}
module.exports={analyzeOilMA,createOilMaDetector};
