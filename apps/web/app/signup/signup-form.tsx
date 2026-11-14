"use client";

import { useActionState } from "react";
import { signUp, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

export function SignupForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  return (
    <form action={formAction} className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-900">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base text-slate-900"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="email" className="block text-sm font-medium text-slate-900">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base text-slate-900"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="password" className="block text-sm font-medium text-slate-900">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base text-slate-900"
        />
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
