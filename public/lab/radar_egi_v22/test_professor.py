import unittest
from professor import audit_event, audit_all, explain

def row(n,close,high=None,low=None):
    return [n*900000,"0",str(high if high is not None else close),str(low if low is not None else close),str(close),"10",(n+1)*900000-1]

class ProfessorTest(unittest.TestCase):
    def test_exactly_1_2_4_closed_candles(self):
        rows=[row(0,100),row(1,101,102,99),row(2,102,103,100),row(3,98),row(4,104)]
        e={"id":"ETH|15m|899999|OBS","a":"ETH","end":899999,"price":100}
        a=audit_event(e,rows)
        self.assertEqual(a["status"],"COMPLETO")
        self.assertEqual(a["horizons"]["1"]["return_pct"],1)
        self.assertEqual(a["horizons"]["2"]["return_pct"],2)
        self.assertEqual(a["horizons"]["4"]["return_pct"],4)
        self.assertEqual(a["horizons"]["2"]["mfe_pct"],3)
    def test_missing_original_never_backfills(self):
        self.assertEqual(audit_event({"end":123,"price":100},[row(1,101)])["status"],"CANDLE_ORIGINAL_INDISPONIVEL")
    def test_pending_not_a_result(self):
        a=audit_event({"end":899999,"price":100},[row(0,100),row(1,99)])
        self.assertEqual(a["status"],"PARCIAL")
        self.assertEqual(a["horizons"]["4"]["status"],"PENDENTE")
    def test_no_entry_and_audit_is_read_only(self):
        a={"rsi":46.76,"price":1664.73,"e21":1665,"rv":0.9}
        h={"price":1666,"e21":1667}
        self.assertFalse(explain(a,h,0.03)["trade_authorized"])
        events=[{"id":"x","a":"ETH","end":899999,"price":100}]
        audit_all(events,{"ETH":[row(0,100),row(1,101)]})
        self.assertNotIn("audit",events[0])

if __name__=="__main__":unittest.main()
