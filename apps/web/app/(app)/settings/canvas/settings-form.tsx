"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type CanvasSettingsFormProps = {
  initialConnected: boolean;
  initialBaseUrl: string | null;
};

type RouteResponse = {
  connected: boolean;
  baseUrl: string | null;
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

  const statusText = connected ? `Connected${baseUrl ? ` to ${baseUrlHost(baseUrl)}` : ""}` : "Not connected";

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
      } catch {
        setError("Unable to save Canvas connection.");
      } finally {
        if (tokenInputRef.current) {
          tokenInputRef.current.value = "";
        }
      }
    });
  };

  const handleDisconnect = () => {
    setError(null);
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
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-700">{statusText}</p>

      <form className="space-y-4" onSubmit={handleSave}>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-900">Canvas base URL</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-blue-500 focus:ring-2"
            name="baseUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-900">Canvas personal access token</span>
          <input
            ref={tokenInputRef}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-blue-500 focus:ring-2"
            name="token"
            type="password"
            autoComplete="off"
            required
          />
        </label>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            type="submit"
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save Canvas connection"}
          </button>
          <button
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
            type="button"
            onClick={handleDisconnect}
            disabled={isPending}
          >
            {isPending ? "Working..." : "Disconnect"}
          </button>
        </div>
      </form>
    </div>
  );
}
