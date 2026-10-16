'use strict';
// Detector de Médias OIL EGI — estudo, sem execução de ordens.
// Fonte única obrigatória por rodada. Candles estritamente FECHADOS.
const fs = require('fs');
const path = require('path');
const PERIODS = ['5m', '15m', '1h', '4h'];
const HORIZONS = [15, 30, 60];
const round = (v, d = 4) => Number(Number(v).toFixed(d));
const avg = (values, n) => values.slice(-n).reduce((a,b)=>a+b,0)/n;
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
  const previousLows = rows.slice(-11,-1).map(r=>Number(r[3]));
  const priorHighs = rows.slice(-13,-1).map(r=>Number(r[2]));
  return {
    price:p, prev, candleClose:Number(curr[6]),
    ma5:round(ma[5]),ma10:round(ma[10]),ma30:round(ma[30]),ma60:round(ma[60]),
    slope5Pct:round((ma[5]/pMa5-1)*100),distanceMA5Pct:round((p/ma[5]-1)*100),
    stretchAtr:atr>0?round((p-ma[5])/atr):null,
    atrPct:round(atr/p*100),volumeRatio:volAvg>0?round(Number(curr[5])/volAvg):null,
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
  const m5=t['5m'],m15=t['15m'],h1=t['1h'],h4=t['4h'];
  const weak5=m5.below5Two && m5.slope5Pct<=0;
  const weak15=m15.below5Two && m15.slope5Pct<0;
  const break5=m5.brokeLow || (m5.ma5<m5.ma10 && m5.below10);
  const break15= m15.brokeLow && m15.below10;
  const confirmed=weak15 && break15 && h1.price<h1.ma5 && h1.slope5Pct<0;
  const possible=weak5 && break5 && (weak15 || m15.slope5Pct<0);
  const preliminary=weak5 || m5.upperReject || m15.upperReject ||
    (h4.stretchAtr!==null && h4.stretchAtr>=1.5 && m5.price<m5.prev);
  const stage=confirmed?4:possible?3:preliminary?2:1;
  const titles={1:'ALTA / CONTEXTO — sem perda confirmada',2:'PRÉ-EXAUSTÃO — observar',3:'POSSÍVEL SHORT — não confirmado',4:'BAIXA CONFIRMADA NO INTRADIA — não significa reversão do 4h'};
  const reasons=[];
  if(h4.alignedUp)reasons.push('4h: preço > MA5 > MA10 > MA30 > MA60 (estrutura compradora)');
  else if(h4.alignedDown)reasons.push('4h: médias alinhadas para baixa');
  else reasons.push('4h: médias sem alinhamento completo');
  if(h4.stretchAtr!==null && h4.stretchAtr>=1.5)reasons.push('4h esticado '+h4.stretchAtr+' ATR acima da MA5 — não é venda isoladamente');
  if(m5.upperReject || m15.upperReject)reasons.push('Rejeição de máxima em candle fechado de 5m/15m');
  if(weak5)reasons.push('5m: dois fechamentos abaixo da MA5 e inclinação não positiva');
  if(break5)reasons.push('5m: quebra de fundo recente ou MA5 abaixo da MA10 com preço fraco');
  if(weak15)reasons.push('15m: dois fechamentos abaixo da MA5, com inclinação negativa');
  if(break15)reasons.push('15m: fechamento abaixo de fundo recente e da MA10');
  if(h1.price<h1.ma5 && h1.slope5Pct<0)reasons.push('1h: preço abaixo da MA5 inclinada para baixo');
  if(stage===1)reasons.push('Sem conjunto suficiente de perda de impulso nos candles curtos');
  return {stage,label:titles[stage],trend4h:h4.alignedUp?'ALTA':h4.alignedDown?'BAIXA':'MISTA',
    price:m5.price,candleClose:m5.candleClose,source:sourceNames[0],time:now,reasons,t};
}
function createOilMaDetector({app,oilCandles,telegram,telegramConfigured,dataDir}) {
  const file=path.join(dataDir,'oil-ma-history.json');
  let stored={sentStage:0,stageOneSince:0,lastAlertAt:0,lastAlertCandle:0,history:[]};
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
          ...current.reasons.slice(0,5).map(x=>'• '+x),
          'Aviso educativo, não é ordem nem confirmação de SHORT.'].join('\n');
        await telegram(msg);
        stored.sentStage=current.stage;stored.lastAlertAt=lastAttempt;stored.lastAlertCandle=current.candleClose;
        stored.history.unshift({stage:current.stage,label:current.label,price:current.price,
          source:current.source,candleClose:current.candleClose,sentAt:lastAttempt,reasons:current.reasons,results:{}});
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
