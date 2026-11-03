import { readFileSync, writeFileSync } from "node:fs";
import {
  makeAccount,
  writeClient,
  readClient,
  pollFinalized,
  throttledRead,
  sleep,
} from "./common.mjs";

const deployment = JSON.parse(
  readFileSync(new URL("../evidence/deployment.json", import.meta.url), "utf8"),
);
const ADDRESS = deployment.contractAddress;
console.log("contract:", ADDRESS);

const creator = makeAccount();
const judgeCaller = makeAccount();
console.log("creator:", creator.address);
console.log("judge caller:", judgeCaller.address);
const creatorClient = writeClient(creator);
const judgeClient = writeClient(judgeCaller);
const reader = readClient();

const steps = [];
async function send(client, functionName, args, label, expect) {
  const res = await client.writeContract({ address: ADDRESS, functionName, args, value: 0n });
  const hash = typeof res === "string" ? res : res?.hash ?? String(res);
  const { execution, errorPayload } = await pollFinalized(client, hash, label);
  const step = { label, hash, status: "FINALIZED", execution, errorPayload: errorPayload ?? null };
  steps.push(step);
  console.log(`${label}: ${hash} FINALIZED/${execution}${errorPayload ? ` payload=${JSON.stringify(errorPayload).slice(0, 120)}` : ""}`);
  if (expect && execution !== expect) {
    throw new Error(`${label}: expected ${expect}, got ${execution}`);
  }
  return step;
}

async function sendJudge(label, matchId, expect, expectWinner) {
  // A consensus disagreement is a fail-closed outcome, not a verdict: retry
  // with a fresh tx (never resend the same hash) up to 3 attempts.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const step = await send(judgeClient, "judge", [matchId], `${label} (attempt ${attempt})`, null);
    if (step.execution === expect) {
      if (expectWinner) {
        const m = JSON.parse(await throttledRead(reader, ADDRESS, "get_match", [matchId]));
        if (m.winner !== expectWinner) {
          throw new Error(`${label}: expected winner ${expectWinner}, chain says ${m.winner}`);
        }
        console.log(`${label}: winner ${m.winner} confirmed by readback`);
      }
      return step;
    }
    if (expect === "SUCCESS") {
      console.log(`${label}: attempt ${attempt} did not succeed (${step.execution}), retrying with a fresh tx`);
      continue;
    }
    throw new Error(`${label}: expected ${expect}, got ${step.execution}`);
  }
  throw new Error(`${label}: no successful judgment after 3 attempts`);
}

// ---- Evidence pages (dpaste, text/plain, 365-day expiry) ----
async function paste(text) {
  const form = new FormData();
  form.append("content", text);
  form.append("syntax", "text");
  form.append("expiry_days", "365");
  const res = await fetch("https://dpaste.org/api/", { method: "POST", body: form });
  const raw = (await res.text()).replaceAll('"', "").trim();
  const rawUrl = raw + "/raw";
  const check = await fetch(rawUrl);
  const body = await check.text();
  if (check.status !== 200 || !body.includes(text.slice(0, 40))) {
    throw new Error(`dpaste verification failed for ${rawUrl}`);
  }
  return rawUrl;
}

const pages = {};
pages.auroraStrong = await paste(
  "Aurora has won 12 international titles, holds 3 world records, and was named champion in 2022, 2023, and 2024. Aurora also coaches junior players on weekends.",
);
pages.borealWeak = await paste(
  "Boreal participated in one local event in 2023. Boreal enjoys watching competitions on television.",
);
pages.auroraWeak = await paste(
  "Aurora attended a workshop in 2024. Aurora likes to practice on weekends.",
);
pages.borealStrong = await paste(
  "Boreal has won 15 international titles, holds 5 world records, and was named champion in 2021, 2022, 2023, 2024, and 2025. Boreal also coaches junior players on weekends.",
);
pages.cinderTie = await paste(
  "Cinder won 2 regional titles in 2023 and coaches juniors on weekends. Cinder trains three times a week.",
);
pages.duneTie = await paste(
  "Dune won 2 regional titles in 2023 and coaches juniors on weekends. Dune trains three times a week.",
);
pages.emberValid = await paste(
  "Ember reached the national final in 2024 and holds a regional record. Ember trains every day.",
);
const UNREACHABLE = "https://no-such-host-xyz-12345.invalid/evidence.txt";
console.log("evidence pages ready");

