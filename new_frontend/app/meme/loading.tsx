import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border bg-background/40 p-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="bg-background/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                <Skeleton className="h-4 w-40" />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="mt-2 h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-background/40 p-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-3 w-32" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

