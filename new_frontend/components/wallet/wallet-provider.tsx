"use client";

import * as React from "react";

type WalletState = {
    isHydrated: boolean;
    hasProvider: boolean;
    isMetaMask: boolean;
    account: string | null;
    chainId: string | null; // hex string (e.g. "0x1")
    isConnecting: boolean;
    error: string | null;
};

type WalletContextValue = WalletState & {
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    refresh: () => Promise<void>;
};

const WalletContext = React.createContext<WalletContextValue | null>(null);

function getEthereum(): Eip1193Provider | null {
    if (typeof window === "undefined") return null;
    return window.ethereum ?? null;
}

function errorToMessage(err: unknown) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (typeof err === "object" && "message" in err && typeof (err as any).message === "string") return (err as any).message;
    try {
        return JSON.stringify(err);
    } catch {
        return "Unknown error";
    }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
    const [isHydrated, setIsHydrated] = React.useState(false);
    const [eth, setEth] = React.useState<Eip1193Provider | null>(null);
    const [account, setAccount] = React.useState<string | null>(null);
    const [chainId, setChainId] = React.useState<string | null>(null);
    const [isConnecting, setIsConnecting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        setIsHydrated(true);
        setEth(getEthereum());
    }, []);

    const refresh = React.useCallback(async () => {
        if (!eth) return;
        try {
            const [accounts, cid] = await Promise.all([
                eth.request<string[]>({ method: "eth_accounts" }),
                eth.request<string>({ method: "eth_chainId" }),
            ]);
            setAccount(accounts?.[0] ?? null);
            setChainId(cid ?? null);
            setError(null);
        } catch (e) {
            setError(errorToMessage(e));
        }
    }, [eth]);

    React.useEffect(() => {
        if (!eth) return;
        refresh();

        const onAccountsChanged = (accounts: string[]) => {
            setAccount(accounts?.[0] ?? null);
        };
        const onChainChanged = (cid: string) => {
            setChainId(cid ?? null);
        };
        const onDisconnect = (e: { code: number; message: string }) => {
            setAccount(null);
            setError(e?.message ?? "Wallet disconnected");
        };

        eth.on?.("accountsChanged", onAccountsChanged);
        eth.on?.("chainChanged", onChainChanged);
        eth.on?.("disconnect", onDisconnect);
        return () => {
            eth.removeListener?.("accountsChanged", onAccountsChanged);
            eth.removeListener?.("chainChanged", onChainChanged);
            eth.removeListener?.("disconnect", onDisconnect);
        };
    }, [eth, refresh]);

    const connect = React.useCallback(async () => {
        if (!eth) {
            setError("No injected wallet found. Please install MetaMask.");
            return;
        }
        setIsConnecting(true);
        setError(null);
        try {
            const accounts = await eth.request<string[]>({ method: "eth_requestAccounts" });
            const cid = await eth.request<string>({ method: "eth_chainId" });
            setAccount(accounts?.[0] ?? null);
            setChainId(cid ?? null);
        } catch (e) {
            setError(errorToMessage(e));
        } finally {
            setIsConnecting(false);
        }
    }, [eth]);

    const disconnect = React.useCallback(async () => {
        if (!eth) {
            setAccount(null);
            setChainId(null);
            setError(null);
            return;
        }
        // MetaMask doesn't fully "disconnect" programmatically, but some wallets support revoking permissions.
        try {
            await eth.request({
                method: "wallet_revokePermissions",
                params: [{ eth_accounts: {} }],
            });
        } catch {
            // ignore
        } finally {
            setAccount(null);
            setChainId(null);
            setError(null);
        }
    }, [eth]);

    const value: WalletContextValue = React.useMemo(
        () => ({
            isHydrated,
            hasProvider: Boolean(eth),
            isMetaMask: Boolean((eth as any)?.isMetaMask),
            account,
            chainId,
            isConnecting,
            error,
            connect,
            disconnect,
            refresh,
        }),
        [isHydrated, eth, account, chainId, isConnecting, error, connect, disconnect, refresh],
    );

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
    const ctx = React.useContext(WalletContext);
    if (!ctx) throw new Error("useWallet must be used within <WalletProvider />");
    return ctx;
}

