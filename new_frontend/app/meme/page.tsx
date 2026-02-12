import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listPumpCurves } from "@/lib/robinpump";
import { getInsuredTokenSet } from "@/lib/insured-tokens";
import { TokenCard } from "@/components/meme/token-card";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function MemePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const q = typeof sp.q === "string" ? sp.q : "";
  const order = typeof sp.order === "string" ? sp.order : "createdAt";
  const insuredOnly = sp.insured === "1";

  const orderBy =
    order === "totalVolumeEth" || order === "tradeCount" || order === "lastTradeAt"
      ? order
      : "createdAt";

  // Fetch subgraph curves and on-chain insured tokens in parallel
  const [curves, insuredTokens] = await Promise.all([
    listPumpCurves({
      first: 48,
      orderBy,
      orderDirection: "desc",
      search: q,
    }),
    getInsuredTokenSet(),
  ]);

  const trimmedQ = q.trim();
  if (trimmedQ.startsWith("0x") && trimmedQ.length === 42 && curves.length > 0) {
    redirect(`/meme/${trimmedQ}`);
  }

  // Apply insured-only filter when toggled on
  const displayCurves = insuredOnly
    ? curves.filter((c) => insuredTokens.has(c.token.toLowerCase()))
    : curves;

  // Build search params string for filter toggle links (preserving q & order)
  function buildFilterHref(toggleInsured: boolean) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (order !== "createdAt") params.set("order", order);
    if (toggleInsured) params.set("insured", "1");
    const qs = params.toString();
    return `/meme${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-fuchsia-500/10 via-background to-cyan-500/10 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">AegisFlow Meme Token Explorer</h1>
              <Badge variant="secondary">RobinPump</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
              Browse meme tokens, inspect sell pressure, and stake with a sell-point trigger for single-sided liquidity auto-selling.
            </p>
          </div>
          <Button asChild>
            <Link href="/meme">Refresh</Link>
          </Button>
        </div>
      </div>

      <Card className="bg-background/40">
        <CardContent className="pt-6">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center" action="/meme" method="GET">
            <div className="flex-1">
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search token name or paste a token address (0x...)"
              />
            </div>
            {insuredOnly && <input type="hidden" name="insured" value="1" />}
            <div className="flex items-center gap-2">
              <select
                name="order"
                defaultValue={order}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="createdAt">Newest</option>
                <option value="totalVolumeEth">Volume</option>
                <option value="tradeCount">Trades</option>
                <option value="lastTradeAt">Recent</option>
              </select>
              <Button type="submit">Search</Button>
            </div>
          </form>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Hint: paste a token address to jump directly into the detail page.
            </div>
            <Button
              asChild
              variant={insuredOnly ? "default" : "outline"}
              size="sm"
              className="shrink-0"
            >
              <Link href={buildFilterHref(!insuredOnly)}>
                <span className="mr-1.5">🛡️</span>
                {insuredOnly ? "Insured Only" : "Show Insured"}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {displayCurves.length === 0 ? (
        <div className="rounded-xl border bg-background/40 p-6 text-sm text-muted-foreground">
          {insuredOnly
            ? "No insured tokens found. Try turning off the filter or creating a staking pool first."
            : "No results. Try a different keyword or a full token address."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayCurves.map((c) => (
            <TokenCard
              key={c.id}
              curve={c}
              insured={insuredTokens.has(c.token.toLowerCase())}
            />
          ))}
        </div>
      )}
    </div>
  );
}

