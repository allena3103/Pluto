import Link from "next/link";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import { PlutoMascot } from "@/components/mascot/pluto-mascot";
import { cn } from "@/lib/utils";

export type PageTint = "peach" | "mint" | "sky" | "butter" | "lilac";

export const TINT_CLASSES: Record<PageTint, string> = {
  peach: "bg-peach text-[#c2462a]",
  mint: "bg-mint text-emerald-700",
  sky: "bg-sky-tint text-sky-700",
  butter: "bg-butter text-amber-700",
  lilac: "bg-lilac text-violet-700",
};

/** Centered page column with a friendly header used by every non-chat screen. */
export function PageShell({
  title,
  description,
  icon: Icon,
  tint = "peach",
  back,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  tint?: PageTint;
  back?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl px-4 pt-5 pb-12 sm:px-6 md:px-8 md:pt-10", className)}>
      {back ? (
        <Link
          href={back.href}
          className="mb-3 -ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <header className="mb-6 flex items-start gap-3 md:mb-8 md:gap-4">
        {Icon ? (
          <span
            className={cn(
              "flex size-11 shrink-0 -rotate-6 items-center justify-center rounded-2xl shadow-warm-sm md:size-12",
              TINT_CLASSES[tint],
            )}
          >
            <Icon className="size-5 md:size-6" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-black tracking-tight break-words text-foreground md:text-3xl">
            {title}
          </h1>
          {description ? <p className="mt-1 text-sm font-medium text-muted-foreground md:text-base">{description}</p> : null}
        </div>
      </header>
      {children}
    </div>
  );
}

/** Soft dashed card for "nothing here yet" states. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-input bg-card/60 px-6 py-10 text-center">
      <PlutoMascot mood="sleeping" size={80} className="mx-auto mb-3 block" />
      <p className="text-base font-extrabold text-foreground">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/** Thinking mascot with a short line, shown above skeletons in `loading.tsx` files. */
export function LoadingNote({ text }: { text: string }) {
  return (
    <div className="mb-5 flex items-center gap-3" role="status">
      <PlutoMascot mood="thinking" size={48} />
      <p className="text-sm font-bold text-muted-foreground">{text}</p>
    </div>
  );
}
