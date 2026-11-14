import { PlutoMascot } from "@/components/mascot/pluto-mascot";

/** Centered, cozy frame for sign in, sign up and OAuth consent. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <PlutoMascot mood="happy" size={104} label="Pluto" />
          <h1 className="mt-4 text-[1.75rem] leading-tight font-black tracking-tight break-words text-foreground">
            {title}
          </h1>
          {description ? <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{description}</p> : null}
        </div>
        <div className="rounded-3xl border border-border/80 bg-card p-6 shadow-warm-lg">{children}</div>
        {footer ? <div className="mt-5 text-center text-sm font-semibold text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}
