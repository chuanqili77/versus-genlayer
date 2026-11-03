import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readClient, pollFinalized } from "./common.mjs";

// Records an already-finalized deployment (used when the deploy script's
// success gate misread a receipt but the contract itself is live and
// answers get_protocol). Usage: node scripts/verify-deployment.mjs <address> <hash> <deployer>
const [address, hash, deployer] = process.argv.slice(2);
if (!address || !hash || !deployer) throw new Error("usage: verify-deployment.mjs <address> <hash> <deployer>");
const source = readFileSync(new URL("../contracts/versus.py", import.meta.url), "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
const reader = readClient();
await pollFinalized(reader, hash, "deploy");
const protocol = await reader.readContract({ address, functionName: "get_protocol", args: [] });
console.log("get_protocol:", JSON.stringify(protocol));
if (protocol !== "versus-1") throw new Error("contract did not answer versus-1");
mkdirSync(new URL("../evidence", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../evidence/deployment.json", import.meta.url),
  JSON.stringify(
    {
      network: "Stable Studionet",
      chainId: 61999,
      contractAddress: address,
      deployTx: hash,
      deployer,
      sourceSha256: sha256,
      protocol: "versus-1",
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote evidence/deployment.json for", address);
