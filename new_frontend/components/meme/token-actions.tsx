"use client";

import * as React from "react";
import { ethers } from "ethers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { shortAddress, formatNumber } from "@/lib/format";
import { useWallet } from "@/components/wallet/wallet-provider";
import {
  ROUTER_ADDRESS,
  ROUTER_ABI,
  STAKING_ABI,
  POOL_ABI,
  ERC20_ABI,
  getProvider,
  getSigner,
  formatPriceX18,
  defaultDeadline,
} from "@/lib/contracts";

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab = "BUY" | "SELL" | "STAKE";

type PositionData = {
  tokenId: bigint;
  remainingTokens: bigint;
  initialSellPriceX18: bigint;
  lastAutoSellPriceX18: bigint;
  pendingPenaltyEth: bigint;
  pendingProceedsEth: bigint;
  createdAt: bigint;
  isMature: boolean;
  active: boolean;
  totalPenaltyBps?: bigint;
  stakeScore?: bigint;
};

interface TokenActionsProps {
  symbol: string;
  tokenAddress: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TokenActions({ symbol, tokenAddress }: TokenActionsProps) {
  const { isHydrated, hasProvider, account, chainId, isConnecting, error, connect } = useWallet();

  // Tab
  const [tab, setTab] = React.useState<Tab>("BUY");

  // Contract discovery
  const [stakingAddress, setStakingAddress] = React.useState<string | null>(null);
  const [poolAddress, setPoolAddress] = React.useState<string | null>(null);
  const [contractsLoading, setContractsLoading] = React.useState(false);
  const [contractError, setContractError] = React.useState<string | null>(null);

  // Price & balance
  const [currentPriceX18, setCurrentPriceX18] = React.useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = React.useState<bigint | null>(null);
  const [tokenDecimals, setTokenDecimals] = React.useState(18);

  // Transaction state
  const [isLoading, setIsLoading] = React.useState(false);
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [txError, setTxError] = React.useState<string | null>(null);
  const [txSuccess, setTxSuccess] = React.useState<string | null>(null);

  // Buy
  const [buyAmountEth, setBuyAmountEth] = React.useState("");
  const [platformBuyEstimate, setPlatformBuyEstimate] = React.useState<bigint | null>(null);
  const [robinpumpBuyEstimate, setRobinpumpBuyEstimate] = React.useState<bigint | null>(null);
  const [bestBuyRatio, setBestBuyRatio] = React.useState<bigint | null>(null);
  const [platformBuyError, setPlatformBuyError] = React.useState<string | null>(null);
  const [estimatesLoading, setEstimatesLoading] = React.useState(false);

  // Sell
  const [sellAmountToken, setSellAmountToken] = React.useState("");
  const [sellAllowance, setSellAllowance] = React.useState<bigint>(0n);
  const [sellEstimateEth, setSellEstimateEth] = React.useState<bigint | null>(null);
  const [sellEstimateLoading, setSellEstimateLoading] = React.useState(false);

  // Stake
  const [stakeAmount, setStakeAmount] = React.useState("");
  const [stakeSellPrice, setStakeSellPrice] = React.useState("");
  const [stakePriceMode, setStakePriceMode] = React.useState<"absolute" | "multiplier">("absolute");
  const [stakeMultiplier, setStakeMultiplier] = React.useState("");
  const [stakeAllowance, setStakeAllowance] = React.useState<bigint>(0n);

  // Positions
  const [positions, setPositions] = React.useState<PositionData[]>([]);
  const [positionsLoading, setPositionsLoading] = React.useState(false);

  // Exit confirmation dialog
  const [exitDialogOpen, setExitDialogOpen] = React.useState(false);
  const [exitTokenId, setExitTokenId] = React.useState<bigint | null>(null);
  const [exitPreview, setExitPreview] = React.useState<{
    penaltyBps: number;
    remainingTokens: bigint;
    confiscatedTokens: bigint;
    penaltyEth: bigint;
  } | null>(null);
  const [exitPreviewLoading, setExitPreviewLoading] = React.useState(false);

  // Chain display
  const chainText = React.useMemo(() => {
    const cid = chainId ?? "";
    if (!cid) return "unknown";
    const n = Number.parseInt(cid, 16);
    return Number.isFinite(n) ? String(n) : cid;
  }, [chainId]);

  const clearTx = React.useCallback(() => {
    setTxHash(null);
    setTxError(null);
    setTxSuccess(null);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════════════════════════════════════

  // Load staking & pool addresses from Router
  React.useEffect(() => {
    if (!account || !tokenAddress) return;
    if (ROUTER_ADDRESS === ethers.ZeroAddress) {
      setContractError("Router address not configured");
      return;
    }

    let cancelled = false;
    const load = async () => {
      setContractsLoading(true);
      setContractError(null);
      try {
        const provider = getProvider();
        if (!provider) throw new Error("No provider");

        const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
        const sAddr: string = await router.stakingByToken(tokenAddress);

        if (cancelled) return;

        if (!sAddr || sAddr === ethers.ZeroAddress) {
          if (!cancelled) {
            setStakingAddress(null);
            setPoolAddress(null);
            setContractError("No staking pool for this token yet.");
          }
          return;
        }

        if (!cancelled) {
          setStakingAddress(sAddr);
        }

        const staking = new ethers.Contract(sAddr, STAKING_ABI, provider);
        const pAddr: string = await staking.poolAddress();
        if (!cancelled) {
          setPoolAddress(!pAddr || pAddr === ethers.ZeroAddress ? null : pAddr);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setContractError(
            e instanceof Error ? e.message : "Failed to load contract addresses"
          );
        }
      } finally {
        if (!cancelled) setContractsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [account, tokenAddress]);

  // Load token balance, decimals, price, allowances
  const refreshBalancesAndPrice = React.useCallback(async () => {
    if (!account || !tokenAddress) return;
    const provider = getProvider();
    if (!provider) return;

    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [balance, decimals] = await Promise.all([
        token.balanceOf(account) as Promise<bigint>,
        (token.decimals() as Promise<bigint>).catch(() => 18n),
      ]);
      setTokenBalance(balance);
      setTokenDecimals(Number(decimals));
    } catch {
      /* ignore */
    }

    // Price
    if (poolAddress && poolAddress !== ethers.ZeroAddress) {
      try {
        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
        const price: bigint = await pool.getCurrentPrice();
        setCurrentPriceX18(price);
      } catch {
        /* pool may not be live yet */
      }
    }

    // Sell allowance (pool)
    if (poolAddress && poolAddress !== ethers.ZeroAddress) {
      try {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const a: bigint = await token.allowance(account, poolAddress);
        setSellAllowance(a);
      } catch {
        /* ignore */
      }
    }

    // Stake allowance (staking)
    if (stakingAddress && stakingAddress !== ethers.ZeroAddress) {
      try {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const a: bigint = await token.allowance(account, stakingAddress);
        setStakeAllowance(a);
      } catch {
        /* ignore */
      }
    }
  }, [account, tokenAddress, poolAddress, stakingAddress]);

  React.useEffect(() => {
    refreshBalancesAndPrice();
  }, [refreshBalancesAndPrice]);

  // Fetch buy estimates from both sources (debounced)
  React.useEffect(() => {
    setPlatformBuyEstimate(null);
    setRobinpumpBuyEstimate(null);
    setBestBuyRatio(null);
    setPlatformBuyError(null);

    if (!buyAmountEth || Number(buyAmountEth) <= 0 || !account) return;
    if (!poolAddress && !stakingAddress) return;

    const timer = setTimeout(async () => {
      setEstimatesLoading(true);
      const provider = getProvider();
      if (!provider) { setEstimatesLoading(false); return; }

      try {
        const ethAmount = ethers.parseEther(buyAmountEth);
        const deadline = defaultDeadline();

        // RobinPump pool estimate (staticCall on pool.buy — 100% external)
        if (poolAddress) {
          try {
            const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
            const amountOut: bigint = await pool.buy.staticCall(0n, deadline, {
              value: ethAmount,
              from: account,
            });
            setRobinpumpBuyEstimate(amountOut);
          } catch {
            if (currentPriceX18 && currentPriceX18 > 0n) {
              setRobinpumpBuyEstimate((ethAmount * ethers.WeiPerEther) / currentPriceX18);
            }
          }
        }

        // Platform aggregator estimate (getBestBuyRatio — finds optimal mix)
        if (stakingAddress) {
          try {
            const staking = new ethers.Contract(stakingAddress, STAKING_ABI, provider);
            const result = await staking.getBestBuyRatio.staticCall(
              100n,
              { value: ethAmount, from: account },
            );
            const ratio: bigint = result.bestRatio ?? result[0];
            const tokenOut: bigint = result.bestTokenOut ?? result[1];
            setPlatformBuyEstimate(tokenOut);
            setBestBuyRatio(ratio);
            setPlatformBuyError(null);
          } catch {
            setPlatformBuyEstimate(null);
            setBestBuyRatio(null);
            setPlatformBuyError("Insufficient liquidity");
          }
        }
      } catch {
        // parse error — ignore
      } finally {
        setEstimatesLoading(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timer);
  }, [buyAmountEth, account, poolAddress, stakingAddress, currentPriceX18]);

  // Fetch sell estimate via staticCall (debounced)
  React.useEffect(() => {
    setSellEstimateEth(null);

    if (!sellAmountToken || Number(sellAmountToken) <= 0 || !account || !poolAddress) return;

    const timer = setTimeout(async () => {
      setSellEstimateLoading(true);
      const provider = getProvider();
      if (!provider) { setSellEstimateLoading(false); return; }

      try {
        const amount = ethers.parseUnits(sellAmountToken, tokenDecimals);
        const deadline = defaultDeadline();
        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
        const ethOut: bigint = await pool.sell.staticCall(amount, 0n, deadline, {
          from: account,
        });
        setSellEstimateEth(ethOut);
      } catch {
        // Fallback: simple price-based estimate
        if (currentPriceX18 && currentPriceX18 > 0n) {
          try {
            const tokenWei = ethers.parseUnits(sellAmountToken, tokenDecimals);
            setSellEstimateEth((tokenWei * currentPriceX18) / ethers.WeiPerEther);
          } catch {
            /* ignore */
          }
        }
      } finally {
        setSellEstimateLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [sellAmountToken, account, poolAddress, tokenDecimals, currentPriceX18]);

  // Load user positions (STAKE tab)
  const loadPositions = React.useCallback(async (signal?: { cancelled: boolean }) => {
    if (!account || !stakingAddress) return;
    setPositionsLoading(true);

    try {
      const provider = getProvider();
      if (!provider) return;

      const staking = new ethers.Contract(stakingAddress, STAKING_ABI, provider);
      const nextId: bigint = await staking.nextTokenId();

      if (signal?.cancelled) return;

      const found: PositionData[] = [];
      for (let id = 1n; id < nextId; id++) {
        if (signal?.cancelled) return;
        try {
          const owner: string = await staking.ownerOf(id);
          if (owner.toLowerCase() !== account.toLowerCase()) continue;

          const info = await staking.positionInfo(id);
          if (!info.active) continue;

          let totalPenaltyBps: bigint | undefined;
          let stakeScore: bigint | undefined;

          try {
            const penalty = await staking.previewExitPenaltyBps(id);
            totalPenaltyBps = penalty.totalPenaltyBps ?? penalty[0];
          } catch {
            /* may revert if pool not set */
          }

          try {
            const score = await staking.previewStakeScore(id);
            stakeScore = score.score ?? score[0];
          } catch {
            /* may revert */
          }

          found.push({
            tokenId: id,
            remainingTokens: info.remainingTokens ?? info[0],
            initialSellPriceX18: info.initialSellPriceX18 ?? info[1],
            lastAutoSellPriceX18: info.lastAutoSellPriceX18 ?? info[2],
            pendingPenaltyEth: info.pendingPenaltyEth ?? info[3],
            pendingProceedsEth: info.pendingProceedsEth ?? info[4],
            createdAt: info.createdAt ?? info[6],
            isMature: info.isMature ?? info[8],
            active: info.active ?? info[9],
            totalPenaltyBps,
            stakeScore,
          });
        } catch {
          // Burned / non-existent token — skip
          continue;
        }
      }

      if (!signal?.cancelled) {
        setPositions(found);
      }
    } catch (e) {
      if (!signal?.cancelled) {
        console.error("Failed to load positions:", e);
      }
    } finally {
      if (!signal?.cancelled) {
        setPositionsLoading(false);
      }
    }
  }, [account, stakingAddress]);

  React.useEffect(() => {
    if (tab === "STAKE" && account && stakingAddress) {
      const signal = { cancelled: false };
      loadPositions(signal);
      return () => { signal.cancelled = true; };
    }
  }, [tab, account, stakingAddress, loadPositions]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════════════════

  /** Buy tokens from RobinPump pool with ETH */
  const handleBuyFromPool = async () => {
    if (!poolAddress || !buyAmountEth) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
      const ethAmount = ethers.parseEther(buyAmountEth);
      const deadline = defaultDeadline();
      const tx = await pool.buy(0n, deadline, { value: ethAmount });
      setTxHash(tx.hash);
      await tx.wait();
      setTxSuccess(`Successfully bought ${symbol} from RobinPump!`);
      setBuyAmountEth("");
      await refreshBalancesAndPrice();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Transaction failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Buy tokens via aggregator (buyTokenMix) using optimal ratio from getBestBuyRatio */
  const handleBuyFromStaking = async () => {
    if (!stakingAddress || !buyAmountEth) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const staking = new ethers.Contract(stakingAddress, STAKING_ABI, signer);
      const ethAmount = ethers.parseEther(buyAmountEth);
      const deadline = defaultDeadline();
      const ratio = bestBuyRatio ?? 50n;
      const tx = await staking.buyTokenMix(0n, deadline, 100n, ratio, { value: ethAmount });
      setTxHash(tx.hash);
      await tx.wait();
      setTxSuccess(`Successfully bought ${symbol} via aggregator (ratio: ${ratio.toString()}% internal)!`);
      setBuyAmountEth("");
      await refreshBalancesAndPrice();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Transaction failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Approve pool to spend tokens (for selling) */
  const handleApproveSell = async () => {
    if (!poolAddress || !tokenAddress) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await token.approve(poolAddress, ethers.MaxUint256);
      setTxHash(tx.hash);
      await tx.wait();
      setSellAllowance(ethers.MaxUint256);
      setTxSuccess("Approved for selling!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Approve failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Sell tokens through pool */
  const handleSell = async () => {
    if (!poolAddress || !sellAmountToken) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
      const amount = ethers.parseUnits(sellAmountToken, tokenDecimals);
      const deadline = defaultDeadline();
      const tx = await pool.sell(amount, 0n, deadline);
      setTxHash(tx.hash);
      await tx.wait();
      setTxSuccess(`Successfully sold ${sellAmountToken} ${symbol}!`);
      setSellAmountToken("");
      await refreshBalancesAndPrice();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Sell failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Approve staking contract to spend tokens */
  const handleApproveStake = async () => {
    if (!stakingAddress || !tokenAddress) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await token.approve(stakingAddress, ethers.MaxUint256);
      setTxHash(tx.hash);
      await tx.wait();
      setStakeAllowance(ethers.MaxUint256);
      setTxSuccess("Approved for staking!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Approve failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Open a staking position */
  const handleOpenPosition = async () => {
    const finalPrice = effectiveSellPrice;
    if (!stakingAddress || !stakeAmount || !finalPrice || Number(finalPrice) <= 0) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const staking = new ethers.Contract(stakingAddress, STAKING_ABI, signer);
      const amount = ethers.parseUnits(stakeAmount, tokenDecimals);
      const sellPriceX18 = ethers.parseEther(finalPrice);

      const tx = await staking.openPosition(amount, sellPriceX18);
      setTxHash(tx.hash);
      await tx.wait();
      const displayPrice = Number(finalPrice) < 0.00001
        ? Number(finalPrice).toExponential(4)
        : Number(finalPrice);
      setTxSuccess(
        `Position opened! Staked ${stakeAmount} ${symbol} with sell trigger at ${displayPrice} ETH`
      );
      setStakeAmount("");
      setStakeSellPrice("");
      setStakeMultiplier("");
      await refreshBalancesAndPrice();
      loadPositions();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Open position failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Open exit confirmation dialog and fetch preview via staticCall */
  const handleRequestExit = async (tokenId: bigint) => {
    if (!stakingAddress) return;
    setExitTokenId(tokenId);
    setExitPreview(null);
    setExitPreviewLoading(true);
    setExitDialogOpen(true);

    try {
      const signer = await getSigner();
      if (!signer) return;
      const staking = new ethers.Contract(stakingAddress, STAKING_ABI, signer);

      // Simulate exitPosition to get exact confiscated amounts
      const result = await staking.exitPosition.staticCall(tokenId);
      const refundTokens: bigint = result.refundTokens ?? result[0];
      const confiscatedTokens: bigint = result.confiscatedTokens ?? result[1];
      const penaltyEthOut: bigint = result.penaltyEthOut ?? result[2];
      const exitPenaltyBps: bigint = result.exitPenaltyBps ?? result[3];

      // Find position to get remainingTokens
      const pos = positions.find((p) => p.tokenId === tokenId);

      setExitPreview({
        penaltyBps: Number(exitPenaltyBps),
        remainingTokens: pos?.remainingTokens ?? (refundTokens + confiscatedTokens),
        confiscatedTokens,
        penaltyEth: penaltyEthOut,
      });
    } catch (e) {
      console.error("[exit-preview] staticCall failed:", e);
      // Fallback: use penalty bps from position data
      const pos = positions.find((p) => p.tokenId === tokenId);
      if (pos && pos.totalPenaltyBps !== undefined) {
        const confiscated =
          (pos.remainingTokens * pos.totalPenaltyBps) / 10000n;
        setExitPreview({
          penaltyBps: Number(pos.totalPenaltyBps),
          remainingTokens: pos.remainingTokens,
          confiscatedTokens: confiscated,
          penaltyEth: 0n, // unknown without simulation
        });
      }
    } finally {
      setExitPreviewLoading(false);
    }
  };

  /** Actually execute exit after user confirms */
  const handleConfirmExit = async () => {
    if (!stakingAddress || exitTokenId === null) return;
    setExitDialogOpen(false);
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const staking = new ethers.Contract(stakingAddress, STAKING_ABI, signer);
      const tx = await staking.exitPosition(exitTokenId);
      setTxHash(tx.hash);
      await tx.wait();
      setTxSuccess(`Position #${exitTokenId.toString()} exited successfully!`);
      await refreshBalancesAndPrice();
      loadPositions();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Exit failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
      setExitTokenId(null);
      setExitPreview(null);
    }
  };

  /** Claim pending ETH rewards from a position */
  const handleClaim = async (tokenId: bigint) => {
    if (!stakingAddress) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const staking = new ethers.Contract(stakingAddress, STAKING_ABI, signer);
      const tx = await staking.claim(tokenId);
      setTxHash(tx.hash);
      await tx.wait();
      setTxSuccess(`Claimed rewards from position #${tokenId.toString()}!`);
      await refreshBalancesAndPrice();
      loadPositions();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Claim failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Create a staking pool for this token (via Router) */
  const handleCreateStaking = async () => {
    if (!tokenAddress || ROUTER_ADDRESS === ethers.ZeroAddress) return;
    clearTx();
    setIsLoading(true);

    try {
      const signer = await getSigner();
      if (!signer) throw new Error("No signer available");

      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
      const tx = await router["createStaking(address)"](tokenAddress);
      setTxHash(tx.hash);
      await tx.wait();
      setTxSuccess("Staking pool created!");

      // Refresh contract addresses
      const provider = getProvider();
      if (provider) {
        const routerRead = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
        const sAddr: string = await routerRead.stakingByToken(tokenAddress);
        setStakingAddress(sAddr);
        setContractError(null);

        const staking = new ethers.Contract(sAddr, STAKING_ABI, provider);
        const pAddr: string = await staking.poolAddress();
        setPoolAddress(!pAddr || pAddr === ethers.ZeroAddress ? null : pAddr);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { reason?: string }).reason || e.message : "Create staking failed";
      setTxError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Computed display values
  // ═══════════════════════════════════════════════════════════════════════════

  const formattedPrice = React.useMemo(() => {
    if (!currentPriceX18) return null;
    return formatPriceX18(currentPriceX18);
  }, [currentPriceX18]);

  const formattedBalance = React.useMemo(() => {
    if (tokenBalance === null) return null;
    return ethers.formatUnits(tokenBalance, tokenDecimals);
  }, [tokenBalance, tokenDecimals]);

  const needsSellApproval = React.useMemo(() => {
    if (!sellAmountToken || !poolAddress) return false;
    try {
      const amount = ethers.parseUnits(sellAmountToken, tokenDecimals);
      return sellAllowance < amount;
    } catch {
      return false;
    }
  }, [sellAmountToken, sellAllowance, tokenDecimals, poolAddress]);

  const needsStakeApproval = React.useMemo(() => {
    if (!stakeAmount || !stakingAddress) return false;
    try {
      const amount = ethers.parseUnits(stakeAmount, tokenDecimals);
      return stakeAllowance < amount;
    } catch {
      return false;
    }
  }, [stakeAmount, stakeAllowance, tokenDecimals, stakingAddress]);

  /** Computed sell price from multiplier mode */
  const computedSellPriceFromMultiplier = React.useMemo(() => {
    if (!currentPriceX18 || !stakeMultiplier || Number(stakeMultiplier) <= 0) return null;
    try {
      // multiplier can be a decimal like 1.5, 2.3 etc.
      // We compute: currentPriceX18 * multiplier / 1
      // Use fixed-point: multiply by (multiplier * 1000) then divide by 1000
      const mult = Math.round(Number(stakeMultiplier) * 10000);
      const result = (currentPriceX18 * BigInt(mult)) / 10000n;
      return result;
    } catch {
      return null;
    }
  }, [currentPriceX18, stakeMultiplier]);

  /** The effective sell price used for the transaction */
  const effectiveSellPrice = React.useMemo(() => {
    if (stakePriceMode === "multiplier") {
      return computedSellPriceFromMultiplier
        ? ethers.formatEther(computedSellPriceFromMultiplier)
        : "";
    }
    return stakeSellPrice;
  }, [stakePriceMode, stakeSellPrice, computedSellPriceFromMultiplier]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <Card className="bg-background/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-3">
          <span>Trade &amp; Stake</span>
          <Badge variant="secondary" className="font-normal">
            {symbol}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* ── Wallet connection states ── */}
        {!isHydrated ? (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Loading wallet&hellip;</div>
            <Button type="button" variant="outline" disabled className="w-full">
              Wallet&hellip;
            </Button>
          </div>
        ) : !hasProvider ? (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              No injected wallet found. Install MetaMask to trade.
            </div>
            <Button asChild variant="outline" className="w-full">
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer noopener">
                Install MetaMask
              </a>
            </Button>
          </div>
        ) : !account ? (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Connect your wallet to enable trading &amp; staking.
            </div>
            <Button onClick={connect} disabled={isConnecting} className="w-full">
              {isConnecting ? "Connecting\u2026" : "Connect Wallet"}
            </Button>
            {error ? <div className="text-xs text-muted-foreground">{error}</div> : null}
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Wallet info ── */}
            <div className="rounded-lg border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">Connected</div>
              <div className="mt-1 font-mono text-sm">{shortAddress(account)}</div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Chain: {chainText}</span>
                {formattedBalance !== null && (
                  <span>
                    Balance: {formatNumber(Number(formattedBalance))} {symbol}
                  </span>
                )}
              </div>
              {formattedPrice && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Current Price: {Number(formattedPrice) < 0.00001
                    ? Number(formattedPrice).toExponential(4)
                    : Number(formattedPrice).toFixed(8)}{" "}
                  ETH
                </div>
              )}
            </div>

            {/* ── Contract loading state ── */}
            {contractsLoading && (
              <div className="text-xs text-muted-foreground animate-pulse">
                Discovering contracts&hellip;
              </div>
            )}

            {/* ── Transaction feedback ── */}
            {txHash && (
              <div className="rounded-lg border bg-background/60 p-2 text-xs break-all">
                <span className="text-muted-foreground">Tx: </span>
                <span className="font-mono">{shortAddress(txHash, 10, 8)}</span>
              </div>
            )}
            {txError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive break-all">
                {txError}
              </div>
            )}
            {txSuccess && (
              <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-2 text-xs text-green-600 dark:text-green-400">
                {txSuccess}
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* Deploy Pool panel (when no staking contract exists)          */}
            {/* ════════════════════════════════════════════════════════════ */}
            {!contractsLoading && !stakingAddress && (
              <div className="space-y-3 rounded-lg border border-dashed bg-background/30 p-4">
                <div className="text-sm font-medium text-center">
                  No insurance pool deployed for {symbol}
                </div>
                <div className="text-xs text-muted-foreground text-center">
                  Deploy an insurance staking pool for this token via the Router contract.
                  Once deployed, you can buy, sell, and stake.
                </div>
                {ROUTER_ADDRESS !== ethers.ZeroAddress ? (
                  <Button
                    type="button"
                    onClick={handleCreateStaking}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading ? "Deploying\u2026" : "Deploy Pool"}
                  </Button>
                ) : (
                  <div className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    Router address not configured.
                  </div>
                )}
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* Trade & Stake panels (when staking contract exists)          */}
            {/* ════════════════════════════════════════════════════════════ */}
            {stakingAddress && (
              <>
                {/* ── Tab switcher ── */}
                <div className="grid grid-cols-3 gap-2">
                  {(["BUY", "SELL", "STAKE"] as Tab[]).map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={tab === t ? "default" : "outline"}
                      onClick={() => {
                        setTab(t);
                        clearTx();
                      }}
                    >
                      {t === "BUY" ? "Buy" : t === "SELL" ? "Sell" : "Stake"}
                    </Button>
                  ))}
                </div>

                {/* ════════════════════════════════════════════════════════ */}
                {/* BUY panel                                                */}
                {/* ════════════════════════════════════════════════════════ */}
                {tab === "BUY" && (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Buy {symbol} with ETH — compare two sources below
                    </div>
                    <Input
                      inputMode="decimal"
                      placeholder="ETH amount (e.g. 0.01)"
                      value={buyAmountEth}
                      onChange={(e) => setBuyAmountEth(e.target.value)}
                      disabled={isLoading}
                    />

                    {/* ── Estimate comparison ── */}
                    {buyAmountEth && Number(buyAmountEth) > 0 && (
                      <div className="space-y-2">
                        {estimatesLoading && (
                          <div className="text-xs text-muted-foreground animate-pulse">
                            Fetching estimates&hellip;
                          </div>
                        )}

                        {/* Aggregator (optimal mix) estimate */}
                        <div className="rounded-lg border bg-background/30 p-3 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px]">
                              Aggregator
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">Optimal route via Insurance Staking</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {platformBuyEstimate !== null
                              ? `≈ ${formatNumber(Number(ethers.formatUnits(platformBuyEstimate, tokenDecimals)))} ${symbol}`
                              : platformBuyError
                                ? <span className="text-amber-600 dark:text-amber-400 font-normal text-xs">{platformBuyError}</span>
                                : <span className="text-muted-foreground font-normal text-xs">Enter amount to estimate</span>
                            }
                          </div>
                          {platformBuyEstimate !== null && platformBuyEstimate > 0n && (
                            <div className="text-[11px] text-muted-foreground">
                              Unit price: {(Number(buyAmountEth) / Number(ethers.formatUnits(platformBuyEstimate, tokenDecimals))).toExponential(4)} ETH/{symbol}
                            </div>
                          )}
                          {platformBuyEstimate !== null && bestBuyRatio !== null && (
                            <div className="text-[11px] text-muted-foreground flex gap-3">
                              <span>Internal: {bestBuyRatio.toString()}%</span>
                              <span>External: {(100n - bestBuyRatio).toString()}%</span>
                            </div>
                          )}
                          <Button
                            type="button"
                            onClick={handleBuyFromStaking}
                            disabled={isLoading || !buyAmountEth || Number(buyAmountEth) <= 0 || !platformBuyEstimate}
                            className="w-full"
                            size="sm"
                          >
                            {isLoading ? "Processing\u2026" : "Buy via Aggregator"}
                          </Button>
                        </div>

                        {/* RobinPump Pool only estimate */}
                        <div className="rounded-lg border bg-background/30 p-3 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="text-[10px]">
                              RobinPump Only
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">100% bonding curve pool</span>
                          </div>
                          <div className="text-sm font-semibold">
                            {robinpumpBuyEstimate !== null
                              ? `≈ ${formatNumber(Number(ethers.formatUnits(robinpumpBuyEstimate, tokenDecimals)))} ${symbol}`
                              : !poolAddress
                                ? <span className="text-amber-600 dark:text-amber-400 font-normal text-xs">Pool not available</span>
                                : <span className="text-muted-foreground font-normal text-xs">Enter amount to estimate</span>
                            }
                          </div>
                          {robinpumpBuyEstimate !== null && robinpumpBuyEstimate > 0n && (
                            <div className="text-[11px] text-muted-foreground">
                              Unit price: {(Number(buyAmountEth) / Number(ethers.formatUnits(robinpumpBuyEstimate, tokenDecimals))).toExponential(4)} ETH/{symbol}
                            </div>
                          )}
                          {poolAddress ? (
                            <Button
                              type="button"
                              onClick={handleBuyFromPool}
                              disabled={isLoading || !buyAmountEth || Number(buyAmountEth) <= 0}
                              className="w-full"
                              variant="outline"
                              size="sm"
                            >
                              {isLoading ? "Processing\u2026" : "Buy from RobinPump"}
                            </Button>
                          ) : (
                            <div className="text-xs text-amber-600 dark:text-amber-400">
                              Pool address not yet available.
                            </div>
                          )}
                        </div>

                        {/* Highlight better deal */}
                        {platformBuyEstimate !== null && robinpumpBuyEstimate !== null && (
                          <div className="text-[11px] text-muted-foreground text-center">
                            {platformBuyEstimate > robinpumpBuyEstimate
                              ? `💡 Aggregator offers ${formatNumber(Number(ethers.formatUnits(platformBuyEstimate - robinpumpBuyEstimate, tokenDecimals)))} more ${symbol} (+${robinpumpBuyEstimate > 0n ? ((Number(platformBuyEstimate - robinpumpBuyEstimate) * 100) / Number(robinpumpBuyEstimate)).toFixed(2) : "∞"}%)`
                              : platformBuyEstimate < robinpumpBuyEstimate
                                ? `💡 RobinPump offers more tokens for this amount (+${platformBuyEstimate > 0n ? ((Number(robinpumpBuyEstimate - platformBuyEstimate) * 100) / Number(platformBuyEstimate)).toFixed(2) : "∞"}%)`
                                : "Both routes offer the same amount"}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-[11px] text-muted-foreground">
                      Deadline: 5 min.
                    </div>
                  </div>
                )}

                {/* ════════════════════════════════════════════════════════ */}
                {/* SELL panel                                               */}
                {/* ════════════════════════════════════════════════════════ */}
                {tab === "SELL" && (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Sell {symbol} for ETH through the pool
                      {formattedBalance && (
                        <span className="ml-1">
                          (Balance: {formatNumber(Number(formattedBalance))})
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        inputMode="decimal"
                        placeholder={`Amount of ${symbol}`}
                        value={sellAmountToken}
                        onChange={(e) => setSellAmountToken(e.target.value)}
                        disabled={isLoading}
                        className="flex-1"
                      />
                      {formattedBalance && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-xs"
                          onClick={() => setSellAmountToken(formattedBalance)}
                        >
                          Max
                        </Button>
                      )}
                    </div>
                    {sellEstimateLoading && (
                      <div className="text-xs text-muted-foreground animate-pulse">
                        Estimating&hellip;
                      </div>
                    )}
                    {!sellEstimateLoading && sellEstimateEth !== null && (
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>
                          &asymp; {Number(ethers.formatEther(sellEstimateEth)).toFixed(6)} ETH
                        </div>
                        {sellAmountToken && Number(sellAmountToken) > 0 && sellEstimateEth > 0n && (
                          <div>
                            Unit price: {(Number(ethers.formatEther(sellEstimateEth)) / Number(sellAmountToken)).toExponential(4)} ETH/{symbol}
                          </div>
                        )}
                      </div>
                    )}
                    {!poolAddress ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">
                        Pool address not yet available. It may need to be synced.
                      </div>
                    ) : needsSellApproval ? (
                      <Button
                        type="button"
                        onClick={handleApproveSell}
                        disabled={isLoading}
                        className="w-full"
                        variant="secondary"
                      >
                        {isLoading ? "Approving\u2026" : `Approve ${symbol}`}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={handleSell}
                        disabled={isLoading || !sellAmountToken || Number(sellAmountToken) <= 0}
                        className="w-full"
                      >
                        {isLoading ? "Processing\u2026" : "Sell"}
                      </Button>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      Deadline: 5 min.
                    </div>
                  </div>
                )}

                {/* ════════════════════════════════════════════════════════ */}
                {/* STAKE panel                                              */}
                {/* ════════════════════════════════════════════════════════ */}
                {tab === "STAKE" && (
                  <div className="space-y-4">
                    {/* Open new position */}
                    <div className="space-y-3 rounded-lg border bg-background/30 p-3">
                    <div className="text-sm font-medium">Open New Position</div>
                    <div className="text-xs text-muted-foreground">
                      Stake {symbol} tokens with a sell-trigger price. When market price
                      reaches the trigger, your position will auto-sell gradually (single-sided
                      liquidity).
                      {formattedBalance && (
                        <span className="ml-1">
                          (Balance: {formatNumber(Number(formattedBalance))})
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        inputMode="decimal"
                        placeholder={`Amount of ${symbol}`}
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        disabled={isLoading}
                        className="flex-1"
                      />
                      {formattedBalance && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-xs"
                          onClick={() => setStakeAmount(formattedBalance)}
                        >
                          Max
                        </Button>
                      )}
                    </div>
                    {/* ── Price mode toggle ── */}
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant={stakePriceMode === "absolute" ? "default" : "outline"}
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setStakePriceMode("absolute")}
                      >
                        Absolute Price
                      </Button>
                      <Button
                        type="button"
                        variant={stakePriceMode === "multiplier" ? "default" : "outline"}
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setStakePriceMode("multiplier")}
                      >
                        Price Multiplier
                      </Button>
                    </div>

                    {stakePriceMode === "absolute" ? (
                      <>
                        <Input
                          inputMode="decimal"
                          placeholder="Sell trigger price (ETH per token)"
                          value={stakeSellPrice}
                          onChange={(e) => setStakeSellPrice(e.target.value)}
                          disabled={isLoading}
                        />
                        {currentPriceX18 && (
                          <div className="text-[11px] text-muted-foreground">
                            Current price:{" "}
                            {Number(formatPriceX18(currentPriceX18)) < 0.00001
                              ? Number(formatPriceX18(currentPriceX18)).toExponential(4)
                              : Number(formatPriceX18(currentPriceX18)).toFixed(8)}{" "}
                            ETH &mdash;{" "}
                            <button
                              type="button"
                              className="underline hover:text-foreground"
                              onClick={() =>
                                setStakeSellPrice(formatPriceX18(currentPriceX18))
                              }
                            >
                              use current price
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="decimal"
                            placeholder="Multiplier (e.g. 2.0)"
                            value={stakeMultiplier}
                            onChange={(e) => setStakeMultiplier(e.target.value)}
                            disabled={isLoading}
                            className="flex-1"
                          />
                          <span className="text-sm text-muted-foreground shrink-0">&times; current</span>
                        </div>
                        {/* Quick multiplier buttons */}
                        <div className="flex flex-wrap gap-1.5">
                          {[1.5, 2, 3, 5, 10].map((m) => (
                            <Button
                              key={m}
                              type="button"
                              variant={stakeMultiplier === String(m) ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-6 px-2"
                              onClick={() => setStakeMultiplier(String(m))}
                            >
                              {m}x
                            </Button>
                          ))}
                        </div>
                        {currentPriceX18 && (
                          <div className="text-[11px] text-muted-foreground space-y-0.5">
                            <div>
                              Current price:{" "}
                              {Number(formatPriceX18(currentPriceX18)) < 0.00001
                                ? Number(formatPriceX18(currentPriceX18)).toExponential(4)
                                : Number(formatPriceX18(currentPriceX18)).toFixed(8)}{" "}
                              ETH
                            </div>
                            {computedSellPriceFromMultiplier && (
                              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                                Trigger price: {" "}
                                {Number(ethers.formatEther(computedSellPriceFromMultiplier)) < 0.00001
                                  ? Number(ethers.formatEther(computedSellPriceFromMultiplier)).toExponential(4)
                                  : Number(ethers.formatEther(computedSellPriceFromMultiplier)).toFixed(8)}{" "}
                                ETH
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {needsStakeApproval ? (
                      <Button
                        type="button"
                        onClick={handleApproveStake}
                        disabled={isLoading}
                        className="w-full"
                        variant="secondary"
                      >
                        {isLoading ? "Approving\u2026" : `Approve ${symbol} for Staking`}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={handleOpenPosition}
                        disabled={
                          isLoading ||
                          !stakeAmount ||
                          Number(stakeAmount) <= 0 ||
                          !effectiveSellPrice ||
                          Number(effectiveSellPrice) <= 0
                        }
                        className="w-full"
                      >
                        {isLoading ? "Processing\u2026" : "Open Position"}
                      </Button>
                    )}
                    </div>

                    {/* User positions list */}
                    <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">My Positions</div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => loadPositions()}
                        disabled={positionsLoading}
                        className="text-xs h-auto py-1 px-2"
                      >
                        {positionsLoading ? "Loading\u2026" : "Refresh"}
                      </Button>
                    </div>

                    {positions.length === 0 && !positionsLoading && (
                      <div className="rounded-lg border border-dashed bg-background/20 p-4 text-center text-xs text-muted-foreground">
                        No active positions found.
                      </div>
                    )}

                    {positions.map((pos) => {
                      const pending = pos.pendingPenaltyEth + pos.pendingProceedsEth;
                      return (
                        <div
                          key={pos.tokenId.toString()}
                          className="rounded-lg border bg-background/30 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">
                              Position #{pos.tokenId.toString()}
                            </div>
                            <div className="flex gap-1">
                              {pos.isMature && (
                                <Badge variant="secondary" className="text-[10px]">
                                  Mature
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <div>
                              <span className="text-muted-foreground">Remaining:</span>
                              <div className="font-medium">
                                {formatNumber(
                                  Number(ethers.formatUnits(pos.remainingTokens, tokenDecimals))
                                )}{" "}
                                {symbol}
                              </div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Current Sell Price:</span>
                              <div className="font-medium">
                                {Number(ethers.formatEther(pos.lastAutoSellPriceX18)).toExponential(4)}{" "}
                                ETH
                              </div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Pending ETH:</span>
                              <div className="font-medium">
                                {Number(ethers.formatEther(pending)).toFixed(6)} ETH
                              </div>
                            </div>
                            {pos.totalPenaltyBps !== undefined && (
                              <div>
                                <span className="text-muted-foreground">Exit Penalty:</span>
                                <div className="font-medium">
                                  {(Number(pos.totalPenaltyBps) / 100).toFixed(2)}%
                                </div>
                              </div>
                            )}
                            {pos.stakeScore !== undefined && pos.stakeScore > 0n && (
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Stake Score:</span>
                                <div className="font-medium">
                                  {formatNumber(
                                    Number(ethers.formatEther(pos.stakeScore))
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleClaim(pos.tokenId)}
                              disabled={isLoading || pending === 0n}
                              className="flex-1 text-xs"
                            >
                              {isLoading ? "\u2026" : "Claim ETH"}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRequestExit(pos.tokenId)}
                              disabled={isLoading}
                              className="flex-1 text-xs"
                            >
                              {isLoading ? "\u2026" : "Exit Position"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Staked tokens earn penalty-pool rewards proportional to your staking points.
                      Early exit incurs a time + price penalty (max 20%). Positions are NFT-based;
                      each stake creates a unique NFT.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>

      {/* ══ Exit Position Confirmation Dialog ══ */}
      <AlertDialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Exit Position</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to exit Position{" "}
                  <span className="font-semibold">
                    #{exitTokenId?.toString()}
                  </span>
                  . Early exit may incur a penalty.
                </p>

                {exitPreviewLoading && (
                  <div className="text-xs text-muted-foreground animate-pulse">
                    Simulating exit&hellip;
                  </div>
                )}

                {exitPreview && (
                  <div className="rounded-lg border bg-destructive/5 p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Penalty Rate</span>
                      <span className="font-semibold text-destructive">
                        {(exitPreview.penaltyBps / 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Staked</span>
                      <span className="font-medium">
                        {formatNumber(
                          Number(ethers.formatUnits(exitPreview.remainingTokens, tokenDecimals))
                        )}{" "}
                        {symbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tokens Confiscated</span>
                      <span className="font-semibold text-destructive">
                        {formatNumber(
                          Number(ethers.formatUnits(exitPreview.confiscatedTokens, tokenDecimals))
                        )}{" "}
                        {symbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tokens Returned</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {formatNumber(
                          Number(
                            ethers.formatUnits(
                              exitPreview.remainingTokens - exitPreview.confiscatedTokens,
                              tokenDecimals
                            )
                          )
                        )}{" "}
                        {symbol}
                      </span>
                    </div>
                    {exitPreview.penaltyEth > 0n && (
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-muted-foreground">Penalty Value</span>
                        <span className="font-semibold text-destructive">
                          {Number(ethers.formatEther(exitPreview.penaltyEth)).toFixed(6)} ETH
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {!exitPreviewLoading && !exitPreview && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Unable to preview exit details. Proceed with caution.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmExit}
              disabled={exitPreviewLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default TokenActions;
