"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Sparkles } from "lucide-react";
import { judgeSignIn, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const INITIAL_STATE: SignInState = { error: null };

function DemoButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full bg-violet-600 text-white shadow-warm hover:bg-violet-700"
      disabled={pending}
    >
      <Sparkles className="size-5" aria-hidden />
      {pending ? "Opening the demo…" : "Try the demo"}
    </Button>
  );
}

/** One-click entry for visitors: a shared demo account with sample courses and notes. */
export function DemoLogin({ next }: { next: string }) {
  const [state, formAction] = useActionState(judgeSignIn, INITIAL_STATE);

  return (
    <form
      action={formAction}
      className="mb-5 space-y-3 rounded-3xl border-2 border-violet-300 bg-lilac p-5 text-center shadow-warm-lg"
    >
      <input type="hidden" name="next" value={next} />
      <p className="text-lg font-black text-violet-900">Just looking around?</p>
      <p className="text-sm font-semibold text-violet-800/80">
        One click, no sign-up. You get a demo student with sample courses, lecture notes and deadlines.
      </p>
      {state.error ? (
        <Alert variant="destructive" className="text-left">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <DemoButton />
    </form>
  );
}
