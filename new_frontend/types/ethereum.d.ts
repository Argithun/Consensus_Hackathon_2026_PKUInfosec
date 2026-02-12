export {};

declare global {
  type Eip1193RequestArgs = {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  };

  interface Eip1193Provider {
    request<T = unknown>(args: Eip1193RequestArgs): Promise<T>;
    on?(event: "accountsChanged", listener: (accounts: string[]) => void): void;
    on?(event: "chainChanged", listener: (chainId: string) => void): void;
    on?(event: "disconnect", listener: (error: { code: number; message: string }) => void): void;
    removeListener?(event: "accountsChanged", listener: (accounts: string[]) => void): void;
    removeListener?(event: "chainChanged", listener: (chainId: string) => void): void;
    removeListener?(event: "disconnect", listener: (error: { code: number; message: string }) => void): void;
    isMetaMask?: boolean;
  }

  interface Window {
    ethereum?: Eip1193Provider;
  }
}

