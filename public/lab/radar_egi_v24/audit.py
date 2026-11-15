"""Auditoria V2.4 LAB: estudo em candles fechados; nunca envia ordens."""
import datetime, json, os, urllib.request, urllib.parse

def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def atr(rows, n=14):
    tr=[]
    for i in range(max(1,len(rows)-n),len(rows)):
        hi=float(rows[i][2]); lo=float(rows[i][3]); prev=float(rows[i-1][4])
        tr.append(max(hi-lo,abs(hi-prev),abs(lo-prev)))
    return sum(tr)/len(tr) if tr else 0

def professor(trade):
    status=trade.get("status","PENDENTE")
    if status=="PENDENTE":
        return "Ainda não houve candle fechado de confirmação; observar, não entrar."
    if status=="INVALIDADO":
        return "Candle seguinte não confirmou força acima do preço observado; nenhum trade simulado."
    if status=="ABERTO":
        return "Simulação LONG confirmada após candle fechado; stop e metas fixadas. Não é ordem."
    if status=="STOP":
        return "Stop simulado atingido; revisar contexto BTC, volume, força relativa e reteste antes de novo sinal."
    if status=="3R":
        return "Alvo 3R simulado atingido. Auditar drawdown, dispersão por moeda e robustez da amostra."
    return "Prazo de avaliação encerrado; estudar a continuidade e a perda de momentum."

def evaluate(state, fetch, max_bars=48):
    """Somente eventos V2.4 são elegíveis a paper trade, sem lookahead.
    Entrada: fechamento do primeiro candle posterior ao sinal, se fechar acima
    do preço observado; stop: 1 ATR(14) da entrada; metas 1/2/3R.
    A avaliação começa no candle SEGUINTE à entrada. Em candle que bate
    stop e alvo, stop prevalece (critério conservador).
    """
    trades=state.setdefault("paperTrades",[])
    ids={t["eventId"] for t in trades}
    events=[e for e in state.get("events",[]) if e.get("origin")=="V2.4" and e.get("id") not in ids]
    bysym={}
    for e in events:
        bysym.setdefault(e.get("a"),[]).append(e)
    for t in trades:
        if t.get("status") in ("PENDENTE","ABERTO"):
            bysym.setdefault(t["symbol"],[])
    for sym, evs in bysym.items():
        try:
            rows=fetch(sym,"15m")
        except Exception as exc:
            state.setdefault("auditErrors",[]).append(sym+": "+str(exc)[:100])
            continue
        ends=[int(x[6]) for x in rows]
        for e in evs:
            t={"eventId":e["id"],"symbol":sym,"timeframe":"15m",
               "signalEnd":int(e["end"]),"status":"PENDENTE",
               "entry":None,"stop":None,"risk":None,"targets":{},
               "hit":{"1R":False,"2R":False,"3R":False},
               "evaluatedTo":int(e["end"]),"createdAt":utcnow()}
            trades.append(t);ids.add(e["id"])
        for t in trades:
            if t["symbol"]!=sym or t.get("status") not in ("PENDENTE","ABERTO"):continue
            if t["status"]=="PENDENTE":
                ix=next((i for i,end in enumerate(ends) if end>t["signalEnd"]),None)
                if ix is None:continue
                event=next((e for e in state["events"] if e["id"]==t["eventId"]),None)
                if event is None:continue
                entry=float(rows[ix][4])
                if entry<=float(event["price"]):
                    t.update(status="INVALIDADO",closedAt=ends[ix],realizedR=None)
                    continue
                risk=atr(rows[:ix+1])
                if risk<=0:continue
                t.update(status="ABERTO",entry=entry,entryEnd=ends[ix],
                    stop=entry-risk,risk=risk,targets={"1R":entry+risk,"2R":entry+2*risk,"3R":entry+3*risk},
                    evaluatedTo=ends[ix])
            eligible=[row for row in rows if int(row[6])>t["evaluatedTo"]]
            for row in eligible:
                hi=float(row[2]);lo=float(row[3]);end=int(row[6])
                t["evaluatedTo"]=end
                t["bars"]=int(t.get("bars",0))+1
                if lo<=t["stop"]:
                    t.update(status="STOP",realizedR=-1.0,closedAt=end)
                    break
                for level in (1,2,3):
                    if hi>=t["targets"][str(level)+"R"]:
                        t["hit"][str(level)+"R"]=True
                if t["hit"]["3R"]:
                    t.update(status="3R",realizedR=3.0,closedAt=end)
                    break
                if t["bars"]>=max_bars:
                    # Saída no fechamento do último candle, não assumir gain garantido.
                    result=(float(row[4])-t["entry"])/t["risk"]
                    t.update(status="EXPIRADO",realizedR=round(result,4),closedAt=end)
                    break
            t["professor"]=professor(t)
    for t in trades:
        t.setdefault("professor",professor(t))
    state["audit"]=summarize(trades)
    state["auditRules"]={"mode":"paper-only","entry":"next CLOSED 15m candle close > signal price",
        "stop":"entry - ATR14 at confirmation","target":"1R, 2R, 3R intrabar high; stop-first if both",
        "expiry":"48 CLOSED 15m candles after entry; exit at last close",
        "noLookahead":True,"legacyV23Excluded":True}
    state["auditUpdatedAt"]=utcnow()
    return state["audit"]

