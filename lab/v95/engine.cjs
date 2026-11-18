const EGI_CLOSE_GUARD_MS=1400;
function ema(values, period){
  const k = 2/(period+1);
  const out = new Array(values.length).fill(null);
  if(values.length < period) return out;
  let sum = 0;
  for(let i=0;i<period;i++) sum += values[i];
  out[period-1] = sum/period;
  for(let i=period;i<values.length;i++) out[i] = values[i]*k + out[i-1]*(1-k);
  return out;
}
function pct(a,b){ return b===0 ? 0 : (a-b)/b*100; }
function egiClosedIndex(candles,now=Date.now()){
  for(let j=candles.length-1;j>=0;j--){
    const k=candles[j];
    const close=Number(k?.[6]),open=Number(k?.[0]);
    if(Number.isFinite(close)&&Number.isFinite(open)&&close>=open&&close<=now-EGI_CLOSE_GUARD_MS)return j;
  }
  return -1;
}
function qualityScore({longBias,shortBias,slope9,slope21,sep,dist9,pullLong,pullShort,rejLong,rejShort,crossRecent,lateral,extended,deepRisk,stretchPct}){
  let score=0;
  if(longBias || shortBias) score += 15;

  const slopeFastOk = longBias ? slope9>0 : slope9<0;
  const slopeSlowOk = longBias ? slope21>0 : slope21<0;
  if(slopeFastOk) score += 10;
  if(slopeSlowOk) score += 10;
  if(slopeFastOk && slopeSlowOk) score += 5;

  if(sep>=0.25 && sep<=3) score += 20;
  else if((sep>=0.12 && sep<0.25) || (sep>3 && sep<=5)) score += 12;
  else if(sep>5) score += 5;

  const ad=Math.abs(dist9);
  if(ad<=0.35) score += 20;
  else if(ad<=0.75) score += 17;
  else if(ad<=1.20) score += 12;
  else if(ad<stretchPct) score += 7;

  const pull = longBias ? pullLong : pullShort;
  const rej = longBias ? rejLong : rejShort;
  if(rej) score += 20;
  else if(pull) score += 10;

  if(crossRecent) score -= 5; // cruzamento ainda precisa amadurecer
  if(lateral) score -= 30;
  if(extended) score -= 25;
  if(deepRisk) score -= 20;
  if(!slopeFastOk) score -= 10;

  return Math.max(0,Math.min(100,Math.round(score)));
}
function avgTrueRange(h,l,c,i,period=14){
  const start=Math.max(1,i-period+1);
  let sum=0, n=0;
  for(let j=start;j<=i;j++){
    const tr=Math.max(h[j]-l[j], Math.abs(h[j]-c[j-1]), Math.abs(l[j]-c[j-1]));
    if(Number.isFinite(tr)){ sum+=tr; n++; }
  }
  return n ? sum/n : 0;
}
function egiFindConfirmedPivotStop(highs,lows,entry,i,isLong,isShort,atr){
  if(!isLong&&!isShort)return {valid:false,reason:'Sem viés LONG/SHORT para definir stop.'};
  if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(atr)||atr<=0)return {valid:false,reason:'ATR14 ou entrada indisponível; não criar stop artificial.'};
  const buffer=0.15*atr;
  let sawPivot=false;
  // Um pivô exige dois candles anteriores e dois posteriores, todos já fechados.
  for(let j=i-2;j>=Math.max(2,i-29);j--){
    const arr=isLong?lows:highs,v=arr[j];
    if(!Number.isFinite(v))continue;
    const confirmed=isLong?(v<=arr[j-2]&&v<=arr[j-1]&&v<=arr[j+1]&&v<=arr[j+2]):
      (v>=arr[j-2]&&v>=arr[j-1]&&v>=arr[j+1]&&v>=arr[j+2]);
    if(!confirmed)continue;
    sawPivot=true;
    const stop=isLong?v-buffer:v+buffer;
    const dist=isLong?entry-stop:stop-entry;
    if(dist<=0 || dist<0.70*atr)continue;
    return {valid:true,stop,index:j,reason:'Pivô local confirmado; ainda precisa de validação no gráfico.'};
  }
  return {valid:false,reason:sawPivot?'Os pivôs recentes ficaram próximos demais (menos de 0,70 ATR) ou do lado incorreto da entrada.':'Não foi encontrado pivô local confirmado nos últimos 30 candles fechados.'};
}
function calcIQE({quality,dist9,quoteVolume,spreadPct,entry,stop,r1,r2,trRatio,state,extended,deepRisk}){
  // 30 pts — força técnica: o Score técnico existente vira a parcela de força do IQE.
  const strength=Math.round(Math.max(0,Math.min(100,quality||0))*0.30);

  // 20 pts — qualidade do preço de entrada em relação à MME9.
  const d=Math.abs(dist9||0);
  let distance=0;
  if(d<=0.35) distance=20;
  else if(d<=0.75) distance=17;
  else if(d<=1.20) distance=13;
  else if(d<=2.00) distance=8;
  else if(d<=3.00) distance=4;
  if(extended) distance=0;
  if(deepRisk) distance=Math.min(distance,4);

  // 20 pts — liquidez: até 12 por volume 24h + até 8 por spread bid/ask.
  const v=Number(quoteVolume)||0;
  let volumePts = v>=100_000_000?12 : v>=50_000_000?11 : v>=20_000_000?10 : v>=10_000_000?8 : v>=5_000_000?6 : v>=2_000_000?4 : 2;
  let spreadPts=4; // neutro se bid/ask vier indisponível
  if(Number.isFinite(spreadPct)){
    spreadPts = spreadPct<=0.05?8 : spreadPct<=0.10?7 : spreadPct<=0.20?5 : spreadPct<=0.35?3 : spreadPct<=0.50?1 : 0;
  }
  const liquidity=volumePts+spreadPts;

  // 20 pts — gestão/stop e estrutura de R:R. 1R/2R precisam existir e o stop não pode ser impraticável.
  let riskPct=Number.NaN, rr=0;
  if(Number.isFinite(entry) && Number.isFinite(stop) && entry>0){
    riskPct=Math.abs(entry-stop)/entry*100;
  }
  if(Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(r2)){
    const risk=Math.abs(entry-stop), reward2=Math.abs(r2-entry);
    if(risk>0) rr=reward2/risk;
  }
  let management=0;
  if(Number.isFinite(riskPct) && rr>=1.8){
    if(riskPct>=0.40 && riskPct<=2.50) management=20;
    else if(riskPct>=0.25 && riskPct<=4.00) management=16;
    else if(riskPct<=6.00) management=10;
    else if(riskPct<=8.00) management=6;
    else management=2;
  }

  // 10 pts — momento: penaliza candle explosivo/exaustão usando amplitude do último candle versus ATR14.
  let momentum=5;
  if(Number.isFinite(trRatio)){
    momentum = trRatio<=1.15?10 : trRatio<=1.50?8 : trRatio<=2.00?5 : trRatio<=2.50?2 : 0;
  }
  if(extended) momentum=0;
  if(deepRisk) momentum=Math.min(momentum,3);

  let iqe=Math.round(strength+distance+liquidity+management+momentum);

  // Proteção de estado: IQE alto não pode transformar preparação/risco em entrada confirmada.
  if(state==='PREPARAR' || state==='PULLBACK') iqe=Math.min(iqe,69);
  if(state==='RISCO') iqe=Math.min(iqe,54);
  if(state==='ESTICADO' || state==='LATERAL') iqe=Math.min(iqe,39);
  iqe=Math.max(0,Math.min(100,iqe));

  return {
    iqe,
    breakdown:{strength,distance,liquidity,management,momentum},
    riskPct,
    rr,
    trRatio
  };
}
function iqeLabel(iqe){
  if(iqe>=80) return {text:'🟢 Excelente', cls:'iqe-excellent'};
  if(iqe>=70) return {text:'🟢 Boa', cls:'iqe-good'};
  if(iqe>=55) return {text:'🟡 Aguardar preço', cls:'iqe-wait'};
  if(iqe>=40) return {text:'🟠 Tardia/arriscada', cls:'iqe-risk'};
  return {text:'🔴 Evitar', cls:'iqe-avoid'};
}
function calcParecerRelOk({state,iqe,trRatio,spreadPct,riskPct,sep,dist9}){
  let penalty=0;
  const reasons=[];
  const add=(pts,msg)=>{ penalty+=pts; reasons.push(msg); };

  const absDist=Math.abs(Number(dist9));
  const tr=Number(trRatio);
  const sp=Number(spreadPct);
  const rp=Number(riskPct);
  const se=Number(sep);

  if(Number.isFinite(tr) && tr>1.60){
    add(tr>1.90?16:12, `Candle/ATR ${tr.toFixed(2)}x > 1,60x`);
  }
  if(Number.isFinite(sp) && sp>0.10){
    add(sp>0.20?16:10, `Spread ${sp.toFixed(3)}% > 0,10%`);
  }
  if(Number.isFinite(rp) && rp>3.00){
    add(rp>6.00?20:12, `Stop ${rp.toFixed(2)}% > 3,00%`);
  }
  if(!Number.isFinite(rp)||rp<=0){
    add(28,'Stop de pivô confirmado indisponível: não aprovar entrada');
  }
  if(Number.isFinite(rp) && rp<0.35){
    add(rp<0.20?18:14, `Stop ${rp.toFixed(2)}% < 0,35%`);
  }
  if(Number.isFinite(se) && se<0.25){
    add(se<0.15?14:10, `Separação ${se.toFixed(3)}% < 0,25%`);
  }
  if(Number.isFinite(absDist) && absDist>1.20){
    add(absDist>1.50?14:10, `Dist.MME9 ${absDist.toFixed(2)}% > 1,20%`);
  }

  const hardReasonCount=reasons.length;

  // Alertas de proximidade dos limites: deixam de ser APROVADO mesmo antes de virar penalidade forte.
  const near=[];
  if(Number.isFinite(tr) && Number.isFinite(absDist) && tr>=1.45 && absDist>=0.90) near.push(`Candle ${tr.toFixed(2)}x + Dist.MME9 ${absDist.toFixed(2)}% próximos do limite`);
  if(Number.isFinite(tr) && Number.isFinite(sp) && tr>=1.45 && sp>=0.08) near.push(`Candle ${tr.toFixed(2)}x + spread ${sp.toFixed(3)}% pedem cautela`);
  if(Number.isFinite(absDist) && Number.isFinite(rp) && absDist>=1.00 && rp>=2.50) near.push(`Dist.MME9 ${absDist.toFixed(2)}% + stop ${rp.toFixed(2)}% pedem melhor preço`);
  if(near.length){ penalty += Math.min(10, near.length*5); reasons.push(...near); }

  const base=Number.isFinite(iqe)?iqe:0;
  const reviewScore=Math.max(0,Math.min(100,Math.round(base-penalty)));
  let code='AGUARDAR', label='🟡 AGUARDAR', cls='verdict-wait', grade='';

  if(state==='LONG' || state==='SHORT'){
    const veryTightStop = !Number.isFinite(rp) || rp<0.35;
    const poorExecution = Number.isFinite(sp) && sp>0.20;
    const veryWeakSeparation = Number.isFinite(se) && se<0.15;
    const explosiveWithCompression = Number.isFinite(tr) && tr>1.90 && Number.isFinite(se) && se<0.25;
    const wideStopWithCompression = Number.isFinite(rp) && rp>3.00 && Number.isFinite(se) && se<0.25;
    const tooManyProblems = hardReasonCount>=3;
    const structuralBad = veryTightStop || poorExecution || veryWeakSeparation || explosiveWithCompression || wideStopWithCompression || tooManyProblems;

    const lateEntry = (Number.isFinite(tr) && tr>1.60) ||
                      (Number.isFinite(absDist) && absDist>1.20) ||
                      (Number.isFinite(rp) && rp>3.00);

    if(structuralBad){
      code='DESCARTAR'; label='🔴 DESCARTAR ENTRADA ATUAL'; cls='verdict-discard';
    }else if(lateEntry){
      code='TARDIA'; label='🔵 TENDÊNCIA BOA — ESPERAR PULLBACK'; cls='verdict-late';
    }else if(reviewScore>=80 && reasons.length===0){
      code='APROVADO';
      const cleanEntry = reviewScore>=85 &&
                         Number.isFinite(absDist) && absDist<=0.85 &&
                         Number.isFinite(rp) && rp>=0.35 && rp<=2.50 &&
                         Number.isFinite(tr) && tr<=1.20 &&
                         Number.isFinite(sp) && sp<=0.08 &&
                         Number.isFinite(se) && se>=0.30;
      if(cleanEntry){
        grade='A+'; label='🏆 A+ ENTRADA LIMPA'; cls='verdict-approved-plus';
      }else{
        grade='A'; label='✅ A APROVADO COM ATENÇÃO'; cls='verdict-approved';
      }
    }
  }else if(state==='ESTICADO'){
    code='TARDIA'; label='🔵 TENDÊNCIA BOA — ESPERAR PULLBACK'; cls='verdict-late';
  }else if(state==='LATERAL' || state==='RISCO'){
    code='DESCARTAR'; label='🔴 DESCARTAR ENTRADA ATUAL'; cls='verdict-discard';
  }

  return {
    code,label,cls,grade,reviewScore,penalty,
    reasons,
    reasonText: reasons.length ? reasons.join(' • ') : 'Sem penalidades do filtro RelOk'
  };
}
function analyze(symbol, quoteVolume, candles, tolPct, stretchPct, bidPrice, askPrice){
  const o=candles.map(x=>+x[1]), h=candles.map(x=>+x[2]), l=candles.map(x=>+x[3]), c=candles.map(x=>+x[4]);
  const e9=ema(c,9), e21=ema(c,21);
  const i=egiClosedIndex(candles); // fechamento verificado pelo timestamp da API
  if(i<25 || !e9[i] || !e21[i]) return null;

  const price=c[i], fast=e9[i], slow=e21[i];
  const slope9=pct(fast, e9[i-3]);
  const slope21=pct(slow, e21[i-3]);
  const sep=Math.abs(pct(fast,slow));
  const dist9=pct(price,fast);
  const bid=Number(bidPrice), ask=Number(askPrice);
  const mid=(bid>0 && ask>0)?(bid+ask)/2:0;
  const spreadPct=mid>0?((ask-bid)/mid*100):Number.NaN;

  // Cruzamento recente: janela de 6 candles fechados. Ele gera PREPARAR, não entrada automática.
  const recentBars=[i,i-1,i-2,i-3,i-4,i-5];
  const crossUp = recentBars.some(j=> j>0 && e9[j]>e21[j] && e9[j-1]<=e21[j-1]);
  const crossDn = recentBars.some(j=> j>0 && e9[j]<e21[j] && e9[j-1]>=e21[j-1]);
  const crossRecent = crossUp || crossDn;

  const longBias=fast>slow;
  const shortBias=fast<slow;
  const slopeLongOk=slope9>0 && slope21>0;
  const slopeShortOk=slope9<0 && slope21<0;
  const lateral = sep < 0.12 && Math.abs(slope9)<0.18 && Math.abs(slope21)<0.12;

  // Diferencia preço esticado na direção da tendência de pullback profundo contra a tendência.
  const extended = (longBias && dist9>=stretchPct) || (shortBias && dist9<=-stretchPct);
  const deepRisk = (longBias && dist9<=-stretchPct) || (shortBias && dist9>=stretchPct);

  // Zona histórica de cada candle: evita comparar barras passadas com MMEs de hoje.
  let pullLong=false, pullShort=false, rejLong=false, rejShort=false;
  for(let j=i;j>=Math.max(i-2,1);j--){
    const zoneLo=Math.min(e9[j],e21[j])*(1-tolPct/100);
    const zoneHi=Math.max(e9[j],e21[j])*(1+tolPct/100);
    const touched = l[j] <= zoneHi && h[j] >= zoneLo;
    if(touched && longBias){
      pullLong=true;
      if(c[j]>o[j] && c[j]>=e9[j]) rejLong=true;
    }
    if(touched && shortBias){
      pullShort=true;
      if(c[j]<o[j] && c[j]<=e9[j]) rejShort=true;
    }
  }

  let state='LATERAL', label='⚪ Lateral', cls='neutral', obs='MMEs próximas/sem direção clara';

  if(!lateral){
    if(extended){
      state='ESTICADO'; label='⚠️ Entrada tardia'; cls='stretch'; obs='Preço esticado na direção do viés; não perseguir, aguardar retorno à MME 9/21';
    } else if(deepRisk){
      state='RISCO'; label='🟣 Pullback profundo / risco'; cls='risk'; obs='Preço afastou contra o viés; estrutura precisa se reorganizar antes de nova entrada';
    } else if(crossUp && longBias){
      state='PREPARAR'; label='🟡 Preparar LONG'; cls='prepare'; obs='Cruzamento recente; aguardar pullback + reação + inclinações positivas';
    } else if(crossDn && shortBias){
      state='PREPARAR'; label='🟡 Preparar SHORT'; cls='prepare'; obs='Cruzamento recente; aguardar pullback + rejeição + inclinações negativas';
    } else if(longBias && pullLong && rejLong && slopeLongOk){
      state='LONG'; label='🟢 LONG confirmado'; cls='long'; obs='Pullback + reação compradora + MME9/MME21 inclinadas para cima';
    } else if(shortBias && pullShort && rejShort && slopeShortOk){
      state='SHORT'; label='🔴 SHORT confirmado'; cls='short'; obs='Pullback + rejeição vendedora + MME9/MME21 inclinadas para baixo';
    } else if(longBias && pullLong && rejLong && !slopeLongOk){
      state='RISCO'; label='🟣 LONG enfraquecendo'; cls='risk'; obs='Houve reação, mas a inclinação das MMEs ainda não confirma força compradora';
    } else if(shortBias && pullShort && rejShort && !slopeShortOk){
      state='RISCO'; label='🟣 SHORT enfraquecendo'; cls='risk'; obs='Houve rejeição, mas a inclinação das MMEs ainda não confirma força vendedora';
    } else if(longBias){
      state='PULLBACK'; label='🔵 Aguardar pullback LONG'; cls='wait'; obs=slopeLongOk?'MME 9 > 21 e inclinações positivas; falta rejeição válida':'MME 9 > 21, mas inclinação ainda fraca/conflitante';
    } else if(shortBias){
      state='PULLBACK'; label='🔵 Aguardar pullback SHORT'; cls='wait'; obs=slopeShortOk?'MME 9 < 21 e inclinações negativas; falta rejeição válida':'MME 9 < 21, mas inclinação ainda fraca/conflitante';
    }
  }

  const quality=qualityScore({longBias,shortBias,slope9,slope21,sep,dist9,pullLong,pullShort,rejLong,rejShort,crossRecent,lateral,extended,deepRisk,stretchPct});

  const entry=price;
  const look=6;
  // Referência legada guardada para auditoria, não usada automaticamente como stop de operação.
  const legacyStop=longBias?Math.min(...l.slice(i-look+1,i+1)):shortBias?Math.max(...h.slice(i-look+1,i+1)):NaN;
  const atr14=avgTrueRange(h,l,c,i,14);
  // V8.3: pivô LOCAL já confirmado (duas barras fechadas à direita), mais buffer de 0,15 ATR.
  // Jamais alargar artificialmente o stop apenas para alcançar o percentual mínimo.
  const pivot=egiFindConfirmedPivotStop(h,l,entry,i,longBias,shortBias,atr14);
  const stop= pivot.valid ? pivot.stop : NaN;
  const stopSourceTs= pivot.valid ? Number(candles[pivot.index]?.[6]||0) : 0;
  const stopAtrMult= pivot.valid && atr14>0 ? Math.abs(entry-stop)/atr14 : NaN;
  const risk= pivot.valid ? Math.abs(entry-stop): NaN;
  const r1=pivot.valid ? (longBias?entry+risk:entry-risk) : NaN;
  const r2=pivot.valid ? (longBias?entry+2*risk:entry-2*risk) : NaN;
  const prev20Volumes=candles.slice(Math.max(0,i-20),i).map(x=>Number(x[5])).filter(x=>Number.isFinite(x)&&x>=0);
  const avgPrev20Vol=prev20Volumes.length===20?prev20Volumes.reduce((sum,v)=>sum+v,0)/20:NaN;
  const volRatio=Number.isFinite(avgPrev20Vol)&&avgPrev20Vol>0 ? Number(candles[i][5])/avgPrev20Vol : NaN;
  const trNow=Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]));
  const trRatio=atr14>0?trNow/atr14:Number.NaN;
  const iqeData=calcIQE({quality,dist9,quoteVolume:+quoteVolume,spreadPct,entry,stop,r1,r2,trRatio,state,extended,deepRisk});
  const iqeInfo=iqeLabel(iqeData.iqe);
  const parecer=calcParecerRelOk({state,iqe:iqeData.iqe,trRatio:iqeData.trRatio,spreadPct,riskPct:iqeData.riskPct,sep,dist9});

  const stopOrigin=longBias?'FUNDO PIVÔ LOCAL':shortBias?'TOPO PIVÔ LOCAL':'INDEFINIDO';
  return {legacyStop,stopMethod:'Pivô confirmado 2+2 com buffer 0,15 ATR14',stopValid:pivot.valid,stopError:pivot.reason,stopLookback:30,stopOrigin,stopSourceTs,atr14,stopAtrMult,snapshotAt:Date.now(),symbol,quoteVolume:+quoteVolume,state,label,cls,quality,iqe:iqeData.iqe,iqeText:iqeInfo.text,iqeCls:iqeInfo.cls,iqeBreakdown:iqeData.breakdown,riskPct:iqeData.riskPct,rr:iqeData.rr,trRatio:iqeData.trRatio,spreadPct,price,fast,slow,dist9,entry,stop,r1,r2,obs,sep,slope9,slope21,pullLong,pullShort,rejLong,rejShort,crossRecent,volRatio,signalCandleClose:Number(candles[i][6]||0),parecerCode:parecer.code,parecerGrade:parecer.grade,parecerLabel:parecer.label,parecerCls:parecer.cls,parecerScore:parecer.reviewScore,parecerPenalty:parecer.penalty,parecerReasons:parecer.reasons,parecerReasonText:parecer.reasonText};
}
const legacy=analyze;
const transition=(()=>{const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;function ema(a,n){let x=a[0];return a.map(v=>x+=(v-x)*2/(n+1))}function closed(a,t){return a.filter(x=>x.t<=t-1400).sort((a,b)=>a.t-b.t)}function calc(a){if(a.length<100)throw Error('Amostra insuficiente');let c=a.map(x=>x.c),m=[9,21,80].map(n=>ema(c,n)),i=a.length-1,tr=a.map((x,j)=>Math.max(x.h-x.l,Math.abs(x.h-(c[j-1]??x.c)),Math.abs(x.l-(c[j-1]??x.c)))),atr=avg(tr.slice(-14)),gap=j=>(Math.max(...m.map(x=>x[j]))-Math.min(...m.map(x=>x[j])))/Math.max(avg(tr.slice(j-13,j+1)),1e-12),g=gap(i),v=a[i].v/Math.max(avg(a.slice(-21,-1).map(x=>x.v)),1e-12),compression=[1,2,3,4,5].some(k=>gap(i-k)<=.6),exp=compression&&g>gap(i-1),dir=atr>0&&exp&&v>=1.3?(m[0][i]>m[1][i]&&m[1][i]>m[2][i]&&c[i]>a[i-1].h?'LONG':m[0][i]<m[1][i]&&m[1][i]<m[2][i]&&c[i]<a[i-1].l?'SHORT':null):null;return {g,v,dir,atr,price:c[i],t:a[i].t,state:dir?'RETOMADA '+dir:g<=.6?'COMPRESSÃO':exp?'TRANSIÇÃO':'AGUARDAR'}}function audit(s,a,ms){if(s.done)return;for(let x of a.filter(x=>x.t>s.last)){if(x.t!==s.last+ms){s.done='LACUNA';return}let d=s.dir==='LONG'?1:-1;s.last=x.t;if(((d===1?x.l:x.h)-s.price)*d<=-s.atr){s.done='STOP';return}for(let k=1;k<=3;k++)if(((d===1?x.h:x.l)-s.price)*d>=k*s.atr)s.hit=Math.max(s.hit,k);if(s.hit===3){s.done='3R';return}}};return {calc,audit,closed,ema}})();
module.exports={legacy,transition};
