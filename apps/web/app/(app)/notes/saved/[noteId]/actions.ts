"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deletes one of the signed-in student's saved notes. RLS plus an explicit student filter. */
export async function deleteSavedNote(formData: FormData): Promise<void> {
  const noteId = formData.get("noteId");
  if (typeof noteId !== "string" || !UUID.test(noteId)) redirect("/notes");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login?next=%2Fnotes");

  const { error: deleteError } = await supabase
    .from("saved_notes")
    .delete()
    .eq("id", noteId)
    .eq("student_id", data.user.id);
  if (deleteError) throw new Error("Could not delete this note. Try again.");

  revalidatePath("/notes");
  redirect("/notes");
}
