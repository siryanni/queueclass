import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { lesson_id, question, initials } = await req.json();
    if (typeof lesson_id !== "string" || typeof question !== "string" || typeof initials !== "string") {
      return json({ error: "Ungültige Anfrage." }, 400);
    }
    const cleanQuestion = question.trim();
    const cleanInitials = initials.trim().toUpperCase();
    if (cleanQuestion.length < 1 || cleanQuestion.length > 200) return json({ error: "Die Frage muss zwischen 1 und 200 Zeichen lang sein." }, 400);
    if (!/^[A-ZÄÖÜ]{1,4}$/.test(cleanInitials)) return json({ error: "Das Kürzel darf 1 bis 4 Buchstaben enthalten." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "Serverkonfiguration fehlt." }, 500);

    const db = createClient(url, serviceKey);
    const { data: lesson, error: lessonError } = await db
      .from("lessons").select("id,active,expires_at").eq("id", lesson_id).maybeSingle();
    if (lessonError || !lesson || !lesson.active || new Date(lesson.expires_at).getTime() <= Date.now()) {
      return json({ error: "Diese Unterrichtssitzung ist nicht mehr aktiv." }, 409);
    }

    const { data: message, error: insertError } = await db
      .from("messages")
      .insert({ lesson_id, question: cleanQuestion, initials: cleanInitials })
      .select("id")
      .single();
    if (insertError || !message) return json({ error: "Meldung konnte nicht gespeichert werden." }, 500);

    const ownerToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const tokenHash = await sha256(ownerToken);
    const { error: ownerError } = await db.from("message_owners")
      .insert({ message_id: message.id, token_hash: tokenHash });
    if (ownerError) {
      await db.from("messages").delete().eq("id", message.id);
      return json({ error: "Meldung konnte nicht abgesichert werden." }, 500);
    }

    return json({ message_id: message.id, owner_token: ownerToken });
  } catch {
    return json({ error: "Anfrage konnte nicht verarbeitet werden." }, 400);
  }
});
