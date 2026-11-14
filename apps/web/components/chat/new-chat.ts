"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Window event the chat view listens for to clear the open conversation. */
export const NEW_CHAT_EVENT = "pluto:new-chat";

/**
 * Start a fresh conversation from anywhere in the app shell. On `/` the mounted
 * chat view resets itself; elsewhere navigating to `/` mounts an empty chat.
 */
export function useStartNewChat(): () => void {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(() => {
    window.dispatchEvent(new Event(NEW_CHAT_EVENT));
    if (pathname !== "/") {
      router.push("/");
    }
  }, [pathname, router]);
}
