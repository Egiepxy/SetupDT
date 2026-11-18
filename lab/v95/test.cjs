const assert=require('node:assert/strict');const {process:step,summary,fresh}=require('./audit.cjs');const {transition}=require('./engine.cjs');
const ms=900000,t=Date.now()-10000;
function bars(d=0,v=1){return Array.from({length:150},(_,i)=>{let c=100+(i>=147?d*(i-146)*.8:0),o=i>=148?100+d*(i-147)*.8:100,k=t-(149-i)*ms;return [k-ms+1,o,Math.max(o,c)+.2,Math.min(o,c)-.2,c,i===149?100*v:100,k]})}
const s=fresh();step(s,'BTCUSDT','15m',bars(),t+2000);assert.equal(s.signals.length,0);step(s,'BTCUSDT','15m',bars(),t+2000);assert.equal(summary(s)[0].samples,1);
const v=fresh();step(v,'ETHUSDT','15m',bars(1,3),t+2000);assert.equal(v.signals[0].dir,'LONG');assert.equal(summary(v)[0].early,1);assert.throws(()=>step(fresh(),'BTCUSDT','15m',bars().filter((_,i)=>i!==120),t+2000));
const p={dir:'LONG',price:100,atr:1,last:0,hit:0};transition.audit(p,[{t:ms,h:104,l:98}],ms);assert.equal(p.done,'STOP');assert.equal(p.hit,0);
assert.equal(transition.closed([{t:100},{t:101}],1500).length,1);console.log('8 assertions passed');
