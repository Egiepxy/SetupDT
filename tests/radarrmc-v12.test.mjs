import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index19.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' deve existir');
  const open = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}
const ctx = { crossed: [], macroState: { risk: '🟡 MODERADO' }, isConfirmedTrigger: status => ['🟢 CONFIRMADO','CONFIRMADO'].includes(String(status).trim().toUpperCase()) };
vm.createContext(ctx);
for (const name of ['decision','classifyTop3','finalStateFrom']) vm.runInContext(extractFunction(name),ctx);
const candidate = (persist=1, danger=2, quality=94) => ({ symbol:'SOLUSDT',score:78,man:{entry:79,persist:{count:persist},action:'CONFIRMAR SETUPDT',rsi:50,space:2},vol:{danger,quality,balance:80} });
const smc = (trigger='🟢 CONFIRMADO',qualified=true) => ({sym:'SOLUSDT',operVerdict:'🟢 CONFIRMADO',triggerStatus:trigger,rq:{score:100,qualified,decision:'🟢 ROMPIMENTO QUALIFICADO'},conflict:'',decision:'Aguardar confirmação final'});
test('1x não pode ser confluência forte',()=>{const x=candidate(1);assert.notMatch(ctx.decision(x).label,/FORTE/);assert.match(x.blockReasons.join(' '),/Persistência 1x/)});
test('3x, risco e qualidade favoráveis podem avançar apenas à avaliação',()=>{const x=candidate(3);assert.match(ctx.decision(x).label,/FORTE/);assert.match(x.decision?.next||ctx.decision(x).next,/SetupDT/)});
test('risco alto bloqueia candidato',()=>{const x=candidate(3,75);assert.match(ctx.decision(x).label,/EVITAR/)});
test('qualidade baixa bloqueia candidato',()=>{const x=candidate(3,2,45);assert.match(ctx.decision(x).label,/EVITAR/)});
test('Top3 sem persistência não recebe verde',()=>{ctx.crossed=[candidate(1)];assert.notMatch(ctx.classifyTop3(smc()).label,/SETUPDT AGORA/)});
test('Top3 com gatilho não confirmado não recebe verde',()=>{ctx.crossed=[candidate(3)];assert.notMatch(ctx.classifyTop3(smc('🟡 NÃO CONFIRMADO')).label,/SETUPDT AGORA/)});
test('Top3 com rompimento não qualificado não recebe verde',()=>{ctx.crossed=[candidate(3)];assert.notMatch(ctx.classifyTop3(smc('🟢 CONFIRMADO',false)).label,/SETUPDT AGORA/)});
test('Top3 completo pode enviar à avaliação SetupDT',()=>{ctx.crossed=[candidate(3)];assert.match(ctx.classifyTop3(smc()).label,/SETUPDT AGORA/)});
test('estado final sem persistência permanece amarelo',()=>{ctx.crossed=[candidate(1)];assert.notMatch(ctx.finalStateFrom(smc()).state,/🟢 ENVIAR/)});
test('fonte só usa candles fechados na leitura automática',()=>{assert.match(html,/ks\.filter\(k=>Number\(k\[6\]\)<Date\.now\(\)\)/)});
test('contagem usa fechamento distinto, não repetição de clique',()=>{assert.match(html,/lastClosedCandle>Number\(old\.lastClosedCandle\)/)});
