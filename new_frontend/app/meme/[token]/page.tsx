import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPumpCurveByTokenAddress } from "@/lib/robinpump";
import { formatNumber, formatUsd, shortAddress, unixSecondsToDate } from "@/lib/format";
import { SellPressureChart } from "@/components/meme/sell-pressure-chart";
import TokenActions from "@/components/meme/token-actions";

function n(s: string | null | undefined) {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export default async function MemeTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const curve = await getPumpCurveByTokenAddress(token);
  if (!curve) return notFound();

  const created = unixSecondsToDate(curve.createdAt);
  const lastTradeAt = curve.lastTradeAt ? unixSecondsToDate(curve.lastTradeAt) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {curve.name}{" "}
              <span className="text-muted-foreground font-medium">${curve.symbol}</span>
            </h1>
            {curve.graduated ? <Badge>Graduated</Badge> : <Badge variant="secondary">Early</Badge>}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            Token: <span className="font-mono">{curve.token}</span> ({shortAddress(curve.token)})
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>Created: {created ? created.toLocaleString() : "—"}</span>
            <span>·</span>
            <span>Last trade: {lastTradeAt ? lastTradeAt.toLocaleString() : "—"}</span>
            <span>·</span>
            <span>Trades: {curve.tradeCount}</span>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/meme">Back</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-background/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last price (USD)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-semibold">{formatUsd(n(curve.lastPriceUsd), { compact: false })}</div>
            <div className="mt-1 text-xs text-muted-foreground">From subgraph trades</div>
          </CardContent>
        </Card>
        <Card className="bg-background/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All-time high (USD)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-semibold">{formatUsd(n(curve.athPriceUsd), { compact: false })}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {curve.athTimestamp ? unixSecondsToDate(curve.athTimestamp)?.toLocaleString() : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-background/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Total volume (ETH)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-semibold">{formatNumber(n(curve.totalVolumeEth))}</div>
            <div className="mt-1 text-xs text-muted-foreground">Trade count: {curve.tradeCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <SellPressureChart tokenAddress={curve.token} bins={20} />
        </div>

        <div className="space-y-4">
          <TokenActions symbol={curve.symbol} tokenAddress={curve.token} />

          <Card className="bg-background/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Links</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2 text-sm">
              <div className="text-muted-foreground">
                Curve ID: <span className="font-mono text-foreground/90">{shortAddress(curve.id)}</span>
              </div>
              <div className="text-muted-foreground">
                Creator: <span className="font-mono text-foreground/90">{shortAddress(curve.creator)}</span>
              </div>
              <div className="text-muted-foreground">
                Metadata URI:{" "}
                <span className="font-mono text-foreground/90 break-all">
                  {curve.uri ?? "—"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

