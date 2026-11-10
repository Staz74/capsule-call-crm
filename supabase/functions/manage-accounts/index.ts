import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const userPattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const loginEmail = (username: string) => `${username}@login.capsule-call.invalid`;
const roles = new Set(["rh", "chef_plateau", "directeur_operationnel", "imperator", "caller"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const publicKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(url, publicKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: "Session invalide. Reconnecte-toi." }, 401);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("crm_profiles").select("role,is_active,employee_id").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_active || profile.role !== user.app_metadata?.role) return json({ error: "Session invalide. Reconnecte-toi." }, 403);

    const body = await req.json();
    if (body.action === "check-caller-access") {
      if (profile.role !== "caller" || user.app_metadata?.role !== "caller" || !profile.employee_id) {
        return json({ error: "Cette vérification est réservée aux accès Mon Salaire." }, 403);
      }
      const { data: employeeState, error: employeeError } = await admin.from("crm_state").select("payload").eq("state_key", "employees").maybeSingle();
      if (employeeError) throw employeeError;
      const employee = (Array.isArray(employeeState?.payload) ? employeeState.payload : [])
        .find((item: any) => String(item?.id) === String(profile.employee_id) && !item.archivedAt && item.status !== "Sorti");
      if (!employee) {
        await admin.from("crm_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", user.id);
        return json({ error: "Cet accès Mon Salaire n’est plus actif." }, 403);
      }
      return json({ active: true });
    }
    if (body.action === "update-self") {
      const username = String(body.username || "").trim().toLowerCase();
      const displayName = String(body.displayName || "").trim();
      if (!userPattern.test(username) || displayName.length < 2 || displayName.length > 100) return json({ error: "Vérifie le nom affiché et l’identifiant (3 à 32 caractères)." }, 400);
      const { data: duplicate, error: duplicateError } = await admin.from("crm_profiles").select("id").eq("username", username).neq("id", user.id).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) return json({ error: "Cet identifiant est déjà utilisé. Choisis-en un autre." }, 409);
      const nextEmail = loginEmail(username);
      if (user.email !== nextEmail) {
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(user.id, { email: nextEmail, email_confirm: true });
        if (authUpdateError) return json({ error: "Cet identifiant est déjà utilisé ou ne peut pas être appliqué." }, 409);
      }
      const { data: updated, error: updateError } = await admin.from("crm_profiles").update({ username, display_name: displayName, updated_at: new Date().toISOString() }).eq("id", user.id).select("id,username,display_name,role,is_active").single();
      if (updateError) {
        if (user.email && user.email !== nextEmail) await admin.auth.admin.updateUserById(user.id, { email: user.email, email_confirm: true });
        throw updateError;
      }
      return json({ updated: true, profile: updated });
    }
    if (body.action === "deactivate-archived-callers") {
      if (!["admin", "rh", "chef_plateau"].includes(profile.role) || profile.role !== user.app_metadata?.role) {
        return json({ error: "Action réservée aux responsables autorisés." }, 403);
      }
      const { data: archivedState, error: archivedError } = await admin.from("crm_state").select("payload").eq("state_key", "archivedEmployees").maybeSingle();
      if (archivedError) throw archivedError;
      const archivedIds = new Set((Array.isArray(archivedState?.payload) ? archivedState.payload : [])
        .map((item: any) => String(item?.id || "")).filter(Boolean));
      if (!archivedIds.size) return json({ deactivated: 0 });
      const { data: callerAccounts, error: callerError } = await admin.from("crm_profiles").select("id,employee_id,is_active").eq("role", "caller");
      if (callerError) throw callerError;
      const ids = (callerAccounts || []).filter((item: any) => item.is_active && archivedIds.has(String(item.employee_id))).map((item: any) => item.id);
      if (ids.length) {
        const { error: deactivateError } = await admin.from("crm_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).in("id", ids);
        if (deactivateError) throw deactivateError;
      }
      return json({ deactivated: ids.length });
    }

    if (body.action === "salary-access-list" || body.action === "salary-access-reset") {
      let allowed = profile.role === "admin";
      if (!allowed) {
        const { data: permissionState, error: permissionError } = await admin.from("crm_state").select("payload").eq("state_key", "appPermissions").maybeSingle();
        if (permissionError) throw permissionError;
        const modules = permissionState?.payload?.moduleAccess?.[profile.role];
        allowed = Array.isArray(modules) && modules.includes("salaryAccess");
      }
      if (!allowed) return json({ error: "L’accès aux comptes Mon Salaire n’est pas autorisé pour ce rôle." }, 403);
      if (body.action === "salary-access-list") {
        const { data: employeeState, error: employeeError } = await admin.from("crm_state").select("payload").eq("state_key", "employees").maybeSingle();
        if (employeeError) throw employeeError;
        const activeIds = new Set((Array.isArray(employeeState?.payload) ? employeeState.payload : [])
          .filter((item: any) => !item.archivedAt && item.status !== "Sorti")
          .map((item: any) => String(item.id)));
        const { data: users, error: listError } = await admin.from("crm_profiles")
          .select("id,username,display_name,role,is_active,employee_id,created_at")
          .eq("role", "caller").not("employee_id", "is", null).order("display_name");
        if (listError) throw listError;
        return json({ users: (users || []).filter((item: any) => activeIds.has(String(item.employee_id))) });
      }
      const id = String(body.id || "");
      const password = String(body.password || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || password.length < 8 || password.length > 72) {
        return json({ error: "Compte ou mot de passe invalide (8 à 72 caractères)." }, 400);
      }
      const { data: target, error: targetError } = await admin.from("crm_profiles").select("id,role,employee_id").eq("id", id).maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role !== "caller" || !target.employee_id) return json({ error: "Cet accès Mon Salaire est introuvable." }, 404);
      const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password });
      if (passwordError) throw passwordError;
      const { error: profileUpdateError } = await admin.from("crm_profiles").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", id);
      if (profileUpdateError) throw profileUpdateError;
      return json({ updated: true, reactivated: true });
    }

    if (profile.role !== "admin" || user.app_metadata?.role !== "admin") return json({ error: "Réservé à l’administrateur." }, 403);
    if (body.action === "list") {
      const { data, error } = await admin.from("crm_profiles").select("id,username,display_name,role,is_active,created_at,employee_id").neq("role", "admin").order("display_name");
      if (error) throw error;
      return json({ users: data || [] });
    }

    if (body.action === "delete-crm-account") {
      const id = String(body.id || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return json({ error: "Identifiant de compte invalide." }, 400);
      }
      const crmRoles = new Set(["rh", "chef_plateau", "directeur_operationnel", "imperator"]);
      const { data: target, error: targetError } = await admin.from("crm_profiles")
        .select("id,role").eq("id", id).maybeSingle();
      if (targetError) throw targetError;
      if (!target || !crmRoles.has(target.role)) {
        return json({ error: "Seuls les comptes de gestion CRM peuvent être supprimés ici." }, 404);
      }
      const { error: deleteError } = await admin.auth.admin.deleteUser(id);
      if (deleteError) throw deleteError;
      return json({ deleted: true });
    }

    if (body.action === "create") {
      const username = String(body.username || "").toLowerCase();
      const displayName = String(body.displayName || "").trim();
      const role = String(body.role || "");
      const password = String(body.password || "");
      const employeeId = role === "caller" ? Number(body.employeeId) : null;
      if (!userPattern.test(username) || displayName.length < 2 || displayName.length > 100 || !roles.has(role) || password.length < 8 || password.length > 72 || (role === "caller" && (!Number.isSafeInteger(employeeId) || employeeId! <= 0))) {
        return json({ error: "Vérifie l’identifiant, le nom, le rôle, la fiche collaborateur et le mot de passe (8 à 72 caractères)." }, 400);
      }
      if (role === "caller") {
        const { data: employeeState, error: employeeError } = await admin.from("crm_state").select("payload").eq("state_key", "employees").maybeSingle();
        if (employeeError) throw employeeError;
        const employee = (Array.isArray(employeeState?.payload) ? employeeState.payload : []).find((item: any) => String(item?.id) === String(employeeId) && !item.archivedAt && item.status !== "Sorti");
        if (!employee) return json({ error: "Choisis une fiche collaborateur active." }, 400);
        const { data: existing, error: existingError } = await admin.from("crm_profiles").select("id").eq("employee_id", employeeId).eq("role", "caller").maybeSingle();
        if (existingError) throw existingError;
        if (existing) return json({ error: "Cette fiche possède déjà un accès Mon salaire." }, 409);
      }
      const { data, error } = await admin.auth.admin.createUser({ email: loginEmail(username), password, email_confirm: true, app_metadata: { role } });
      if (error) return json({ error: error.message }, 400);
      const { error: insertError } = await admin.from("crm_profiles").insert({ id: data.user.id, username, display_name: displayName, role, is_active: true, employee_id: employeeId });
      if (insertError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw insertError;
      }
      return json({ created: true });
    }

    if (body.action === "update") {
      const id = String(body.id || "");
      const { data: target, error: targetError } = await admin.from("crm_profiles").select("id,username,role,is_active,employee_id").eq("id", id).maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role === "admin") return json({ error: "Ce compte ne peut pas être modifié depuis cette liste." }, 404);
      const displayName = body.displayName === undefined ? undefined : String(body.displayName).trim();
      const role = body.role === undefined ? target.role : String(body.role);
      const isActive = body.isActive === undefined ? target.is_active : Boolean(body.isActive);
      if (!roles.has(role) || (displayName !== undefined && (displayName.length < 2 || displayName.length > 100)) || (role === "caller" && !target.employee_id)) return json({ error: "Informations de compte invalides. Pour créer un accès Mon salaire, passe par le formulaire de création et lie-le à une fiche." }, 400);
      if (body.password !== undefined && (String(body.password).length < 8 || String(body.password).length > 72)) return json({ error: "Le mot de passe doit contenir de 8 à 72 caractères." }, 400);
      if (body.password !== undefined || role !== target.role) {
        const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(id);
        if (getUserError) throw getUserError;
        const attributes: Record<string, unknown> = { app_metadata: { ...authUser.user.app_metadata, role } };
        if (body.password !== undefined) attributes.password = String(body.password);
        const { error } = await admin.auth.admin.updateUserById(id, attributes);
        if (error) throw error;
      }
      const update: Record<string, unknown> = { role, is_active: isActive, employee_id: role === "caller" ? target.employee_id : null, updated_at: new Date().toISOString() };
      if (displayName !== undefined) update.display_name = displayName;
      const { error } = await admin.from("crm_profiles").update(update).eq("id", id);
      if (error) throw error;
      return json({ updated: true });
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("manage-accounts:", error);
    return json({ error: "La demande n’a pas abouti. Réessaie ou vérifie les paramètres du compte." }, 400);
  }
});

