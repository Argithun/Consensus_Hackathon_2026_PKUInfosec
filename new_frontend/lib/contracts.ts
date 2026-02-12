import { ethers } from "ethers";

// ─── Contract addresses ─────────────────────────────────────────────────────
// Set via environment variables (NEXT_PUBLIC_ prefix for client-side access).
export const ROUTER_ADDRESS: string =
  process.env.NEXT_PUBLIC_ROUTER_ADDRESS ??
  "0xC1c0E61647A8e09AbD51200D26E9F0d34838Bf72";

// ─── Minimal ABIs (ethers v6 human-readable) ────────────────────────────────

export const ROUTER_ABI = [
  "function stakingByToken(address token) view returns (address)",
  "function tokenByStaking(address staking) view returns (address)",
  "function platform() view returns (address)",
  "function createStaking(address token) returns (address staking)",
  "function createStaking(address token, string name_, string symbol_) returns (address staking)",
  "function allTokensLength() view returns (uint256)",
  "function allStakingsLength() view returns (uint256)",
  "function tokenAt(uint256 index) view returns (address)",
  "function stakingAt(uint256 index) view returns (address)",
];

export const STAKING_ABI = [
  // ── Write ──
  "function openPosition(uint256 tokenAmount, uint256 initialSellPriceX18) returns (uint256 tokenId)",
  "function exitPosition(uint256 tokenId) returns (uint256 refundTokens, uint256 confiscatedTokens, uint256 penaltyEthOut, uint256 exitPenaltyBps)",
  "function claim(uint256 tokenId) returns (uint256 ethAmount)",
  "function buyTokenInternal(uint256 minTokenOut, uint256 deadline, uint256 maxPositions) payable returns (uint256 tokenOut)",
  "function buyTokenExternal(uint256 minTokenOut, uint256 deadline) payable returns (uint256 tokenOut)",
  "function buyTokenMix(uint256 minTokenOut, uint256 deadline, uint256 maxPositions, uint256 ratio) payable returns (uint256 tokenOut)",
  "function getBestBuyRatio(uint256 maxPositions) payable returns (uint256 bestRatio, uint256 bestTokenOut)",
  "function poke(uint256 maxPositions) returns (uint256 processedPositions, uint256 soldTokens, uint256 ownerEthOut)",
  "function syncPosition(uint256 tokenId)",
  // ── Read ──
  "function positionInfo(uint256 tokenId) view returns (tuple(uint256 remainingTokens, uint256 initialSellPriceX18, uint256 lastAutoSellPriceX18, uint256 pendingPenaltyEth, uint256 pendingProceedsEth, uint256 rewardDebtEth, uint64 createdAt, uint32 creationBucket, bool isMature, bool active))",
  "function previewExitPenaltyBps(uint256 tokenId) view returns (uint256 totalPenaltyBps, uint256 timePenaltyBps, uint256 pricePenaltyBps)",
  "function previewStakeScore(uint256 tokenId) view returns (uint256 score, uint256 virtualRemaining)",
  "function activePositionCount() view returns (uint256)",
  "function liquidityPositionCount() view returns (uint256)",
  "function poolAddress() view returns (address)",
  "function memeToken() view returns (address)",
  "function nextTokenId() view returns (uint256)",
  "function maxTotalPenaltyBps() view returns (uint256)",
  // ── ERC-721 (inherited) ──
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  // ── Events (for log filtering) ──
  "event PositionOpened(uint256 indexed tokenId, address indexed owner, uint256 tokenAmount, uint256 initialSellPriceX18)",
  "event PositionExited(uint256 indexed tokenId, address indexed owner, uint256 currentPriceX18, uint256 refundTokens, uint256 confiscatedTokens, uint256 penaltyEthOut, uint256 exitPenaltyBps)",
  "event Claimed(uint256 indexed tokenId, address indexed receiver, uint256 ethAmount)",
];

export const POOL_ABI = [
  "function buy(uint256 minOut, uint256 deadline) payable returns (uint256 amountOut)",
  "function sell(uint256 amountIn, uint256 minOut, uint256 deadline) returns (uint256 amountOut)",
  "function getCurrentPrice() view returns (uint256)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

// ─── Provider / Signer helpers ──────────────────────────────────────────────

export function getProvider(): ethers.BrowserProvider | null {
  if (typeof window === "undefined" || !window.ethereum) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ethers.BrowserProvider(window.ethereum as any);
}

export async function getSigner(): Promise<ethers.JsonRpcSigner | null> {
  const provider = getProvider();
  if (!provider) return null;
  return provider.getSigner();
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

/** Parse a human-readable price string to X18 bigint. e.g. "0.001" → 1000000000000000n */
export function parsePriceX18(input: string): bigint {
  return ethers.parseEther(input);
}

/** Format an X18 price bigint to human-readable string. e.g. 1000000000000000n → "0.001" */
export function formatPriceX18(priceX18: bigint): string {
  return ethers.formatEther(priceX18);
}

/** Parse a token amount string with given decimals. e.g. "100" with 18 decimals */
export function parseTokenAmount(input: string, decimals: number = 18): bigint {
  return ethers.parseUnits(input, decimals);
}

/** Format a token amount bigint with given decimals. */
export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  return ethers.formatUnits(amount, decimals);
}

/** Default deadline: current time + 5 minutes (in seconds). */
export function defaultDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 300);
}
