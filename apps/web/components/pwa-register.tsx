"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` (an ES module). Only in production: dev reloads
 * would otherwise fight the worker, and the worker must never serve a cached
 * authenticated page.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { type: "module" }).catch(() => {
      // Installing the service worker is an enhancement; failing silently
      // keeps the app usable without it.
    });
  }, []);

  return null;
}
