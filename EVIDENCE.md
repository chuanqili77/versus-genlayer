# Versus — Evidence

## Contract

- File: `contracts/versus.py`, protocol `versus-1`.
- Network: Stable Studionet, chain ID 61999.
- Deployment: see `evidence/deployment.json`.

## Mechanism

`create_match(title, contestant_a, contestant_b, evidence_a_url, evidence_b_url)`
creates a head-to-head match with an auto-assigned id (`match-0`, `match-1`, …).
Contestant names are tallied case-insensitively: `Aurora` and `aurora` are one
record, displayed under the first-seen spelling. Each creator may create up to
32 matches.

`judge(match_id)` is open to any caller. Validators fetch BOTH evidence pages
and pick a winner:

- `A` / `B`: that side's page presents the clearly stronger case — more
  specific, verifiable achievements, records, titles, or endorsements directly
  about that contestant. The verdict carries a reason (8–400 characters) and
  one exact quote from the winner's page (8–800 characters, a substring of
  that side's page).
- `TIE`: the cases are evenly matched, or neither page supports its
  contestant. The quote is empty.

Validators must agree on the winner, or the judgment fails closed and the
match stays `PENDING`. If either evidence page is unreachable or empty, the
judgment fails closed and the match stays `PENDING`. A decided match keeps
its verdict; re-judging fails.

On a successful judgment, contestant records update: the winner gains a win,
the loser a loss, or both gain a tie. `get_leaderboard` returns contestants
sorted by wins descending, then name ascending.

## Guards

| Code | Trigger |
| --- | --- |
| `NOT_FOUND` | Unknown match id |
| `ALREADY_JUDGED` | Judging a decided match |
| `INVALID_URL` | Evidence URL not HTTPS, over 500 characters, or malformed |
| `INVALID_CONTESTANTS` | Both contestants the same, case-insensitively |
| `TEXT_BOUNDS` | Title, name, reason, or statement outside its length bounds |
| `CAP_REACHED` | A creator's 33rd match |
| `INVALID_VERDICT` | Verdict shape, winner value, reason bounds, or TIE with a quote wrong |
| `UNSUPPORTED_QUOTE` | Winner quote missing from, or too short for, the winner's page |
| `EVIDENCE_UNAVAILABLE` | Either evidence page fails to fetch or is empty |

Guard proofs rest on FINALIZED status plus state readbacks: error receipts
on this network carry no error string.

## Views

- `get_match(match_id)` — match record JSON, or empty.
- `get_contestant(name)` — contestant record JSON (case-insensitive), or empty.
- `get_leaderboard()` — contestants sorted by wins descending, then name.
- `get_counts()` — match, judged, pending, and contestant counts.
- `get_protocol()` — `versus-1`.

## Tests

Run the two suites in separate processes (they stub the host module
differently and must never share one process):

```sh
python3 -m unittest discover -s tests_standin -v
python3 -m unittest discover -s tests_direct -v
python3 scripts/check_contract.py
```

- Stand-in suite: create validation, cap, judge guards, verdict validation,
  tally and leaderboard sorting.
- Direct suite: judge end to end with mocked fetches and canned verdicts —
  A win, TIE, rematch accumulation, disagreement failing closed, unreachable
  evidence failing closed, unsupported quote failing closed.
- `scripts/check_contract.py`: pinned Depends header, no comments after it,
  `gl.Contract` subclass, `__init__` present, public decorators, no float
  literals.

## Verification loop

45 transactions, all FINALIZED: 39 SUCCESS, 6 expected ERROR. Every
transaction hash is recorded in `evidence.json`; final state was
re-read by an independent client (`scripts/readback.mjs`, 22/22 checks
pass) and matches the loop exactly.

- match-0 "Aurora vs Boreal, season final": created, judged, winner A.
  Validators compared both evidence pages and returned a reason (232
  chars) with an exact quote from Aurora's page.
- match-1 "Aurora vs Boreal, rematch": created with different evidence
  pages, judged, winner B. The rematch reversed the first result.
- match-2 "Cinder vs Dune, even draw": judged TIE, quote empty.
- match-3 "Ember vs Frost, pending": judging failed closed with
  `EVIDENCE_UNAVAILABLE` because side B's evidence host does not
  resolve; the match remains PENDING with no winner, no reason, and no
  quote.
- Negatives, all FINALIZED ERROR: re-judging match-0
  (`ALREADY_JUDGED`), judging a nonexistent match (`NOT_FOUND`),
  creating with an `http://` URL and with a non-URL string
  (`INVALID_URL` in both cases).
- Cap: 32 filler matches created by one creator account, all SUCCESS;
  the 33rd create for that creator failed with `CAP_REACHED`. The cap
  is per creator: other creators are unaffected.
- Final counts: 36 matches, 3 judged, 33 pending, 4 contestants with
  records. Leaderboard by wins: Aurora 1-1-0, Boreal 1-1-0, Cinder
  0-0-1, Dune 0-0-1. Contestant lookup is case-insensitive (`AURORA`
  returns Aurora's record). Ember and Frost have no record because
  their match was never judged.

## Attempt log

- Attempt 1 — deploy `0x8ca04cc1120a4fc2210aed04d68f8e67d343b4bb66f12438fa91e25c91d01164`,
  FINALIZED, contract `0x5daDB9584f0cb94CAabE765946CB3aAb6e4f277C`. The deploy
  script's success gate misread the receipt (it looked for an execution field
  that deploys do not carry) and exited, although the contract was live and
  answered `get_protocol` with `versus-1`. The deployment was kept and
  recorded by `scripts/verify-deployment.mjs`; the script gate was fixed to
  verify via a contract read. No redeploy was needed.

## Honest limits

- The verification loop uses temporary test accounts, not independent human
  judges; validator agreement is by the network's consensus, and the loop
  demonstrates the mechanism, not real-world adoption.
- Evidence pages in the loop are short synthetic texts hosted for the loop;
  they demonstrate comparative judging, not a real contest.
- The standalone genvm-lint binary was not available in this environment, so
  lint-equivalence was verified by `scripts/check_contract.py` (which enforces
  the known live-runner rejection modes) plus the successful live deployment,
  which is the runner itself accepting the contract.
- No frontend exists by design; interaction is through contract calls.
