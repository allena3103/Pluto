import { CHAT_STREAM_CONTENT_TYPE } from "@pluto/core/contract";
import { noteUrl } from "@pluto/core/deep-links";

const DEMO_FILE_ID = "00000000-0000-4000-8000-000000000101";
const DEMO_FILE_ID_2 = "00000000-0000-4000-8000-000000000102";

function encodeLine(obj: object): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Dev-only NDJSON stream that mirrors POST /api/chat. Removed before the web milestone PR.
 */
export function createChatFixtureStream(
  message: string,
  priorSessionId: string | undefined,
  signal: AbortSignal,
  origin: string,
): ReadableStream<Uint8Array> {
  const lower = message.trim().toLowerCase();
  const sessionId = priorSessionId ?? "00000000-0000-4000-8000-00000000f001";

  return new ReadableStream({
    async start(controller) {
      try {
        if (lower.includes("fixture error")) {
          await delay(80, signal);
          controller.enqueue(
            encodeLine({ type: "error", message: "The assistant could not finish that reply. Try again." }),
          );
          controller.close();
          return;
        }

        const deltas = [
          "Here is a short summary of your recent History 105 notes.\n\n",
          "Lecture themes include colonial settlement patterns and ",
          "how trade shaped early regional economies.\n\n",
          "Key terms: mercantilism, triangular trade, and the Navigation Acts.",
        ];

        for (const delta of deltas) {
          await delay(120, signal);
          controller.enqueue(encodeLine({ type: "text", delta }));
        }

        await delay(100, signal);
        controller.enqueue(
          encodeLine({
            type: "citation",
            fileId: DEMO_FILE_ID,
            page: 3,
            deepLink: noteUrl(origin, DEMO_FILE_ID, 3),
          }),
        );
        await delay(80, signal);
        controller.enqueue(
          encodeLine({
            type: "citation",
            fileId: DEMO_FILE_ID_2,
            page: 7,
            deepLink: noteUrl(origin, DEMO_FILE_ID_2, 7),
          }),
        );

        await delay(60, signal);
        controller.enqueue(encodeLine({ type: "done", sessionId }));
        controller.close();
      } catch (err) {
        if (signal.aborted) {
          controller.error(err);
          return;
        }
        throw err;
      }
    },
  });
}

export const FIXTURE_STREAM_CONTENT_TYPE = CHAT_STREAM_CONTENT_TYPE;