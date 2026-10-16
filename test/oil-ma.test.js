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
test('estrutura de baixa 15m/1h atinge fase quatro sem inverter 4h',()=>{
  const {data,sources}=scenario({
    '5m':i=>i<78?100+.08*i:107-(i-78)*.33,
    '15m':i=>i<75?100+.08*i:106-(i-75)*.35,
    '1h':i=>i<80?95+.16*i:108-(i-80)*.26
  });
  const r=analyzeOilMA(data,sources,NOW);
  assert.equal(r.stage,4);
  assert.equal(r.trend4h,'ALTA');
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
