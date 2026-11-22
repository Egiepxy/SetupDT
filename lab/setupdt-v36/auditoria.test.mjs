import assert from 'node:assert/strict';
import {audit,classify,selfTest} from './auditoria.mjs';
assert.match(selfTest(),/aprovados/);
const rows=[
 {key:'binance|BOME|1',asset:'BOME',checklist:6,technicalTradable:true,tradable:false,reason:'Fluxo: 🟡 AGUARDAR FLUXO | Janela: WAITING_FLOW | Filtro: 6/6 APROVADO'},
 {key:'binance|BOME|2',asset:'BOME',checklist:6,technicalTradable:false,tradable:false,reason:'Triple Screen 0/100 — SEM CONFLUÊNCIA INTRADAY | Janela: NÃO AVALIADA (filtros anteriores pendentes)'},
 {key:'binance|MET|3',asset:'MET',checklist:6,technicalTradable:true,tradable:false,reason:'Fluxo: 🟠 COMPRADORES PERDENDO FORÇA | Janela: WAITING_FLOW'},
 {key:'binance|NIL|4',asset:'NIL',checklist:6,technicalTradable:true,tradable:false,reason:'Fluxo: 🟡 AGUARDAR FLUXO | Janela: WAITING_FLOW'},
 {key:'binance|PENDLE|5',asset:'PENDLE',checklist:6,technicalTradable:true,tradable:false,reason:'Fluxo: 🟠 COMPRADORES PERDENDO FORÇA | Janela: WAITING_FLOW'}
];
const r=audit({records:rows});
assert.equal(r.summary.full,5);
assert.equal(r.summary.waitingFlow,4);
assert.equal(r.summary.uniqueKeys,5);
assert.equal(r.summary.authorized,0);
assert.equal(r.summary.notEvaluated,1);
assert.equal(r.anomalies.length,0);
assert.equal(classify(rows[1]).trace[1].status,'PENDING');
console.log('PASS: testes de regressão V3.6 (fixture sintética; não comprova execução no navegador)');
