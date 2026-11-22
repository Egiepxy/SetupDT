#!/usr/bin/env python3
"""Radar EGI V2.2 LAB — alertas de estudo, sem ordens."""
import json, os, urllib.request, urllib.parse, datetime, pathlib, math
from professor import explain, audit_all
ROOT=pathlib.Path(__file__).resolve().parent
STATE=ROOT/"state.json"
SYMS=["BTC","XRP","LINK","ETH","SOL","ONDO"]
TFS=["15m","1h","2h","4h"]
def get(symbol,tf):
    q=urllib.parse.urlencode({"symbol":symbol+"USDT","interval":tf,"limit":230})
    urls=["https://api.binance.com/api/v3/klines?"+q,"https://data-api.binance.vision/api/v3/klines?"+q]
    for url in urls:
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"RadarEGILAB/2.2"})
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
       headers={"Title":"Radar EGI V2.2 LAB","Tags":"mag,warning","Priority":"default"},method="POST")
    with urllib.request.urlopen(req,timeout=15) as r:return r.status==200
def main():
    state=json.loads(STATE.read_text()) if STATE.exists() else {"sent":[],"events":[]}
    sent=set(state.get("sent",[])); multi={};errors=[]; new=[]; candles15={}
    for tf in TFS:
        multi[tf]={}
        for sym in SYMS:
            try:
                rows=get(sym,tf)
                multi[tf][sym]=measure(rows)
                if tf=="15m":candles15[sym]=rows
            except Exception as e:errors.append(sym+" "+tf+": "+str(e)[:140])
    btc=multi.get("1h",{}).get("BTC")
    for sym in SYMS:
        if sym=="BTC":continue
        a=multi["15m"].get(sym);h=multi["1h"].get(sym)
        if not a or not h or not btc:continue
        # Observação somente: recuperação relativa e RSI crescente, sem gatilho de entrada.
        relative=h["ret"]-btc["ret"]
        if a["rsi"]>a["rsiPrev"] and h["rsi"]>h["rsiPrev"] and relative>0 and a["price"]>a["e9"]:
            key=f'{sym}|15m|{a["end"]}|OBS'
            if key not in sent:
                event={"id":key,"a":sym,"tf":"15m","end":a["end"],"price":a["price"],
                    "kind":"OBSERVAÇÃO","state":"AGUARDANDO CONFIRMAÇÃO","relative":round(relative,2),
                    "createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "professor":explain(a,h,relative)}
                new.append(event)
                msg=f'OBSERVAR {sym}USDT 15m | Preço {a["price"]:.8g} USDT | RSI {a["rsi"]} | Força vs BTC {relative:+.2f}pp | Candle fechado. NÃO É ENTRADA.'
                try:
                    if send(msg):sent.add(key)
                    elif os.getenv("ENABLE_NTFY")!="true":sent.add(key)
                except Exception as e:errors.append("ntfy: "+str(e)[:120])
    state["events"]=(state.get("events",[])+new)[-500:]
    previous_audits=state.get("audits",{})
    current_audits=audit_all(state["events"],candles15)
    for key, current in current_audits.items():
        old=previous_audits.get(key,{})
        if old.get("status")=="COMPLETO":
            continue
        if old.get("horizons"):
            current["horizons"]={**current.get("horizons",{}),
                **{n:v for n,v in old["horizons"].items() if v.get("status")=="AUDITADO"}}
            current["status"]="COMPLETO" if all(current["horizons"].get(str(n),{}).get("status")=="AUDITADO" for n in (1,2,4)) else "PARCIAL"
        previous_audits[key]=current
    state["audits"]=previous_audits
    state["sent"]=list(sent)[-1000:]
    state["lastRun"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    state["multi"]=multi;state["errors"]=errors
    STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"new":len(new),"errors":errors,"pairs":sum(map(len,multi.values())),"audited":sum(v.get("status")=="COMPLETO" for v in state["audits"].values())},ensure_ascii=False))
if __name__=="__main__":main()
