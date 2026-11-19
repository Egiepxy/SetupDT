import {readFile,writeFile,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {stats} from './auditoria-v15.mjs';
const path='lab/connors/state-v16.json';
const read=async(p)=>JSON.parse(await readFile(p,'utf8'));
async function save(p,x){await writeFile(p+'.tmp',JSON.stringify(x,null,2));await rename(p+'.tmp',p)}
function ranking(series){return Object.entries(series).filter(([k])=>k.endsWith('|original')).map(([key,x])=>({key,...stats(x.trades)})).sort((a,b)=>(b.expectancy??-Infinity)-(a.expectancy??-Infinity));}
function eligible(t,now,baseline,seen,id){return t>baseline&&t<=now&&now-t<=20*60000&&!seen[id]}
if(process.argv.includes('--test')){assert.equal(ranking({'BTC|1h|original':{trades:[{net:1}]}})[0].gains,1);assert(eligible(99,100,98,{},'a'));assert(!eligible(99,100,98,{a:true},'a'));assert(!eligible(99,100,99,{},'a'));console.log('V1.6 tests OK');}
else {
const audit=await read('lab/connors/auditoria-v15.json');
let state;try{state=await read(path)}catch(e){if(e.code!=='ENOENT')throw e;state={baseline:Date.now(),seen:{},history:{},reports:{}}}
const now=Date.now();if(audit.coverage.ok!==100||audit.coverage.fail!==0)throw Error('Incomplete coverage');
for(const [key,x] of Object.entries(audit.series)){const h=state.history[key]??={};for(const t of x.trades){const id=t.signalTime+'|'+t.side;h[id]??=t;}}
const rank=ranking(audit.series);
const byCoin={};for(const r of rank){const coin=r.key.split('|')[0];(byCoin[coin]??=[]).push(r);}
const report={generated:audit.generated,coverage:audit.coverage,ranking: Object.entries(byCoin).map(([symbol,periods])=>({symbol,periods,meanExpectancy:periods.every(p=>p.expectancy!=null)?periods.reduce((a,p)=>a+p.expectancy,0)/periods.length:null})).sort((a,b)=>(b.meanExpectancy??-Infinity)-(a.meanExpectancy??-Infinity))};
await save('lab/connors/report-v16.json',report);
const local=new Date(now-3*3600000).toISOString();if(local.slice(11,13)==='21')state.reports[local.slice(0,10)]??=report;
for(const [key,x] of Object.entries(audit.series)){if(!key.endsWith('|original')||!x.pending)continue;const p=x.pending,id=key+'|'+p.time+'|'+(p.exit?'exit':p.side);if(!eligible(p.time,now,state.baseline,state.seen,id))continue;const s=stats(x.trades.filter(t=>t.exitTime<=p.time));console.log('DRY RUN',JSON.stringify({id,key,side:p.side??x.position?.side,type:p.exit?'exit':'entry',stats:s}));state.seen[id]='dry-run';}
await save(path,state);
if(process.env.NTFY_TEST==='true'){const r=await fetch('https://ntfy.sh/ConnorsEGI_11',{method:'POST',body:'TESTE Connors EGI V1.6 LAB - nenhuma ordem ou sinal real',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('NTFY HTTP '+r.status);console.log('NTFY accepted',r.status);}
console.log('V1.6 coverage',audit.coverage,'ranking coins',report.ranking.length);
}
