"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  BookmarkCheck,
  BookOpen,
  CalendarClock,
  FileText,
  GraduationCap,
  RotateCcw,
  Sparkles,
  Square,
  type LucideIcon,
} from "lucide-react";
import { notePath } from "@pluto/core/deep-links";
import { MarkdownText } from "@/components/markdown-text";
import { type MascotMood, PlutoMascot } from "@/components/mascot/pluto-mascot";
import { useMascotMood } from "@/components/mascot/use-mascot-mood";
import { cn } from "@/lib/utils";
import { ClarifyingQuestions } from "./clarifying-questions";
import { NEW_CHAT_EVENT } from "./new-chat";
import { type ChatCitation, type ChatMessage, type QuestionAnswer, useChatStream } from "./use-chat-stream";

const SUGGESTIONS: readonly { text: string; icon: LucideIcon; className: string }[] = [
  {
    text: "What's due this week?",
    icon: CalendarClock,
    className: "bg-butter text-amber-900 hover:bg-[#ffe9a8] [&_svg]:text-amber-600",
  },
  {
    text: "How am I doing in my classes?",
    icon: GraduationCap,
    className: "bg-mint/70 text-emerald-900 hover:bg-mint [&_svg]:text-emerald-600",
  },
  {
    text: "Make me a study guide from my latest notes",
    icon: Sparkles,
    className: "bg-peach text-[#8a3a22] hover:bg-[#ffd6c0] [&_svg]:text-[#ff6b4a]",
  },
  {
    text: "Summarize my last lecture",
    icon: BookOpen,
    className: "bg-sky-tint/80 text-sky-900 hover:bg-sky-tint [&_svg]:text-sky-600",
  },
];

const COMPOSER_MAX_HEIGHT = 200;

