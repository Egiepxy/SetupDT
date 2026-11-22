/* SetupDT EGI V3.6 LAB — auditoria somente leitura; sem execução de ordens.
   Uso: node lab/setupdt-v36/auditoria.mjs arquivo-diagnostico.json
   Não altera arquivos, filtros, históricos ou sinais. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

export function classify(record) {
  const reason = String(record.reason ?? '');
  const parts = reason.split(' | ');
  const find = prefix => parts.find(p => p.startsWith(prefix)) ?? null;
  const triple = find('Triple Screen');
  const flow = find('Fluxo:');
  const window = find('Janela:');
  const liquidity = reason.includes('BLOQUEADA POR LIQUIDEZ');
  const checklistFull = record.checklist === 6;
  const waitingFlow = window?.includes('WAITING_FLOW') ?? false;
  const notEvaluated = window?.includes('NÃO AVALIADA') ?? false;
  const trace = [
    {stage:'checklist',status:checklistFull?'PASS':'BLOCK',evidence:record.checklist+'/6'},
    {stage:'triple_screen',status:triple ? (/SEM CONFLUÊNCIA|SEM DIREÇÃO|DADOS INSUFICIENTES|EM FORMAÇÃO|PREPARAR/.test(triple)?'PENDING':'OBSERVED'):'UNKNOWN',evidence:triple},
    {stage:'liquidity',status:liquidity?'BLOCK':'UNKNOWN',evidence:liquidity?'Bloqueada por liquidez':'Sem confirmação estruturada'},
    {stage:'flow',status:waitingFlow?'PENDING':flow?'OBSERVED':'UNKNOWN',evidence:flow},
    {stage:'entry_window',status:waitingFlow?'WAITING_FLOW':notEvaluated?'NOT_EVALUATED':'UNKNOWN',evidence:window},
    {stage:'authorization',status:record.tradable===true?'AUTHORIZED_RECORDED':'NOT_AUTHORIZED',evidence:record.tradable}
  ];
  const professor = !checklistFull?'Checklist incompleto: aguardar critérios faltantes.':
    liquidity?'Liquidez bloqueada: não autorizar.':
    waitingFlow?'Checklist completo, mas fluxo não confirmado: aguardar candle fechado e fluxo.':
    notEvaluated?'Janela não avaliada por filtros anteriores: verificar causa antes de liberar.':
    'Não há evidência suficiente para autorizar entrada.';
  return {key:record.key,asset:record.asset,checklist:record.checklist,technicalTradable:record.technicalTradable===true,tradable:record.tradable===true,trace,professor};
}
export function audit(data) {
  assert.ok(Array.isArray(data.records),'records deve ser array');
  const rows=data.records.map(classify);
  const full=rows.filter(x=>x.checklist===6);
  const waiting=rows.filter(x=>x.trace.some(s=>s.status==='WAITING_FLOW'));
  const keys=rows.map(x=>x.key);
  const summary={total:rows.length,uniqueKeys:new Set(keys).size,full:full.length,waitingFlow:waiting.length,technical:rows.filter(x=>x.technicalTradable).length,authorized:rows.filter(x=>x.tradable).length,notEvaluated:rows.filter(x=>x.trace.some(s=>s.status==='NOT_EVALUATED')).length};
  return {app:'SetupDT EGI V3.6 LAB — diagnóstico somente leitura',summary,fullRecords:full,waitingFlowRecords:waiting,anomalies:rows.filter(x=>x.tradable&&(!x.technicalTradable||x.trace.some(s=>s.status==='WAITING_FLOW'||s.status==='BLOCK')))};
}
export function selfTest(){
 const base={key:'test',asset:'TEST',checklist:6,technicalTradable:true,tradable:false,reason:'Fluxo: 🟡 AGUARDAR FLUXO | Janela: WAITING_FLOW | Filtro: 6/6 APROVADO'};
 const result=audit({records:[base]});
 assert.equal(result.summary.full,1);
 assert.equal(result.summary.waitingFlow,1);
 assert.equal(result.summary.authorized,0);
 assert.equal(result.anomalies.length,0);
 assert.equal(classify({...base,checklist:5}).trace[0].status,'BLOCK');
 assert.equal(classify({...base,reason:'Fluxo: ⚪ Aguardar macro | Janela: NÃO AVALIADA (filtros anteriores pendentes)'}).trace[4].status,'NOT_EVALUATED');
 assert.equal(classify({...base,reason:'Filtro: BLOQUEADA POR LIQUIDEZ'}).trace[2].status,'BLOCK');
 return '6 autotestes aprovados';
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
 console.error(selfTest());
 if(process.argv[2]){
   const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
   const report=audit(input);
   console.log(JSON.stringify(report,null,2));
   if(report.anomalies.length)process.exitCode=2;
 }
}
