import { z } from "zod";
import { createLinkCode, issueLinkCode, LINK_CODE_PATTERN } from "@/lib/phone-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Not in contract.ts ENDPOINTS. This schema is the response contract until the director adds one.
const linkCodeResponse = z
  .object({
    code: z.string().regex(LINK_CODE_PATTERN),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const userId = !error && data.user ? data.user.id : null;

  const issued = await issueLinkCode({
    userId,
    create: () => {
      // Re-check so a missing session never constructs the service-role client.
      if (!userId) {
        throw new Error("could not issue a link code");
      }
      return createLinkCode(createAdminClient(), userId);
    },
  });

  if (issued.status === 401) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = linkCodeResponse.safeParse({ code: issued.code, expiresAt: issued.expiresAt });
  if (!parsed.success) {
    return Response.json({ error: "could not issue a link code" }, { status: 500 });
  }

  return Response.json(parsed.data);
}
