function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export default function DeadlinesLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-32" />
        <SkeletonBlock className="h-4 w-48" />
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="space-y-3">
          <SkeletonBlock className="h-4 w-36" />
          {[0, 1].map((row) => (
            <div key={row} className="space-y-2 rounded-xl border border-slate-200 p-4">
              <SkeletonBlock className="h-4 w-3/4" />
              <SkeletonBlock className="h-4 w-1/2" />
              <SkeletonBlock className="h-4 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}