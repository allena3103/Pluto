"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { notePath } from "@pluto/core/deep-links";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type ChatCitation, type ChatMessage, useChatStream } from "./use-chat-stream";

function formatCitationLabel(citation: ChatCitation): string {
  if (citation.title) {
    return `${citation.title} p.${citation.page}`;
  }
  return `page ${citation.page}`;
}

function citationHref(citation: ChatCitation): string {
  return notePath(citation.fileId, citation.page);
}

function AssistantText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="space-y-2 break-words">
      {paragraphs.map((para, index) => (
        <p key={index} className="whitespace-pre-wrap">
          {para}
        </p>
      ))}
    </div>
  );
}

function MessageBody({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>;
  }

  return (
    <div className="space-y-2">
      {message.pending && message.content === "" && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="inline-flex items-center gap-1">
            <span className="sr-only">Assistant is typing</span>
            <span className="animate-pulse">●</span>
            <span className="animate-pulse [animation-delay:150ms]">●</span>
            <span className="animate-pulse [animation-delay:300ms]">●</span>
          </span>
        </p>
      )}
      {message.content !== "" && <AssistantText text={message.content} />}
      {message.error && (
        <p className="text-sm text-destructive" role="alert">
          {message.error}
        </p>
      )}
      {message.citations.length > 0 && (
        <ul className="flex flex-wrap gap-2 pt-1">
          {message.citations.map((citation) => (
            <li key={`${citation.fileId}-${citation.page}-${citation.deepLink}`}>
              <Link
                href={citationHref(citation)}
                className="inline-flex max-w-full items-center rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
              >
                <span className="truncate">{formatCitationLabel(citation)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChatView() {
  const {
    messages,
    composerText,
    setComposerText,
    isStreaming,
    sendMessage,
    retryLast,
    canRetry,
  } = useChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 20;
    const maxHeight = lineHeight * 5 + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [composerText, resizeComposer]);

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

  return (
    <div className="-mx-4 -mt-4 flex h-[calc(100dvh-11rem-env(safe-area-inset-bottom))] min-h-0 max-w-full flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 pt-4"
        aria-label="Chat messages"
      >
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Ask about your courses, notes, or deadlines.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex w-full max-w-full", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[min(100%,20rem)] rounded-2xl px-3 py-2",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-card-foreground",
              )}
            >
              <MessageBody message={message} />
            </div>
          </div>
        ))}
        <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
      </div>

      <form
        onSubmit={onSubmit}
        className="shrink-0 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {canRetry && (
          <div className="mb-2 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => retryLast()}>
              Retry last message
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="chat-composer">
            Message
          </label>
          <textarea
            id="chat-composer"
            ref={textareaRef}
            rows={1}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isStreaming}
            placeholder="Message Pluto…"
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 field-sizing-content min-h-9 w-full min-w-0 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          />
          <Button type="submit" disabled={isStreaming || composerText.trim() === ""} className="shrink-0">
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}