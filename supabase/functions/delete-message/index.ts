import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { message_id, owner_token } = await req.json();
    if (typeof message_id !== "string" || typeof owner_token !== "string" || owner_token.length !== 64) {
      return json({ error: "Ungültige Löschanfrage." }, 400);
    }
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "Serverkonfiguration fehlt." }, 500);
    const db = createClient(url, serviceKey);
    const tokenHash = await sha256(owner_token);
    const { data: owner, error: ownerError } = await db
      .from("message_owners").select("message_id").eq("message_id", message_id).eq("token_hash", tokenHash).maybeSingle();
    if (ownerError || !owner) return json({ error: "Du kannst nur deine eigene Meldung entfernen." }, 403);

    const { error: deleteError } = await db.from("messages").delete().eq("id", message_id);
    if (deleteError) return json({ error: "Meldung konnte nicht gelöscht werden." }, 500);
    return json({ success: true });
  } catch {
    return json({ error: "Anfrage konnte nicht verarbeitet werden." }, 400);
  }
});
