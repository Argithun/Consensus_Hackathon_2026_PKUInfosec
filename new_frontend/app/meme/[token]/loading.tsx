import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
        </div>
        <Skeleton className="h-10 w-24" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="bg-background/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                <Skeleton className="h-4 w-40" />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="mt-2 h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border bg-background/40 p-4">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="mt-3 h-40 w-full" />
          </div>
          <div className="rounded-xl border bg-background/40 p-6">
            <Skeleton className="h-4 w-56" />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border bg-background/40 p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-3 h-10 w-full" />
            <Skeleton className="mt-3 h-10 w-full" />
          </div>
          <div className="rounded-xl border bg-background/40 p-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}

