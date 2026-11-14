"use client";

export default function GradesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <h1 className="text-lg font-semibold text-red-900">Could not load grades</h1>
      <p className="text-sm text-red-800">{error.message || "Something went wrong."}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}