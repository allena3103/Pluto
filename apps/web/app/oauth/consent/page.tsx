import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { approveConsent, denyConsent } from "./actions";
import { loginPathForConsent, parseAuthorizationId, redirectHost, safeClientRedirect, scopeList } from "./shared";

export const metadata: Metadata = {
  title: "Connect an app to Pluto",
};

type Details = {
  clientName: string;
  redirectHost: string;
  scopes: string[];
};

type Lookup =
  | { kind: "signed-out" }
  | { kind: "error" }
  | { kind: "redirect"; url: string }
  | { kind: "consent"; email: string; details: Details };

async function lookup(authorizationId: string): Promise<Lookup> {
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return { kind: "signed-out" };

    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) {
      if (error) console.error("oauth consent lookup failed", error.status ?? "", error.code ?? "");
      return { kind: "error" };
    }
    if (!("authorization_id" in data)) {
      // Consent was given before: Supabase returns the client redirect directly.
      const url = safeClientRedirect(data.redirect_url);
      return url ? { kind: "redirect", url } : { kind: "error" };
    }
    return {
      kind: "consent",
      email: userData.user.email ?? data.user.email,
      details: {
        clientName: data.client.name || "An app",
        redirectHost: redirectHost(data.redirect_uri),
        scopes: scopeList(data.scope),
      },
    };
  } catch (error) {
    console.error("oauth consent lookup failed", error instanceof Error ? error.name : "Error");
    return { kind: "error" };
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">{children}</Card>
    </main>
  );
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <CardHeader>
        <CardTitle className="text-xl">Connect an app</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Back to Pluto</Link>
        </Button>
      </CardContent>
    </Shell>
  );
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;

  if (params.error !== undefined) {
    return (
      <ErrorState
        title="Could not finish"
        message="This request expired or was already answered. Start the connection again from the app."
      />
    );
  }

  const authorizationId = parseAuthorizationId(params.authorization_id);
  if (!authorizationId) {
    return <ErrorState title="Invalid request" message="This link is missing a valid authorization request." />;
  }

  const result = await lookup(authorizationId);
  if (result.kind === "signed-out") redirect(loginPathForConsent(authorizationId));
  if (result.kind === "redirect") redirect(result.url);
  if (result.kind === "error") {
    return (
      <ErrorState
        title="Request not found"
        message="This request expired or is unknown. Start the connection again from the app."
      />
    );
  }

  const { details, email } = result;
  return (
    <Shell>
      <CardHeader>
        <CardTitle className="text-xl break-words">{details.clientName} wants to use Pluto</CardTitle>
        <CardDescription className="break-words">
          Signed in as <span className="font-medium text-foreground">{email}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          This app will be able to read your courses, notes, deadlines and grades. It cannot change anything.
        </p>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Sends you back to</dt>
            <dd className="font-medium break-all">{details.redirectHost}</dd>
          </div>
          {details.scopes.length > 0 ? (
            <div>
              <dt className="text-muted-foreground">Requested scopes</dt>
              <dd className="font-medium break-words">{details.scopes.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
        <form className="flex flex-col gap-2 sm:flex-row-reverse">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <Button type="submit" formAction={approveConsent} className="w-full sm:flex-1">
            Approve
          </Button>
          <Button type="submit" formAction={denyConsent} variant="outline" className="w-full sm:flex-1">
            Deny
          </Button>
        </form>
      </CardContent>
    </Shell>
  );
}