def summarize(trades):
    out={}
    for t in trades:
        s=t["symbol"]
        d=out.setdefault(s,{"signals":0,"confirmed":0,"invalidated":0,
            "open":0,"closed":0,"wins":0,"losses":0,"hit1R":0,"hit2R":0,"hit3R":0,
            "totalR":0.0,"grossWinR":0.0,"grossLossR":0.0})
        d["signals"]+=1
        if t["status"]=="INVALIDADO":d["invalidated"]+=1
        if t.get("entry") is not None:d["confirmed"]+=1
        if t["status"]=="ABERTO":d["open"]+=1
        if t["status"] in ("STOP","3R","EXPIRADO"):
            d["closed"]+=1
            r=float(t.get("realizedR",0))
            d["totalR"]+=r
            if r>0:d["wins"]+=1;d["grossWinR"]+=r
            elif r<0:d["losses"]+=1;d["grossLossR"]+=abs(r)
        for n in (1,2,3):
            if t.get("hit",{}).get(str(n)+"R"):d["hit"+str(n)+"R"]+=1
    for d in out.values():
        d["totalR"]=round(d["totalR"],3)
        d["winRate"]=round(100*d["wins"]/d["closed"],2) if d["closed"] else None
        d["payoff"]=round(d["grossWinR"]/d["wins"]/(d["grossLossR"]/d["losses"]),3) if d["wins"] and d["losses"] and d["grossLossR"] else None
        d["grossWinR"]=round(d["grossWinR"],3);d["grossLossR"]=round(d["grossLossR"],3)
        d["sample"]=str(d["wins"])+"/"+str(d["closed"]) if d["closed"] else "sem operações fechadas"
    return out

def ntfy_test(state):
    """Pré-visualização local por padrão; só entrega com duas flags explícitas."""
    message="TESTE Radar EGI V2.4 LAB | Sem sinal de entrada | "+utcnow()
    live=os.getenv("ENABLE_NTFY")=="true" and os.getenv("NTFY_TEST")=="true"
    record={"at":utcnow(),"mode":"live" if live else "dry-run",
            "topic":os.getenv("NTFY_TOPIC","RadarIA_11"),"delivered":False}
    if live:
        url="https://ntfy.sh/"+urllib.parse.quote(record["topic"],safe="")
        req=urllib.request.Request(url,data=message.encode("utf-8"),
              headers={"Title":"Radar EGI V2.4 LAB TESTE","Tags":"test_tube","Priority":"low"},method="POST")
        try:
            with urllib.request.urlopen(req,timeout=15) as res:
                record["delivered"]=res.status in (200,201)
        except Exception as exc:record["error"]=str(exc)[:160]
    state["ntfyTest"]=record
    return record

def snapshot(state):
    history=state.setdefault("history",[])
    history.append({"at":utcnow(),"signals":len(state.get("events",[])),
                    "paperTrades":len(state.get("paperTrades",[])),
                    "audit":state.get("audit",{}),"errors":state.get("auditErrors",[])})
    state["history"]=history[-90:]
