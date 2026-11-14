"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`. Only in production: dev reloads would otherwise
 * fight the service worker's cached app shell, and the app shell cache must
 * never serve a stale or cross-student response.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installing the service worker is an enhancement; failing silently
      // keeps the app usable without it.
    });
  }, []);

  return null;
}
