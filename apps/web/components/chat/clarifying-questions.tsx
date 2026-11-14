"use client";

import { useId, useState } from "react";
import { Check, Send } from "lucide-react";
import type { ClarifyingQuestion } from "@pluto/core/contract";
import { cn } from "@/lib/utils";
import type { QuestionAnswer } from "./use-chat-stream";

type Draft = { selected: string[]; text: string };

/** Single choice: a typed answer wins over a tapped one. Multiple: every pick plus the typed text. */
export function answerFor(question: ClarifyingQuestion, draft: Draft): string {
  const typed = draft.text.trim();
  if (question.multiple) return [...draft.selected, typed].filter(Boolean).join(", ");
  return typed || draft.selected[0] || "";
}

export function ClarifyingQuestions({
  questions,
  disabled,
  onSubmit,
}: {
  questions: ClarifyingQuestion[];
  disabled: boolean;
  onSubmit: (answers: QuestionAnswer[]) => void;
}) {
  const baseId = useId();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, { selected: [], text: "" }])),
  );

  const answers = questions.map((question) => ({
    prompt: question.prompt,
    answer: answerFor(question, drafts[question.id] ?? { selected: [], text: "" }),
  }));
  const ready = answers.every((a) => a.answer !== "");

  const toggle = (question: ClarifyingQuestion, option: string) => {
    setDrafts((prev) => {
      const draft = prev[question.id] ?? { selected: [], text: "" };
      const has = draft.selected.includes(option);
      const selected = question.multiple
        ? has
          ? draft.selected.filter((o) => o !== option)
          : [...draft.selected, option]
        : has
          ? []
          : [option];
      // Picking an option in a single-choice question clears the typed answer.
      const text = question.multiple || has ? draft.text : "";
      return { ...prev, [question.id]: { selected, text } };
    });
  };

  const setText = (question: ClarifyingQuestion, text: string) => {
    setDrafts((prev) => {
      const draft = prev[question.id] ?? { selected: [], text: "" };
      // Typing in a single-choice question replaces the tapped option.
      const selected = question.multiple || text.trim() === "" ? draft.selected : [];
      return { ...prev, [question.id]: { selected, text } };
    });
  };

  return (
    <form
      className="space-y-4 rounded-3xl border border-border/80 bg-card p-4 shadow-warm-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !disabled) onSubmit(answers);
      }}
    >
      {questions.map((question, index) => {
        const draft = drafts[question.id] ?? { selected: [], text: "" };
        const inputId = `${baseId}-${index}`;
        const showText = question.allowText || question.options.length === 0;
        return (
          <fieldset key={question.id} className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-extrabold text-foreground">{question.prompt}</legend>
            {question.multiple && <p className="text-xs font-semibold text-muted-foreground">Pick any that apply.</p>}
            {question.options.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={question.prompt}>
                {question.options.map((option) => {
                  const selected = draft.selected.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(question, option)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-bold transition-all focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                        selected
                          ? "border-primary bg-primary text-primary-foreground shadow-warm-sm"
                          : "border-input bg-background text-foreground hover:border-primary/40 hover:bg-accent",
                      )}
                    >
                      {selected && <Check className="size-3.5" aria-hidden />}
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
            {showText && (
              <>
                <label htmlFor={inputId} className="sr-only">
                  {question.options.length > 0 ? `Other answer to: ${question.prompt}` : question.prompt}
                </label>
                <input
                  id={inputId}
                  type="text"
                  value={draft.text}
                  maxLength={300}
                  onChange={(e) => setText(question, e.target.value)}
                  placeholder={question.options.length > 0 ? "Or type your own…" : "Type your answer…"}
                  className="h-10 w-full rounded-2xl border border-input bg-background px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground/80 focus:border-ring focus:ring-4 focus:ring-ring/15 md:text-sm"
                />
              </>
            )}
          </fieldset>
        );
      })}
      <button
        type="submit"
        disabled={!ready || disabled}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-sunrise px-4 py-2 text-sm font-bold text-white shadow-warm transition-all hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:bg-none disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0"
      >
        <Send className="size-4" aria-hidden />
        Send answers
      </button>
    </form>
  );
}
