import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
export function stats(trades){
 const g=trades.filter(t=>t.net>0),l=trades.filter(t=>t.net<0),n=trades.length;
 return {closed:n,gains:g.length,losses:l.length,flat:n-g.length-l.length,win:n?100*g.length/n:null,payoff:g.length&&l.length?avg(g.map(t=>t.net))/-avg(l.map(t=>t.net)):null,expectancy:n?avg(trades.map(t=>t.net)):null};
}
export function replay(rows,tf,mode='original',fee=0.1){
 const step=tf==='1h'?3600000:7200000;
 const a=rows.filter(c=>c.end<Date.now()-1000);
 if(a.length<205)throw Error('Histórico insuficiente');
 for(let i=0;i<a.length;i++){let c=a[i];if(![c.end,c.open,c.close,c.high,c.low].every(Number.isFinite)||c.close<=0||c.open<=0||(i&&c.end-a[i-1].end!==step))throw Error('Candles inválidos ou lacuna');}
 let gain=0,loss=0;const r=[];
 for(let i=1;i<a.length;i++){let d=a[i].close-a[i-1].close;gain=i<=2?gain+Math.max(d,0)/2:(gain+Math.max(d,0))/2;loss=i<=2?loss+Math.max(-d,0)/2:(loss+Math.max(-d,0))/2;r[i]=!gain&&!loss?50:!loss?100:100-100/(1+gain/loss);}
 let pos=null,pending=null;const trades=[],events=[];
 const sma=(i,n)=>avg(a.slice(i-n+1,i+1).map(c=>c.close));
 for(let i=200;i<a.length;i++){
 const c=a[i],p=a[i-1];
 if(pending){if(pending.exit){let gross=(pos.side==='LONG'?1:-1)*(c.open-pos.price)/pos.price*100;let t={...pos,exit:c.open,exitTime:c.end-step+1,gross,net:gross-2*fee,reason:'Fechamento além da MMS5'};trades.push(t);events.push({type:'exit',...t,signalTime:pending.time});pos=null;}else{pos={side:pending.side,price:c.open,time:c.end-step+1,signalTime:pending.time};events.push({type:'entry',...pos});}pending=null;}
 if(pos){if(pos.side==='LONG'?c.close>sma(i,5):c.close<sma(i,5))pending={exit:true,time:c.end};}
 else{let long=mode==='original'?r[i-1]<=10&&p.close>sma(i-1,200)&&c.close>p.high&&c.close>sma(i,200):r[i]<5&&c.close>sma(i,200);let short=mode==='original'?r[i-1]>=90&&p.close<sma(i-1,200)&&c.close<p.low&&c.close<sma(i,200):r[i]>95&&c.close<sma(i,200);if(long||short)pending={side:long?'LONG':'SHORT',time:c.end};}
 }
 return {trades,events,position:pos,pending,stats:stats(trades),last:a.at(-1).end};
}
export function format(symbol,tf,mode,e,s){
 const pct=x=>x==null?'N/D':x.toFixed(2);
 const entry=e.type==='entry',sell=entry?e.side==='SHORT':e.side==='LONG';
 return [ (entry?'ENTRADA':'SAÍDA')+' — '+(sell?'Venda':'Compra')+' (simulação)', 'Ativo: '+symbol,'Estratégia: Connors EGI '+mode+' '+tf,'Preço: '+(entry?e.price:e.exit),'Candle: '+new Date(e.signalTime).toISOString(),...(!entry?['Entrada: '+e.price,'Motivo: '+e.reason,'Resultado líquido: '+pct(e.net)+'%']:[]),'Histórico anterior por ativo/configuração','Acerto: '+pct(s.win)+'% | Payoff: '+pct(s.payoff),s.gains+' gains e '+s.losses+' losses | '+s.closed+' fechadas'].join('\n');
}
async function candles(symbol,tf){let errors=[];for(const host of ['https://data-api.binance.vision','https://api.binance.com']){try{let r=await fetch(host+'/api/v3/klines?'+new URLSearchParams({symbol,interval:tf,limit:'1000'}),{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('HTTP '+r.status);return (await r.json()).map(k=>({end:+k[6],open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));}catch(e){errors.push(e.message)}}throw Error(errors.join('; '));}
async function main(){const original=JSON.parse(await readFile('lab/connors/estado.json','utf8'));const symbols=original.configuration.symbols.split(',').map(s=>s==='QNTUSDT'?'VETUSDT':s);assert.equal(new Set(symbols).size,50);
 const result={version:'1.5 LAB',source:'Binance Spot',model:'next open, simulated SHORT; 0.1% per side assumed; no funding/slippage',generated:new Date().toISOString(),symbols,coverage:{ok:0,fail:0},series:{},errors:[],messages:[]};
 for(const symbol of symbols)for(const tf of ['1h','2h'])try{let a=await candles(symbol,tf);for(const mode of ['original','classic']){let x=replay(a,tf,mode);result.series[symbol+'|'+tf+'|'+mode]=x;for(const e of x.events.slice(-2)){let time=e.type==='entry'?e.time:e.exitTime;let s=stats(x.trades.filter(t=>t.exitTime<time));result.messages.push({historical:true,text:format(symbol,tf,mode,e,s)});}}result.coverage.ok++;}catch(e){result.coverage.fail++;result.errors.push({symbol,tf,error:e.message});}
 await writeFile('lab/connors/auditoria-v15.tmp',JSON.stringify(result,null,2));await rename('lab/connors/auditoria-v15.tmp','lab/connors/auditoria-v15.json');console.log(result.coverage);}
export function test(){assert.deepEqual(stats([]),{closed:0,gains:0,losses:0,flat:0,win:null,payoff:null,expectancy:null});let s=stats([{net:2},{net:-1},{net:0}]);assert.equal(s.payoff,2);assert.equal(s.gains,1);assert.equal(s.losses,1);assert.equal(s.flat,1);assert.equal(stats([{net:1}]).payoff,null);let a=Array.from({length:220},(_,i)=>({end:(i+1)*3600000-1,open:10,close:10,high:10,low:10}));assert.equal(replay(a,'1h').trades.length,0);assert.throws(()=>replay(a.slice(0,5),'1h'));a[210].end+=1;assert.throws(()=>replay(a,'1h'));console.log('Autotestes OK');}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.includes('--test'))test();else await main();}
