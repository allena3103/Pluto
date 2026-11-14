"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CanvasSettingsFormProps = {
  initialConnected: boolean;
  initialBaseUrl: string | null;
};

type RouteResponse = {
  connected: boolean;
  baseUrl: string | null;
  error?: string;
};

type SyncResponse = {
  result?: {
    courses: { inserted: number; updated: number };
    assignments: { inserted: number; updated: number };
    errors: string[];
  };
  files?: { ingested: number; failed: number };
  error?: string;
};

const DEFAULT_BASE_URL = "https://umamherst.instructure.com";

function parseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function CanvasSettingsForm({ initialConnected, initialBaseUrl }: CanvasSettingsFormProps) {
  const router = useRouter();
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl ?? DEFAULT_BASE_URL);
  const [connected, setConnected] = useState(initialConnected);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const statusText = connected ? `Connected${baseUrl ? ` to ${baseUrlHost(baseUrl)}` : ""}` : "Not connected";

  // Pulls courses, assignments and PDFs from Canvas into Pluto. Returns an error message or null.
  async function runSync(): Promise<string | null> {
    setSyncStatus("Syncing your Canvas courses. This can take a minute...");
    try {
      const response = await fetch("/api/canvas/sync", { method: "POST" });
      const data = (await response.json()) as SyncResponse;
      if (!response.ok || !data.result) {
        setSyncStatus(null);
        return parseError(data, "Canvas sync failed.");
      }
      const courses = data.result.courses.inserted + data.result.courses.updated;
      const assignments = data.result.assignments.inserted + data.result.assignments.updated;
      const pdfs = data.files?.ingested ?? 0;
      const skipped = data.result.errors.length + (data.files?.failed ?? 0);
      setSyncStatus(
        `Synced ${courses} courses, ${assignments} assignments and ${pdfs} new PDFs` +
          (skipped ? ` (${skipped} items skipped).` : "."),
      );
      router.refresh();
      return null;
    } catch {
      setSyncStatus(null);
      return "Canvas sync failed.";
    }
  }

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const token = String(formData.get("token") ?? "");

    startTransition(async () => {
      try {
        const response = await fetch("/api/canvas/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, baseUrl }),
        });
        const data = (await response.json()) as RouteResponse;
        if (!response.ok) {
          setError(parseError(data, "Unable to save Canvas connection."));
          return;
        }

        setConnected(data.connected);
        setBaseUrl(data.baseUrl ?? baseUrl);
        router.refresh();
        const syncError = await runSync();
        if (syncError) setError(syncError);
      } catch {
        setError("Unable to save Canvas connection.");
      } finally {
        if (tokenInputRef.current) {
          tokenInputRef.current.value = "";
        }
      }
    });
  };

  const handleSync = () => {
    setError(null);
    startTransition(async () => {
      const syncError = await runSync();
      if (syncError) setError(syncError);
    });
  };

  const handleDisconnect = () => {
    setError(null);
    setSyncStatus(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/canvas/token", { method: "DELETE" });
        const data = (await response.json()) as RouteResponse;
        if (!response.ok) {
          setError(parseError(data, "Unable to disconnect Canvas."));
          return;
        }
        setConnected(false);
        setBaseUrl(data.baseUrl ?? DEFAULT_BASE_URL);
        if (tokenInputRef.current) {
          tokenInputRef.current.value = "";
        }
        router.refresh();
      } catch {
        setError("Unable to disconnect Canvas.");
      }
    });
  };

  return (
    <div className="space-y-5 rounded-3xl border border-border/80 bg-card p-5 shadow-warm sm:p-6">
      <p
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-extrabold break-all",
          connected ? "bg-mint text-emerald-800" : "bg-muted text-muted-foreground",
        )}
      >
        <span
          className={cn("size-2 shrink-0 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground/50")}
          aria-hidden
        />
        {statusText}
      </p>

      <form className="space-y-4" onSubmit={handleSave}>
        <label className="block space-y-1.5">
          <span className="text-sm font-bold text-foreground">Canvas base URL</span>
          <Input
            name="baseUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-bold text-foreground">Canvas personal access token</span>
          <Input ref={tokenInputRef} name="token" type="password" autoComplete="off" required />
        </label>

        {error ? (
          <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">{error}</p>
        ) : null}
        {syncStatus ? (
          <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm font-semibold text-foreground">{syncStatus}</p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" variant="sunrise" disabled={isPending}>
            {isPending ? "Saving..." : "Save Canvas connection"}
          </Button>
          {connected ? (
            <Button type="button" variant="outline" onClick={handleSync} disabled={isPending}>
              {isPending ? "Working..." : "Sync now"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={handleDisconnect} disabled={isPending}>
            {isPending ? "Working..." : "Disconnect"}
          </Button>
        </div>
      </form>
    </div>
  );
}
