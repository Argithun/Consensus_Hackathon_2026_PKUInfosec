import { ethers } from "ethers";
import { ROUTER_ADDRESS, ROUTER_ABI } from "./contracts";

// ─── Server-side RPC provider ────────────────────────────────────────────────
// Use a plain JSON-RPC provider (no wallet needed) for server-side reads.
// Falls back to local Anvil if NEXT_PUBLIC_RPC_URL is not set.
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

/**
 * Query the Router contract on-chain and return a Set of all token addresses
 * that have been registered (i.e. have a staking pool created via the Router).
 *
 * Returns a lowercased Set<string> for easy lookup.
 * Falls back to an empty set if the RPC URL is missing or the call fails.
 */
export async function getInsuredTokenSet(): Promise<Set<string>> {
  if (!RPC_URL || !ROUTER_ADDRESS || ROUTER_ADDRESS === ethers.ZeroAddress) {
    return new Set();
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);

    const length: bigint = await router.allTokensLength();

    if (length === 0n) return new Set();

    // Batch all tokenAt calls in parallel
    const promises = Array.from({ length: Number(length) }, (_, i) =>
      router.tokenAt(BigInt(i)) as Promise<string>
    );
    const tokens = await Promise.all(promises);

    return new Set(tokens.map((t) => t.toLowerCase()));
  } catch (e) {
    console.error("[insured-tokens] Failed to fetch insured tokens:", e);
    return new Set();
  }
}
