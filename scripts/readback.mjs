import { readFileSync, writeFileSync } from "node:fs";
import { readClient, throttledRead } from "./common.mjs";

// Independent readback: a fresh client, no shared state with the loop.
// Every check must match the loop's recorded outcomes exactly.
const evidence = JSON.parse(
  readFileSync(new URL("../evidence.json", import.meta.url), "utf8"),
);
const ADDRESS = evidence.contractAddress;
const reader = readClient();
const checks = [];
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
function check(name, actual, expected) {
  const ok = JSON.stringify(canon(actual)) === JSON.stringify(canon(expected));
  checks.push({ name, ok, actual, expected });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`);
  return ok;
}

const counts = JSON.parse(await throttledRead(reader, ADDRESS, "get_counts", []));
check("counts", counts, { match_count: 36, judged_count: 3, pending_count: 33, contestant_count: 4 });

const leaderboard = JSON.parse(await throttledRead(reader, ADDRESS, "get_leaderboard", []));
check("leaderboard", leaderboard, {
  contestants: [
    { name: "Aurora", wins: 1, losses: 1, ties: 0 },
    { name: "Boreal", wins: 1, losses: 1, ties: 0 },
    { name: "Cinder", wins: 0, losses: 0, ties: 1 },
    { name: "Dune", wins: 0, losses: 0, ties: 1 },
  ],
});

for (const [id, status, winner] of [
  ["match-0", "JUDGED", "A"],
  ["match-1", "JUDGED", "B"],
  ["match-2", "JUDGED", "TIE"],
  ["match-3", "PENDING", ""],
]) {
  const m = JSON.parse(await throttledRead(reader, ADDRESS, "get_match", [id]));
  check(`${id} status`, m.status, status);
  check(`${id} winner`, m.winner, winner);
  if (winner === "A" || winner === "B") {
    const side = winner === "A" ? m.evidence_a_url : m.evidence_b_url;
    check(`${id} quote non-empty`, m.quote.length > 0, true);
    check(`${id} reason bounded`, m.reason.length >= 8 && m.reason.length <= 400, true);
    void side;
  }
  if (winner === "TIE") check(`${id} quote empty`, m.quote, "");
}

for (const [name, expected] of [
  ["aurora", { name: "Aurora", wins: 1, losses: 1, ties: 0 }],
  ["boreal", { name: "Boreal", wins: 1, losses: 1, ties: 0 }],
  ["cinder", { name: "Cinder", wins: 0, losses: 0, ties: 1 }],
  ["dune", { name: "Dune", wins: 0, losses: 0, ties: 1 }],
  ["AURORA", { name: "Aurora", wins: 1, losses: 1, ties: 0 }],
]) {
  const raw = await throttledRead(reader, ADDRESS, "get_contestant", [name]);
  check(`contestant ${name}`, raw ? JSON.parse(raw) : null, expected);
}
for (const name of ["ember", "frost"]) {
  const raw = await throttledRead(reader, ADDRESS, "get_contestant", [name]);
  check(`contestant ${name} has no record`, raw, "");
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  new URL("../evidence/readback.json", import.meta.url),
  JSON.stringify({ contractAddress: ADDRESS, checks, passed: failed.length === 0 }, null, 2) + "\n",
);
if (failed.length > 0) {
  console.log(`READBACK FAILED: ${failed.length} checks`);
  process.exit(1);
}
evidence.verified = true;
writeFileSync(
  new URL("../evidence.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(`READBACK PASSED: all ${checks.length} checks`);
