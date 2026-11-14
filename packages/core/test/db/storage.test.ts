// Private `notes` bucket: a student reaches only objects under their own <student_id>/ folder.
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_STUDENT_EMAIL,
  DEMO_STUDENT_ID,
  OTHER_STUDENT_EMAIL,
  OTHER_STUDENT_ID,
} from "../../../../scripts/lib/seed-ids";
import { SKIP_DB_TESTS } from "../db-env";
import { anonClient, requireTestEnv, serviceClient, signIn } from "./helpers";

const PDF = { contentType: "application/pdf" };

describe.skipIf(SKIP_DB_TESTS)("notes storage bucket", () => {
  const tag = randomBytes(6).toString("hex");
  const demoPath = `${DEMO_STUDENT_ID}/rls-test-${tag}.pdf`;
  const intruderPath = `${DEMO_STUDENT_ID}/rls-intruder-${tag}.pdf`;
  const otherOwnPath = `${OTHER_STUDENT_ID}/rls-test-${tag}.pdf`;
  const body = Buffer.from(`%PDF-1.4 pluto rls test ${tag}`);
  let service: SupabaseClient;
  let demo: SupabaseClient;
  let other: SupabaseClient;

  beforeAll(async () => {
    service = serviceClient();
    demo = await signIn(DEMO_STUDENT_EMAIL, requireTestEnv("DEMO_STUDENT_PASSWORD"));
    other = await signIn(OTHER_STUDENT_EMAIL, requireTestEnv("OTHER_STUDENT_PASSWORD"));
    const { error } = await service.storage.from("notes").upload(demoPath, body, PDF);
    if (error) throw new Error(`service upload failed: ${error.message}`);
  });

  afterAll(async () => {
    if (service) await service.storage.from("notes").remove([demoPath, intruderPath, otherOwnPath]);
  });

  it("the bucket is private", async () => {
    const { data, error } = await service.storage.getBucket("notes");
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });

  it("the other student cannot download, list, overwrite or delete the demo student's file", async () => {
    const download = await other.storage.from("notes").download(demoPath);
    expect(download.error).not.toBeNull();
    expect(download.data).toBeNull();

    const list = await other.storage.from("notes").list(DEMO_STUDENT_ID);
    expect(list.data ?? []).toEqual([]);
    const rootList = await other.storage.from("notes").list("");
    expect((rootList.data ?? []).map((o) => o.name)).not.toContain(DEMO_STUDENT_ID);

    const signed = await other.storage.from("notes").createSignedUrl(demoPath, 60);
    expect(signed.error).not.toBeNull();

    const overwrite = await other.storage.from("notes").update(demoPath, Buffer.from("%PDF-1.4 overwritten"), PDF);
    expect(overwrite.error).not.toBeNull();

    await other.storage.from("notes").remove([demoPath]);
    const still = await service.storage.from("notes").download(demoPath);
    expect(still.error).toBeNull();
    expect(Buffer.from(await still.data!.arrayBuffer()).equals(body)).toBe(true);
  });

  it("the other student cannot upload into the demo student's folder", async () => {
    const upload = await other.storage.from("notes").upload(intruderPath, body, PDF);
    expect(upload.error).not.toBeNull();
    const check = await service.storage.from("notes").download(intruderPath);
    expect(check.error).not.toBeNull();
  });

  it("anonymous callers cannot download or upload", async () => {
    const anon = anonClient();
    const download = await anon.storage.from("notes").download(demoPath);
    expect(download.error).not.toBeNull();
    const upload = await anon.storage.from("notes").upload(intruderPath, body, PDF);
    expect(upload.error).not.toBeNull();
  });

  it("the demo student can download and list their own file", async () => {
    const download = await demo.storage.from("notes").download(demoPath);
    expect(download.error).toBeNull();
    expect(Buffer.from(await download.data!.arrayBuffer()).equals(body)).toBe(true);
    const list = await demo.storage.from("notes").list(DEMO_STUDENT_ID);
    expect((list.data ?? []).map((o) => o.name)).toContain(`rls-test-${tag}.pdf`);
  });

  it("positive control: a student can upload to and read from their own folder", async () => {
    const upload = await other.storage.from("notes").upload(otherOwnPath, body, PDF);
    expect(upload.error).toBeNull();
    const download = await other.storage.from("notes").download(otherOwnPath);
    expect(download.error).toBeNull();
    const demoRead = await demo.storage.from("notes").download(otherOwnPath);
    expect(demoRead.error).not.toBeNull();
  });
});
