"use client";

import { RouteError } from "@/components/route-error";

export default function NoteFileError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load this note" retry={retry} />;
}
