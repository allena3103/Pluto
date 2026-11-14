function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export default function GradesLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-7 w-24" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 rounded-xl border border-slate-200 p-4">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-10 w-28" />
          <SkeletonBlock className="h-4 w-48" />
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}