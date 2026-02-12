export const PUMP_CHARTS_SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cmjjrebt3mxpt01rm9yi04vqq/subgraphs/pump-charts/v2/gn";

type GraphQlResponse<T> = { data?: T; errors?: { message: string }[] };

async function fetchPumpSubgraph<TData>(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(PUMP_CHARTS_SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    throw new Error(`pump-charts subgraph request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as GraphQlResponse<TData>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("\n"));
  }
  if (!json.data) {
    throw new Error("pump-charts subgraph returned no data");
  }
  return json.data;
}

export type PumpCurve = {
  id: string;
  token: string;
  name: string;
  symbol: string;
  uri: string | null;
  creator: string;
  createdAt: string; // unix seconds
  graduated: boolean;
  graduatedAt: string | null;
  lastPriceUsd: string;
  lastPriceEth: string;
  lastTradeAt: string | null;
  totalVolumeEth: string;
  ethCollected: string;
  tradeCount: string;
  athPriceUsd: string;
  athTimestamp: string | null;
};

export type PumpTrade = {
  id: string;
  curve: string;
  side: "BUY" | "SELL" | string;
  amountEth: string;
  amountToken: string;
  priceUsd: string;
  timestamp: string; // unix seconds
  trader: string;
  txHash: string;
};

export async function listPumpCurves(params?: {
  first?: number;
  skip?: number;
  orderBy?: "createdAt" | "totalVolumeEth" | "tradeCount" | "lastTradeAt";
  orderDirection?: "asc" | "desc";
  search?: string;
}) {
  const first = params?.first ?? 50;
  const skip = params?.skip ?? 0;
  const orderBy = params?.orderBy ?? "createdAt";
  const orderDirection = params?.orderDirection ?? "desc";

  const search = (params?.search ?? "").trim();
  const where =
    search.length === 0
      ? {}
      : search.startsWith("0x") && search.length === 42
        ? { token: search.toLowerCase() }
        : { name_contains_nocase: search };

  const query = `
    query Curves($first:Int!, $skip:Int!, $orderBy: Curve_orderBy!, $orderDirection: OrderDirection!, $where: Curve_filter) {
      curves(first:$first, skip:$skip, orderBy:$orderBy, orderDirection:$orderDirection, where:$where) {
        id
        token
        name
        symbol
        uri
        creator
        createdAt
        graduated
        graduatedAt
        lastPriceUsd
        lastPriceEth
        lastTradeAt
        totalVolumeEth
        ethCollected
        tradeCount
        athPriceUsd
        athTimestamp
      }
    }
  `;

  const data = await fetchPumpSubgraph<{ curves: PumpCurve[] }>(query, {
    first,
    skip,
    orderBy,
    orderDirection,
    where,
  });

  return data.curves;
}

export async function getPumpCurveByTokenAddress(tokenAddress: string) {
  const addr = tokenAddress.trim().toLowerCase();
  if (!addr.startsWith("0x") || addr.length !== 42) return null;

  const query = `
    query CurveByToken($where: Curve_filter) {
      curves(first: 1, where: $where) {
        id
        token
        name
        symbol
        uri
        creator
        createdAt
        graduated
        graduatedAt
        lastPriceUsd
        lastPriceEth
        lastTradeAt
        totalVolumeEth
        ethCollected
        tradeCount
        athPriceUsd
        athTimestamp
      }
    }
  `;

  const data = await fetchPumpSubgraph<{ curves: PumpCurve[] }>(query, {
    where: { token: addr },
  });

  return data.curves[0] ?? null;
}

export async function listPumpTrades(params: {
  curveId: string;
  first?: number;
  side?: "BUY" | "SELL";
}) {
  const first = params.first ?? 200;
  const where = params.side ? { curve: params.curveId, side: params.side } : { curve: params.curveId };

  const query = `
    query Trades($first:Int!, $where: Trade_filter) {
      trades(first:$first, orderBy: timestamp, orderDirection: desc, where: $where) {
        id
        curve
        side
        amountEth
        amountToken
        priceUsd
        timestamp
        trader
        txHash
      }
    }
  `;

  const data = await fetchPumpSubgraph<{ trades: PumpTrade[] }>(query, { first, where });
  return data.trades;
}

