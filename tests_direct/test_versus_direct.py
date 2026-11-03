import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stub

stub.install()

import importlib.util

SPEC = importlib.util.spec_from_file_location(
    "versus", str(Path(__file__).resolve().parent.parent / "contracts" / "versus.py")
)
versus = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(versus)

SENDER = "0x1111111111111111111111111111111111111111"
URL_A = "https://example.com/a"
URL_B = "https://example.com/b"
PAGE_A_STRONG = "Aurora has won 12 international titles, holds 3 world records, and was named champion in 2022, 2023, and 2024."
PAGE_B_WEAK = "Boreal participated in one local event in 2023."
PAGE_A_WEAK = "Aurora attended a workshop in 2024."
PAGE_B_STRONG = "Boreal has won 15 international titles, holds 5 world records, and was named champion in 2021, 2022, 2023, 2024, and 2025."
PAGE_TIE = "Cinder won 2 regional titles in 2023 and coaches juniors on weekends."


def fresh():
    versus.gl.message.sender_address = SENDER
    versus.gl.nondet.web.pages = {}
    versus.gl.nondet.answers = []
    c = versus.Versus()
    c.__init__()
    return c


def expect_error(fn, code):
    try:
        fn()
    except versus.gl.vm.UserError as exc:
        assert str(exc) == code, f"expected {code}, got {exc}"
        return
    raise AssertionError(f"expected UserError {code}, call succeeded")


class TestJudgeDirect(unittest.TestCase):
    def test_a_wins(self):
        c = fresh()
        versus.gl.nondet.web.pages = {URL_A: PAGE_A_STRONG, URL_B: PAGE_B_WEAK}
        c.create_match("Final", "Aurora", "Boreal", URL_A, URL_B)
        versus.gl.nondet.answers = [
            {"winner": "A", "reason": "Aurora shows titles and records", "quote": "won 12 international titles"},
            {"winner": "A", "reason": "Aurora has the stronger record", "quote": "holds 3 world records"},
        ]
        raw = c.judge("match-0")
        m = json.loads(raw)
        self.assertEqual((m["status"], m["winner"]), ("JUDGED", "A"))
        self.assertEqual(json.loads(c.get_contestant("aurora")), {"name": "Aurora", "wins": 1, "losses": 0, "ties": 0})
        self.assertEqual(json.loads(c.get_contestant("boreal")), {"name": "Boreal", "wins": 0, "losses": 1, "ties": 0})
        self.assertEqual(json.loads(c.get_leaderboard())["contestants"][0]["name"], "Aurora")

    def test_tie(self):
        c = fresh()
        versus.gl.nondet.web.pages = {URL_A: PAGE_TIE, URL_B: PAGE_TIE.replace("Cinder", "Dune")}
        c.create_match("Even", "Cinder", "Dune", URL_A, URL_B)
        versus.gl.nondet.answers = [
            {"winner": "TIE", "reason": "Both pages show equal records", "quote": ""},
            {"winner": "TIE", "reason": "No side is stronger here", "quote": ""},
        ]
        m = json.loads(c.judge("match-0"))
        self.assertEqual(m["winner"], "TIE")
        self.assertEqual(m["quote"], "")
        self.assertEqual(json.loads(c.get_contestant("cinder"))["ties"], 1)
        self.assertEqual(json.loads(c.get_contestant("dune"))["ties"], 1)

    def test_rematch_accumulates(self):
        c = fresh()
        versus.gl.nondet.web.pages = {URL_A: PAGE_A_STRONG, URL_B: PAGE_B_WEAK}
        c.create_match("First", "Aurora", "Boreal", URL_A, URL_B)
        versus.gl.nondet.answers = [
            {"winner": "A", "reason": "Aurora shows titles and records", "quote": "won 12 international titles"},
            {"winner": "A", "reason": "Aurora has the stronger record", "quote": "holds 3 world records"},
        ]
        c.judge("match-0")
        versus.gl.nondet.web.pages = {URL_A: PAGE_A_WEAK, URL_B: PAGE_B_STRONG}
        c.create_match("Rematch", "Aurora", "Boreal", URL_A, URL_B)
        versus.gl.nondet.answers = [
            {"winner": "B", "reason": "Boreal shows more titles now", "quote": "won 15 international titles"},
            {"winner": "B", "reason": "Boreal has the stronger record", "quote": "holds 5 world records"},
        ]
        m = json.loads(c.judge("match-1"))
        self.assertEqual(m["winner"], "B")
        self.assertEqual(json.loads(c.get_contestant("aurora")), {"name": "Aurora", "wins": 1, "losses": 1, "ties": 0})
        self.assertEqual(json.loads(c.get_contestant("boreal")), {"name": "Boreal", "wins": 1, "losses": 1, "ties": 0})
        counts = json.loads(c.get_counts())
        self.assertEqual(counts, {"match_count": 2, "judged_count": 2, "pending_count": 0, "contestant_count": 2})

    def test_disagreement_fails_closed(self):
        c = fresh()
        versus.gl.nondet.web.pages = {URL_A: PAGE_A_STRONG, URL_B: PAGE_B_WEAK}
        c.create_match("Final", "Aurora", "Boreal", URL_A, URL_B)
        versus.gl.nondet.answers = [
            {"winner": "A", "reason": "Aurora shows titles and records", "quote": "won 12 international titles"},
            {"winner": "B", "reason": "Boreal shows a local event", "quote": "participated in one local event"},
        ]
        expect_error(lambda: c.judge("match-0"), "MAJORITY_DISAGREE")
        self.assertEqual(json.loads(c.get_match("match-0"))["status"], "PENDING")
        self.assertEqual(c.get_contestant("aurora"), "")

    def test_unreachable_fails_closed(self):
        c = fresh()
        versus.gl.nondet.web.pages = {URL_A: PAGE_A_STRONG}
        c.create_match("Final", "Aurora", "Boreal", URL_A, URL_B)
        expect_error(lambda: c.judge("match-0"), "EVIDENCE_UNAVAILABLE")
        self.assertEqual(json.loads(c.get_match("match-0"))["status"], "PENDING")

    def test_bad_quote_fails_closed(self):
        c = fresh()
        versus.gl.nondet.web.pages = {URL_A: PAGE_A_STRONG, URL_B: PAGE_B_WEAK}
        c.create_match("Final", "Aurora", "Boreal", URL_A, URL_B)
        versus.gl.nondet.answers = [
            {"winner": "A", "reason": "Aurora shows titles and records", "quote": "this quote is nowhere"},
            {"winner": "A", "reason": "Aurora has the stronger record", "quote": "holds 3 world records"},
        ]
        expect_error(lambda: c.judge("match-0"), "UNSUPPORTED_QUOTE")
        self.assertEqual(json.loads(c.get_match("match-0"))["status"], "PENDING")


if __name__ == "__main__":
    unittest.main(verbosity=2)
