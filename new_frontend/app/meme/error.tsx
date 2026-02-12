"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-background/40 p-6">
      <div className="text-lg font-semibold">Failed to load meme list</div>
      <div className="mt-2 text-sm text-muted-foreground break-all">
        {error.message}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button onClick={() => reset()}>Retry</Button>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}

