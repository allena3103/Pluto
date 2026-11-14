"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/route-error";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <RouteError
      title="Oops, something went sideways"
      message="This screen hit an error. Try again, or come back in a moment."
      retry={retry}
    />
  );
}
