"use client";

export default function RouteError({ retry }: { retry: () => void }) {
  return (
    <div className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 className="text-lg font-semibold text-red-900">Could not load grades</h2>
      <p className="text-sm text-red-800">Something went wrong. Please try again.</p>
      <button type="button" onClick={() => retry()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
        Try again
      </button>
    </div>
  );
}
