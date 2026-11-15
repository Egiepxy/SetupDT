#!/usr/bin/env python3
"""Testes determinísticos offline do Radar EGI V2.4 LAB."""
import json, os, unittest
import audit

def bars(prices):
    rows=[]
    for i,p in enumerate(prices):
        end=1_000_000+i*900_000
        rows.append([end-899999,str(p),str(p+1),str(p-1),str(p),"100",end])
    return rows

def event(price=100, ident="SOL|15m|19000000|OBS"):
    return {"id":ident,"a":"SOL","end":1_000_000+20*900_000,
            "price":price,"origin":"V2.4","kind":"OBSERVAÇÃO"}

class AuditTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ENABLE_NTFY",None)
        os.environ.pop("NTFY_TEST",None)
    def run_case(self,rows):
        state={"events":[event()],"paperTrades":[]}
        audit.evaluate(state,lambda s,tf:rows)
        return state["paperTrades"][0],state
    def test_3r_after_confirmed_closed_candle(self):
        prices=[100.0]*21+[101.0,107.0,107.0]
        t,state=self.run_case(bars(prices))
        self.assertEqual(t["status"],"3R")
        self.assertEqual(t["realizedR"],3)
        self.assertTrue(all(t["hit"].values()))
        self.assertEqual(state["audit"]["SOL"]["sample"],"1/1")
    def test_unconfirmed_is_not_a_trade(self):
        t,state=self.run_case(bars([100]*21+[99,101]))
        self.assertEqual(t["status"],"INVALIDADO")
        self.assertEqual(state["audit"]["SOL"]["closed"],0)
        self.assertIsNone(state["audit"]["SOL"]["winRate"])
    def test_pending_no_future_bar(self):
        t,state=self.run_case(bars([100]*21))
        self.assertEqual(t["status"],"PENDENTE")
        self.assertEqual(state["audit"]["SOL"]["open"],0)
    def test_stop_wins_ambiguous_candle(self):
        rows=bars([100]*21+[101,102])
        rows[-1][2]="110"
        rows[-1][3]="95"
        t,state=self.run_case(rows)
        self.assertEqual(t["status"],"STOP")
        self.assertEqual(t["realizedR"],-1)
        self.assertFalse(t["hit"]["3R"])
    def test_no_double_count_on_second_run(self):
        rows=bars([100]*21+[101,107])
        state={"events":[event()],"paperTrades":[]}
        for i in range(2):audit.evaluate(state,lambda s,tf:rows)
        self.assertEqual(len(state["paperTrades"]),1)
    def test_v23_legacy_excluded(self):
        state={"events":[dict(event(),origin="V2.3")]}
        audit.evaluate(state,lambda s,tf:bars([100]*25))
        self.assertFalse(state["paperTrades"])
    def test_ntfy_offline_by_default(self):
        state={}
        result=audit.ntfy_test(state)
        self.assertEqual(result["mode"],"dry-run")
        self.assertFalse(result["delivered"])
        self.assertEqual(result["topic"],"RadarIA_11")
    def test_history_backup_snapshots(self):
        state={"events":[],"paperTrades":[],"audit":{}}
        for i in range(95):audit.snapshot(state)
        self.assertEqual(len(state["history"]),90)
    def test_payoff_and_denominator(self):
        examples=[
         {"symbol":"SOL","eventId":"1","status":"3R","entry":1,"realizedR":3,"hit":{"1R":True,"2R":True,"3R":True}},
         {"symbol":"SOL","eventId":"2","status":"STOP","entry":1,"realizedR":-1,"hit":{"1R":False,"2R":False,"3R":False}}]
        stats=audit.summarize(examples)["SOL"]
        self.assertEqual(stats["winRate"],50)
        self.assertEqual(stats["payoff"],3)
        self.assertEqual(stats["sample"],"1/2")

if __name__=="__main__":unittest.main()
