import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeAccount, writeClient, readClient, pollFinalized } from "./common.mjs";

const source = readFileSync(new URL("../contracts/versus.py", import.meta.url), "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");

const deployer = makeAccount();
console.log("deployer:", deployer.address);
const client = writeClient(deployer);

const hash = await client.deployContract({ code: source });
console.log("deploy hash:", hash);
const { tx, execution } = await pollFinalized(client, hash, "deploy");
const address = tx.data?.contract_address ?? tx.to_address;
console.log("status: FINALIZED execution:", execution);
console.log("contract:", address);
if (!address) throw new Error("no contract address in deploy receipt");
// A deploy's success is proven by reading the contract, not by the
// receipt's execution fields (those are empty for deploys).
const reader = readClient();
let protocol = null;
for (let i = 0; i < 10; i++) {
  try {
    protocol = await reader.readContract({ address, functionName: "get_protocol", args: [] });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 5000));
  }
}
console.log("get_protocol:", JSON.stringify(protocol));
if (protocol !== "versus-1") throw new Error("deployed contract did not answer versus-1");

mkdirSync(new URL("../evidence", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../evidence/deployment.json", import.meta.url),
  JSON.stringify(
    {
      network: "Stable Studionet",
      chainId: 61999,
      contractAddress: address,
      deployTx: hash,
      deployer: deployer.address,
      sourceSha256: sha256,
      protocol: "versus-1",
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote evidence/deployment.json");
