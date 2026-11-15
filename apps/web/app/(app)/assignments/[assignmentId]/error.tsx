"use client";

import { RouteError } from "@/components/route-error";

export default function AssignmentError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load this assignment" retry={retry} />;
}
