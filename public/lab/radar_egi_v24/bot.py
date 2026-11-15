#!/usr/bin/env python3
"""Radar EGI V2.4 LAB — alertas de estudo, sem ordens."""
import json, os, urllib.request, urllib.parse, datetime, pathlib, math
import audit
ROOT=pathlib.Path(__file__).resolve().parent
STATE=ROOT/"state.json"
SYMS=["BTC","XRP","LINK","ETH","SOL","ONDO"]
TFS=["15m","1h","2h","4h"]
def get(symbol,tf):
    q=urllib.parse.urlencode({"symbol":symbol+"USDT","interval":tf,"limit":230})
    urls=["https://api.binance.com/api/v3/klines?"+q,"https://data-api.binance.vision/api/v3/klines?"+q]
    for url in urls:
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"RadarEGILAB/2.4"})
            with urllib.request.urlopen(req,timeout=15) as r: data=json.load(r)
            now=int(datetime.datetime.now(datetime.timezone.utc).timestamp()*1000)
            closed=[x for x in data if int(x[6])<now]
            if len(closed)>=210:return closed
        except Exception as e: last=str(e)
    raise RuntimeError(last)
def ema(vals,n):
    e=sum(vals[:n])/n
    for v in vals[n:]:e+=(v-e)*2/(n+1)
    return e
def rsi(vals,n=14):
    changes=[vals[i]-vals[i-1] for i in range(1,len(vals))]
    gains=[max(x,0) for x in changes]; losses=[max(-x,0) for x in changes]
    ag=sum(gains[:n])/n; al=sum(losses[:n])/n
    for g,l in zip(gains[n:],losses[n:]):ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n
    return 100 if al==0 else 100-100/(1+ag/al)
def measure(rows):
    c=[float(x[4]) for x in rows]; vol=[float(x[5]) for x in rows]
    return {"price":c[-1],"rsi":round(rsi(c),2),"rsiPrev":round(rsi(c[:-1]),2),
            "e9":ema(c,9),"e21":ema(c,21),"e80":ema(c,80),"e200":ema(c,200),
            "rv":vol[-1]/max(1e-12,sum(vol[-21:-1])/20),
            "ret":100*(c[-1]/c[-5]-1),"end":int(rows[-1][6])}
def send(msg):
    topic=os.getenv("NTFY_TOPIC","RadarIA_11")
    if os.getenv("ENABLE_NTFY")!="true":return False
    req=urllib.request.Request("https://ntfy.sh/"+urllib.parse.quote(topic),data=msg.encode(),
       headers={"Title":"Radar EGI V2.4 LAB","Tags":"mag,warning","Priority":"default"},method="POST")
    with urllib.request.urlopen(req,timeout=15) as r:return r.status==200
def main():
    cache={}
    def fetch(symbol,tf):
        key=(symbol,tf)
        if key not in cache:cache[key]=get(symbol,tf)
        return cache[key]
    state=json.loads(STATE.read_text()) if STATE.exists() else {"sent":[],"events":[]}
    sent=set(state.get("sent",[])); multi={};errors=[];new=[];diagnostics={}
    delivery={"sent":0,"failed":0,"disabled":0,"duplicates":0}
    for tf in TFS:
        multi[tf]={}
        for sym in SYMS:
            try:multi[tf][sym]=measure(fetch(sym,tf))
            except Exception as e:errors.append(sym+" "+tf+": "+str(e)[:140])
    btc=multi.get("1h",{}).get("BTC")
    for sym in SYMS:
        if sym=="BTC":continue
        a=multi["15m"].get(sym);h=multi["1h"].get(sym)
        reasons=[]
        if not a:reasons.append("15m indisponível")
        if not h:reasons.append("1h indisponível")
        if not btc:reasons.append("BTC 1h indisponível")
        relative=None
        if not reasons:
            relative=h["ret"]-btc["ret"]
            if a["rsi"]<=a["rsiPrev"]:reasons.append("RSI 15m não crescente")
            if h["rsi"]<=h["rsiPrev"]:reasons.append("RSI 1h não crescente")
            if relative<=0:reasons.append("Força relativa vs BTC não positiva")
            if a["price"]<=a["e9"]:reasons.append("Preço 15m abaixo/igual MME9")
        diagnostics[sym]={"status":"OBSERVAÇÃO CANDIDATA" if not reasons else "SEM SINAL",
            "reasons":reasons,"relative":round(relative,3) if relative is not None else None,
            "price":a["price"] if a else None}
        if reasons:continue
        key=f'{sym}|15m|{a["end"]}|OBS'
        if key in sent:
            delivery["duplicates"]+=1
            diagnostics[sym]["status"]="DUPLICADO"
            continue
        event={"id":key,"a":sym,"tf":"15m","end":a["end"],"price":a["price"],
               "kind":"OBSERVAÇÃO","state":"AGUARDANDO CONFIRMAÇÃO",
               "relative":round(relative,2),
               "createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "origin":"V2.4"}
        new.append(event)
        msg=f'OBSERVAR {sym}USDT 15m | Preço {a["price"]:.8g} USDT | RSI {a["rsi"]} | Força vs BTC {relative:+.2f}pp | Candle fechado. NÃO É ENTRADA.'
        if os.getenv("ENABLE_NTFY")!="true":
            delivery["disabled"]+=1
            sent.add(key)
        else:
            try:
                if send(msg):
                    sent.add(key);delivery["sent"]+=1
                else:
                    delivery["failed"]+=1
            except Exception as e:
                delivery["failed"]+=1;errors.append("ntfy: "+str(e)[:120])
    state["events"]=(state.get("events",[])+new)[-500:]
    state["sent"]=sorted(sent)[-1000:]
    state["lastRun"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    state["multi"]=multi;state["errors"]=errors
    state["diagnostics"]=diagnostics;state["delivery"]=delivery
    counts={}
    for e in state["events"]:
        s=e.get("a")
        if not s:continue
        d=counts.setdefault(s,{"observations":0,"resolved":0,"wins":0,"losses":0})
        d["observations"]+=1
        # Não inferir gain/loss sem preços futuros e regra de saída validada.
    state["bySymbol"]=counts
    state["version"]="2.4-LAB"
    state["auditErrors"]=[]
    audit.evaluate(state,fetch)
    audit.ntfy_test(state)
    audit.snapshot(state)
    STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"new":len(new),"errors":errors,
        "pairs":sum(map(len,multi.values())),"diagnostics":diagnostics,
        "delivery":delivery,"bySymbol":counts,
        "audit":state.get("audit",{}),"ntfyTest":state.get("ntfyTest",{})},ensure_ascii=False))
if __name__=="__main__":main()
