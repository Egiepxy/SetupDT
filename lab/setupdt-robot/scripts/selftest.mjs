import assert from 'node:assert/strict';
process.env.SETUPDT_TEST='1';
const {evaluate,dailyReports,parseCandles}=await import('./scan.mjs');
for(const dir of ['LONG','SHORT']){
 const sign=dir==='LONG'?1:-1;
 const snap={dir,trend:sign===1?'Alta forte':'Baixa forte',price:100,atr:1,r:50,volRatio:2,candleClose:1000};
 const rows=Array.from({length:23},(_,i)=>({open:100,close:100,volume:100,end:i,takerBuyBase:50}));
 rows[21]={open:100,close:100-sign,volume:80,end:21,takerBuyBase:40};
 rows[22]={open:100-sign,close:100+sign,volume:200,end:22,takerBuyBase:sign===1?120:80};
 const result=evaluate({'15m':snap,'1h':snap,'4h':snap,'1d':snap},rows,{price:100});
 assert.equal(result.day,dir);assert.equal(result.count,6);assert.ok(result.status.startsWith('CANDIDATO'));assert.equal(result.execution,'NONE');assert.equal(result.fullSetupDTApproval,false);
 assert.ok(sign*(result.levels.t1-result.levels.entry)>0);
}
assert.throws(()=>parseCandles([], '15m',Date.now()));
const ms=900000, now=ms*1000+5000;
const candle=i=>[i*ms,100,101,99,100,10,i*ms+ms-1,0,0,5];
const valid=Array.from({length:200},(_,i)=>candle(800+i));
assert.equal(parseCandles([...valid,candle(1000)],'15m',now).length,200);
assert.throws(()=>parseCandles(Array.from({length:200},(_,i)=>candle(799+i)),'15m',now),/esperado ausente/);
assert.throws(()=>parseCandles([...valid.slice(0,100),valid[99],...valid.slice(100)],'15m',now),/duplicados/);
assert.throws(()=>parseCandles(valid.filter((_,i)=>i!==100).concat([candle(799)]),'15m',now),/fora de ordem/);
assert.equal(parseCandles([candle(799),...valid],'15m',ms*1000+1).at(-1).start,998*ms);
const run={at:'2026-11-26T00:07:00Z'};
assert.equal(dailyReports({runs:[]},run,[])['2026-11-25'].runs,0);
console.log('LONG/SHORT, candle validation and daily cutoff passed');
