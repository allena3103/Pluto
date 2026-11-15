"use client";

import { RouteError } from "@/components/route-error";

export default function AssignmentFileError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load this attachment" retry={retry} />;
}
