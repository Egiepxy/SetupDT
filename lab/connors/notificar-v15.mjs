import {readFile,writeFile,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {format,stats} from './auditoria-v15.mjs';
const maxAge=20*60*1000;
export function eligible(signal,now,last,seen,id){return Number.isFinite(signal)&&signal>last&&signal<=now&&now-signal<=maxAge&&!seen[id];}
if(process.argv.includes('--test')){let n=2000000;assert(eligible(n-1000,n,n-2000,{},'a'));assert(!eligible(n-1000,n,n-2000,{a:true},'a'));assert(!eligible(n-maxAge-1,n,0,{},'a'));assert(!eligible(n+1,n,0,{},'a'));assert(!eligible(n-1000,n,n-1000,{},'a'));console.log('Proteções OK');}
else {
const file='lab/connors/notificacoes-v15.json';
const state=JSON.parse(await readFile(file,'utf8'));
const audit=JSON.parse(await readFile('lab/connors/auditoria-v15.json','utf8'));
const now=Date.now();
if(now-Date.parse(audit.generated)>maxAge)throw Error('Auditoria atrasada');
const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(state,null,2));await rename(file+'.tmp',file)};
if(!state.started){state.started=now;await save();console.log('Primeira execução: baseline, sem alertas históricos');}
else for(const [key,x] of Object.entries(audit.series)){
const [symbol,tf,mode]=key.split('|');if(mode!=='original'||!x.pending)continue;
const p=x.pending,id=key+'|'+p.time+'|'+(p.exit?'exit':p.side);
if(!eligible(p.time,Date.now(),state.started,state.seen,id))continue;
const s=stats(x.trades.filter(t=>t.exitTime<=p.time));
const side=p.exit?x.position?.side:p.side;if(!side)continue;
const pair=key+'|'+side;
if(p.exit&&!state.open[pair])continue;
if(!p.exit&&state.open[pair])continue;
const msg=['Connors EGI V1.5 LAB — '+(p.exit?'SAÍDA':'ENTRADA')+' '+side,'Ativo: '+symbol+' | '+tf,'Candle fechado: '+new Date(p.time).toISOString(),'Execução simulada na próxima abertura; preço e resultado ainda não confirmados','Histórico móvel: '+s.closed+' fechadas | '+s.gains+' gains | '+s.losses+' losses','Acerto: '+(s.win?.toFixed(2)??'N/D')+'% | Payoff: '+(s.payoff?.toFixed(2)??'N/D'),id].join('\n');
if(process.env.NTFY_ENABLED!=='true'){console.log('DRY RUN '+msg);continue;}
state.seen[id]={status:'attempt',at:Date.now()};if(p.exit)delete state.open[pair];else state.open[pair]=id;await save();
try{let r=await fetch('https://ntfy.sh/ConnorsEGI_11',{method:'POST',body:msg,signal:AbortSignal.timeout(10000),headers:process.env.NTFY_TOKEN?{Authorization:'Bearer '+process.env.NTFY_TOKEN}:{}});if(!r.ok)throw Error('HTTP '+r.status);state.seen[id].status='sent';}catch(e){state.seen[id].status='uncertain';state.seen[id].error=e.message;console.error(id,e.message);}await save();
}
}
