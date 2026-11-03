(() => {
  const cfg = window.CRM_SUPABASE_CONFIG;
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  window.crmSupabase = client;
  let currentUser = null, currentProfile = null, cloudReady = false, bootstrapCodeVisible = false;
  const queues = new Map(), cloudBase = new Map();
  const $ = (id) => document.getElementById(id);
  const dataKeys = ["employees","candidates","archivedEmployees","archivedCandidates","appPermissions","tasks","taskHistory","qualityHistory","coachingHistory","synthesisActions","onboardingHistory","attendanceHistory","reports","meetings","docs","kpiRows","controlRules"];
  const storedOriginal = Storage.prototype.setItem;
  const removedOriginal = Storage.prototype.removeItem;
  const scopedKey = (key) => key.startsWith("capsule_") ? key.slice(8) : (key.startsWith("cc_onboarding_steps_") || key.startsWith("cc_attendance_")) ? "local:" + key : null;
  Storage.prototype.setItem = function(key, value) {
    storedOriginal.call(this, key, value);
    const syncKey = this === localStorage && scopedKey(String(key));
    if (syncKey && window.crmCloudSave) {
      let payload = value;
      try { payload = JSON.parse(value); } catch {}
      window.crmCloudSave(syncKey, payload);
    }
  };
  Storage.prototype.removeItem = function(key) {
    removedOriginal.call(this, key);
    const syncKey = this === localStorage && scopedKey(String(key));
    if (syncKey && window.crmCloudDelete) window.crmCloudDelete(syncKey);
  };

  const showMessage = (id, message, error = true) => {
    const el = $(id); if (!el) return;
    el.textContent = message; el.classList.toggle("auth-error", error); el.classList.toggle("auth-success", !error);
  };
  const edgeFailure = async (error, fallback) => {
    if (error?.context && typeof error.context.json === "function") {
      try { const body = await error.context.json(); if (typeof body?.error === "string") return body.error; } catch {}
    }
    return error?.message || fallback;
  };
  const usernameEmail = (name) => String(name).trim().toLowerCase() + "@login.capsule-call.invalid";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const initial = (name) => String(name || "U").trim().split(/\s+/).map((x) => x[0] || "").join("").slice(0,2).toUpperCase();
  const setSync = (label, failed = false) => {
    const el = $("crmSyncStatus"); if (!el) return;
    el.textContent = label; el.classList.toggle("sync-error", failed); el.classList.toggle("sync-ok", !failed);
  };

  window.crmCloudSave = (key, payload) => {
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      if (!currentUser || !cloudReady) return;
      const { error } = await client.rpc("crm_merge_state", {
        p_state_key: key, p_base: cloudBase.get(key) ?? null, p_next: payload
      });
      if (error) throw error;
      cloudBase.set(key, payload);
      setSync("Synchronisé");
    });
    queues.set(key, next);
    next.catch((error) => { console.error("CRM cloud save:", key, error); setSync("Erreur de synchronisation", true); });
    return next;
  };
  window.crmCloudDelete = (key) => {
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      if (!currentUser || !cloudReady) return;
      const { error } = await client.from("crm_state").delete().eq("state_key", key);
      if (error) throw error;
      setSync("Synchronisé");
    });
    queues.set(key, next);
    next.catch((error) => { console.error("CRM cloud delete:", key, error); setSync("Erreur de synchronisation", true); });
  };

  async function syncState() {
    setSync("Synchronisation…");
    const { data, error } = await client.from("crm_state").select("state_key,payload");
    if (error) throw error;
    const rows = data || [];
    const remote = new Map(rows.map((row) => [row.state_key, row.payload]));
    cloudBase.clear(); for (const [key, payload] of remote) cloudBase.set(key, payload);
    const local = typeof window.crmGetLocalState === "function" ? window.crmGetLocalState() : {};
    if (rows.length === 0) {
      const firstState = dataKeys.map((key) => ({ state_key: key, payload: local[key] ?? null, updated_by: currentUser.id }));
      for (let i = firstState.length - 1; i >= 0; i--) if (firstState[i].payload === null) firstState.splice(i, 1);
      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i), key = storageKey && scopedKey(storageKey);
        if (key && key.startsWith("local:")) {
          try { firstState.push({ state_key:key, payload:JSON.parse(localStorage.getItem(storageKey)), updated_by:currentUser.id }); } catch {}
        }
      }
      if (firstState.length) {
        const { error: seedError } = await client.from("crm_state").upsert(firstState, { onConflict:"state_key" });
        if (seedError) throw seedError;
      }
      for (const row of firstState) { remote.set(row.state_key, row.payload); cloudBase.set(row.state_key, row.payload); }
    }
    for (const key of dataKeys) {
      if (remote.has(key)) storedOriginal.call(localStorage, "capsule_" + key, JSON.stringify(remote.get(key)));
      else if (Object.prototype.hasOwnProperty.call(local, key)) {
        storedOriginal.call(localStorage, "capsule_" + key, JSON.stringify(local[key]));
        const { error: seedError } = await client.from("crm_state").upsert({ state_key:key, payload:local[key], updated_by:currentUser.id }, { onConflict:"state_key" });
        if (seedError) throw seedError;
        cloudBase.set(key, local[key]);
      }
    }
    for (const [key, payload] of remote) {
      if (key.startsWith("local:")) storedOriginal.call(localStorage, key.slice(6), JSON.stringify(payload));
      cloudBase.set(key, payload);
    }
    cloudReady = true;
    setSync("Synchronisé");
  }

  function applyPermissions(role) {
    const pages = {
      admin: ["dashboard","candidates","employees","employee-archive","profile","onboarding","performance","quality","tasks","reports","synthesis","documents","control","settings"],
      rh: ["dashboard","candidates","employees","employee-archive","profile","onboarding","performance","quality","tasks","reports","documents"],
      directeur_operationnel:["synthesis"],
      imperator:["synthesis"],
      chef_plateau: ["dashboard","employees","profile","onboarding","performance","quality","tasks","reports"]
    };
    let configured = null;
    try { const saved = JSON.parse(localStorage.getItem("capsule_appPermissions") || "{}")?.moduleAccess?.[role]; if (Array.isArray(saved)) configured = saved; } catch {}
    const requested = configured || pages[role] || []; const allowed = role === "admin" ? pages.admin : [...new Set(requested.map((page) => page === "kpi" || page === "assiduity" ? "performance" : page))];
    const uploadControls = document.querySelector(".doc-upload-controls"); if (uploadControls) uploadControls.hidden = !(role === "admin" || role === "rh");
    document.querySelectorAll("#nav [data-page]").forEach((button) => { button.hidden = !allowed.includes(button.dataset.page); });
    document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = role !== "admin"; });
    window.crmCanPage = (page) => allowed.includes(page);
    window.crmFirstAllowedPage = () => allowed[0] || "dashboard";
    const activePage = document.querySelector(".screen.active")?.id.replace("screen-", "");
    if (activePage && !allowed.includes(activePage)) {
      const target = allowed[0] || "dashboard";
      if (typeof window.crmGo === "function") window.crmGo(target);
      else { document.querySelectorAll(".screen").forEach((screen) => { screen.classList.toggle("active", screen.id === "screen-" + target); }); }
    }
  }
  window.crmCurrentRole = () => currentProfile?.role || "";
  window.crmCurrentProfile = () => currentProfile;
  window.crmCanPage = () => false;

  function renderAccountList(users) {
    const table = $("accountUserList"); if (!table) return;
    table.innerHTML = users.length ? users.map((user) => `
      <div class="account-row" data-account-id="${escapeHtml(user.id)}">
        <div><b>${escapeHtml(user.display_name)}</b><small>@${escapeHtml(user.username)}</small></div>
        <label class="account-field"><span>Rôle</span><select data-account-role>
          <option value="rh" ${user.role === "rh" ? "selected" : ""}>RH</option>
          <option value="chef_plateau" ${user.role === "chef_plateau" ? "selected" : ""}>Chef de plateau</option>
          <option value="directeur_operationnel" ${user.role === "directeur_operationnel" ? "selected" : ""}>Directeur opérationnel</option>
          <option value="imperator" ${user.role === "imperator" ? "selected" : ""}>Imperator</option>
        </select></label>
        <label class="account-field"><span>Accès</span><select data-account-active><option value="true" ${user.is_active ? "selected" : ""}>Actif</option><option value="false" ${!user.is_active ? "selected" : ""}>Désactivé</option></select></label>
        <button class="btn account-save" type="button" data-save-account>Enregistrer</button>
        <button class="btn account-save" type="button" data-change-account-password>Changer le mot de passe</button>
      </div>`).join("") : '<div class="empty"><b>Aucun accès créé</b>Ajoute un accès RH, chef de plateau ou directeur opérationnel ci-dessus.</div>';
  }
  async function listAccounts() {
    const { data, error } = await client.functions.invoke("manage-accounts", { body: { action:"list" } });
    if (error) throw error;
    renderAccountList(data?.users || []);
  }
  async function invokeAdmin(body) {
    const { data, error } = await client.functions.invoke("manage-accounts", { body });
    if (error) throw new Error(data?.error || await edgeFailure(error, "La demande a échoué."));
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function activate(session, reload = false) {
    const user = session?.user;
    if (!user) return false;
    const { data: profile, error } = await client.from("crm_profiles").select("id,username,display_name,role,is_active").eq("id", user.id).maybeSingle();
    if (error || !profile || !profile.is_active || profile.role !== user.app_metadata?.role) {
      await client.auth.signOut();
      currentUser = currentProfile = null;
      cloudReady = false;
      showMessage("loginMessage", profile?.is_active ? "Ton rôle vient d’être modifié. Reconnecte-toi pour appliquer les nouveaux droits." : "Ce compte est désactivé ou n’a pas de profil actif.");
      return false;
    }
    currentUser = user; currentProfile = profile;
    const displayNameField = $("ownDisplayName"); if (displayNameField) displayNameField.value = profile.display_name || "";
    const usernameField = $("ownUsername"); if (usernameField) usernameField.value = profile.username || "";
    const dashboardGreeting = document.querySelector("#screen-dashboard .head h1"), firstName = String(profile.display_name || profile.username || "").trim().split(/\s+/)[0];
    if (dashboardGreeting) dashboardGreeting.textContent = firstName ? "Bonjour " + firstName : "Bonjour";
    try { await syncState(); } catch (error) {
      console.error("CRM sync:", error); setSync("Erreur de synchronisation", true);
      showMessage("loginMessage", "Connexion réussie, mais le chargement de la base a échoué : " + (error.message || "vérifie la connexion au projet."));
      return false;
    }
    if (reload) { location.reload(); return true; }
    applyPermissions(profile.role);
    const badge = $("profileBadge"); if (badge) { badge.textContent = initial(profile.username); badge.title = "@" + profile.username + " · " + profile.role; }
    const name = $("activeUserName"); if (name) name.textContent = "";
    const sidebarName = $("sidebarAccountName"); if (sidebarName) sidebarName.textContent = profile.username;
    const sidebarRole = $("sidebarAccountRole"); if (sidebarRole) sidebarRole.textContent = ({admin:"Administrateur",rh:"RH",chef_plateau:"Chef de plateau",directeur_operationnel:"Directeur opérationnel",imperator:"Imperator"}[profile.role] || profile.role);
    const headerName = $("headerUserName"); if (headerName) headerName.textContent = "@" + profile.username;
    const headerUsername = $("headerUsername"); if (headerUsername) headerUsername.textContent = "";
    const headerRole = $("headerUserRole"); if (headerRole) headerRole.textContent = ({admin:"Admin",rh:"RH",chef_plateau:"Chef de plateau",directeur_operationnel:"Directeur opérationnel",imperator:"Imperator"}[profile.role] || profile.role);
    const headerBadge = $("headerProfileBadge"); if (headerBadge) { headerBadge.textContent = initial(profile.username); headerBadge.title = "@" + profile.username + " · " + profile.role; }
    const gate = $("authGate"); if (gate) gate.hidden = true;
    if (profile.role === "admin") listAccounts().catch((e) => { console.error(e); showMessage("accountMessage", e.message, true); });
    return true;
  }

  async function checkBootstrapStatus() {
    try {
      const { data, error } = await client.functions.invoke("bootstrap-admin", { body: { action:"status" } });
      if (error) throw error;
      const button = $("showBootstrap");
      if (data?.needsAdminSetup && button) button.hidden = false;
    } catch (error) { console.warn("Bootstrap status unavailable:", error); }
  }


  window.crmResetAllData = async () => {
    if (!currentUser || currentProfile?.role !== "admin" || !cloudReady) throw new Error("Action réservée à l’administrateur connecté.");
    cloudReady = false;
    const { error } = await client.from("crm_state").delete().neq("state_key", "");
    if (error) { cloudReady = true; throw error; }
    queues.clear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && scopedKey(key)) removedOriginal.call(localStorage, key);
    }
    const state = typeof window.crmGetLocalState === "function" ? window.crmGetLocalState() : {};
    for (const key of dataKeys) {
      const empty = key === "controlRules" ? state.controlRules : key === "appPermissions" ? { deleteEmployeeRoles:["Administrateur"] }
        : key === "onboardingHistory" ? {} : [];
      storedOriginal.call(localStorage, "capsule_" + key, JSON.stringify(empty));
    }
  };
  document.addEventListener("DOMContentLoaded", async () => {
    $("loginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = $("loginUsername").value.trim().toLowerCase(), password = $("loginPassword").value;
      showMessage("loginMessage", "Connexion…", false);
      const { data, error } = await client.auth.signInWithPassword({ email:usernameEmail(username), password });
      if (error) { showMessage("loginMessage", "Identifiant ou mot de passe incorrect."); return; }
      showMessage("loginMessage", "Connexion en cours…", false);
      await activate(data.session, true);
    });
    $("showBootstrap")?.addEventListener("click", () => {
      bootstrapCodeVisible = !bootstrapCodeVisible;
      $("bootstrapPane").hidden = !bootstrapCodeVisible;
      $("loginPane").hidden = bootstrapCodeVisible;
    });
    $("backToLogin")?.addEventListener("click", () => { $("bootstrapPane").hidden = true; $("loginPane").hidden = false; });
    $("bootstrapForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = $("bootstrapUsername").value.trim().toLowerCase(), password = $("bootstrapPassword").value;
      if (password !== $("bootstrapPasswordConfirm").value) { showMessage("bootstrapMessage", "Les deux mots de passe ne correspondent pas."); return; }
      let backupValues = null;
      const backupFile = $("bootstrapBackup")?.files?.[0];
      if (backupFile) {
        try {
          const backup = JSON.parse((await backupFile.text()).replace(/^\uFEFF/, ""));
          if (backup?.source !== "CapsuleCall" || !backup.data || typeof backup.data !== "object") throw new Error("Sauvegarde Capsule Call non reconnue.");
          backupValues = Object.entries(backup.data).filter(([key]) => dataKeys.some((stateKey) => key === "capsule_" + stateKey) || key.startsWith("cc_onboarding_steps_") || key.startsWith("cc_attendance_"));
          if (!backupValues.length) throw new Error("La sauvegarde ne contient pas de données CRM compatibles.");
        } catch (error) { showMessage("bootstrapMessage", error.message || "Impossible de lire la sauvegarde."); return; }
      }
      showMessage("bootstrapMessage", "Création du compte administrateur…", false);
      const { data, error } = await client.functions.invoke("bootstrap-admin", { body: {
        action:"create", bootstrapCode:$("bootstrapCode").value.trim(), username,
        displayName:$("bootstrapName").value.trim(), password
      }});
      if (error || data?.error) { showMessage("bootstrapMessage", data?.error || (error ? await edgeFailure(error, "La création du compte a échoué.") : "La création du compte a échoué.")); return; }
      if (backupValues) for (const [key, value] of backupValues) storedOriginal.call(localStorage, key, JSON.stringify(value));
      const { error: signInError } = await client.auth.signInWithPassword({ email:usernameEmail(username), password });
      if (signInError) { showMessage("bootstrapMessage", "Compte créé. Recharge la page puis connecte-toi avec ton identifiant et ton mot de passe."); return; }
      if (!backupValues) {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && (key.startsWith("capsule_") || key.startsWith("cc_onboarding_steps_") || key.startsWith("cc_attendance_"))) removedOriginal.call(localStorage, key);
        }
      }
      location.reload();
    });
    const logout = async () => { cloudReady = false; await client.auth.signOut(); currentUser = currentProfile = null; location.reload(); };
    $("logoutBtn")?.addEventListener("click", logout);
    $("headerLogoutBtn")?.addEventListener("click", logout);
    $("changeOwnProfile")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = $("ownUsername").value.trim().toLowerCase(), displayName = $("ownDisplayName").value.trim();
      showMessage("profileMessage", "Mise \u00e0 jour du profil...", false);
      try {
        const result = await invokeAdmin({ action:"update-self", username, displayName });
        currentProfile = result.profile;
        $("ownDisplayName").value = result.profile.display_name;
        $("ownUsername").value = result.profile.username;
        const firstName = String(result.profile.display_name || result.profile.username).trim().split(/\s+/)[0];
        const greeting = document.querySelector("#screen-dashboard .head h1"); if (greeting) greeting.textContent = firstName ? "Bonjour " + firstName : "Bonjour";
        const sidebarName = $("sidebarAccountName"); if (sidebarName) sidebarName.textContent = result.profile.username;
        const headerName = $("headerUserName"); if (headerName) headerName.textContent = "@" + result.profile.username;
        const badge = $("profileBadge"); if (badge) { badge.textContent = initial(result.profile.username); badge.title = "@" + result.profile.username + " · " + result.profile.role; }
        const headerBadge = $("headerProfileBadge"); if (headerBadge) { headerBadge.textContent = initial(result.profile.username); headerBadge.title = "@" + result.profile.username + " · " + result.profile.role; }
        showMessage("profileMessage", "Profil mis \u00e0 jour. Utilise le nouvel identifiant lors de ta prochaine connexion.", false);
      } catch (error) { showMessage("profileMessage", error.message || "La mise \u00e0 jour du profil a echou\u00e9."); }
    });
    $("changeOwnPassword")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = $("ownPassword").value;
      if (password !== $("ownPasswordConfirm").value) { showMessage("accountMessage", "Les deux mots de passe ne correspondent pas."); return; }
      const { error } = await client.auth.updateUser({ password });
      if (error) { showMessage("accountMessage", error.message); return; }
      $("changeOwnPassword").reset(); showMessage("accountMessage", "Ton mot de passe a été modifié.", false);
    });
    $("createStaffAccount")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      showMessage("accountMessage", "Création du compte…", false);
      try {
        await invokeAdmin({ action:"create", username:$("newUsername").value.trim().toLowerCase(), displayName:$("newDisplayName").value.trim(), role:$("newUserRole").value, password:$("newUserPassword").value });
        $("createStaffAccount").reset(); await listAccounts(); showMessage("accountMessage", "Accès créé. Transmets l’identifiant et le mot de passe à la personne concernée.", false);
      } catch (error) { showMessage("accountMessage", error.message); }
    });
    $("accountUserList")?.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-account-id]"); if (!row) return;
      try {
        if (event.target.closest("[data-save-account]")) {
          await invokeAdmin({ action:"update", id:row.dataset.accountId, role:row.querySelector("[data-account-role]").value, isActive:row.querySelector("[data-account-active]").value === "true" });
          await listAccounts(); showMessage("accountMessage", "Compte mis à jour. Si le rôle a changé, la personne devra se reconnecter.", false);
        } else if (event.target.closest("[data-change-account-password]")) {
          const password = prompt("Nouveau mot de passe (8 caractères minimum). Il sera communiqué manuellement à la personne :");
          if (password === null) return;
          await invokeAdmin({ action:"update", id:row.dataset.accountId, password });
          showMessage("accountMessage", "Mot de passe modifié. Communique-le à la personne concernée.", false);
        }
      } catch (error) { showMessage("accountMessage", error.message); }
    });
    await checkBootstrapStatus();
    const { data: { session } } = await client.auth.getSession();
    if (session) await activate(session);
  });
})();


