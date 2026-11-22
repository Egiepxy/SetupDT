"""Professor e auditoria de observações Radar EGI LAB. Sem ordens."""
def explain(a, h, relative):
    missing=[]
    if a["rsi"] < 50: missing.append("RSI 15m ainda abaixo de 50")
    if a["price"] <= a["e21"]: missing.append("preço abaixo da MME21 15m")
    if a["rv"] < 1.2: missing.append("volume relativo inferior a 1,20x")
    if h["price"] <= h["e21"]: missing.append("contexto 1h abaixo da MME21")
    if relative < 0.15: missing.append("vantagem relativa vs BTC pequena")
    return {"classification":"OBSERVAR","trade_authorized":False,
            "reasons":missing or ["sem rompimento, reteste e stop validados"],
            "next":"Aguardar candle fechado, alinhamento 1h, volume e rompimento/reteste."}

def audit_event(event, rows):
    """Audita somente fechamentos posteriores ao candle original, sem extrapolar."""
    result={"status":"SEM_BASE","horizons":{}}
    end=event.get("end")
    price=event.get("price")
    if not isinstance(end,int) or not isinstance(price,(int,float)) or price<=0:
        return result
    index=next((i for i,r in enumerate(rows) if int(r[6])==end),None)
    if index is None:
        result["status"]="CANDLE_ORIGINAL_INDISPONIVEL"
        return result
    for n in (1,2,4):
        if index+n>=len(rows):
            result["horizons"][str(n)]={"status":"PENDENTE"}
            continue
        section=rows[index+1:index+n+1]
        close=float(section[-1][4])
        high=max(float(x[2]) for x in section)
        low=min(float(x[3]) for x in section)
        result["horizons"][str(n)]={
            "status":"AUDITADO","close":close,
            "return_pct":round((close/price-1)*100,4),
            "mfe_pct":round((high/price-1)*100,4),
            "mae_pct":round((low/price-1)*100,4),
            "last_close_time":int(section[-1][6])}
    result["status"]="COMPLETO" if all(v["status"]=="AUDITADO" for v in result["horizons"].values()) else "PARCIAL"
    return result

def audit_all(events, candles):
    return {e["id"]:audit_event(e,candles[e["a"]]) if e.get("a") in candles else {"status":"SEM_DADOS","horizons":{}}
            for e in events if e.get("id")}
