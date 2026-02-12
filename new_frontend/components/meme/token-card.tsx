import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PumpCurve } from "@/lib/robinpump";
import { formatNumber, formatUsd, shortAddress, unixSecondsToDate } from "@/lib/format";

function safeNumber(s: string | null | undefined) {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function TokenCard({ curve, insured }: { curve: PumpCurve; insured?: boolean }) {
  const priceUsd = safeNumber(curve.lastPriceUsd);
  const volumeEth = safeNumber(curve.totalVolumeEth);
  const created = unixSecondsToDate(curve.createdAt);

  return (
    <Link href={`/meme/${curve.token}`} className="group block">
      <Card className={`h-full transition-all group-hover:shadow-md group-hover:-translate-y-0.5${insured ? " ring-1 ring-emerald-500/40" : ""}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">
                {curve.name}{" "}
                <span className="text-muted-foreground font-medium">${curve.symbol}</span>
              </CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">
                {shortAddress(curve.token)} ·{" "}
                {created ? created.toLocaleString() : "unknown time"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {insured && (
                <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Insured
                </Badge>
              )}
              {curve.graduated ? (
                <Badge className="shrink-0">Graduated</Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  Early
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">Last price</div>
              <div className="mt-1 font-semibold">{formatUsd(priceUsd, { compact: false })}</div>
            </div>
            <div className="rounded-lg border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">Total volume (ETH)</div>
              <div className="mt-1 font-semibold">{formatNumber(volumeEth)}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Trades: {curve.tradeCount}</span>
            <span className="text-foreground/80 group-hover:text-foreground">
              View →{" "}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