// ---- Main matches ----
await send(creatorClient, "create_match",
  ["Aurora vs Boreal, season final", "Aurora", "Boreal", pages.auroraStrong, pages.borealWeak],
  "create-match-0", "SUCCESS");
await sendJudge("judge-match-0", "match-0", "SUCCESS", "A");

await send(creatorClient, "create_match",
  ["Aurora vs Boreal, rematch", "Aurora", "Boreal", pages.auroraWeak, pages.borealStrong],
  "create-match-1", "SUCCESS");
await sendJudge("judge-match-1", "match-1", "SUCCESS", "B");

await send(creatorClient, "create_match",
  ["Cinder vs Dune, even draw", "Cinder", "Dune", pages.cinderTie, pages.duneTie],
  "create-match-2", "SUCCESS");
await sendJudge("judge-match-2", "match-2", "SUCCESS", "TIE");

await send(creatorClient, "create_match",
  ["Ember vs Frost, pending", "Ember", "Frost", pages.emberValid, UNREACHABLE],
  "create-match-3", "SUCCESS");
await sendJudge("judge-match-3-unreachable", "match-3", "ERROR", null);
{
  const m = JSON.parse(await throttledRead(reader, ADDRESS, "get_match", ["match-3"]));
  if (m.status !== "PENDING") throw new Error(`match-3 should stay PENDING, got ${m.status}`);
  console.log("match-3 confirmed still PENDING after failed judgment");
}

// ---- Negatives ----
await send(judgeClient, "judge", ["match-0"], "rejudge-match-0", "ERROR");
await send(judgeClient, "judge", ["match-99"], "judge-missing-match", "ERROR");
await send(creatorClient, "create_match",
  ["Bad scheme", "Aurora", "Boreal", "http://example.com/a", pages.borealWeak],
  "create-bad-url-http", "ERROR");
await send(creatorClient, "create_match",
  ["Garbage url", "Aurora", "Boreal", "not-a-url", pages.borealWeak],
  "create-bad-url-garbage", "ERROR");

// ---- Cap: creator already has 4 matches; 28 fillers reach 32, 33rd fails ----
for (let i = 0; i < 28; i++) {
  await send(creatorClient, "create_match",
    [`Filler ${i}`, "Filler", "Dummy", "https://example.com/a", "https://example.com/b"],
    `create-filler-${i}`, "SUCCESS");
}
await send(creatorClient, "create_match",
  ["Over cap", "Filler", "Dummy", "https://example.com/a", "https://example.com/b"],
  "create-cap-33rd", "ERROR");

// ---- Final state snapshot (throttled reads) ----
const counts = JSON.parse(await throttledRead(reader, ADDRESS, "get_counts", []));
const leaderboard = JSON.parse(await throttledRead(reader, ADDRESS, "get_leaderboard", []));
const matches = {};
for (const id of ["match-0", "match-1", "match-2", "match-3"]) {
  matches[id] = JSON.parse(await throttledRead(reader, ADDRESS, "get_match", [id]));
}
const contestants = {};
for (const name of ["aurora", "boreal", "cinder", "dune", "ember", "frost"]) {
  const raw = await throttledRead(reader, ADDRESS, "get_contestant", [name]);
  contestants[name] = raw ? JSON.parse(raw) : null;
}
console.log("counts:", JSON.stringify(counts));
console.log("leaderboard:", JSON.stringify(leaderboard));

writeFileSync(
  new URL("../evidence.json", import.meta.url),
  JSON.stringify(
    {
      network: "Stable Studionet",
      chainId: 61999,
      contractAddress: ADDRESS,
      deployTx: deployment.deployTx,
      sourceSha256: deployment.sourceSha256,
      protocol: "versus-1",
      evidencePages: pages,
      unreachableUrl: UNREACHABLE,
      steps,
      counts,
      leaderboard,
      matches,
      contestants,
      verified: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote evidence.json with ${steps.length} steps`);