function firstNameOf(name: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const base = trimmed.includes("@")
    ? (trimmed.split("@")[0] ?? "").split(/[._+-]/)[0] ?? ""
    : trimmed.split(/\s+/)[0] ?? "";
  if (!base) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatCitationLabel(citation: ChatCitation): string {
  if (citation.title) {
    return `${citation.title} p.${citation.page}`;
  }
  return `page ${citation.page}`;
}

function citationHref(citation: ChatCitation): string {
  return notePath(citation.fileId, citation.page);
}

function savedNoteHref(noteId: string): string {
  return `/notes/saved/${encodeURIComponent(noteId)}`;
}

const BUSY_CAPTIONS: Partial<Record<MascotMood, string>> = {
  thinking: "Thinking…",
  working: "Digging through your notes…",
};

type AssistantMessageProps = {
  message: ChatMessage;
  /** Set only on the latest assistant message; older avatars stay still. */
  liveMood?: MascotMood;
  /** Questions can be answered only on the latest assistant message. */
  canAnswer: boolean;
  busy: boolean;
  onAnswer: (answers: QuestionAnswer[]) => void;
};

function AssistantMessage({ message, liveMood, canAnswer, busy, onAnswer }: AssistantMessageProps) {
  const caption = liveMood && message.content === "" && !message.stopped ? BUSY_CAPTIONS[liveMood] : undefined;
  return (
    <div className="flex gap-3">
      <PlutoMascot mood={liveMood ?? "happy"} size={36} animated={liveMood !== undefined} className="-mt-1" />
      <div className="min-w-0 flex-1 space-y-3 pt-1 text-[0.97rem] leading-relaxed text-foreground">
        {caption && (
          <p className="flex h-7 items-center text-sm font-bold text-muted-foreground" aria-live="polite">
            <span className="sr-only">Assistant is typing. </span>
            {caption}
          </p>
        )}
        {message.content !== "" && <MarkdownText text={message.content} />}
        {message.stopped && (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Square className="size-3.5 fill-current" aria-hidden />
            You stopped this reply.
          </p>
        )}
        {message.questions && message.questions.length > 0 && !message.answered && canAnswer && (
          <ClarifyingQuestions questions={message.questions} disabled={busy} onSubmit={onAnswer} />
        )}
        {message.error && (
          <p
            className="inline-flex items-start gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {message.error}
          </p>
        )}
        {message.citations.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Sources">
            {message.citations.map((citation) => (
              <li key={`${citation.fileId}-${citation.page}-${citation.deepLink}`} className="max-w-full">
                <Link
                  href={citationHref(citation)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-input bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-warm-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                >
                  <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{formatCitationLabel(citation)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {message.savedNote && (
          <Link
            href={savedNoteHref(message.savedNote.noteId)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-mint/70 px-3 py-1.5 text-xs font-bold text-emerald-900 shadow-warm-sm transition-all hover:-translate-y-0.5 hover:bg-mint"
          >
            <BookmarkCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
            <span className="truncate">
              Saved to Notes{message.savedNote.courseName ? ` · ${message.savedNote.courseName}` : ""}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end pl-10">
      <p className="max-w-full rounded-3xl rounded-br-lg bg-[linear-gradient(135deg,#ffe3d3,#ffeccd)] px-4 py-2.5 text-[0.97rem] leading-relaxed font-semibold whitespace-pre-wrap break-words text-[#5a2a1a] shadow-warm-sm">
        {message.content}
      </p>
    </div>
  );
}

type ComposerProps = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  streaming: boolean;
  canSend: boolean;
  large?: boolean;
};

function Composer({ textareaRef, value, onChange, onKeyDown, onSubmit, onStop, streaming, canSend, large }: ComposerProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "flex items-end gap-2 rounded-[1.75rem] border border-input bg-card py-2 pr-2 pl-5 shadow-warm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15",
        large && "md:rounded-[2rem] md:py-3 md:pr-3 md:pl-6",
      )}
    >
      <label className="sr-only" htmlFor="chat-composer">
        Message
      </label>
      <textarea
        id="chat-composer"
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={streaming}
        placeholder={large ? "Ask Pluto anything…" : "Message Pluto…"}
        className={cn(
          "min-h-10 w-full min-w-0 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-60",
          large && "md:min-h-14 md:text-lg",
        )}
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop reply"
          title="Stop"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-warm transition-all hover:-translate-y-0.5 hover:shadow-warm-lg active:scale-95 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <Square className="size-4 fill-current" aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-sunrise text-white shadow-warm transition-all hover:-translate-y-0.5 hover:shadow-warm-lg active:scale-95 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:bg-none disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0"
        >
          <ArrowUp className="size-5" strokeWidth={2.75} aria-hidden />
        </button>
      )}
    </form>
  );
}

export function ChatView({ name }: { name: string | null }) {
  const {
    messages,
    composerText,
    setComposerText,
    isStreaming,
    sendMessage,
    answerQuestions,
    stop,
    retryLast,
    canRetry,
    reset,
  } = useChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const firstName = firstNameOf(name);
  const isEmpty = messages.length === 0;
  const mood = useMascotMood(messages, composerText);
  const lastAssistantId = messages.findLast((m) => m.role === "assistant")?.id;

  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [composerText, isEmpty, resizeComposer]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distance < 64);
  }, []);

  useEffect(() => {
    if (!stickToBottom) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, stickToBottom]);

  useEffect(() => {
    const onNewChat = () => {
      reset();
      setStickToBottom(true);
    };
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, [reset]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && composerText.trim()) {
        void sendMessage();
      }
    }
  };

  const composer = (
    <Composer
      textareaRef={textareaRef}
      value={composerText}
      onChange={setComposerText}
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
      onStop={stop}
      streaming={isStreaming}
      canSend={!isStreaming && composerText.trim() !== ""}
      large={isEmpty}
    />
  );

  if (isEmpty) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        <div className="m-auto w-full max-w-2xl px-4 py-8 md:py-12">
          <div className="flex flex-col items-center text-center">
            <PlutoMascot mood={mood} size={120} label={`Pluto is ${mood}`} />
            <h1 className="mt-5 text-[1.75rem] leading-tight font-black tracking-tight text-balance text-foreground md:text-[2.5rem]">
              Hey {firstName ?? "there"}!{" "}
              <span className="block">
                What are we <span className="text-sunrise">tackling</span> today?
              </span>
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted-foreground md:text-base">
              I know your notes, grades and deadlines. Ask me anything.
            </p>
          </div>

          <div className="mt-7 md:mt-9">{composer}</div>

          <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Suggestions">
            {SUGGESTIONS.map(({ text, icon: Icon, className }) => (
              <li key={text}>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => void sendMessage(text)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-left text-sm font-bold shadow-warm-sm transition-all hover:-translate-y-0.5 hover:shadow-warm active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-60",
                    className,
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        aria-label="Chat messages"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pt-6 pb-4 md:px-6 md:pt-10">
          {messages.map((message) => (
            <div key={message.id} className="motion-safe:animate-pop-in">
              {message.role === "user" ? (
                <UserMessage message={message} />
              ) : (
                <AssistantMessage
                  message={message}
                  liveMood={message.id === lastAssistantId ? mood : undefined}
                  canAnswer={message.id === lastAssistantId}
                  busy={isStreaming}
                  onAnswer={(answers) => answerQuestions(message.id, answers)}
                />
              )}
            </div>
          ))}
          <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
        </div>
      </div>

      <div className="shrink-0 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-5">
        <div className="mx-auto w-full max-w-3xl">
          {canRetry && (
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                onClick={() => retryLast()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-input bg-card px-4 py-1.5 text-sm font-bold text-foreground shadow-warm-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
              >
                <RotateCcw className="size-4" aria-hidden />
                Retry last message
              </button>
            </div>
          )}
          {composer}
          <p className="mt-2 hidden text-center text-xs font-medium text-muted-foreground/80 sm:block">
            Pluto can make mistakes, so double-check important dates.
          </p>
        </div>
      </div>
    </div>
  );
}
