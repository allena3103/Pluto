"use client";

import { useState } from "react";

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
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Linked phone</p>
        {phone ? (
          <p className="mt-1 break-all text-base font-medium text-slate-900">{phone}</p>
        ) : (
          <p className="mt-1 text-base text-slate-700">Not linked yet.</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          Link your phone by texting Pluto a one-time code, so texts from your number reach your account.
        </p>
        <button
          type="button"
          onClick={getCode}
          disabled={state.kind === "loading"}
          className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {state.kind === "loading" ? "Getting code…" : "Get a link code"}
        </button>

        {state.kind === "code" ? (
          <div className="mt-3 space-y-1" role="status">
            <p className="break-words text-base font-medium text-slate-900">
              Text LINK {state.code} to {fromNumber ?? "the Pluto number"}
            </p>
            {state.expires ? <p className="text-sm text-slate-600">This code expires in 15 minutes.</p> : null}
          </div>
        ) : null}
        {state.kind === "unavailable" ? (
          <p className="mt-3 text-sm text-slate-700" role="status">
            Phone linking isn&apos;t available yet.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="mt-3 text-sm text-red-800" role="alert">
            Something went wrong. Please try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
