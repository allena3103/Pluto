"use client";

import { RouteError } from "@/components/route-error";

export default function GradesError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load grades" retry={retry} />;
}
