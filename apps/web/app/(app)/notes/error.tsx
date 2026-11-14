"use client";

import { RouteError } from "@/components/route-error";

export default function NotesError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load notes" retry={retry} />;
}
