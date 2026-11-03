# Versus

Contract: https://explorer-studio.genlayer.com/address/0x5daDB9584f0cb94CAabE765946CB3aAb6e4f277C

Versus is a pairwise head-to-head judging contract on GenLayer Stable
Studionet (chain ID 61999). Instead of verifying one record against one
source, it stages a contest between two contestants and lets consensus
decide the winner by comparing both sides' evidence.

## How it works

`create_match(title, contestant_a, contestant_b, evidence_a_url,
evidence_b_url)` opens a match between two named contestants, each
backed by an evidence page URL. Match ids are assigned automatically
(`match-0`, `match-1`, …). Each creator may open at most 32 matches.

`judge(match_id)` is open to any caller. Validators fetch both evidence
pages and return a verdict: winner `A`, `B`, or `TIE`, a reason of 8–400
characters, and — for an A or B verdict — one exact quote from the
winner's evidence page (the quote must be a substring of that page; it
is empty for a TIE). Validators must agree on the winner, or the
judgment fails closed. If either evidence page is unreachable, the
judgment fails closed and the match stays PENDING.

Contestant records are tallied by name, case-insensitively, as
wins/losses/ties. The leaderboard is ordered by wins.

## Views

- `get_match(match_id)` — match record, verdict, reason, and quote.
- `get_contestant(name)` — a contestant's win/loss/tie record.
- `get_leaderboard()` — contestants ordered by wins.
- `get_counts()` — total, judged, and pending match counts, and the
  number of contestants with records.
- `get_protocol()` — returns `versus-1`.

## Guards

| Guard | Trigger |
| --- | --- |
| `NOT_FOUND` | Judging a match id that does not exist. |
| `ALREADY_JUDGED` | Judging a match that already has a verdict. |
| `INVALID_URL` | An evidence URL that is not a valid `https://` URL. |
| `INVALID_CONTESTANTS` | Both sides naming the same contestant. |
| `TEXT_BOUNDS` | A title, name, reason, or quote outside its length bounds. |
| `INVALID_VERDICT` | A verdict outside `A` / `B` / `TIE`. |
| `UNSUPPORTED_QUOTE` | A quote that is not a substring of the winner's evidence page, or a non-empty quote for a TIE. |
| `EVIDENCE_UNAVAILABLE` | Either evidence page unreachable or empty at judgment time. |
| `CAP_REACHED` | A creator opening a 33rd match. |

## Verification

On-chain loop, 45 transactions, all FINALIZED (39 SUCCESS, 6 expected
ERROR); every hash is in `evidence.json`, and an independent readback
of the final state passes 22/22 checks. Proven on chain: A beats B
(match-0), a rematch on different evidence where B beats A (match-1), a
TIE (match-2), and a PENDING match whose judgment failed closed on
unreachable evidence (match-3). The negatives above all failed closed
with their documented guard codes, and the 32-per-creator cap was
exercised to its 33rd-create rejection. Final state: 36 matches, 3
judged, 33 pending; leaderboard Aurora 1-1-0, Boreal 1-1-0, Cinder
0-0-1, Dune 0-0-1.

See `EVIDENCE.md` for the mechanism, the full loop, and the attempt
log. Contract source: `contracts/versus.py` (protocol `versus-1`).
