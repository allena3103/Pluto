"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, BellRing, KeyRound } from "lucide-react";
import { sendSimMessage } from "@/app/(app)/sms-sim/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SimMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
};

type Note = { id: string; text: string; tone: "reply" | "error" | "info" };

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} className="break-all underline underline-offset-2">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SmsSim(props: {
  studentId: string;
  linkedPhone: string | null;
  defaultNumber: string;
  messages: SimMessage[];
}) {
  const router = useRouter();
  const [fromNumber, setFromNumber] = useState(props.defaultNumber);
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"code" | "crunch" | null>(null);

  function addNote(text: string, tone: Note["tone"]) {
    setNotes((prev) => [...prev.slice(-4), { id: crypto.randomUUID(), text, tone }]);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await sendSimMessage(fromNumber, text);
      if (!result.ok) {
        addNote(result.error, "error");
        return;
      }
      setContent("");
      // Replies to an unlinked number have no student, so they are not stored. Show them here.
      if (result.reply) addNote(`Pluto → ${fromNumber}: ${result.reply}`, "reply");
      if (result.outcome === "duplicate") addNote("Already handled that message.", "info");
      router.refresh();
    });
  }

  async function getLinkCode() {
    setBusy("code");
    try {
      const res = await fetch("/api/sms/link-code", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (!res.ok || !body?.code) {
        addNote("Could not get a link code.", "error");
        return;
      }
      setContent(`LINK ${body.code}`);
      addNote("Code ready. Pick a 555 test number above, then send.", "info");
    } catch {
      addNote("Could not get a link code.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function crunchWeek() {
    setBusy("crunch");
    try {
      const res = await fetch("/api/alerts/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: props.studentId }),
      });
      if (!res.ok) {
        addNote(res.status === 404 ? "The crunch-week alert isn't available yet." : "The crunch-week alert failed.", "error");
        return;
      }
      router.refresh();
    } catch {
      addNote("The crunch-week alert failed.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-3xl border border-border/80 bg-card p-4 text-sm shadow-warm sm:p-5">
        {props.linkedPhone ? (
          <p className="font-semibold text-muted-foreground">
            Your linked phone: <span className="font-extrabold text-foreground">{props.linkedPhone}</span>
          </p>
        ) : (
          <p className="font-semibold text-muted-foreground">
            No phone linked yet. Get a code, then text it from a 555 test number.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={getLinkCode} disabled={busy !== null}>
            <KeyRound className="size-4" aria-hidden />
            {busy === "code" ? "Getting code…" : "Get link code"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={crunchWeek} disabled={busy !== null}>
            <BellRing className="size-4" aria-hidden />
            {busy === "crunch" ? "Sending…" : "Crunch week alert"}
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-border/80 bg-card/70 p-3 shadow-warm sm:p-4">
        <ol className="flex min-w-0 flex-col gap-2" aria-label="Messages">
          {props.messages.length === 0 && (
            <li className="py-6 text-center text-sm font-semibold text-muted-foreground">No messages yet.</li>
          )}
          {props.messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed font-semibold break-words whitespace-pre-wrap",
                m.direction === "inbound"
                  ? "self-end rounded-br-lg bg-sunrise text-white shadow-warm-sm"
                  : "self-start rounded-bl-lg bg-muted text-foreground",
              )}
            >
              <Linkified text={m.body} />
            </li>
          ))}
        </ol>
      </div>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-live="polite">
          {notes.map((n) => (
            <li
              key={n.id}
              className={cn(
                "rounded-2xl px-4 py-2 text-xs font-semibold break-words",
                n.tone === "error" ? "bg-red-50 text-red-700" : "bg-butter text-amber-900",
              )}
            >
              {n.text}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={send} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-from">From number</Label>
          <Input
            id="sim-from"
            inputMode="tel"
            autoComplete="off"
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 rounded-full border border-input bg-card p-1.5 pl-4 shadow-warm focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15">
          <input
            aria-label="Message"
            placeholder="Ask about your notes, grades or deadlines"
            value={content}
            maxLength={1000}
            onChange={(e) => setContent(e.target.value)}
            className="h-9 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80"
          />
          <Button type="submit" variant="sunrise" size="icon-sm" disabled={pending || !content.trim()} aria-label="Send">
            {pending ? "…" : <ArrowUp className="size-4" strokeWidth={2.75} aria-hidden />}
          </Button>
        </div>
      </form>
    </div>
  );
}
