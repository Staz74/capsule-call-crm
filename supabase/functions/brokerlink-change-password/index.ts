import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const publicKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY");
    const apiKey = Deno.env.get("BROKERLINK_API_KEY");
    if (!url || !publicKey || !serviceKey || !apiKey) {
      console.error("Configuration Brokerlink ou Supabase absente (valeurs masquées).");
      return json({ error: "Le service Brokerlink n’est pas configuré. Contacte l’administrateur." }, 503);
    }
    const authorization = req.headers.get("Authorization") || "";
    const authClient = createClient(url, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "Session invalide. Reconnecte-toi." }, 401);

    const adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: profile, error: profileError } = await adminClient.from("crm_profiles")
      .select("role,is_active").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_active || profile.role !== "admin" || user.app_metadata?.role !== "admin") {
      return json({ error: "Cette action est réservée à l’administrateur." }, 403);
    }

    const body = await req.json();
    const agent = String(body?.agent || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (agent.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agent)) {
      return json({ error: "Adresse e-mail Brokerlink invalide." }, 400);
    }
    if (password.length < 8 || password.length > 72 || /[\r\n]/.test(password)) {
      return json({ error: "Le nouveau mot de passe doit contenir de 8 à 72 caractères." }, 400);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch("https://maladie-api.brokerlink.ch/api/integrations/capsule-call/change-password", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ agent, password }),
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    if (response.status === 200) {
      const result = await response.json().catch(() => ({}));
      if (result?.updated === true) return json({ updated: true });
      return json({ error: "Brokerlink n’a pas confirmé la modification." }, 502);
    }
    if (response.status === 401) return json({ error: "La clé API Brokerlink est refusée. Vérifie sa configuration." }, 502);
    if (response.status === 403) return json({ error: "La clé API n’a pas le droit de changer les mots de passe." }, 502);
    if (response.status === 404) return json({ error: "Cette adresse n’appartient pas à un collaborateur de l’équipe Brokerlink." }, 404);
    if (response.status === 422) return json({ error: "Brokerlink a refusé les paramètres. Vérifie l’adresse et le mot de passe." }, 422);
    console.error("Brokerlink password API returned status", response.status);
    return json({ error: "Brokerlink n’a pas pu traiter la demande. Réessaie plus tard." }, 502);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return json({ error: "Brokerlink ne répond pas pour le moment. Réessaie plus tard." }, 504);
    console.error("brokerlink-change-password:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Le changement de mot de passe a échoué. Réessaie ou contacte l’administrateur." }, 502);
  }
});

