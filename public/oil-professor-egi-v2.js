/* SETUPDT OIL — Professor de Transições V2
 * Complemento de estudo. Não altera índice de exaustão, SetupDT 6/6,
 * Telegram, ordens, histórico OIL existente ou critérios de risco.
 */
(function(){
'use strict';
const KEY='setupdt_light_oil_professor_transicoes_v2';
const PERIODS=[3,6,12], CAP=160, COOLDOWN=4*60*60*1000;
const STAGES={OBSERVACAO_PRECOCE:1,EXAUSTAO_PROVAVEL:2,TRANSICAO_CONFIRMADA:3};
const LABEL={OBSERVACAO_PRECOCE:'🔵 OBSERVAÇÃO PRECOCE',EXAUSTAO_PROVAVEL:'🟠 EXAUSTÃO PROVÁVEL (HEURÍSTICA)',TRANSICAO_CONFIRMADA:'🟢 TRANSIÇÃO ESTRUTURAL CONFIRMADA'};
const state={history:[],last:null,error:'',storageOK:true};
const byId=id=>document.getElementById(id);
const ratio=v=>Number.isFinite(v)?v.toFixed(2)+'×':'n/d';
const pct=v=>Number.isFinite(v)?(v>=0?'+':'')+v.toFixed(2)+'%':'n/d';
const localTime=v=>Number.isFinite(v)?new Date(v).toLocaleString('pt-BR'):'n/d';
const price=v=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:v>=100?2:4,minimumFractionDigits:2}):'n/d';
function recordText(node,cls,value){const el=document.createElement('div');el.className=cls;el.textContent=String(value);node.append(el);}
function load(){
 try{const value=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(value))state.history=value.filter(x=>x&&Number.isFinite(x.candleClose)&&Number.isFinite(x.price)&&['HIGH','LOW'].includes(x.direction)).slice(0,CAP);}catch(e){state.error='Histórico V2 ilegível: exporte o arquivo original antes de substituí-lo.';}
}
function persist(){
 try{localStorage.setItem(KEY,JSON.stringify(state.history.slice(0,CAP)));state.storageOK=true;}
 catch(e){state.storageOK=false;state.error='Armazenamento local cheio/indisponível; exporte o JSON antes de fechar a página.';}
}
function tfEvidence(a,side){
 const v=a?.[side];return !!(v&&Array.isArray(v.reasons)&&v.reasons.some(s=>/divergência|MACD perdeu|rejeição com pavio|perda recente da EMA9|recuperação recente da EMA9/i.test(s)));
}
function makeAssessment(s,rows15,rows1,rows4,now){
 if(!s||![rows15,rows1,rows4].every(a=>Array.isArray(a)&&a.length>=35))
   return {valid:false,reason:'Faltam candles fechados para análise de transição.'};
 const a15=s.analyses.find(a=>a.tf==='15m'),a1=s.analyses.find(a=>a.tf==='1h'),a4=s.analyses.find(a=>a.tf==='4h');
 if(!a15||!a1||!a4)return {valid:false,reason:'Timeframes incompletos.'};
 const latest=[rows15.at(-1),rows1.at(-1),rows4.at(-1)];
 if(latest.some(x=>!x||!Number.isFinite(x.end)||x.end>now+1000)||now-latest[0].end>90*60*1000||now-latest[1].end>5*60*60*1000||now-latest[2].end>15*60*60*1000)
   return {valid:false,reason:'Dados OIL desatualizados ou ainda não fechados; não gerar novo evento.',closed:latest[0]?.end};
 const vol15=a15.high.volRatio,vol1=a1.high.volRatio,vol4=a4.high.volRatio;
 const volReason=[['15m',vol15],['1h',vol1],['4h',vol4]].map(([tf,v])=>tf+' '+ratio(v)+(Number.isFinite(v)&&v>=1.8?' (volume elevado)':Number.isFinite(v)&&v<.5?' (volume reduzido)':'')).join(' | ');
 const bands={
   HIGH:{ref15:Math.min(...rows15.slice(-13,-1).map(x=>x.low)),ref1:Math.min(...rows1.slice(-9,-1).map(x=>x.low))},
   LOW:{ref15:Math.max(...rows15.slice(-13,-1).map(x=>x.high)),ref1:Math.max(...rows1.slice(-9,-1).map(x=>x.high))}
 };
 const candidates=['HIGH','LOW'].map(direction=>{
   const side=direction==='HIGH'?'high':'low',scores=[a15[side].score,a1[side].score,a4[side].score],points=scores[0]*.35+scores[1]*.4+scores[2]*.25;
   const evidence=[tfEvidence(a15,side),tfEvidence(a1,side),tfEvidence(a4,side)];
   const support=bands[direction],break15=direction==='HIGH'?latest[0].close<support.ref15:latest[0].close>support.ref15;
   const break1=direction==='HIGH'?latest[1].close<support.ref1:latest[1].close>support.ref1;
   const multi=scores.filter(v=>v>=25).length>=2;
   const warning=evidence.some(Boolean)&&((scores[0]>=25)||(scores[1]>=30)||(scores[2]>=35));
   const probable=warning&&points>=40&&multi;
   const volumeConf=Number.isFinite(vol15)&&vol15>=1.20&&Number.isFinite(vol1)&&vol1>=.80;
   const confirmed=probable&&break15&&break1&&volumeConf;
   const stage=confirmed?'TRANSICAO_CONFIRMADA':probable?'EXAUSTAO_PROVAVEL':warning?'OBSERVACAO_PRECOCE':null;
   const explanation=[
     '15m '+scores[0]+'/100; 1h '+scores[1]+'/100; 4h '+scores[2]+'/100',
     'Evidência de perda de impulso/rejeição: '+evidence.map((v,i)=>(v?['15m','1h','4h'][i]:'')).filter(Boolean).join(', ')+(evidence.some(Boolean)?'':'nenhuma'),
     'Estrutura 15m: '+(break15?'confirmou':'aguardar')+' fechamento '+(direction==='HIGH'?'abaixo de ':'acima de ')+price(support.ref15),
     'Estrutura 1h: '+(break1?'confirmou':'aguardar')+' fechamento '+(direction==='HIGH'?'abaixo de ':'acima de ')+price(support.ref1),
     'Volume de confirmação 15m ≥1,20× e 1h ≥0,80×: '+(volumeConf?'OK':'pendente')
   ];
   return {direction,stage,score:Math.round(points),scores,evidence,break15,break1,ref15:support.ref15,ref1:support.ref1,volumeConf,explanation};
 });
 const lead=candidates.filter(c=>c.stage).sort((a,b)=>STAGES[b.stage]-STAGES[a.stage]||b.score-a.score)[0]||null;
 const divergence=(a15.high.score>a15.low.score&&a4.low.score>a4.high.score)||(a15.low.score>a15.high.score&&a4.high.score>a4.low.score);
 return {valid:true,lead,candidates,closed:latest[0].end,closed1:latest[1].end,close15:latest[0].close,vol15,vol1,vol4,volReason,divergence,
   note:divergence?'15m e 4h apontam exaustões opostas; não presumir reversão geral.':'Não há oposição dominante de exaustões entre 15m e 4h.',
   sessionNote:'Volume relativo é medido contra candles anteriores, sem ajuste por horário/sessão. Não equivale a fluxo agressor nem prova reversão.'};
}
function evolve(rows15){
 let changed=false;
 for(const event of state.history){
   if(!event.outcomes||typeof event.outcomes!=='object')event.outcomes={};
   const idx=rows15.findIndex(c=>c.end===event.candleClose);
   if(idx<0){if(Object.keys(event.outcomes).length<PERIODS.length)event.coverage='Candle inicial não disponível na janela atual. Resultados pendentes não podem ser reconstruídos.';continue;}
   for(const n of PERIODS){
     if(event.outcomes[n]||idx+n>=rows15.length)continue;
     const seq=rows15.slice(idx+1,idx+n+1),last=seq.at(-1),dir=event.direction==='HIGH'?-1:1;
     const minLow=Math.min(...seq.map(c=>c.low)),maxHigh=Math.max(...seq.map(c=>c.high));
     const favor=event.direction==='HIGH'?event.price-minLow:maxHigh-event.price;
     const adverse=event.direction==='HIGH'?maxHigh-event.price:event.price-minLow;
     event.outcomes[n]={end:last.end,close:last.close,directionalPct:dir*(last.close/event.price-1)*100,
       favorablePct:Math.max(0,favor/event.price*100),adversePct:Math.max(0,adverse/event.price*100)};
     changed=true;
   }
   if(Object.keys(event.outcomes).length===PERIODS.length&&event.coverage){delete event.coverage;changed=true;}
 }
 if(changed)persist();
}
function capture(s,assessment){
 const c=assessment.lead;if(!c||!STAGES[c.stage])return false;
 const lastSame=state.history.find(x=>x.direction===c.direction&&x.stage===c.stage);
 if(lastSame&&assessment.closed-lastSame.candleClose<COOLDOWN)return false;
 const key=c.direction+'|'+c.stage+'|'+assessment.closed;
 if(state.history.some(e=>e.key===key))return false;
 state.history.unshift({key,direction:c.direction,stage:c.stage,score:c.score,candleClose:assessment.closed,detected:Date.now(),price:assessment.close15,
   ref15:c.ref15,ref1:c.ref1,vol15:assessment.vol15,vol1:assessment.vol1,break15:c.break15,break1:c.break1,
   source:s.source,explanation:c.explanation,outcomes:{}});
 state.history=state.history.slice(0,CAP);persist();return true;
}
function draw(){
 const root=byId('oilProfV2Status'),details=byId('oilProfV2Details'),history=byId('oilProfV2History'),count=byId('oilProfV2Count');
 if(!root||!details||!history)return;
 const a=state.last;root.textContent=a?.valid?(a.lead?(LABEL[a.lead.stage]+' • '+(a.lead.direction==='HIGH'?'possível perda da ALTA':'possível perda da BAIXA')+' • '+a.lead.score+'/100'):'⚪ SEM PRÉ-ALERTA FUNDAMENTADO'):'⚪ '+(a?.reason||'Aguardando atualização OIL');
 root.style.borderColor=a?.valid&&a.lead?'#d5a44e':'#42617f';
 details.replaceChildren();
 if(a?.valid){
   recordText(details,'oil-prof-row','Fechamento 15m: '+localTime(a.closed)+' • preço $ '+price(a.close15));
   recordText(details,'oil-prof-row','Volume: '+a.volReason);
   recordText(details,'oil-prof-row',a.note);
   recordText(details,'oil-prof-row',a.sessionNote);
   if(a.lead){for(const v of a.lead.explanation)recordText(details,'oil-prof-row',v);}
   else recordText(details,'oil-prof-row','Não há conjunto de perda de impulso, divergência ou rejeição suficiente para registrar nova observação.');
   recordText(details,'oil-prof-row','Nível estrutural confirmado não é, isoladamente, autorização de operação.');
 }else recordText(details,'oil-prof-row',a?.reason||'Faça uma atualização do OIL.');
 if(state.error)recordText(details,'oil-prof-row','⚠ '+state.error);
 if(!state.storageOK)recordText(details,'oil-prof-row','⚠ Histórico em memória: use exportar JSON.');
 history.replaceChildren();if(count)count.textContent=state.history.length+' evento(s) V2';
 if(!state.history.length)recordText(history,'oil-prof-row','Ainda não existem observações V2. O histórico anterior do OIL continua separado e preservado.');
 for(const x of state.history.slice(0,30)){
   const box=document.createElement('div');box.className='oil-prof-event';
   recordText(box,'oil-prof-head',(LABEL[x.stage]||x.stage)+' • '+(x.direction==='HIGH'?'ALTA':'BAIXA')+' • '+x.score+'/100');
   recordText(box,'oil-prof-row','Candle '+localTime(x.candleClose)+' • $ '+price(x.price)+' • '+(x.source||'MEXC'));
   const outcome=x.outcomes||{};
   for(const n of PERIODS){
     const p=outcome[n];recordText(box,'oil-prof-row','+'+n+' candles: '+(p?'deslocamento direcional '+pct(p.directionalPct)+' • máximo favorável '+pct(p.favorablePct)+' • máximo adverso '+pct(p.adversePct):'aguardando candles fechados/atualização'));
   }
   if(x.coverage)recordText(box,'oil-prof-row','⚠ '+x.coverage);
   history.append(box);
 }
}
function report(){
 let txt='\nPROFESSOR DE TRANSIÇÕES OIL V2 — AUDITORIA PROSPECTIVA (NÃO É ORDEM)\n';
 const a=state.last;
 if(!a?.valid)txt+='Estado: '+(a?.reason||'sem leitura')+'\n';
 else{
   txt+='Candle fechado 15m: '+localTime(a.closed)+' | $ '+price(a.close15)+'\n';
   txt+='Estágio: '+(a.lead?LABEL[a.lead.stage]:'SEM PRÉ-ALERTA')+' | Lado observado: '+(a.lead?.direction==='HIGH'?'possível fim de ALTA':a.lead?.direction==='LOW'?'possível fim de BAIXA':'n/d')+'\n';
   txt+='Volume: '+a.volReason+'\n'+a.note+'\n'+a.sessionNote+'\n';
   if(a.lead)for(const x of a.lead.explanation)txt+='• '+x+'\n';
 }
 txt+='Histórico V2 (observações não são trades): '+state.history.length+'\n';
 for(const x of state.history.slice(0,40)){
   txt+='- '+localTime(x.candleClose)+' | '+(LABEL[x.stage]||x.stage)+' | '+x.direction+' | $ '+price(x.price)+' | '+x.score+'/100';
   for(const n of PERIODS){const v=x.outcomes?.[n];txt+=' | +'+n+'='+ (v?pct(v.directionalPct)+' (favor '+pct(v.favorablePct)+', contra '+pct(v.adversePct)+')':'pendente');}
   txt+='\n';
 }
 txt+='Resultados são deslocamentos após candles fechados; não são lucro, taxa de acerto operacional, ordens nem P&L.\n';
 return txt;
}
function exportHistory(){
 const blob=new Blob([JSON.stringify({schema:'EGI-OIL-TRANSICOES-V2',exportedAt:new Date().toISOString(),note:'Dados locais de observação. Não representam operações.',events:state.history},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SetupDT_OIL_Professor_V2_'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 const s=byId('oilProfV2ExportStatus');if(s)s.textContent='JSON com '+state.history.length+' observações V2 preparado. Histórico original preservado.';
}
window.oilProfessorV2Update=function(snapshot,r15,r1,r4){
 try{
   state.last=makeAssessment(snapshot,r15,r1,r4,Date.now());
   if(state.last.valid){evolve(r15);capture(snapshot,state.last);}
   draw();
 }catch(error){state.last={valid:false,reason:'Falha do Professor OIL V2: '+(error?.message||error)};draw();}
};
window.oilProfessorV2Report=report;
window.oilProfessorV2Model=makeAssessment;
load();
const btn=byId('oilProfV2Export');if(btn)btn.addEventListener('click',exportHistory);
draw();
})();