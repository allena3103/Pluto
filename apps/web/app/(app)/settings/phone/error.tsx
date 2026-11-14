"use client";

import { RouteError } from "@/components/route-error";

export default function PhoneError({ retry }: { retry: () => void }) {
  return <RouteError title="Could not load phone settings" retry={retry} />;
}
