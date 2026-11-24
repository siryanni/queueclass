import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { action, lesson_id, name } = await req.json();
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "Serverkonfiguration fehlt." }, 500);
    const db = createClient(url, serviceKey);

    if (action === "start") {
      // Expire any previous session before creating a new one.
      await db.from("lessons").update({ active: false }).eq("active", true);
      
const { error: deactivateError } = await db
  .from("lessons")
  .update({ active: false })
  .eq("active", true);

if (deactivateError) {
  console.error("SESSION DEACTIVATION FAILED:", deactivateError);
  return json({ error: "Vorherige Sitzung konnte nicht beendet werden." }, 500);
}

const { data, error } = await db
  .from("lessons")
  .insert({
    name: typeof name === "string" ? name.slice(0, 60) : "Unterricht",
    active: true
  })
  .select("id,name,created_at,expires_at,active")
  .single();

if (error || !data) {
  console.error("SESSION INSERT FAILED:", error);
  return json({
    error: "Unterrichtssitzung konnte nicht gestartet werden."
  }, 500);
}

return json({ session: data });

    }

    if (action === "end" && typeof lesson_id === "string") {
      const { data: lesson, error: lookupError } = await db.from("lessons")
        .select("id,active").eq("id", lesson_id).maybeSingle();
      if (lookupError || !lesson || !lesson.active) return json({ error: "Diese Sitzung ist nicht mehr aktiv." }, 409);
      const { error: deleteError } = await db.from("messages").delete().eq("lesson_id", lesson_id);
      if (deleteError) return json({ error: "Meldungen konnten nicht gelöscht werden." }, 500);
      const { error: updateError } = await db.from("lessons").update({ active: false }).eq("id", lesson_id);
      if (updateError) return json({ error: "Sitzung konnte nicht beendet werden." }, 500);
      return json({ success: true });
    }

    return json({ error: "Unbekannte Aktion." }, 400);
  } catch {
    return json({ error: "Anfrage konnte nicht verarbeitet werden." }, 400);
  }
});
