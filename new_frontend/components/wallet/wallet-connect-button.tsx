"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/format";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@/components/wallet/wallet-provider";

function chainLabel(chainId: string | null) {
    if (!chainId) return "Unknown network";
    const n = Number.parseInt(chainId, 16);
    if (!Number.isFinite(n)) return chainId;
    if (n === 1) return "Ethereum Mainnet";
    if (n === 11155111) return "Sepolia";
    if (n === 10) return "Optimism";
    if (n === 42161) return "Arbitrum One";
    if (n === 8453) return "Base";
    return `Chain ${n}`;
}

export function WalletConnectButton() {
    const { isHydrated, hasProvider, account, chainId, isConnecting, error, connect, disconnect } = useWallet();
    const [copied, setCopied] = React.useState(false);

    const copy = async () => {
        if (!account) return;
        try {
            await navigator.clipboard.writeText(account);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 900);
        } catch {
            // ignore
        }
    };

    if (!isHydrated) {
        // Avoid SSR -> hydration UI jump: don't decide between "Install/Connect/Address" until hydrated.
        return (
            <Button variant="outline" size="sm" disabled>
                Wallet…
            </Button>
        );
    }

    if (!hasProvider) {
        return (
            <Button asChild variant="outline" size="sm">
                <a href="https://metamask.io/download/" target="_blank" rel="noreferrer noopener">
                    Install MetaMask
                </a>
            </Button>
        );
    }

    if (!account) {
        return (
            <div className="flex items-center gap-2">
                <Button onClick={connect} disabled={isConnecting} size="sm">
                    {isConnecting ? "Connecting…" : "Connect Wallet"}
                </Button>
                {error ? <span className="hidden md:inline text-xs text-muted-foreground">{error}</span> : null}
            </div>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                    {shortAddress(account)}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px]">
                <DropdownMenuLabel>Wallet</DropdownMenuLabel>
                <div className="px-2 pb-2 text-xs text-muted-foreground">
                    <div className="font-mono text-foreground/90 break-all">{account}</div>
                    <div className="mt-1">{chainLabel(chainId)}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={copy}>{copied ? "Copied" : "Copy address"}</DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => {
                        void disconnect();
                    }}
                >
                    Disconnect
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

