"use client";

import { useFormStatus } from "react-dom";
import { Trash2, X } from "lucide-react";
import { deleteSavedNote } from "@/app/(app)/notes/saved/[noteId]/actions";
import { cn } from "@/lib/utils";

function SubmitButton({ title, variant }: { title: string; variant: "icon" | "full" }) {
  const { pending } = useFormStatus();
  if (variant === "icon") {
    return (
      <button
        type="submit"
        disabled={pending}
        aria-label={`Delete ${title}`}
        title="Delete"
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="size-4" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-input bg-card px-4 py-2 text-sm font-bold text-red-700 shadow-warm-sm transition-all hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Trash2 className="size-4" aria-hidden />
      {pending ? "Deleting…" : "Delete this note"}
    </button>
  );
}

/** Deletes a saved chat note after a confirm. `icon` is the X on the Notes list; `full` is the detail page button. */
export function DeleteSavedNoteButton({
  noteId,
  title,
  variant,
  className,
}: {
  noteId: string;
  title: string;
  variant: "icon" | "full";
  className?: string;
}) {
  return (
    <form
      action={deleteSavedNote}
      className={cn(className)}
      onSubmit={(e) => {
        if (!window.confirm(`Delete "${title}"? This can't be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="noteId" value={noteId} />
      <SubmitButton title={title} variant={variant} />
    </form>
  );
}
