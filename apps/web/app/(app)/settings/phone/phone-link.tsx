"use client";

import { useState } from "react";
import { KeyRound, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "code"; code: string; expires: boolean }
  | { kind: "unavailable" }
  | { kind: "error" };

export function PhoneLink({ phone, fromNumber }: { phone: string | null; fromNumber: string | null }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function getCode() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/sms/link-code", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.status === 401) {
        window.location.assign("/login?next=%2Fsettings%2Fphone");
        return;
      }
      if (res.status === 404 || res.status === 501) {
        setState({ kind: "unavailable" });
        return;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      if (res.ok && obj && typeof obj.code === "string" && obj.code.length > 0) {
        setState({ kind: "code", code: obj.code, expires: typeof obj.expiresAt === "string" });
        return;
      }
      setState(res.ok || !obj ? { kind: "unavailable" } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-3xl border border-border/80 bg-card p-5 shadow-warm">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-mint text-emerald-700">
          <Phone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-muted-foreground">Linked phone</p>
          {phone ? (
            <p className="mt-0.5 text-lg font-extrabold break-all text-foreground">{phone}</p>
          ) : (
            <p className="mt-0.5 text-lg font-extrabold text-foreground">Not linked yet.</p>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border/80 bg-card p-5 shadow-warm">
        <p className="text-sm font-semibold text-muted-foreground">
          Link your phone by texting Pluto a one-time code, so texts from your number reach your account.
        </p>
        <Button
          type="button"
          variant="sunrise"
          onClick={getCode}
          disabled={state.kind === "loading"}
          className="mt-4 w-full sm:w-auto"
        >
          <KeyRound className="size-4" aria-hidden />
          {state.kind === "loading" ? "Getting code…" : "Get a link code"}
        </Button>

        {state.kind === "code" ? (
          <div className="mt-4 space-y-1 rounded-2xl bg-butter px-4 py-3" role="status">
            <p className="text-base font-extrabold break-words text-amber-900">
              Text LINK {state.code} to {fromNumber ?? "the Pluto number"}
            </p>
            {state.expires ? <p className="text-sm font-semibold text-amber-800">This code expires in 15 minutes.</p> : null}
          </div>
        ) : null}
        {state.kind === "unavailable" ? (
          <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground" role="status">
            Phone linking isn&apos;t available yet.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
            Something went wrong. Please try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
