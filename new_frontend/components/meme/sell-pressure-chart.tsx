"use client";

import * as React from "react";
import { ethers } from "ethers";
import {
  ROUTER_ADDRESS,
  ROUTER_ABI,
  STAKING_ABI,
  POOL_ABI,
  getProvider,
} from "@/lib/contracts";
import { formatNumber } from "@/lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────

type PositionBin = {
  priceLow: number;   // ETH lower bound
  priceHigh: number;  // ETH upper bound
  priceMid: number;   // ETH midpoint (for label)
  totalTokens: number; // tokens that will be sold in this range (xy=k model)
};

type PositionRaw = {
  lastAutoSellPriceX18: bigint;
  remainingTokens: bigint;
  active: boolean;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatEthPrice(v: number): string {
  if (v === 0) return "0";
  return v < 0.00001 ? v.toExponential(2) : v.toFixed(8);
}

/**
 * For a position with sell trigger price `x` and remaining tokens `s`,
 * using an xy=k-like continuous sell model, the tokens sold in price range
 * [p0, p1] (where p0 >= x) is:
 *
 *   amount = sqrt(s^2 * x / p0) - sqrt(s^2 * x / p1)
 *          = s * sqrt(x) * (1/sqrt(p0) - 1/sqrt(p1))
 *
 * If p0 < x, the effective start is x (hasn't started selling yet).
 * If p1 <= x, no contribution.
 */
function positionSellInRange(
  sellPrice: number,  // x: sell trigger price (ETH)
  remaining: number,  // s: remaining tokens
  p0: number,         // bin lower bound
  p1: number,         // bin upper bound
): number {
  if (remaining <= 0 || sellPrice <= 0 || p1 <= sellPrice) return 0;

  const effectiveP0 = Math.max(p0, sellPrice);
  if (effectiveP0 >= p1) return 0;

  const sqrtX = Math.sqrt(sellPrice);
  const amount = remaining * sqrtX * (1 / Math.sqrt(effectiveP0) - 1 / Math.sqrt(p1));
  return Math.max(0, amount);
}

/**
 * Map a price to its log-scale percentage within [chartMin, chartMax].
 * Returns 0–100.
 */
function logPercent(price: number, chartMin: number, chartMax: number): number {
  if (chartMin <= 0 || chartMax <= chartMin || price <= 0) return 0;
  const logMin = Math.log10(chartMin);
  const logMax = Math.log10(chartMax);
  const logRange = logMax - logMin;
  if (logRange === 0) return 0;
  return ((Math.log10(price) - logMin) / logRange) * 100;
}

/**
 * Build histogram bins for sell pressure (logarithmic spacing).
 *
 * X-axis: [minSellPrice, minSellPrice * 10]  (one decade, log-spaced)
 * Each bin accumulates token amounts from all positions using the xy=k model.
 */
function buildBins(positions: PositionRaw[], numBins: number): PositionBin[] {
  const active = positions.filter((p) => p.active && p.remainingTokens > 0n);
  if (active.length === 0) return [];

  const sellPrices = active.map((p) => Number(ethers.formatEther(p.lastAutoSellPriceX18)));
  const minPrice = Math.min(...sellPrices);

  if (minPrice <= 0) return [];

  const chartMin = minPrice;
  const chartMax = minPrice * 10;

  // Logarithmic bin boundaries: chartMin * 10^(i/numBins)
  const logMin = Math.log10(chartMin);
  const logStep = 1 / numBins; // total log range is 1 decade

  const bins: PositionBin[] = Array.from({ length: numBins }, (_, i) => {
    const low = Math.pow(10, logMin + logStep * i);
    const high = Math.pow(10, logMin + logStep * (i + 1));
    return {
      priceLow: low,
      priceHigh: high,
      priceMid: Math.pow(10, logMin + logStep * (i + 0.5)),
      totalTokens: 0,
    };
  });

  // For each active position, compute its contribution to every bin
  for (const pos of active) {
    const x = Number(ethers.formatEther(pos.lastAutoSellPriceX18));
    const s = Number(ethers.formatUnits(pos.remainingTokens, 18));
    if (x <= 0 || s <= 0) continue;

    for (const bin of bins) {
      bin.totalTokens += positionSellInRange(x, s, bin.priceLow, bin.priceHigh);
    }
  }

  return bins;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function SellPressureChart({
  tokenAddress,
  bins: numBins = 20,
}: {
  tokenAddress: string;
  bins?: number;
}) {
  const [data, setData] = React.useState<PositionBin[]>([]);
  const [currentPriceEth, setCurrentPriceEth] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const provider = getProvider();
        if (!provider) {
          setError("Wallet not connected");
          setLoading(false);
          return;
        }

        // 1. Resolve staking address via Router
        const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
        const stakingAddress: string = await router.stakingByToken(tokenAddress);
        if (!stakingAddress || stakingAddress === ethers.ZeroAddress) {
          setError("No staking pool deployed");
          setLoading(false);
          return;
        }

        const staking = new ethers.Contract(stakingAddress, STAKING_ABI, provider);

        // 2. Get pool current price
        try {
          const poolAddr: string = await staking.poolAddress();
          if (poolAddr && poolAddr !== ethers.ZeroAddress) {
            const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
            const priceX18: bigint = await pool.getCurrentPrice();
            if (!cancelled) setCurrentPriceEth(Number(ethers.formatEther(priceX18)));
          }
        } catch {
          /* pool price optional */
        }

        // 3. Enumerate all positions
        const nextId: bigint = await staking.nextTokenId();
        if (nextId === 0n) {
          if (!cancelled) {
            setData([]);
            setLoading(false);
          }
          return;
        }

        // Batch fetch position info (parallel, in chunks)
        const CHUNK = 50;
        const allPositions: PositionRaw[] = [];

        for (let start = 0n; start < nextId; start += BigInt(CHUNK)) {
          const end = start + BigInt(CHUNK) < nextId ? start + BigInt(CHUNK) : nextId;
          const promises: Promise<PositionRaw | null>[] = [];

          for (let id = start; id < end; id++) {
            promises.push(
              staking.positionInfo(id).then((info: Record<string, bigint | boolean>) => ({
                lastAutoSellPriceX18: (info.lastAutoSellPriceX18 ?? info[2]) as bigint,
                remainingTokens: (info.remainingTokens ?? info[0]) as bigint,
                active: (info.active ?? info[9]) as boolean,
              })).catch(() => null)
            );
          }

          const results = await Promise.all(promises);
          for (const r of results) {
            if (r) allPositions.push(r);
          }
        }

        if (!cancelled) {
          setData(buildBins(allPositions, numBins));
        }
      } catch (e) {
        console.error("[sell-pressure-chart] Failed:", e);
        if (!cancelled) setError("Failed to load position data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tokenAddress, numBins]);

  const maxTokens = React.useMemo(() => Math.max(0, ...data.map((d) => d.totalTokens)), [data]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="rounded-xl border bg-background/40 p-6 text-sm text-muted-foreground animate-pulse">
        Loading sell pressure data from on-chain positions&hellip;
      </div>
    );
  }

  // ── Error / empty states ──
  if (error) {
    return (
      <div className="rounded-xl border bg-background/40 p-6 text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-xl border bg-background/40 p-6 text-sm text-muted-foreground">
        No active staking positions — sell pressure chart will appear once positions are opened.
      </div>
    );
  }

  // ── Compute current-price marker position (log scale) ──
  const chartMin = data[0].priceLow;
  const chartMax = data[data.length - 1].priceHigh;
  let currentPricePercent: number | null = null;
  if (currentPriceEth !== null && chartMin > 0 && chartMax > chartMin) {
    const pct = logPercent(currentPriceEth, chartMin, chartMax);
    if (pct >= -5 && pct <= 105) currentPricePercent = Math.max(0, Math.min(100, pct));
  }

  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Sell Pressure Distribution</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Projected token sell volume per price range (xy=k continuous sell model).
            Range: lowest trigger → 10× lowest trigger.
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground space-y-0.5">
          <div>Peak: <span className="font-medium text-foreground">{formatNumber(maxTokens)} tokens</span></div>
          {currentPriceEth !== null && (
            <div>Market: <span className="font-medium text-foreground">{formatEthPrice(currentPriceEth)} ETH</span></div>
          )}
        </div>
      </div>

      {/* ── Bar chart ── */}
      <div className="relative mt-4">
        <div
          className="grid gap-[2px] items-end h-44"
          style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
        >
          {data.map((d, i) => {
            const h = maxTokens === 0 ? 0 : Math.max(d.totalTokens > 0 ? 2 : 0, Math.round((d.totalTokens / maxTokens) * 176));
            const isCurrentBin =
              currentPriceEth !== null &&
              currentPriceEth >= d.priceLow &&
              currentPriceEth < d.priceHigh;
            return (
              <div key={i} className="group relative h-full flex items-end">
                <div
                  className={`w-full rounded-sm border ${
                    isCurrentBin
                      ? "bg-gradient-to-t from-amber-500/80 to-amber-400/40 border-amber-500/40"
                      : "bg-gradient-to-t from-rose-600/70 to-rose-400/30 border-rose-500/20"
                  }`}
                  style={{ height: `${h}px` }}
                />
                {/* Tooltip */}
                <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="rounded-md border bg-background px-2.5 py-1.5 shadow-sm text-[11px] whitespace-nowrap">
                    <div className="text-muted-foreground">Price Range</div>
                    <div className="font-medium">
                      {formatEthPrice(d.priceLow)} — {formatEthPrice(d.priceHigh)} ETH
                    </div>
                    <div className="mt-1 text-muted-foreground">Sell Volume</div>
                    <div className="font-medium">{formatNumber(d.totalTokens)} tokens</div>
                    <div className="mt-1 text-muted-foreground">Est. ETH Volume</div>
                    <div className="font-medium">{formatEthPrice(d.priceLow * d.totalTokens)} ETH</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Current price marker line ── */}
        {currentPricePercent !== null && (
          <div
            className="absolute top-0 h-44 w-px bg-amber-500 pointer-events-none"
            style={{ left: `${currentPricePercent}%` }}
          >
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
              Market Price
            </div>
          </div>
        )}
      </div>

      {/* ── X-axis labels ── */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatEthPrice(chartMin)} ETH</span>
        {data.length > 2 && (
          <span>{formatEthPrice((chartMin + chartMax) / 2)} ETH</span>
        )}
        <span>{formatEthPrice(chartMax)} ETH</span>
      </div>

      {/* ── Legend ── */}
      <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-rose-600/70 to-rose-400/30 border border-rose-500/20" />
          <span>Sell pressure</span>
        </div>
        {currentPriceEth !== null && (
          <div className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-amber-500/80 to-amber-400/40 border border-amber-500/40" />
            <span>Market price bin</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default SellPressureChart;
