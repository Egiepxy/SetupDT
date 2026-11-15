import {readFile,writeFile} from 'node:fs/promises';
const file='lab/connors/estado.json';
const state=JSON.parse(await readFile(file,'utf8'));
const brt=t=>new Date(t).toISOString();
function sma(a,n,i){if(i<n-1)return NaN;let s=0;for(let j=i-n+1;j<=i;j++)s+=a[j].close;return s/n}
function rsi2(a){const v=Array(a.length).fill(NaN);if(a.length<4)return v;let gain=0,loss=0;for(let k=1;k<=2;k++){const d=a[k].close-a[k-1].close;gain+=Math.max(0,d);loss+=Math.max(0,-d)}gain/=2;loss/=2;function value(g,l){return g===0&&l===0?50:l===0?100:g===0?0:100-100/(1+g/l)}v[2]=value(gain,loss);for(let i=3;i<a.length;i++){const d=a[i].close-a[i-1].close;gain=(gain+Math.max(0,d))/2;loss=(loss+Math.max(0,-d))/2;v[i]=value(gain,loss)}return v}
function decision(a,tf,low,high,key){const dur=tf==='1h'?3600000:7200000,now=Date.now();a=a.filter(c=>c.end<now-1000);if(a.length<205)throw new Error('Histórico insuficiente: '+a.length+' candles fechados');const i=a.length-1,c=a[i],prev=a[i-1],rsi=rsi2(a),sma200=sma(a,200,i),smaPrev=sma(a,200,i-1),sma5=sma(a,5,i);if(now-c.end>dur*2)throw new Error('Último candle fechado desatualizado: '+brt(c.end));const longSetup=rsi[i-1]<=low&&prev.close>smaPrev,shortSetup=rsi[i-1]>=high&&prev.close<smaPrev;const confirmedLong=longSetup&&c.close>prev.high&&c.close>sma200;const confirmedShort=shortSetup&&c.close<prev.low&&c.close<sma200;const rawPrepare=(rsi[i]<=low&&c.close>sma200)?'PREPARAR LONG':(rsi[i]>=high&&c.close<sma200)?'PREPARAR SHORT':null;
const pos=state.positions[key];let type=null,reason='';if(pos&&pos.side==='LONG'&&c.close>sma5){type='SAÍDA LONG';reason='Fechou acima da SMA5'}else if(pos&&pos.side==='SHORT'&&c.close<sma5){type='SAÍDA SHORT';reason='Fechou abaixo da SMA5'}else if(!pos&&confirmedLong){type='CONFIRMADO LONG';reason='RSI2 extremo anterior + rompimento da máxima + SMA200'}else if(!pos&&confirmedShort){type='CONFIRMADO SHORT';reason='RSI2 extremo anterior + perda da mínima + SMA200'}else if(!pos&&rawPrepare){type=rawPrepare;reason='RSI2 extremo e filtro SMA200; ainda sem gatilho'}
return {c,rsi:rsi[i],sma200,sma5,type,reason,rawPrepare,key}}
async function candles(symbol,tf){
  const errors=[];
  for(const host of ['https://api.binance.com','https://data-api.binance.vision']){
    try{
      const response=await fetch(host+'/api/v3/klines?'+new URLSearchParams({symbol,interval:tf,limit:'260'}),{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const rows=await response.json();
      return rows.map(k=>({end:+k[6],high:+k[2],low:+k[3],close:+k[4]})).filter(c=>Object.values(c).every(Number.isFinite)&&c.close>0);
    }catch(error){errors.push(host+' '+error.message)}
  }
  throw new Error(errors.join(' | '));
}
const {symbols,low,high,macro}=state.configuration;
const run={start:Date.now(),end:0,requested:0,ok:0,fail:0,events:0,macro,failures:[]};
const seen=new Set(state.events.map(e=>e.id));
const processed=state.processed??={};
for(const symbol of symbols.split(',')){
  for(const tf of ['1h','2h']){
    run.requested++;
    const key=symbol+'|'+tf;
    try{
      const {c,type,rsi,reason}=decision(await candles(symbol,tf),tf,+low,+high,key);
      run.ok++;
      if(c.end<=(processed[key]??0))continue;
      processed[key]=c.end;
      if(!type)continue;
      const id=key+'|'+c.end+'|'+type;
      if(seen.has(id))continue;
      seen.add(id);
      if(type.startsWith('CONFIRMADO'))state.positions[key]={side:type.endsWith('LONG')?'LONG':'SHORT',price:c.close,time:c.end};
      if(type.startsWith('SAÍDA'))delete state.positions[key];
      state.events.push({id,recordedAt:Date.now(),candleEnd:c.end,symbol,tf,type,price:c.close,rsi,reason,macro,delivery:'notificações desativadas'});
      run.events++;
    }catch(error){
      run.fail++;
      run.failures.push({symbol,tf,error:error.message});
    }
  }
}
run.end=Date.now();
state.exportedAt=new Date(run.end).toISOString();
state.runs.push(run);
state.runs=state.runs.slice(-100);
state.events=state.events.slice(-1500);
await writeFile(file,JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify(run,null,2));
