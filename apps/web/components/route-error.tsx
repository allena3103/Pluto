"use client";

import { RotateCcw } from "lucide-react";
import { PlutoMascot } from "@/components/mascot/pluto-mascot";
import { Button } from "@/components/ui/button";

/** Friendly error card shared by every `error.tsx` in the app. */
export function RouteError({
  title,
  message = "Something went wrong on our side. Give it another try.",
  retry,
}: {
  title: string;
  message?: string;
  retry: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 md:py-20">
      <div role="alert" className="rounded-3xl border border-border/80 bg-card px-6 py-8 text-center shadow-warm">
        <PlutoMascot mood="worried" size={80} className="mx-auto" />
        <h2 className="mt-4 text-xl font-black tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button type="button" onClick={() => retry()} className="mt-6">
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    </div>
  );
}
