'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeOilMA}=require('../oil-ma');
const NOW=Date.UTC(2026,9,16,20,0,0);
const TF={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
function candles(tf,fn,{reject=false}={}){
  const d=TF[tf],rows=[];
  for(let i=0;i<90;i++){
    const close=fn(i),open=i>0?fn(i-1):close-0.1;
    const start=NOW-(90-i)*d;
    rows.push([start,open,Math.max(open,close)+((reject&&i===89)?8:0.04),
      Math.min(open,close)-0.04,close,200,start+d-1]);
  }
  return rows;
}
function scenario(changes={},rejection=false){
  const data={},sources={};
  for(const tf of Object.keys(TF)){
    data[tf]=candles(tf,changes[tf]||((i)=>95+.09*i),{reject:rejection&&tf==='5m'});
    sources[tf]='MEXC UKOIL_USDT';
  }
  return {data,sources};
}
test('alta sem perda de força não gera pré-alerta',()=>{
  const {data,sources}=scenario();
  const result=analyzeOilMA(data,sources,NOW);
  assert.equal(result.stage,1);
  assert.equal(result.trend4h,'ALTA');
});
test('rejeição próxima da máxima gera pré-exaustão com 4h comprador',()=>{
  const {data,sources}=scenario({},true);
  assert.equal(analyzeOilMA(data,sources,NOW).stage,2);
});
test('virada nos 5m/15m distingue possível short de reversão 4h',()=>{
  const {data,sources}=scenario({
    '5m':i=>i<72?100+.15*i:111-.28*(i-72),
    '15m':i=>i<75?100+.08*i:106-.07*(i-75)
  });
  const result=analyzeOilMA(data,sources,NOW);
  assert.equal(result.stage,3);
  assert.equal(result.trend4h,'ALTA');
});
function bearishScenario(){
  return scenario({
    '5m':i=>i<78?100+.08*i:107-(i-78)*.33,
    '15m':i=>i<75?100+.08*i:106-(i-75)*.35,
    '1h':i=>i<80?95+.16*i:108-(i-80)*.26
  });
}
test('sem volume vendedor, queda intradiária continua possível short, não confirmada',()=>{
  const {data,sources}=bearishScenario();
  const r=analyzeOilMA(data,sources,NOW);
  assert.equal(r.stage,3);
  assert.equal(r.t['15m'].macd.bearish,true);
  assert.equal(r.t['15m'].sellVolumeConfirmed,false);
});
test('queda 15m/1h com MACD vendedor e volume 1,8x atinge fase quatro, 4h segue em alta',()=>{
  const {data,sources}=bearishScenario();
  data['15m'].at(-1)[5]=360;
  const r=analyzeOilMA(data,sources,NOW);
  assert.equal(r.stage,4);
  assert.equal(r.trend4h,'ALTA');
  assert.equal(r.t['15m'].macd.bearish,true);
  assert.equal(r.t['15m'].sellVolumeConfirmed,true);
});
test('volume alto em candle verde não simula fluxo vendedor nem confirma fase quatro',()=>{
  const {data,sources}=bearishScenario();
  const last=data['15m'].at(-1);
  last[1]=last[4]-0.5; // candle verde, mesmo em estrutura de baixa
  last[2]=Math.max(last[1],last[4])+0.04;
  last[5]=400;
  const r=analyzeOilMA(data,sources,NOW);
  assert.equal(r.t['15m'].sellVolumeConfirmed,false);
  assert.equal(r.stage,3);
});
test('MACD calcula linha, sinal e histograma só de candles fechados',()=>{
  const {data,sources}=bearishScenario();
  const initial=analyzeOilMA(data,sources,NOW);
  assert.equal(initial.t['15m'].macd.bearish,true);
  data['15m'].push([NOW,5,500,1,5,100000,NOW+900000-1]);
  const after=analyzeOilMA(data,sources,NOW);
  assert.equal(after.t['15m'].macd.hist,initial.t['15m'].macd.hist);
  assert.equal(after.t['15m'].volumeRatio,initial.t['15m'].volumeRatio);
});
test('não aceita fontes MEXC e Brent Yahoo misturadas',()=>{
  const {data,sources}=scenario();sources['4h']='Brent BZ=F';
  assert.throws(()=>analyzeOilMA(data,sources,NOW),/FONTES INCOMPATÍVEIS/);
});
test('ignora candle em formação',()=>{
  const {data,sources}=scenario();
  const first=analyzeOilMA(data,sources,NOW);
  const d=TF['5m'];
  data['5m'].push([NOW,1,500,1,1,1000,NOW+d-1]);
  const second=analyzeOilMA(data,sources,NOW);
  assert.equal(second.price,first.price);
  assert.equal(second.candleClose,first.candleClose);
  assert.equal(second.stage,first.stage);
});

test('RSI6/12/24 e escala de histograma MEXC são calculados e auditáveis',()=>{
  const {data,sources}=bearishScenario();
  const result=analyzeOilMA(data,sources,NOW), z=result.t['15m'];
  for(const n of [6,12,24]){
    const value=z.rsi['rsi'+n];
    assert.equal(Number.isFinite(value)&&value>=0&&value<=100,true);
  }
  assert.equal(z.histMexcScale,Number((z.macd.hist*2).toFixed(6)));
  assert.equal(result.checklist.some(x=>x.name.includes('MACD vendedor')),true);
});
test('RSI pressionado identifica risco de repique, não gera fase quatro sem volume',()=>{
  const {data,sources}=bearishScenario();
  const result=analyzeOilMA(data,sources,NOW);
  assert.equal(result.t['15m'].rsi.rsi6<=25,true);
  assert.equal(result.reasons.some(x=>x.includes('risco de repique')||x.includes('cuidado com repique')),true);
  assert.equal(result.stage,3);
});
test('OIL sem fechamentos recentes não produz sinal novo por cache antigo',()=>{
  const {data,sources}=scenario();
  assert.throws(()=>analyzeOilMA(data,sources,NOW+60*60000),/CANDLES DESATUALIZADOS/);
});

test('MACD 15m vendedor com MA5 abaixo da MA10 avisa cedo sem forçar fase 3',()=>{
  const {data,sources}=scenario({'15m':i=>i<76?100+.07*i:105.32-.23*(i-76)});
  const out=analyzeOilMA(data,sources,NOW);
  assert.equal(out.t['15m'].macd.bearish,true);
  assert.equal(out.t['15m'].ma5<out.t['15m'].ma10,true);
  assert.equal(out.stage,2);
  assert.equal(out.reasons.some(x=>x.includes('pré-aviso')),true);
});
