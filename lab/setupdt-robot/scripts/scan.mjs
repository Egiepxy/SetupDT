import fs from 'node:fs/promises';
import path from 'node:path';

const ASSETS = ['BTC','ETH','SOL','LINK','XRP','AVAX','NEAR','ONDO','PENDLE','SUI','CKB','INJ','AAVE','ENA','HYPE','SEI','TIA','WLD','PEPE','ADA','UNI'];
const TIMEFRAMES = ['15m','1h','4h','1d'];
const BASES = ['https://api.binance.com/api/v3/','https://data-api.binance.vision/api/v3/'];
const STATE_PATH = process.env.SETUPDT_STATE_PATH || path.resolve('state.json');
const NOW = Date.now();

function sma(a,n){return a.length<n?null:a.slice(-n).reduce((x,y)=>x+y,0)/n;}
function rsi(closes,period=14){if(closes.length<=period)return null;let gains=0,loss=0;for(let i=closes.length-period;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)gains+=d;else loss-=d;}if(loss===0)return gains===0?50:100;return 100-100/(1+(gains/period)/(loss/period));}
function atr(highs,lows,closes,period=14){if(closes.length<=period)return null;const trs=[];for(let i=1;i<closes.length;i++)trs.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));return sma(trs,period);}
function snapshot(rows){
  const closes=rows.map(x=>x.close),highs=rows.map(x=>x.high),lows=rows.map(x=>x.low),vols=rows.map(x=>x.volume),price=closes.at(-1);
  const r=rsi(closes),ma20=sma(closes,20),ma50=sma(closes,50),ma200=sma(closes,200),vol20=sma(vols,20),lastVol=vols.at(-1);
  let trend='Lateral';if(price>ma20&&ma20>ma50&&ma50>ma200)trend='Alta forte';else if(price>ma20&&ma20>ma50)trend='Alta';else if(price<ma20&&ma20<ma50&&ma50<ma200)trend='Baixa forte';else if(price<ma20&&ma20<ma50)trend='Baixa';
  let score=0;if(price>ma20)score++;else score--;if(ma20>ma50)score++;else score--;if(price>ma200)score++;else score--;if(r<35)score++;if(r>70)score--;if(vol20&&lastVol>vol20*1.2)score+=Math.sign(price-closes.at(-2));
  let signal='N';if(score>=3)signal='L+';else if(score>=1)signal='L';else if(score<=-3)signal='S+';else if(score<=-1)signal='S';
  const range=atr(highs,lows,closes);if(!(range>0))throw new Error('ATR indisponível.');
  return {price,r,ma20,ma50,ma200,trend,score,signal,dir:signal.startsWith('L')?'LONG':signal.startsWith('S')?'SHORT':'NEUTRO',atr:range,volRatio:vol20?lastVol/vol20:0,candleClose:rows.at(-1).end};
}
function trackerStrength(snaps){
  const dirs=snaps.map(x=>x.trend.startsWith('Alta')?1:x.trend.startsWith('Baixa')?-1:0),weighted=dirs[0]+dirs[1]*2+dirs[2]*3+dirs[3]*4,direction=Math.sign(weighted),agreement=Math.abs(weighted)/10,strong=snaps.filter(x=>x.trend.includes('forte')).length;
  const force=Math.min(99,Math.round(45+agreement*45+strong*2));let signal='NEUTRO';if(direction>0&&force>=80)signal='LONG FORTE';else if(direction>0&&force>=62)signal='LONG';else if(direction<0&&force>=80)signal='SHORT FORTE';else if(direction<0&&force>=62)signal='SHORT';
  return {force,signal,direction,weighted};
}
function adaptiveStop(m15){
  const price=m15.price,a=m15.atr,atrPct=a/price;let multiplier=1.25,floorPct=.0045,label='ATR normal';
  if(atrPct<.0025){multiplier=1.70;floorPct=.0035;label='ATR muito comprimido';}else if(atrPct<.005){multiplier=1.50;floorPct=.0050;label='ATR comprimido';}else if(atrPct<.009){multiplier=1.35;floorPct=.0055;label='ATR moderado';}else{multiplier=1.25;floorPct=.0060;label='ATR elevado';}
  return {risk:Math.max(a*multiplier,price*floorPct),multiplier,atrPct,floorPct,label};
}
function evaluate(snaps,rows15m,quote){
  const m15=snaps['15m'],h1=snaps['1h'],h4=snaps['4h'],d1=snaps['1d'],tracker=trackerStrength([m15,h1,h4,d1]);
  const volOK=m15.volRatio>=.8,align=h4.dir!=='NEUTRO'&&h4.dir===h1.dir,trigger=align&&m15.dir===h4.dir,model=adaptiveStop(m15),entry=m15.price,sign=h4.dir==='SHORT'?-1:1,stop=entry-sign*model.risk,target=entry+sign*model.risk*1.5;
  const rrOK=model.risk>0&&[entry,stop,target].every(x=>Number.isFinite(x)&&x>0)&&Math.abs(target-entry)/Math.abs(entry-stop)>=1.499999,rsiOK=m15.r>=30&&m15.r<=70;
  const checks=[h4.dir!=='NEUTRO',align,trigger,volOK,rrOK,rsiOK],count=checks.filter(Boolean).length;let day='AGUARDAR';
  if(h4.dir==='LONG'&&h1.dir==='LONG')day=trigger&&volOK&&rrOK&&rsiOK?'LONG':'PREPARAR LONG';else if(h4.dir==='SHORT'&&h1.dir==='SHORT')day=trigger&&volOK&&rrOK&&rsiOK?'SHORT':'PREPARAR SHORT';
  const trackerDir=tracker.signal.startsWith('LONG')?'LONG':tracker.signal.startsWith('SHORT')?'SHORT':'NEUTRO',dailyAgainst=(day.includes('LONG')&&d1.dir==='SHORT')||(day.includes('SHORT')&&d1.dir==='LONG'),trackerAgainst=(day.includes('LONG')&&trackerDir==='SHORT')||(day.includes('SHORT')&&trackerDir==='LONG');
  const baseCandidate=count===6&&(day==='LONG'||day==='SHORT'),direction=day==='SHORT'?-1:1,levels=baseCandidate?{entry,stop:entry-direction*model.risk,t1:entry+direction*model.risk*1.5,t2:entry+direction*model.risk*2,t3:entry+direction*model.risk*3}:null;
  let status=day==='LONG'||day==='SHORT'?'AGUARDAR FILTROS FINAIS':day.startsWith('PREPARAR')?day:tracker.signal==='NEUTRO'?'OBSERVAR':'AGUARDAR';
  let flow={confirmed:false,phase:'SEM DIREÇÃO',label:'Aguardar 6/6 técnico',reason:'A liberação do fluxo só é calculada após o checklist 6/6.'};
  if(baseCandidate){
    const arr=rows15m,last=arr.at(-1),prev=arr.at(-2),prev2=arr.at(-3),avgVol=sma(arr.slice(0,-1).slice(-20).map(x=>x.volume),20),volRatio=avgVol?last.volume/avgVol:null,buyShare=Number.isFinite(last.takerBuyBase)&&last.volume>0?last.takerBuyBase/last.volume:null;
    const lastUp=last.close>last.open&&last.close>prev.close,lastDown=last.close<last.open&&last.close<prev.close,prevDown=prev.close<prev.open||prev.close<prev2.close,prevUp=prev.close>prev.open||prev.close>prev2.close,drying=prev.volume<prev2.volume*.93,expanding=last.volume>prev.volume*1.10,strong=Number.isFinite(volRatio)&&volRatio>=1.20;
    const sellerDrying=prevDown&&drying,buyerDrying=prevUp&&drying,buyTrigger=lastUp&&expanding&&(buyShare===null||buyShare>=.52),sellTrigger=lastDown&&expanding&&(buyShare===null||buyShare<=.48);
    flow.confirmed=day==='LONG'?buyTrigger&&(sellerDrying||strong):sellTrigger&&(buyerDrying||strong);flow.phase=flow.confirmed?'CONFIRMADO':day==='LONG'&&sellerDrying||day==='SHORT'&&buyerDrying?'EXAUSTÃO':'AGUARDAR';
    flow.label=flow.confirmed?(day==='LONG'?'FLUXO COMPRADOR CONFIRMADO':'FLUXO VENDEDOR CONFIRMADO'):'AGUARDAR FLUXO 15m';flow.reason=flow.confirmed?'Sequência de candle e volume compatível com a regra de fluxo EGI.':'O candle fechado de 15m ainda não completou a sequência de fluxo exigida.';flow.buyShare=buyShare;flow.volRatio=volRatio;flow.closed=last.end;
    status=flow.confirmed?'CANDIDATO '+day+' • 6/6 + FLUXO':'AGUARDAR FLUXO';
    if(quote&&levels){if(day==='LONG'&&quote.price<=levels.stop||day==='SHORT'&&quote.price>=levels.stop)status='INVALIDADO — PREÇO ALÉM DO STOP';else if(day==='LONG'&&quote.price>=levels.t1||day==='SHORT'&&quote.price<=levels.t1)status='ENTRADA PERDIDA — NÃO PERSEGUIR';else if(!flow.confirmed)status='AGUARDAR FLUXO';else if(day==='LONG'&&quote.price>levels.entry||day==='SHORT'&&quote.price<levels.entry)status='AGUARDAR ENTRADA/PULLBACK';}
  }
  return {status,day,checks,count,tracker,dailyAgainst,trackerAgainst,snapshots:snaps,flow,quote,levels,stopModel:model,signalCandle:m15.candleClose,fullSetupDTApproval:false,execution:'NONE',note:'Monitor LAB: filtros completos de risco/Triple Screen e ordens não são executados por este serviço.'};
}
function parseCandles(payload,tf,now){
  if(!Array.isArray(payload))throw new Error('Resposta de candles inválida em '+tf);
  const rows=payload.filter(x=>Array.isArray(x)&&Number(x[6])<now-1000).map(x=>({start:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5]),end:Number(x[6]),takerBuyBase:Number.isFinite(Number(x[9]))?Number(x[9]):null}));
  if(rows.length<200)throw new Error('Menos de 200 candles fechados em '+tf);
  if(rows.some(c=>![c.start,c.open,c.high,c.low,c.close,c.volume,c.end].every(Number.isFinite)||c.open<=0||c.close<=0||c.low<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0))throw new Error('Candles inconsistentes em '+tf);
  return rows;
}
async function fetchJson(pathname){
  let lastError=null;
  for(const base of BASES){
    try{const res=await fetch(base+pathname,{headers:{'accept':'application/json','user-agent':'SetupDT-Robot-LAB/1.0'},signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error('HTTP '+res.status);return await res.json();}catch(error){lastError=error;}
  }
  throw lastError||new Error('Sem resposta da fonte pública Binance.');
}
async function collectAsset(asset){
  const symbol=asset+'USDT';
  const results=await Promise.all([...TIMEFRAMES.map(async tf=>[tf,await fetchJson('klines?symbol='+symbol+'&interval='+tf+'&limit=220')]),['quote',await fetchJson('ticker/price?symbol='+symbol)]]);
  const raw=Object.fromEntries(results),rows={};for(const tf of TIMEFRAMES)rows[tf]=parseCandles(raw[tf],tf,Date.now());
  const snaps=Object.fromEntries(TIMEFRAMES.map(tf=>[tf,snapshot(rows[tf])]));
  const price=Number(raw.quote.price);if(!Number.isFinite(price)||price<=0)throw new Error('Cotação atual inválida.');
  return {asset,market:'Binance Spot',price,updatedAt:new Date().toISOString(),result:evaluate(snaps,rows['15m'],{price,time:Date.now()})};
}
async function loadState(){try{return JSON.parse(await fs.readFile(STATE_PATH,'utf8'));}catch{return {schema:'setupdt-robot-lab/v1',generatedAt:null,latestRun:null,assets:{},signals:[],runs:[],execution:'NONE',notification:'NOT_CONFIGURED'};}}
async function main(){
  const old=await loadState(),assets={},errors=[];
  for(let i=0;i<ASSETS.length;i+=3){
    const batch=ASSETS.slice(i,i+3);
    const done=await Promise.all(batch.map(async asset=>{try{return {asset,value:await collectAsset(asset)};}catch(error){return {asset,error:String(error?.message||error)};}}));
    for(const item of done){if(item.value)assets[item.asset]=item.value;else{errors.push({asset:item.asset,error:item.error});assets[item.asset]={asset:item.asset,status:'SEM DADOS',error:item.error,updatedAt:new Date().toISOString(),fullSetupDTApproval:false,execution:'NONE'};}}
  }
  const now=new Date().toISOString(),run={at:now,assetsOk:Object.values(assets).filter(x=>x.result).length,assetsFailed:errors.length,candidates:Object.values(assets).filter(x=>String(x.result?.status||'').startsWith('CANDIDATO')).length,errors};
  const history=Array.isArray(old.signals)?old.signals:[];
  for(const item of Object.values(assets)){const r=item.result;if(!r||!String(r.status).startsWith('CANDIDATO'))continue;const key=item.asset+'|'+r.day+'|'+r.signalCandle;if(!history.some(x=>x.key===key))history.push({key,asset:item.asset,direction:r.day,status:r.status,candle:r.signalCandle,detectedAt:now,price:item.price,flow:r.flow,execution:'NONE'});}
  const state={schema:'setupdt-robot-lab/v1',generatedAt:now,source:'Binance Spot public API',schedule:'15 min (GitHub Actions; requires workflow on default branch)',assets,latestRun:run,signals:history.slice(-500),runs:[...(Array.isArray(old.runs)?old.runs:[]),run].slice(-96),execution:'NONE',notification:'NOT_CONFIGURED',scope:'Read-only signal monitoring; no exchange keys and no orders.'};
  await fs.mkdir(path.dirname(STATE_PATH),{recursive:true});const temp=STATE_PATH+'.tmp';await fs.writeFile(temp,JSON.stringify(state,null,2)+'\n','utf8');await fs.rename(temp,STATE_PATH);
  console.log(JSON.stringify({generatedAt:now,assetsOk:run.assetsOk,assetsFailed:run.assetsFailed,candidates:run.candidates,errors:errors.slice(0,10)},null,2));
  if(run.assetsOk===0)process.exitCode=1;
}
main().catch(error=>{console.error('Falha fatal no monitor SetupDT LAB:',error);process.exitCode=1;});