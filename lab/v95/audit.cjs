const fs=require('node:fs');
const {legacy,transition}=require('./engine.cjs');
const coins='BTC ETH SOL LINK XRP AVAX NEAR ONDO PENDLE SUI CKB INJ AAVE ENA HYPE SEI TIA WLD PEPE ADA UNI'.split(' ');
const frames={'15m':900000,'1h':3600000,'4h':14400000};
const dir='lab/v95/data',file=dir+'/state.json';
function process(s,symbol,tf,raw,now){
 const ms=frames[tf],eligible=raw.filter(k=>+k[6]<=now-1400).sort((a,b)=>a[6]-b[6]);
 const a=eligible.map(k=>({t:+k[6],c:+k[4],h:+k[2],l:+k[3],v:+k[5]}));
 if(a.length<100||a.some((x,i)=>![x.t,x.c,x.h,x.l,x.v].every(Number.isFinite)||x.c<=0||x.l>x.h||x.v<0||(i&&x.t-a[i-1].t!==ms)))throw Error('Dados insuficientes ou lacuna');
 const x=transition.calc(a),old=legacy(symbol,NaN,eligible.slice(-80),0.2,1.5,NaN,NaN);
 if(!old||old.signalCandleClose!==x.t)throw Error('Timestamp divergente');
 const key=symbol+'|'+tf,id=key+'|'+x.t;
 if(s.last[key]>=x.t)return;
 const previous=s.last[key];s.last[key]=x.t;
 for(const p of s.signals.filter(p=>p.key===key)){
   transition.audit(p,a,ms);
   if(!p.confirmedAt&&!p.expired){
     if(previous&&x.t-previous!==ms)p.expired='LACUNA';
     else if(x.t-p.t>8*ms)p.expired='JANELA';
     else if(old.state===p.dir){p.confirmedAt=x.t;p.lead=(x.t-p.t)/ms;}
   }
 }
 if(now-x.t>=ms+1400)return;
 s.counts[key]??={samples:0,agree:0,early:0,conflict:0,originalOnly:0};
 const c=s.counts[key];c.samples++;
 if(x.dir&&old.state===x.dir)c.agree++;else if(x.dir&&old.state===(x.dir==='LONG'?'SHORT':'LONG'))c.conflict++;else if(x.dir)c.early++;else if(['LONG','SHORT'].includes(old.state))c.originalOnly++;
 if(x.dir&&!s.signals.some(p=>p.id===id))s.signals.push({id,key,symbol,tf,t:x.t,last:x.t,dir:x.dir,price:x.price,atr:x.atr,hit:0,done:null,confirmedAt:old.state===x.dir?x.t:null,lead:old.state===x.dir?0:null});
}
function summary(s){return Object.entries(s.counts).map(([key,c])=>{const p=s.signals.filter(x=>x.key===key),confirmed=p.filter(x=>Number.isFinite(x.lead));return {key,...c,signals:p.length,confirmed:confirmed.length,meanLead:confirmed.length?confirmed.reduce((n,x)=>n+x.lead,0)/confirmed.length:null,r1:p.filter(x=>x.hit>=1).length,r2:p.filter(x=>x.hit>=2).length,r3:p.filter(x=>x.hit>=3).length,stop:p.filter(x=>x.done==='STOP').length,gaps:p.filter(x=>x.done==='LACUNA').length,open:p.filter(x=>!x.done).length}})}
function fresh(){return {schema:'EGI_V95_1',last:{},counts:{},signals:[]}}
async function get(symbol,tf){let errors=[];for(const host of ['https://data-api.binance.vision','https://api.binance.com']){try{const r=await fetch(host+'/api/v3/klines?symbol='+symbol+'&interval='+tf+'&limit=300',{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}catch(e){errors.push(e.message)}}throw Error(errors.join('; '))}
async function main(){fs.mkdirSync(dir,{recursive:true});const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fresh();if(s.schema!=='EGI_V95_1')throw Error('Schema inválido');let errors=[],ok=0;const jobs=coins.flatMap(c=>Object.keys(frames).map(tf=>[c+'USDT',tf]));for(let i=0;i<jobs.length;i+=5)await Promise.all(jobs.slice(i,i+5).map(async ([symbol,tf])=>{try{const raw=await get(symbol,tf);process(s,symbol,tf,raw,Date.now());ok++}catch(e){errors.push({symbol,tf,error:e.message})}}));const now=new Date();s.lastRun={at:now.toISOString(),ok,total:jobs.length,errors};fs.writeFileSync(file+'.tmp',JSON.stringify(s,null,2));fs.renameSync(file+'.tmp',file);const report={...s.lastRun,rows:summary(s),note:'Dados prospectivos; alvos cumulativos, stop prioritário, sem taxas. Antecipação em até 8 candles consecutivamente observados; não equivale a lucro.'};fs.writeFileSync(dir+'/latest.json',JSON.stringify(report,null,2));if(now.getUTCHours()===0){fs.mkdirSync(dir+'/daily',{recursive:true});const day=new Date(now.getTime()-3*3600000).toISOString().slice(0,10);const p=dir+'/daily/'+day+'.json';if(!fs.existsSync(p))fs.writeFileSync(p,JSON.stringify(report,null,2))}if(!ok)globalThis.process.exitCode=2;}
if(require.main===module)main().catch(e=>{console.error(e);globalThis.process.exitCode=1});
module.exports={process,summary,fresh};
