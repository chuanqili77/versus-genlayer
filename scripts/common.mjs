import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const RPC = "https://studio.genlayer.com/api";
export const CHAIN_ID = 61999;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeAccount() {
  return createAccount(generatePrivateKey());
}

export function writeClient(account) {
  return createClient({ chain: studionet, account });
}

export function readClient() {
  return createClient({ chain: studionet });
}

// Poll a known tx hash to FINALIZED, retrying through transient HTML/RPC
// errors (polling a known hash is idempotent). Returns the tx object.
export async function pollFinalized(client, hash, label) {
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const tx = await client.getTransaction({ hash });
      const st = tx.statusName ?? tx.status;
      if (st === "FINALIZED" || st === 7) {
        // Execution outcome lives on the leader receipt, not on the
        // txExecutionResult fields (those are empty for deploys):
        // result.status "return" = success, anything else ("rollback"
        // for guard failures) = error.
        let execution = "unknown";
        let errorPayload = null;
        try {
          const lr = tx.consensus_data?.leader_receipt;
          if (Array.isArray(lr) && lr[0]?.result) {
            const rstatus = lr[0].result.status;
            if (rstatus === "return") execution = "SUCCESS";
            else if (rstatus) execution = "ERROR";
            const p = lr[0].result.payload;
            errorPayload = p?.readable ?? p ?? null;
          }
        } catch { /* ignore */ }
        if (execution === "unknown") {
          const exec = tx.txExecutionResultName ?? tx.txExecutionResult;
          if (exec === "FINISHED_WITH_RETURN" || exec === 1 || exec === "SUCCESS") execution = "SUCCESS";
          else if (exec === "FINISHED_WITH_ERROR" || exec === 2 || exec === "ERROR") execution = "ERROR";
        }
        return { tx, execution, errorPayload, attempts, ms: Date.now() - started };
      }
      if (st === "CANCELED") {
        throw new Error(`${label}: tx CANCELED`);
      }
    } catch (e) {
      if (e.message?.includes("CANCELED")) throw e;
      // Transient RPC/HTML/not-found: keep polling.
    }
    if (attempts >= 80) throw new Error(`${label}: not FINALIZED after 80 polls`);
    await sleep(15000);
  }
}

// Throttled read (Studionet allows ~30 reads/minute).
export async function throttledRead(client, address, functionName, args = []) {
  await sleep(2500);
  return client.readContract({ address, functionName, args });
}
