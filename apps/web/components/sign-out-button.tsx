"use client";

import { useRef } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(app)/actions";
import { clearPlutoCaches } from "@/lib/clear-pluto-caches";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const bypass = useRef(false);
  const clearing = useRef(false);

  return (
    <form
      action={signOut}
      onSubmit={(event) => {
        // The second submit is the real server action, after caches are gone.
        if (bypass.current) return;
        event.preventDefault();
        if (clearing.current) return;
        clearing.current = true;
        const form = event.currentTarget;
        void (async () => {
          try {
            await clearPlutoCaches();
          } catch {
            // Cache Storage can be unavailable. The session still has to end.
          }
          bypass.current = true;
          form.requestSubmit();
        })();
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        className={cn("w-full justify-start gap-3 px-3 font-semibold text-muted-foreground", className)}
      >
        <LogOut className="size-4" aria-hidden />
        Sign out
      </Button>
    </form>
  );
}
