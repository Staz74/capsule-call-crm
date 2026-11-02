import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const userPattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const loginEmail = (username: string) => `${username}@login.capsule-call.invalid`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const body = await req.json();
    if (body.action === "status") {
      const { count, error } = await admin.from("crm_profiles").select("id", { count: "exact", head: true });
      if (error) throw error;
      return json({ needsAdminSetup: count === 0 });
    }
    if (body.action !== "create" || !userPattern.test(String(body.username || "")) || typeof body.displayName !== "string" || body.displayName.trim().length < 2 || String(body.displayName).length > 100 || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72 || typeof body.bootstrapCode !== "string") {
      return json({ error: "Identifiant invalide, nom incomplet ou mot de passe (8 à 72 caractères) invalide." }, 400);
    }
    const username = body.username.toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.bootstrapCode));
    const tokenHash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
    const claimId = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("crm_claim_bootstrap", { p_token_hash: tokenHash, p_claim_id: claimId });
    if (claimError) throw claimError;
    if (!claimed) return json({ error: "Le code est incorrect ou a déjà été utilisé." }, 403);

    let userId: string | null = null;
    try {
      const { data, error } = await admin.auth.admin.createUser({
        email: loginEmail(username),
        password: body.password,
        email_confirm: true,
        app_metadata: { role: "admin" },
      });
      if (error) throw error;
      userId = data.user.id;
      const { error: profileError } = await admin.from("crm_profiles").insert({
        id: userId, username, display_name: body.displayName.trim(), role: "admin", is_active: true,
      });
      if (profileError) throw profileError;
      const { data: finished, error: finishError } = await admin.rpc("crm_finish_bootstrap", { p_claim_id: claimId, p_success: true });
      if (finishError || !finished) throw finishError || new Error("Impossible de finaliser l’activation.");
      return json({ created: true });
    } catch (error) {
      if (userId) await admin.auth.admin.deleteUser(userId);
      await admin.rpc("crm_finish_bootstrap", { p_claim_id: claimId, p_success: false });
      throw error;
    }
  } catch (error) {
    console.error("bootstrap-admin:", error);
    return json({ error: "La création du compte admin a échoué. Vérifie les champs et réessaie." }, 400);
  }
});


