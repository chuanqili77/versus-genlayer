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
OTHER = "0x2222222222222222222222222222222222222222"
URL_A = "https://example.com/a"
URL_B = "https://example.com/b"


def fresh():
    versus.gl.message.sender_address = SENDER
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


class TestCreate(unittest.TestCase):
    def test_create_success(self):
        c = fresh()
        raw = c.create_match("Title", "Aurora", "Boreal", URL_A, URL_B)
        m = json.loads(raw)
        self.assertEqual(m["match_id"], "match-0")
        self.assertEqual(m["status"], "PENDING")
        self.assertEqual(m["creator"], SENDER.lower())
        self.assertEqual(json.loads(c.get_match("match-0"))["title"], "Title")
        counts = json.loads(c.get_counts())
        self.assertEqual(counts, {"match_count": 1, "judged_count": 0, "pending_count": 1, "contestant_count": 0})

    def test_create_validation(self):
        c = fresh()
        expect_error(lambda: c.create_match("ab", "Aurora", "Boreal", URL_A, URL_B), "TEXT_BOUNDS")
        expect_error(lambda: c.create_match("Title", "Aurora", "aurora", URL_A, URL_B), "INVALID_CONTESTANTS")
        expect_error(lambda: c.create_match("Title", "Aurora", "Boreal", "http://example.com/a", URL_B), "INVALID_URL")
        expect_error(lambda: c.create_match("Title", "Aurora", "Boreal", "not-a-url", URL_B), "INVALID_URL")
        expect_error(lambda: c.create_match("Title", "A" * 61, "Boreal", URL_A, URL_B), "TEXT_BOUNDS")

    def test_cap(self):
        c = fresh()
        for i in range(32):
            c.create_match(f"Title {i}", "Aurora", "Boreal", URL_A, URL_B)
        expect_error(lambda: c.create_match("Title 32", "Aurora", "Boreal", URL_A, URL_B), "CAP_REACHED")
        versus.gl.message.sender_address = OTHER
        c.create_match("Other title", "Aurora", "Boreal", URL_A, URL_B)
        self.assertEqual(json.loads(c.get_counts())["match_count"], 33)

    def test_views_empty(self):
        c = fresh()
        self.assertEqual(c.get_match("match-99"), "")
        self.assertEqual(c.get_contestant("Nobody"), "")
        self.assertEqual(json.loads(c.get_leaderboard()), {"contestants": []})
        self.assertEqual(c.get_protocol(), "versus-1")


class TestJudgeGuards(unittest.TestCase):
    def test_not_found(self):
        c = fresh()
        expect_error(lambda: c.judge("match-99"), "NOT_FOUND")

    def test_already_judged(self):
        c = fresh()
        c.create_match("Title", "Aurora", "Boreal", URL_A, URL_B)
        raw = json.loads(c.get_match("match-0"))
        raw["status"] = "JUDGED"
        c.matches["match-0"] = json.dumps(raw)
        expect_error(lambda: c.judge("match-0"), "ALREADY_JUDGED")


class TestVerdict(unittest.TestCase):
    def test_valid_a(self):
        v = versus.verdict(
            {"winner": "A", "reason": "Stronger case here", "quote": "won 12 titles"},
            "Aurora won 12 titles in total.", "Boreal took part once.",
        )
        self.assertEqual(v["winner"], "A")

    def test_valid_tie(self):
        v = versus.verdict(
            {"winner": "TIE", "reason": "Evenly matched pair", "quote": ""},
            "page a text", "page b text",
        )
        self.assertEqual(v["winner"], "TIE")

    def test_invalid(self):
        expect_error(lambda: versus.verdict(
            {"winner": "TIE", "reason": "Evenly matched pair", "quote": "something"},
            "a", "b"), "INVALID_VERDICT")
        expect_error(lambda: versus.verdict(
            {"winner": "A", "reason": "short", "quote": "won 12 titles"},
            "Aurora won 12 titles.", "Boreal took part once."), "INVALID_VERDICT")
        expect_error(lambda: versus.verdict(
            {"winner": "A", "reason": "Stronger case here", "quote": "not in the page"},
            "Aurora won 12 titles.", "Boreal took part once."), "UNSUPPORTED_QUOTE")
        expect_error(lambda: versus.verdict(
            {"winner": "C", "reason": "Stronger case here", "quote": ""},
            "a", "b"), "INVALID_VERDICT")


class TestTally(unittest.TestCase):
    def test_tally_and_leaderboard(self):
        c = fresh()
        c._tally("aurora", "Aurora", "boreal", "Boreal", "A")
        c._tally("aurora", "Aurora", "boreal", "Boreal", "B")
        c._tally("cinder", "Cinder", "dune", "Dune", "TIE")
        self.assertEqual(json.loads(c.get_contestant("AURORA")), {"name": "Aurora", "wins": 1, "losses": 1, "ties": 0})
        self.assertEqual(json.loads(c.get_contestant("boreal")), {"name": "Boreal", "wins": 1, "losses": 1, "ties": 0})
        self.assertEqual(json.loads(c.get_contestant("Cinder")), {"name": "Cinder", "wins": 0, "losses": 0, "ties": 1})
        board = json.loads(c.get_leaderboard())["contestants"]
        self.assertEqual([r["name"] for r in board], ["Aurora", "Boreal", "Cinder", "Dune"])
        self.assertEqual(json.loads(c.get_counts())["contestant_count"], 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
