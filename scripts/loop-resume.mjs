import { readFileSync, writeFileSync } from "node:fs";
import {
  makeAccount,
  writeClient,
  readClient,
  pollFinalized,
  throttledRead,
} from "./common.mjs";

// Resumes the verification loop after the first run stopped at the
// unreachable-evidence judgment. The first run's 8 steps are verified by
// fresh reads below (never re-sent), then the remaining steps run:
// negatives, the creator-cap sequence with a dedicated creator account,
// and the final state snapshot.
const deployment = JSON.parse(
  readFileSync(new URL("../evidence/deployment.json", import.meta.url), "utf8"),
);
const ADDRESS = deployment.contractAddress;
const reader = readClient();

const completed = [
  { label: "create-match-0", hash: "0x658c56dc544538692c7c183bfb54c9a7dfaba0c85eca654bcb7feadfb448b0a5", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "judge-match-0 (attempt 1)", hash: "0xdd5af50cdbc5ee5a61fce00795d04a7b19ae256b33cc94c4b072aca83d3db966", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "create-match-1", hash: "0xbcdead53c6751a4bada116148de171687e689c52fbd0d9ab407be06a0fc394a9", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "judge-match-1 (attempt 1)", hash: "0xc1ffcec3f253ba3dba9028bc284b56d9170dbef588db840003680792e0ad824d", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "create-match-2", hash: "0xfc8f546b283d3b50117e3d77c7119b40bcf7a5261477d91afa979130a05bf321", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "judge-match-2 (attempt 1)", hash: "0x171daff50e2366ca205390b280fcca7255ba86e72c3e037df8f4162a28cedea0", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "create-match-3", hash: "0x4165639de4097449d922f67fc4a3d2c0dd68c7f29ec110022bf965cfe25cfcc2", status: "FINALIZED", execution: "SUCCESS", errorPayload: null },
  { label: "judge-match-3-unreachable (attempt 1)", hash: "0xf4fe9c800a7952c736fc4fd7a10a4c2b91e8b9a5c1da32455f0e931420a48732", status: "FINALIZED", execution: "ERROR", errorPayload: "EVIDENCE_UNAVAILABLE" },
];

// Verify the first run's outcomes by fresh reads (no re-sends).
const expected = [
  ["match-0", "JUDGED", "A"],
  ["match-1", "JUDGED", "B"],
  ["match-2", "JUDGED", "TIE"],
  ["match-3", "PENDING", ""],
];
const matches = {};
for (const [id, status, winner] of expected) {
  const m = JSON.parse(await throttledRead(reader, ADDRESS, "get_match", [id]));
  if (m.status !== status || m.winner !== winner) {
    throw new Error(`resume precondition failed for ${id}: ${m.status}/${m.winner}`);
  }
  matches[id] = m;
  console.log(`verified ${id}: ${status}/${winner || "-"}`);
}

const creator = makeAccount();
const judgeCaller = makeAccount();
console.log("resume creator:", creator.address);
console.log("resume judge caller:", judgeCaller.address);
const creatorClient = writeClient(creator);
const judgeClient = writeClient(judgeCaller);

const steps = [...completed];
async function send(client, functionName, args, label, expect) {
  const res = await client.writeContract({ address: ADDRESS, functionName, args, value: 0n });
  const hash = typeof res === "string" ? res : res?.hash ?? String(res);
  const { execution, errorPayload } = await pollFinalized(client, hash, label);
  steps.push({ label, hash, status: "FINALIZED", execution, errorPayload: errorPayload ?? null });
  console.log(`${label}: ${hash} FINALIZED/${execution}`);
  if (expect && execution !== expect) throw new Error(`${label}: expected ${expect}, got ${execution}`);
}

// Negatives (guards fire before any consensus work).
await send(judgeClient, "judge", ["match-0"], "rejudge-match-0", "ERROR");
await send(judgeClient, "judge", ["match-99"], "judge-missing-match", "ERROR");
await send(creatorClient, "create_match",
  ["Bad scheme", "Aurora", "Boreal", "http://example.com/a", "https://example.com/b"],
  "create-bad-url-http", "ERROR");
await send(creatorClient, "create_match",
  ["Garbage url", "Aurora", "Boreal", "not-a-url", "https://example.com/b"],
  "create-bad-url-garbage", "ERROR");

// Cap: dedicated creator creates 32 matches; the 33rd is rejected.
for (let i = 0; i < 32; i++) {
  await send(creatorClient, "create_match",
    [`Filler ${i}`, "Filler", "Dummy", "https://example.com/a", "https://example.com/b"],
    `create-filler-${i}`, "SUCCESS");
}
await send(creatorClient, "create_match",
  ["Over cap", "Filler", "Dummy", "https://example.com/a", "https://example.com/b"],
  "create-cap-33rd", "ERROR");

const counts = JSON.parse(await throttledRead(reader, ADDRESS, "get_counts", []));
const leaderboard = JSON.parse(await throttledRead(reader, ADDRESS, "get_leaderboard", []));
const contestants = {};
for (const name of ["aurora", "boreal", "cinder", "dune", "ember", "frost"]) {
  const raw = await throttledRead(reader, ADDRESS, "get_contestant", [name]);
  contestants[name] = raw ? JSON.parse(raw) : null;
}
console.log("counts:", JSON.stringify(counts));
console.log("leaderboard:", JSON.stringify(leaderboard));

const pages = {
  auroraStrong: matches["match-0"].evidence_a_url,
  borealWeak: matches["match-0"].evidence_b_url,
  auroraWeak: matches["match-1"].evidence_a_url,
  borealStrong: matches["match-1"].evidence_b_url,
  cinderTie: matches["match-2"].evidence_a_url,
  duneTie: matches["match-2"].evidence_b_url,
  emberValid: matches["match-3"].evidence_a_url,
};
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
      unreachableUrl: matches["match-3"].evidence_b_url,
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
