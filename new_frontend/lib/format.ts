export function shortAddress(addr: string, left = 6, right = 4) {
  if (!addr) return "";
  if (addr.length <= left + right + 2) return addr;
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

export function formatUsd(input: number, opts?: { compact?: boolean }) {
  if (!Number.isFinite(input)) return "—";
  const compact = opts?.compact ?? true;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 6,
  }).format(input);
}

export function formatNumber(input: number, opts?: { compact?: boolean; maximumFractionDigits?: number }) {
  if (!Number.isFinite(input)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.maximumFractionDigits ?? 4,
  }).format(input);
}

export function unixSecondsToDate(sec: string | number) {
  const n = typeof sec === "string" ? Number(sec) : sec;
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000);
}

