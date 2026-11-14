"use client";

import { RouteError } from "@/components/route-error";

export default function DeadlinesError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load deadlines" retry={retry} />;
}
