'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadRenderer(){
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const start=html.indexOf('function drawOilDaytrade(data){');
  const end=html.indexOf('\nasync function refreshOilDaytrade()',start);
  assert.ok(start>=0&&end>start,'função drawOilDaytrade existe');
  const render=html.slice(start,end);
  const header={textContent:''};
  const body={id:'oilDaytradeBody',className:'hint',textContent:''};
  const panel={
    _header:header,_body:body,
    querySelector(q){return q==='strong'?this._header:null;},
    prepend(el){this._header=el;},
    appendChild(el){this._body=el;}
  };
  const elements={oilDaytradeCard:panel,oilDaytradeBody:body};
  const context={
    $:key=>elements[key],document:{createElement:tag=>({tagName:tag.toUpperCase()})},
    fmt:value=>Number(value).toFixed(2)
  };
  vm.createContext(context);
  vm.runInContext(render,context);
  return {draw:context.drawOilDaytrade,panel,header,body,elements};
}

test('Day Trade OIL preserva título e detalhes nas atualizações consecutivas',()=>{
  const r=loadRenderer();
  r.draw(null);
  assert.equal(r.panel._body,r.body);
  const reading={direction:'SHORT',level:'STRONG',score:84,price:106.02,
    candleClose:Date.UTC(2026,9,16,19,44,59),volumeRatio:1.69,atrPct:0.21,
    context4h:'UP',telegramConfigured:true,reasons:['MACD vendedor','4h em alta']};
  r.draw(reading);
  assert.match(r.header.textContent,/BAIXA.*84\/100/);
  assert.match(r.body.textContent,/volume 1.69x/);
  assert.match(r.body.textContent,/4h em alta/);
  assert.equal(r.panel._body,r.body);
  r.draw({...reading,direction:'LONG',level:'ATTENTION',score:61});
  assert.match(r.header.textContent,/ALTA.*61\/100/);
  assert.match(r.body.textContent,/15m fechado/);
  assert.equal(r.elements.oilDaytradeBody,r.panel._body);
});
