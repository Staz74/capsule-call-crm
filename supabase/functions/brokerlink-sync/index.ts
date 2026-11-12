import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const asCount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
};
const parseDate = (value: unknown) => {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function currentZurichDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function getPublishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return keys.default || "";
  } catch {
    return "";
  }
}

async function brokerlinkJson(url: URL, apiKey: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Authorization": "Bearer " + apiKey, "Accept": "application/json" },
  });
  if (!response.ok) {
    const message = response.status === 401 ? "La clé Brokerlink a été refusée." :
      response.status === 403 ? "La clé n’a pas accès à cette API Brokerlink." :
      response.status === 422 ? "La période demandée n’est pas valide." :
      response.status === 429 ? "Limite de requêtes Brokerlink atteinte. Réessaie dans une minute." :
      "Brokerlink est momentanément indisponible (HTTP " + response.status + ").";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return await response.json();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Méthode non autorisée." }, 405);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const cronSecret = request.headers.get("x-brokerlink-sync-secret") || "";
    const projectUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = getPublishableKey();
    if ((!token && !cronSecret) || !projectUrl || !publishableKey) return reply({ error: "Session CRM invalide." }, 401);

    const supabase = createClient(projectUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
    });
    let scheduledRun = false;
    if (cronSecret) {
      const { data: validSecret, error: secretError } = await supabase.rpc("validate_brokerlink_sync_cron_secret", { p_candidate: cronSecret });
      if (secretError || validSecret !== true) return reply({ error: "Authentification de synchronisation invalide." }, 401);
      scheduledRun = true;
    } else {
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) return reply({ error: "Session CRM expirée. Reconnecte-toi." }, 401);

      const { data: profile, error: profileError } = await supabase
        .from("crm_profiles")
        .select("role,is_active")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (profileError || !profile || !profile.is_active) return reply({ error: "Compte CRM inactif ou introuvable." }, 403);
      if (!["admin", "chef_plateau", "directeur_operationnel", "imperator"].includes(profile.role)) {
        return reply({ error: "Ce rôle n’est pas autorisé à synchroniser les données de performance." }, 403);
      }
    }
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!serviceKey) return reply({ error: "La clé serveur Supabase n’est pas configurée." }, 503);
    const storageClient = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const rawApiKey = Deno.env.get("BROKERLINK_API_KEY") || "";
    const keyLines = [...rawApiKey.matchAll(/(?:^|\r?\n)\s*(\d{4}\|[A-Za-z0-9]+)\s*(?=\r?\n|$)/gm)];
    const apiKey = keyLines.length
      ? keyLines[keyLines.length - 1][1]
      : rawApiKey.trim();
    if (!apiKey) return reply({ error: "La clé API Brokerlink n’est pas encore configurée côté serveur." }, 503);

    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}
    const cutoff = "2026-09-01";
    const requestedFrom = parseDate(body.from);
    const from = requestedFrom && requestedFrom < cutoff ? cutoff : requestedFrom;
    const to = parseDate(body.to);
    const today = currentZurichDate();
    const startMs = Date.parse(from + "T12:00:00Z");
    const endMs = Date.parse(to + "T12:00:00Z");
    const span = (endMs - startMs) / 86400000 + 1;
    if (!from || !to || !Number.isFinite(span) || span < 1 || span > 92 || to > today) {
      return reply({ error: "Choisis une plage de 1 à 92 jours, jusqu’à aujourd’hui." }, 422);
    }

    const base = "https://maladie-api.brokerlink.ch";
    const collaboratorsUrl = new URL("/api/integrations/capsule-call/collaborators", base);
    const collaboratorResponse = await brokerlinkJson(collaboratorsUrl, apiKey);
    const collaboratorRows = Array.isArray(collaboratorResponse?.data) ? collaboratorResponse.data : [];
    const nameByEmail = new Map<string, string>();
    for (const person of collaboratorRows) {
      const email = normalizeEmail(person?.email);
      if (email) nameByEmail.set(email, String(person?.name || "").trim());
    }

    const { data: linkedStateRows, error: linkedStateError } = await storageClient
      .from("crm_state")
      .select("state_key,payload")
      .in("state_key", ["employees", "archivedEmployees"]);
    if (linkedStateError) throw linkedStateError;
    const linkedEmails = new Set<string>();
    for (const state of linkedStateRows || []) {
      if (!["employees", "archivedEmployees"].includes(String(state.state_key))) continue;
      const employees = Array.isArray(state.payload) ? state.payload : [];
      for (const employee of employees) {
        const email = normalizeEmail(employee?.brokerlinkEmail || employee?.brokerlink_email);
        if (email) linkedEmails.add(email);
      }
    }

    const rows: Record<string, unknown>[] = [];
    const endpoint = new URL("/api/integrations/capsule-call/daily-stats", base);
    endpoint.searchParams.set("from", from);
    endpoint.searchParams.set("to", to);
    endpoint.searchParams.set("per_page", "2000");
    let page = 1;
    let lastPage = 1;
    do {
      endpoint.searchParams.set("page", String(page));
      const result = await brokerlinkJson(endpoint, apiKey);
      const data = Array.isArray(result?.data) ? result.data : [];
      for (const row of data) {
        const email = normalizeEmail(row?.email);
        const date = parseDate(row?.date);
        if (!email || !date || date < cutoff || !linkedEmails.has(email)) continue;
        const lpp = asCount(row?.ouvertures_lpp);
        const lca = asCount(row?.signatures_lca);
        const signatures = lpp + lca;
        rows.push({
          source: "brokerlink-api",
          email,
          brokerlink_email: email,
          name: nameByEmail.get(email) || String(row?.name || row?.collaborateur || email),
          date,
          premiere_connexion: row?.premiere_connexion ?? null,
          first_login: row?.premiere_connexion ?? null,
          fiches_traitees: asCount(row?.fiches_traitees),
          appels_passes: asCount(row?.appels_passes),
          appels_repondus: asCount(row?.appels_repondus),
          rdv_pris: asCount(row?.rdv_pris),
          ouvertures_lpp: lpp,
          signatures_lca: lca,
          signatures_confirmees: signatures,
          alertes_plus_10min: asCount(row?.alertes_plus_10min),
          alertes: asCount(row?.alertes_plus_10min),
          secondes_en_ligne: asCount(row?.secondes_en_ligne),
          fuseau: String(row?.fuseau || collaboratorResponse?.timezone || "Europe/Zurich"),
        });
      }
      lastPage = Math.max(1, Number(result?.meta?.last_page) || 1);
      page++;
      if (page <= lastPage) await sleep(550);
      if (page > 101) return reply({ error: "L’import dépasse la limite de pages autorisée." }, 413);
    } while (page <= lastPage);

    const { error: kpiSaveError } = await storageClient.rpc("crm_sync_brokerlink_rows", {
      p_next: rows,
    });
    if (kpiSaveError) throw kpiSaveError;

    const rowDates = rows.map((row) => String(row.date || "")).filter(Boolean).sort();
    console.info("brokerlink-sync success", {
      requestedFrom: from, requestedTo: to, collaborators: collaboratorRows.length,
      rows: rows.length, firstDate: rowDates[0] || null, lastDate: rowDates[rowDates.length - 1] || null,
    });
    return reply({
      from, to, timezone: collaboratorResponse?.timezone || "Europe/Zurich",
      collaborators: collaboratorRows.length, linkedCollaborators: linkedEmails.size, rows,
    });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 502;
    const message = error instanceof Error ? error.message : "Erreur de synchronisation Brokerlink.";
    console.error("brokerlink-sync failure", {
      name: error instanceof Error ? error.name : typeof error,
      message: message.slice(0, 300),
      status,
    });
    return reply({ error: message }, status);
  }
});
