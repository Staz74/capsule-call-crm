(() => {
  const cfg = window.CRM_SUPABASE_CONFIG;
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  window.crmSupabase = client;
  let currentUser = null, currentProfile = null, cloudReady = false, bootstrapCodeVisible = false, accountCache = [], selectedLoginMode = "staff";
  const queues = new Map(), cloudBase = new Map();
  const $ = (id) => document.getElementById(id);
  const dataKeys = ["employees","candidates","archivedEmployees","archivedCandidates","appPermissions","tasks","taskHistory","qualityHistory","coachingHistory","synthesisActions","onboardingHistory","attendanceHistory","reports","meetings","docs","kpiRows","controlRules"];
  const storedOriginal = Storage.prototype.setItem;
  const removedOriginal = Storage.prototype.removeItem;
  const scopedKey = (key) => key.startsWith("capsule_") ? key.slice(8) : (key.startsWith("cc_onboarding_steps_") || key.startsWith("cc_attendance_")) ? "local:" + key : null;
  Storage.prototype.setItem = function(key, value) {
    storedOriginal.call(this, key, value);
    const syncKey = this === localStorage && scopedKey(String(key));
    if (syncKey && window.crmCloudSave && !(syncKey === "kpiRows" && window.crmBrokerlinkRemoteSave)) {
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
    const crmEmployees = Array.isArray(remote.get("employees")) ? remote.get("employees") : [];
    const linkedBrokerlinkEmails = new Set(crmEmployees.map((employee) => String(employee.brokerlinkEmail || employee.brokerlink_email || "").trim().toLowerCase()).filter(Boolean));
    for (const key of dataKeys) {
      if (remote.has(key)) {
        let localPayload = remote.get(key);
        if (key === "kpiRows" && Array.isArray(localPayload)) {
          localPayload = localPayload.filter((row) => {
            if (row?.source !== "brokerlink-api") return true;
            const email = String(row.email || row.brokerlink_email || "").trim().toLowerCase();
            return email && linkedBrokerlinkEmails.has(email);
          });
        }
        storedOriginal.call(localStorage, "capsule_" + key, JSON.stringify(localPayload));
      } else if (Object.prototype.hasOwnProperty.call(local, key)) {
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
      caller:["salary"],
      chef_plateau: ["dashboard","employees","profile","onboarding","performance","quality","tasks","reports"]
    };
    let configured = null;
    try { const saved = JSON.parse(localStorage.getItem("capsule_appPermissions") || "{}")?.moduleAccess?.[role]; if (Array.isArray(saved)) configured = saved; } catch {}
    const requested = configured || pages[role] || []; const allowed = role === "admin" ? pages.admin : role === "caller" ? pages.caller : [...new Set(requested.map((page) => page === "kpi" || page === "assiduity" ? "performance" : page))];
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
    accountCache = users || [];
    const table = $("accountUserList"); if (!table) return;
    table.innerHTML = users.length ? users.map((user) => `
      <div class="account-row" data-account-id="${escapeHtml(user.id)}">
        <div><b>${escapeHtml(user.display_name)}</b><small>@${escapeHtml(user.username)}${user.role === "caller" ? " · fiche #" + escapeHtml(user.employee_id) : ""}</small></div>
        <label class="account-field"><span>Rôle</span><select data-account-role>
          <option value="rh" ${user.role === "rh" ? "selected" : ""}>RH</option>
          <option value="chef_plateau" ${user.role === "chef_plateau" ? "selected" : ""}>Chef de plateau</option>
          <option value="directeur_operationnel" ${user.role === "directeur_operationnel" ? "selected" : ""}>Directeur opérationnel</option>
          <option value="imperator" ${user.role === "imperator" ? "selected" : ""}>Imperator</option>
          ${user.role === "caller" ? '<option value="caller" selected>Collaborateur · Mon salaire</option>' : ""}
        </select></label>
        <label class="account-field"><span>Accès</span><select data-account-active><option value="true" ${user.is_active ? "selected" : ""}>Actif</option><option value="false" ${!user.is_active ? "selected" : ""}>Désactivé</option></select></label>
        <button class="btn account-save" type="button" data-save-account>Enregistrer</button>
        <button class="btn account-save" type="button" data-change-account-password>Changer le mot de passe</button>
      </div>`).join("") : '<div class="empty"><b>Aucun accès créé</b>Ajoute un accès RH, chef de plateau ou directeur opérationnel ci-dessus.</div>';
  }
  async function listAccounts() {
    const { data, error } = await client.functions.invoke("manage-accounts", { body: { action:"list" } });
    if (error) throw error;
    renderAccountList(data?.users || []); renderEmployeeSalaryAccessCard();
  }
  async function invokeAdmin(body) {
    const { data, error } = await client.functions.invoke("manage-accounts", { body });
    if (error) throw new Error(data?.error || await edgeFailure(error, "La demande a échoué."));
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function setupCallerAccountFields() {
    const roleSelect = $("newUserRole");
    roleSelect?.querySelector('option[value="caller"]')?.remove();
    $("newCallerEmployeeField")?.remove();
  }
  function clearCallerCache() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("capsule_") || key.startsWith("cc_attendance_") || key.startsWith("cc_onboarding_steps_"))) removedOriginal.call(localStorage, key);
    }
  }
  async function activateCaller(profile) {
    cloudReady = false;
    clearCallerCache();
    document.body.classList.add("crm-caller");
    if (!document.getElementById("crmCallerIsolationStyle")) {
      const style = document.createElement("style"); style.id = "crmCallerIsolationStyle";
      style.textContent = "body.crm-caller .app,body.crm-caller #authGate,body.crm-caller .modalbg,body.crm-caller .toast{display:none!important}";
      document.head.appendChild(style);
    }
    document.querySelector(".app")?.remove();
    if ($("authGate")) $("authGate").hidden = true;
    document.body.classList.remove("auth-pending", "workspace-entering");
    if (!document.querySelector('link[href="./src/salary.css"]')) {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "./src/salary.css"; document.head.appendChild(css);
    }
    if (!window.crmMountSalary) await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "./src/salary.js"; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
    window.crmMountSalary(profile);
    return true;
  }
  window.crmCallerLogout = async () => {
    cloudReady = false;
    await client.auth.signOut(); currentUser = currentProfile = null; location.reload();
  };

  async function activate(session) {
    const user = session?.user;
    if (!user) return false;
    const { data: profile, error } = await client.from("crm_profiles").select("id,username,display_name,role,is_active,employee_id").eq("id", user.id).maybeSingle();
    if (error || !profile || !profile.is_active || profile.role !== user.app_metadata?.role) {
      await client.auth.signOut();
      currentUser = currentProfile = null;
      cloudReady = false;
      showMessage("loginMessage", profile?.is_active ? "Ton rôle vient d’être modifié. Reconnecte-toi pour appliquer les nouveaux droits." : "Ce compte est désactivé ou n’a pas de profil actif.");
      return false;
    }
    currentUser = user; currentProfile = profile;
    if (profile.role === "caller") return await activateCaller(profile);
    sessionStorage.removeItem("ccCallerCacheCleared");
    const displayNameField = $("ownDisplayName"); if (displayNameField) displayNameField.value = profile.display_name || "";
    const usernameField = $("ownUsername"); if (usernameField) usernameField.value = profile.username || "";
    const dashboardGreeting = document.querySelector("#screen-dashboard .head h1"), firstName = String(profile.display_name || profile.username || "").trim().split(/\s+/)[0];
    if (dashboardGreeting) dashboardGreeting.textContent = firstName ? "Bonjour " + firstName : "Bonjour";
    try { await syncState(); } catch (error) {
      console.error("CRM sync:", error); setSync("Erreur de synchronisation", true);
      showMessage("loginMessage", "Connexion réussie, mais le chargement de la base a échoué : " + (error.message || "vérifie la connexion au projet."));
      return false;
    }
    applyPermissions(profile.role);
    const badge = $("profileBadge"); if (badge) { badge.textContent = initial(profile.username); badge.title = "@" + profile.username + " · " + profile.role; }
    const name = $("activeUserName"); if (name) name.textContent = "";
    const sidebarName = $("sidebarAccountName"); if (sidebarName) sidebarName.textContent = profile.username;
    const sidebarRole = $("sidebarAccountRole"); if (sidebarRole) sidebarRole.textContent = ({admin:"Administrateur",rh:"RH",chef_plateau:"Chef de plateau",directeur_operationnel:"Directeur opérationnel",imperator:"Imperator"}[profile.role] || profile.role);
    const headerName = $("headerUserName"); if (headerName) headerName.textContent = "@" + profile.username;
    const headerUsername = $("headerUsername"); if (headerUsername) headerUsername.textContent = "";
    const headerRole = $("headerUserRole"); if (headerRole) headerRole.textContent = ({admin:"Admin",rh:"RH",chef_plateau:"Chef de plateau",directeur_operationnel:"Directeur opérationnel",imperator:"Imperator"}[profile.role] || profile.role);
    const headerBadge = $("headerProfileBadge"); if (headerBadge) { headerBadge.textContent = initial(profile.username); headerBadge.title = "@" + profile.username + " · " + profile.role; }
    const gate = $("authGate");
    if (gate) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (document.body.classList.contains("auth-pending") && !reduceMotion) {
        gate.getBoundingClientRect();
        document.body.classList.add("workspace-entering");
        gate.classList.add("auth-exiting");
        await new Promise((resolve) => setTimeout(resolve, 620));
      }
      gate.hidden = true;
      gate.classList.remove("auth-exiting");
    }
    document.body.classList.remove("auth-pending", "workspace-entering");
    $("loginForm")?.classList.remove("auth-submitting");
    if (profile.role === "admin") { setupCallerAccountFields(); listAccounts().catch((e) => { console.error(e); showMessage("accountMessage", e.message, true); }); }
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
  let employeeAccessCard = null;
  function installLoginAnimationStyles() {
    if (document.getElementById("ccLoginEffectsStyle")) return;
    const style=document.createElement("style");style.id="ccLoginEffectsStyle";
    style.textContent=`
      #crmLoginModeSelector{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 20px}
      #crmLoginModeSelector button{border:1px solid #514244;border-radius:11px;padding:11px 10px;background:#211d1d;color:#c5b9b7;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;transition:.18s}
      #crmLoginModeSelector button[aria-pressed="true"]{background:linear-gradient(110deg,#f4d7db,#e8c4ca);border-color:#edc7cd;color:#1b1515;box-shadow:0 4px 15px #0004}
      #crmLoginModeHint{grid-column:1/-1;margin:0;color:#a99c99;font-size:11px;line-height:1.45}
      .cc-employee-schedule{margin-top:14px}.cc-schedule-form{display:grid;gap:14px;padding:4px 2px 0}.cc-schedule-group{display:grid;gap:8px}.cc-schedule-group>strong{color:#f1d9df;font-size:12px}.cc-schedule-grid{display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:10px}.cc-schedule-field{display:grid;gap:6px;color:#cbbec0;font-size:11px}.cc-schedule-field input{width:100%;min-height:40px;padding:8px 10px;border:1px solid #55464a;border-radius:9px;background:#211c1d;color:#f5e8eb;color-scheme:dark;font:500 13px Inter,system-ui,sans-serif}.cc-schedule-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.cc-schedule-status{color:#b9a8ab;font-size:11px;line-height:1.45}@media(max-width:600px){.cc-schedule-footer{align-items:stretch;flex-direction:column}.cc-schedule-footer .btn{width:100%}}
      #dashEmployees .person b,#employeesTable .profile-name-button .person b{color:#f3e2e6!important;font-size:13px!important;font-weight:700;line-height:1.35;letter-spacing:.1px;text-shadow:0 1px 3px #0008}
      #ccLoginPetalsCanvas{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10020;opacity:1;transition:opacity .44s ease}
      #ccLoginTransitionCurtain{position:fixed;inset:0;z-index:10019;display:grid;place-items:center;padding:24px;pointer-events:none;overflow:hidden;background:radial-gradient(ellipse at 50% 45%,rgba(88,43,59,.66),rgba(28,15,21,.92) 72%),rgba(18,10,13,.65);backdrop-filter:blur(9px) saturate(1.12);opacity:0;animation:ccCurtainReveal .48s cubic-bezier(.22,.72,.24,1) forwards}
      #ccLoginTransitionCurtain:before,#ccLoginTransitionCurtain:after{content:"";position:absolute;left:50%;top:50%;width:min(76vw,720px);aspect-ratio:1;border:1px solid rgba(255,211,224,.13);border-radius:50%;transform:translate(-50%,-50%) scale(.35);animation:ccSakuraBloom 1.9s cubic-bezier(.16,.72,.25,1) both}
      #ccLoginTransitionCurtain:after{width:min(96vw,900px);animation-delay:.12s;border-color:rgba(255,211,224,.075)}
      .cc-transition-copy{position:relative;z-index:1;display:grid;justify-items:center;gap:10px;text-align:center;color:#f8e9ed;animation:ccTransitionRise .55s .08s cubic-bezier(.2,.72,.18,1) both}
      .cc-transition-mark{width:52px;height:52px;display:grid;place-items:center;border:1px solid #f3c5d1;border-radius:50%;background:radial-gradient(circle,#633b4a,#25131b);color:#ffe6ec;font:28px/1 Georgia,serif;box-shadow:0 0 30px #efb6c544;animation:ccFlowerTurn 3s ease-in-out infinite}
      .cc-transition-copy small{font:700 9px/1 Inter,system-ui,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#e5bac5}
      .cc-transition-copy strong{font:600 clamp(22px,3vw,30px)/1.15 "Playfair Display",Georgia,serif;letter-spacing:.01em}
      .cc-transition-copy span{font:500 12px/1.4 Inter,system-ui,sans-serif;color:#cfb8bf}
      .cc-transition-track{width:150px;height:3px;margin-top:7px;overflow:hidden;border-radius:99px;background:#f6d7e124}
      .cc-transition-track i{display:block;width:38%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#c95c7a,#ffe0e8);box-shadow:0 0 12px #f2a0b899;animation:ccTransitionTrack 1.15s ease-in-out infinite}
      #ccLoginTransitionCurtain.cc-transition-leaving{opacity:0;transition:opacity .48s ease}
      body.cc-transition-active .auth-shell{box-shadow:0 0 60px #f4d7db1a,0 22px 80px #0008}
      body.cc-transition-active .auth-brand{filter:drop-shadow(0 0 14px #f1c9d288)}
      .cc-employee-access{margin:0 0 18px!important;border-color:#493c3d!important;background:linear-gradient(140deg,#211c1d,#171515)!important}
      .cc-employee-access .cc-access-body{padding:14px 18px;display:grid;gap:12px}
      .cc-employee-access .cc-access-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .cc-employee-access input,.cc-employee-access select{width:100%;min-width:0;background:#181515;border:1px solid #514547;border-radius:9px;padding:10px 12px;color:#f5eeee}
      .cc-employee-access label{display:grid;gap:6px;color:#c5b9b7;font-size:10px}
      .cc-employee-access .cc-access-note{font-size:11px;color:#b9adab;line-height:1.5;margin:0}
      .cc-employee-access .cc-access-status{font-size:11px;color:#edc6cc;min-height:16px}
      .cc-employee-access .cc-access-topline{font-size:11px;color:#d3c4c3}
      .cc-employee-access .cc-access-topline b{color:#fff}
      .cc-employee-brokerlink{margin:0 0 16px!important;border-color:#65434c!important;background:linear-gradient(140deg,#2b2023,#1f191b)!important}
      .cc-brokerlink-body{padding:14px 18px;display:grid;gap:9px}
      .cc-brokerlink-body label{color:#e8cbd1;font-size:11px;font-weight:700}
      .cc-brokerlink-row{display:flex;align-items:center;gap:9px}
      .cc-brokerlink-row input{flex:1;min-width:0;background:#181315;border:1px solid #674852;border-radius:9px;padding:10px 12px;color:#f5e8eb}
      .cc-brokerlink-status{min-height:15px;color:#c6aaaf;font-size:10px}
      .cc-brokerlink-warning{padding:10px 12px;border:1px solid #89633c;border-radius:9px;background:#38281c;color:#ffdda0;font-size:11px;line-height:1.45}
      .attendance-kpis-new.cc-first-login-only{grid-template-columns:minmax(0,330px)}
      @keyframes ccCurtainReveal{from{opacity:0}to{opacity:1}}
      @keyframes ccSakuraBloom{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}45%{opacity:.72}100%{opacity:0;transform:translate(-50%,-50%) scale(1.18)}}
      @keyframes ccTransitionRise{from{opacity:0;transform:translateY(16px) scale(.96);filter:blur(4px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
      @keyframes ccFlowerTurn{0%,100%{transform:rotate(-8deg) scale(.96)}50%{transform:rotate(8deg) scale(1.05)}}
      @keyframes ccTransitionTrack{0%{transform:translateX(-115%)}100%{transform:translateX(285%)}}
      @media(max-width:640px){.cc-employee-access .cc-access-grid{grid-template-columns:1fr}#crmLoginModeSelector{margin-bottom:14px}.cc-transition-copy{gap:8px}}
      @media(prefers-reduced-motion:reduce){#ccLoginTransitionCurtain:before,#ccLoginTransitionCurtain:after,.cc-transition-copy,.cc-transition-mark,.cc-transition-track i{animation:none!important}#ccLoginTransitionCurtain{transition:none!important}}
    `;
    document.head.appendChild(style);
  }
  function setupLoginModePicker() {
    installLoginAnimationStyles();
    const pane=$("loginPane"),form=$("loginForm");
    if(!pane||!form||$("crmLoginModeSelector"))return;
    const switcher=document.createElement("div");switcher.id="crmLoginModeSelector";switcher.innerHTML='<button type="button" data-login-mode="staff" aria-pressed="true">Gestion du call</button><button type="button" data-login-mode="caller" aria-pressed="false">Accès collaborateur</button><p id="crmLoginModeHint">Connexion à l’espace de gestion de l’équipe.</p>';
    form.insertAdjacentElement("beforebegin",switcher);
    const apply=mode=>{
      selectedLoginMode=mode;
      switcher.querySelectorAll("[data-login-mode]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.loginMode===mode)));
      const hint=$("crmLoginModeHint");if(hint)hint.textContent=mode==="caller"?"Accès personnel à la page Mon salaire.":"Connexion à l’espace de gestion de l’équipe.";
    };
    switcher.addEventListener("click",event=>{const button=event.target.closest("[data-login-mode]");if(button)apply(button.dataset.loginMode)});
  }
  function playCherryTransition(button) {
    installLoginAnimationStyles();
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return Promise.resolve();
    document.body.classList.add("cc-transition-active");
    const curtain=document.createElement("div");
    curtain.id="ccLoginTransitionCurtain";
    const destination=selectedLoginMode==="caller"?"Ouverture de Mon salaire":"Ouverture de ton espace de travail";
    curtain.innerHTML='<div class="cc-transition-copy"><i class="cc-transition-mark" aria-hidden="true">✿</i><small>Capsule Call · Sakura</small><strong>'+destination+'</strong><span>Préparation de tes indicateurs…</span><div class="cc-transition-track" aria-hidden="true"><i></i></div></div>';
    document.body.appendChild(curtain);
    const canvas=document.createElement("canvas");canvas.id="ccLoginPetalsCanvas";document.body.appendChild(canvas);
    const ctx=canvas.getContext("2d");
    if(!ctx){canvas.remove();curtain.remove();document.body.classList.remove("cc-transition-active");return Promise.resolve()}
    const dpr=Math.min(window.devicePixelRatio||1,2),width=window.innerWidth,height=window.innerHeight;
    canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    const colors=["#f3b4c3","#ffe3e9","#d95e7d","#f8cbd4"],count=width<700?100:190;
    const petals=Array.from({length:count},()=>({x:Math.random()*width,y:Math.random()*height,vx:width*.68+Math.random()*width*.36,vy:18+Math.random()*height*.28,size:4+Math.random()*11,angle:Math.random()*6.28,spin:(Math.random()-.5)*8,phase:Math.random()*6.28,sway:12+Math.random()*38,color:colors[Math.floor(Math.random()*colors.length)],depth:.35+Math.random()*.65}));
    let raf=0,start=performance.now();const duration=2050;
    return new Promise(resolve=>{
      const draw=now=>{
        const t=Math.min(1,(now-start)/duration),ease=t*t*(3-2*t);
        ctx.clearRect(0,0,width,height);
        const bloom=Math.sin(Math.PI*t);
        ctx.save();ctx.globalAlpha=.14*bloom;ctx.strokeStyle="#ffdce5";ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(width*.5,height*.47,Math.max(12,ease*Math.min(width,height)*.76),0,Math.PI*2);ctx.stroke();ctx.restore();
        for(const petal of petals){
          const x=petal.x-width*.24+petal.vx*ease+Math.sin(t*10+petal.phase)*petal.sway+Math.sin(Math.PI*t+petal.phase)*18;
          const y=petal.y+petal.vy*t+Math.sin(t*8+petal.phase)*petal.sway*.65;
          if(x<-30||x>width+30||y<-30||y>height+30)continue;
          const flip=Math.abs(Math.cos(petal.angle+t*petal.spin));
          ctx.save();ctx.globalAlpha=(.42+.52*petal.depth)*(t>.78?(1-t)/.22:1);ctx.translate(x,y);ctx.rotate(petal.angle+t*petal.spin);ctx.scale(Math.max(.12,flip),1);
          ctx.fillStyle=petal.color;ctx.beginPath();ctx.moveTo(0,petal.size);ctx.bezierCurveTo(-petal.size*1.1,petal.size*.25,-petal.size*.8,-petal.size,0,-petal.size*1.15);ctx.bezierCurveTo(petal.size*.8,-petal.size,petal.size*1.1,petal.size*.25,0,petal.size);ctx.fill();ctx.restore();
        }
        if(t<1)raf=requestAnimationFrame(draw);
        else {
          cancelAnimationFrame(raf);
          canvas.style.opacity="0";curtain.classList.add("cc-transition-leaving");
          setTimeout(()=>{canvas.remove();curtain.remove();document.body.classList.remove("cc-transition-active");resolve()},500);
        }
      };
      raf=requestAnimationFrame(draw);
    });
  }
  function trackEmployeeProfile() {
    const wrap=(name)=>{
      const original=window[name];if(typeof original!=="function"||original.__ccTracked)return;
      const tracked=function(id,...args){window.crmSelectedProfileEmployeeId=Number(id);const result=original.call(this,id,...args);setTimeout(renderEmployeeSalaryAccessCard,0);return result};
      tracked.__ccTracked=true;window[name]=tracked;
    };
    ["openEmployeeProfile","renderProfile","crmOpenEmployeeProfile"].forEach(wrap);
    const refresh=()=>setTimeout(()=>{renderBrokerlinkEmailCard();renderEmployeeScheduleCard();renderEmployeeSalaryAccessCard();normalizeProfileAttendanceKpis()},0);
    const observe=target=>{if(target&&!target.dataset.ccProfileObserver){new MutationObserver(refresh).observe(target,{childList:true,subtree:true,characterData:true});target.dataset.ccProfileObserver="1"}};
    observe($("profileIdentity"));observe($("profileTitle"));observe($("profileContent"));
    refresh();
  }
  function normalizeProfileAttendanceKpis() {
    const host=$("profileContent"),grid=host?.querySelector(".attendance-crm-card .attendance-kpis-new");
    if(!grid)return;
    const metrics=[...grid.querySelectorAll(".attendance-kpi")];
    metrics.slice(1).forEach(item=>item.remove());
    grid.classList.add("cc-first-login-only");
  }
  function renderBrokerlinkEmailCard() {
    if(!currentProfile||currentProfile.role==="caller")return;
    const host=$("profileIdentity");if(!host)return;
    let employees=[];try{employees=JSON.parse(localStorage.getItem("capsule_employees")||"[]")}catch{}
    let employeeId=Number(window.crmSelectedProfileEmployeeId);
    if(!employeeId){const title=$("profileTitle")?.textContent?.trim();const matches=employees.filter(item=>item.name===title);if(matches.length===1)employeeId=Number(matches[0].id)}
    const employee=employees.find(item=>Number(item.id)===employeeId);if(!employee)return;
    let card=$("ccEmployeeBrokerlinkLink");
    if(!card){
      card=document.createElement("section");card.id="ccEmployeeBrokerlinkLink";card.className="panel cc-employee-brokerlink";host.insertAdjacentElement("afterend",card);
      card.addEventListener("submit",async event=>{
        const form=event.target;if(form.id!=="ccBrokerlinkEmailForm")return;
        event.preventDefault();
        const email=String(form.querySelector("[name=brokerlinkEmail]")?.value||"").trim().toLowerCase(),status=form.querySelector(".cc-brokerlink-status"),button=form.querySelector('button[type="submit"]');
        if(!email){if(status)status.textContent="Saisis l’e-mail Brokerlink pour créer le lien.";return}
        button.disabled=true;if(status)status.textContent="Enregistrement du lien…";
        try{
          let currentEmployees=[];try{currentEmployees=JSON.parse(localStorage.getItem("capsule_employees")||"[]")}catch{}
          const selectedId=Number(window.crmSelectedProfileEmployeeId),selected=currentEmployees.find(item=>Number(item.id)===selectedId);
          if(!selected)throw new Error("Fiche collaborateur introuvable. Rouvre la fiche et réessaie.");
          const duplicate=currentEmployees.find(item=>Number(item.id)!==selectedId&&String(item.brokerlinkEmail||"").trim().toLowerCase()===email);
          if(duplicate)throw new Error("Cette adresse Brokerlink est déjà liée à une autre fiche. Vérifie le compte.");
          selected.brokerlinkEmail=email;
          localStorage.setItem("capsule_employees",JSON.stringify(currentEmployees));
          const pending=queues.get("employees");if(pending)await pending;
          if(status)status.textContent="E-mail Brokerlink enregistré et synchronisé.";
          card.dataset.signature="";
          renderBrokerlinkEmailCard();
          window.renderEmployees?.();window.renderDash?.();
        }catch(error){if(status)status.textContent=error.message||"Impossible d’enregistrer cet e-mail."}
        finally{const submit=card.querySelector('button[type="submit"]');if(submit)submit.disabled=false}
      });
    }
    const email=String(employee.brokerlinkEmail||"").trim().toLowerCase(),signature=employeeId+":"+email;
    if(card.dataset.signature===signature)return;
    card.dataset.signature=signature;
    const warning=email?"":'<div class="cc-brokerlink-warning" role="alert">E-mail Brokerlink manquant : les KPI, signatures et premières connexions ne pourront pas être associés à cette fiche.</div>';
    card.innerHTML='<div class="panel-head"><div><div class="panel-title">Lien avec Brokerlink</div><div class="panel-desc">L’adresse e-mail Brokerlink sert à rapprocher les KPI et la première connexion de cette fiche.</div></div></div><div class="cc-brokerlink-body">'+warning+'<form id="ccBrokerlinkEmailForm"><label for="ccBrokerlinkEmailInput">E-mail Brokerlink</label><div class="cc-brokerlink-row"><input id="ccBrokerlinkEmailInput" name="brokerlinkEmail" type="email" autocomplete="email" maxlength="254" required value="'+escapeHtml(email)+'" placeholder="prenom.nom@brokerlink…"><button class="btn primary" type="submit">Enregistrer</button></div><small class="cc-brokerlink-status" aria-live="polite">'+(email?"Adresse liée à cette fiche.":"À renseigner pour activer le rapprochement des données.")+'</small></form></div>';
  }
  const scheduleCss=document.createElement("style");scheduleCss.textContent=".cc-employee-schedule{grid-column:1/-1!important;background:#211d1d!important;border:1px solid #493d3c!important;color:#f3ecea!important}.cc-employee-schedule .panel-head{margin-bottom:12px}.cc-schedule-form{display:grid;grid-template-columns:minmax(180px,320px) 1fr auto;gap:12px;align-items:end}.cc-schedule-select-label,.cc-schedule-field{display:grid;gap:6px;font-size:10px;font-weight:700;color:#cbbbbb}.cc-schedule-select-label select,.cc-schedule-field input{width:100%;padding:10px;border:1px solid #493d3c;border-radius:8px;background:#292323!important;color:#f3ecea!important;color-scheme:dark;font:inherit}.cc-schedule-select-label option{background:#211d1d!important;color:#f3ecea!important}.cc-schedule-status{font-size:10px;line-height:1.5;color:#cbbbbb}.cc-schedule-dialog-shade{position:fixed;inset:0;z-index:1600;display:grid;place-items:center;padding:18px;background:#000b}.cc-schedule-dialog{width:min(520px,100%);padding:22px;border:1px solid #493d3c;border-radius:16px;background:#211d1d;color:#f3ecea;box-shadow:0 24px 70px #0009}.cc-schedule-dialog h2{margin:0 0 6px;font-size:19px}.cc-schedule-dialog p{margin:0 0 16px;color:#cbbbbb;font-size:11px;line-height:1.5}.cc-schedule-modal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cc-schedule-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.cc-custom-schedule-error{display:block;color:#e59aa3;font-size:10px;margin-top:10px}@media(max-width:760px){.cc-schedule-form{grid-template-columns:1fr}.cc-schedule-form button{width:100%}}";document.head.appendChild(scheduleCss);
  function renderEmployeeScheduleCard() {
    if(!currentProfile||currentProfile.role==="caller")return;
    const host=$("profileContent"),container=host?.querySelector(".attendance-crm-card"),layout=host?.querySelector(".attendance-layout-new,.attendance-layout");if(!container||!layout)return;
    let employees=[];try{employees=JSON.parse(localStorage.getItem("capsule_employees")||"[]")}catch{}
    let employeeId=Number(window.crmSelectedProfileEmployeeId);
    if(!employeeId){const title=$("profileTitle")?.textContent?.trim();const matches=employees.filter(item=>item.name===title);if(matches.length===1)employeeId=Number(matches[0].id)}
    const employee=employees.find(item=>Number(item.id)===employeeId);if(!employee)return;
    let card=$("ccEmployeeWorkSchedule");
    if(!card){
      card=document.createElement("section");card.id="ccEmployeeWorkSchedule";card.className="panel cc-employee-schedule";
      layout.insertBefore(card,container);
      card.addEventListener("change",event=>{
        const select=event.target.closest("[name='scheduleType']");if(!select)return;
        const form=card.querySelector("#ccEmployeeWorkScheduleForm");
        if(select.value==="special"){form.dataset.previousScheduleType=select.dataset.lastScheduleType||employee.workSchedule?.type||"fullDay";openCustomScheduleDialog(form,employee.workSchedule||{});}else{select.dataset.lastScheduleType=select.value;form.dataset.previousScheduleType=select.value;}
      });
      card.addEventListener("click",async event=>{
        if(!event.target.closest("[data-save-employee-schedule]"))return;
        const form=card.querySelector("#ccEmployeeWorkScheduleForm"),status=form?.querySelector(".cc-schedule-status"),button=event.target.closest("[data-save-employee-schedule]");
        if(!form||!button)return;
        const type=form.querySelector("[name='scheduleType']")?.value||"";
        let schedule;
        if(type==="special"){try{schedule=JSON.parse(form.dataset.customSchedule||"null")}catch{}}
        else{
          let rules={};try{rules=JSON.parse(localStorage.getItem("capsule_controlRules")||"{}")}catch{}
          const template=rules.scheduleTemplates?.[type];
          if(template&&templateValid(type,template))schedule={type,timezone:"Europe/Zurich",...template};
        }
        if(!schedule){if(status)status.textContent=type==="special"?"Complète et enregistre les heures personnalisées.":"Configure d’abord cet horaire dans Paramètres → Horaires.";return;}
        button.disabled=true;if(status)status.textContent="Enregistrement des horaires…";
        try{
          let rows=[];try{rows=JSON.parse(localStorage.getItem("capsule_employees")||"[]")}catch{}
          const selected=rows.find(item=>Number(item.id)===employeeId);if(!selected)throw new Error("Fiche collaborateur introuvable. Rouvre-la puis réessaie.");
          selected.workSchedule=schedule;localStorage.setItem("capsule_employees",JSON.stringify(rows));
          const pending=queues.get("employees");if(pending)await pending;
          if(status)status.textContent="Horaire enregistré et synchronisé pour Europe/Zurich. Le retard sera calculé depuis le premier shift.";
          window.crmRebuildAutomaticLates?.();window.renderEmployees?.();window.renderDash?.();
          setTimeout(renderEmployeeScheduleCard,0);
        }catch(error){if(status)status.textContent=error.message||"Impossible d’enregistrer les horaires."}
        finally{button.disabled=false}
      });
    }
    if(card.parentElement!==layout)layout.insertBefore(card,container);
    const ws=employee.workSchedule||{},hasTimes=!!(ws.morningStart||ws.afternoonStart),type=ws.type||(hasTimes?"special":"fullDay");
    const signature=employeeId+":"+type+":"+["morningStart","morningEnd","afternoonStart","afternoonEnd"].map(key=>ws[key]||"").join("|");
    if(card.dataset.signature===signature)return;
    card.dataset.signature=signature;
    const options=[["fullDay","Journée complète"],["morning","Matinée"],["afternoon","Après-midi"],["special","Personnalisé"]].map(([value,label])=>'<option value="'+value+'"'+(type===value?" selected":"")+'>'+label+'</option>').join("");
    const description=type==="special"?"Les heures personnalisées sont enregistrées sur cette fiche et utilisées pour calculer le retard.":"Les heures de ce modèle sont définies dans Paramètres → Horaires.";
    card.innerHTML='<div class="panel-head"><div><div class="panel-title">Horaire prévu</div><div class="panel-desc">Choisis le rythme de travail de cette personne.</div></div></div><form id="ccEmployeeWorkScheduleForm" class="cc-schedule-form"><label class="cc-schedule-select-label">Type d’horaire<select name="scheduleType">'+options+'</select></label><small class="cc-schedule-status" aria-live="polite">'+description+'</small><button class="btn primary" type="button" data-save-employee-schedule>Enregistrer l’horaire</button></form>';
    const form=card.querySelector("#ccEmployeeWorkScheduleForm");
    if(type==="special")form.dataset.customSchedule=JSON.stringify({type:"special",timezone:"Europe/Zurich",morningStart:ws.morningStart||"",morningEnd:ws.morningEnd||"",afternoonStart:ws.afternoonStart||"",afternoonEnd:ws.afternoonEnd||""});
  }
  function templateValid(type,t){
    const m=!!t?.morningStart&&!!t?.morningEnd,a=!!t?.afternoonStart&&!!t?.afternoonEnd;
    if(type==="fullDay")return m&&a;if(type==="morning")return m&&!t.afternoonStart&&!t.afternoonEnd;if(type==="afternoon")return a&&!t.morningStart&&!t.morningEnd;return false;
  }
  function openCustomScheduleDialog(form,existing={}){
    if(!form)return;
    if($("ccCustomScheduleDialog"))return;
    const previous=form.dataset.previousScheduleType||"";
    const current=(()=>{try{return JSON.parse(form.dataset.customSchedule||"{}")}catch{return {}}})();
    const value=key=>current[key]||existing[key]||"";
    const shade=document.createElement("div");shade.id="ccCustomScheduleDialog";shade.className="cc-schedule-dialog-shade";
    const input=(key,label)=>'<label class="cc-schedule-field">'+label+'<input type="time" name="'+key+'" value="'+escapeHtml(value(key))+'"></label>';
    shade.innerHTML='<section class="cc-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="ccCustomScheduleTitle"><h2 id="ccCustomScheduleTitle">Horaire personnalisé</h2><p>Renseigne une ou deux plages de travail. Les heures sont enregistrées dans le fuseau suisse.</p><div class="cc-schedule-modal-grid">'+input("morningStart","Début matinée")+input("morningEnd","Fin matinée")+input("afternoonStart","Début après-midi")+input("afternoonEnd","Fin après-midi")+'</div><small class="cc-custom-schedule-error" aria-live="polite"></small><div class="cc-schedule-dialog-actions"><button type="button" class="btn" data-custom-cancel>Annuler</button><button type="button" class="btn primary" data-custom-save>Enregistrer les heures</button></div></section>';
    document.body.appendChild(shade);
    const close=()=>{shade.remove();if(!form.dataset.customSchedule){const select=form.querySelector("[name='scheduleType']");if(select&&previous)select.value=previous;}};
    shade.querySelector("[data-custom-cancel]").addEventListener("click",close);
    shade.addEventListener("click",event=>{if(event.target===shade)close()});
    shade.querySelector("[data-custom-save]").addEventListener("click",()=>{
      const get=key=>shade.querySelector('[name="'+key+'"]').value;
      const schedule={type:"special",timezone:"Europe/Zurich",morningStart:get("morningStart"),morningEnd:get("morningEnd"),afternoonStart:get("afternoonStart"),afternoonEnd:get("afternoonEnd")};
      const pairInvalid=(schedule.morningStart&&!schedule.morningEnd)||(!schedule.morningStart&&schedule.morningEnd)||(schedule.afternoonStart&&!schedule.afternoonEnd)||(!schedule.afternoonStart&&schedule.afternoonEnd);
      const hasShift=(schedule.morningStart&&schedule.morningEnd)||(schedule.afternoonStart&&schedule.afternoonEnd);
      const endInvalid=(schedule.morningStart&&schedule.morningEnd<=schedule.morningStart)||(schedule.afternoonStart&&schedule.afternoonEnd<=schedule.afternoonStart);
      if(pairInvalid||!hasShift||endInvalid){shade.querySelector(".cc-custom-schedule-error").textContent="Renseigne au moins une plage complète avec une heure de fin après le début.";return;}
      form.dataset.customSchedule=JSON.stringify(schedule);form.dataset.previousScheduleType="special";
      shade.remove();
      const status=form.querySelector(".cc-schedule-status");if(status)status.textContent="Heures personnalisées prêtes à être enregistrées sur la fiche.";
    });
  }
  function renderEmployeeSalaryAccessCard() {
    if(currentProfile?.role!=="admin")return;
    const host=$("profileIdentity");
    let employees=[];try{employees=JSON.parse(localStorage.getItem("capsule_employees")||"[]")}catch{}
    let employeeId=Number(window.crmSelectedProfileEmployeeId);
    if(!employeeId){const title=$("profileTitle")?.textContent?.trim();const matches=employees.filter(item=>item.name===title);if(matches.length===1)employeeId=Number(matches[0].id)}
    if(!host||!employeeId)return;
    const employee=employees.find(item=>Number(item.id)===employeeId);if(!employee)return;
    const access=accountCache.find(user=>user.role==="caller"&&Number(user.employee_id)===employeeId);
    let card=$("ccEmployeeSalaryAccess");
    if(!card){card=document.createElement("section");card.id="ccEmployeeSalaryAccess";card.className="panel cc-employee-access";host.insertAdjacentElement("afterend",card);
      card.addEventListener("submit",async event=>{
        event.preventDefault();const form=event.target;
        if(form.id==="ccCreateEmployeeSalaryAccess"){
          const username=form.querySelector("[name=username]").value.trim().toLowerCase(),password=form.querySelector("[name=password]").value;
          const status=form.querySelector(".cc-access-status"),submit=form.querySelector('button[type="submit"]');submit.disabled=true;status.textContent="Création de l’accès…";
          try{let currentEmployees=[];try{currentEmployees=JSON.parse(localStorage.getItem("capsule_employees")||"[]")}catch{}const selectedId=Number(window.crmSelectedProfileEmployeeId),selectedEmployee=currentEmployees.find(item=>Number(item.id)===selectedId);if(!selectedEmployee)throw new Error("Fiche collaborateur introuvable. Rouvre la fiche et réessaie.");await invokeAdmin({action:"create",username,displayName:selectedEmployee.name,role:"caller",employeeId:selectedId,password});await listAccounts();const updated=$("ccEmployeeSalaryAccess")?.querySelector(".cc-access-status");if(updated)updated.textContent="Accès créé. Transmets l’identifiant et le mot de passe à la personne en privé."}
          catch(error){status.textContent=error.message||"Impossible de créer cet accès."}
          finally{const button=$("ccEmployeeSalaryAccess")?.querySelector('button[type="submit"]');if(button)button.disabled=false}
        }else if(form.id==="ccUpdateEmployeeSalaryAccess"){
          const password=form.querySelector("[name=password]").value,active=form.querySelector("[name=active]").value==="true",status=form.querySelector(".cc-access-status"),submit=form.querySelector('button[type="submit"]');submit.disabled=true;status.textContent="Enregistrement…";
          const payload={action:"update",id:form.dataset.accountId,role:"caller",isActive:active};if(password)payload.password=password;
          try{await invokeAdmin(payload);await listAccounts();const updated=$("ccEmployeeSalaryAccess")?.querySelector(".cc-access-status");if(updated)updated.textContent=password?"Accès mis à jour et mot de passe remplacé.":"Accès mis à jour."}
          catch(error){status.textContent=error.message||"Impossible de modifier cet accès."}
          finally{const button=$("ccEmployeeSalaryAccess")?.querySelector('button[type="submit"]');if(button)button.disabled=false}
        }
      });
    }
    const signature=[employeeId,access?.id||"new",access?.is_active?"active":"off"].join(":");
    if(card.dataset.signature===signature)return;
    card.dataset.signature=signature;
    const body=access
      ? '<div class="cc-access-topline">Accès Mon salaire : <b>@'+escapeHtml(access.username)+'</b> · '+(access.is_active?"actif":"désactivé")+'</div><form id="ccUpdateEmployeeSalaryAccess" data-account-id="'+escapeHtml(access.id)+'"><div class="cc-access-grid"><label>Statut de l’accès<select name="active"><option value="true" '+(access.is_active?"selected":"")+'>Actif</option><option value="false" '+(!access.is_active?"selected":"")+'>Désactivé</option></select></label><label>Remplacer le mot de passe (facultatif)<input name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" placeholder="8 caractères minimum"></label></div><p class="cc-access-note">L’identifiant actuel est @'+escapeHtml(access.username)+'. Communique tout nouveau mot de passe directement au collaborateur.</p><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" type="submit">Enregistrer l’accès</button><span class="cc-access-status" aria-live="polite"></span></div></form>'
      : '<form id="ccCreateEmployeeSalaryAccess"><div class="cc-access-grid"><label>Identifiant à communiquer<input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autocomplete="username" value="'+escapeHtml(String(employee.name||"collaborateur").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9._-]+/g,".").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,"").slice(0,32)||"collaborateur")+'"></label><label>Mot de passe temporaire<input name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password" placeholder="8 caractères minimum"></label></div><p class="cc-access-note">Cet accès ouvrira uniquement la page Mon salaire associée à la fiche de '+escapeHtml(employee.name)+'.</p><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" type="submit">Créer l’accès Mon salaire</button><span class="cc-access-status" aria-live="polite"></span></div></form>';
    card.innerHTML='<div class="panel-head"><div><div class="panel-title">Accès collaborateur · Mon salaire</div><div class="panel-desc">Crée et gère l’accès personnel lié à cette fiche.</div></div></div><div class="cc-access-body">'+body+'</div>';
  }

  document.addEventListener("DOMContentLoaded", async () => {
    setupLoginModePicker(); trackEmployeeProfile();
    $("loginForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = $("loginForm"), button = form.querySelector('button[type="submit"]');
      const buttonLabel = button?.textContent.trim() || "Se connecter";
      const username = $("loginUsername").value.trim().toLowerCase(), password = $("loginPassword").value;
      const setBusy = (busy) => {
        form.setAttribute("aria-busy", String(busy));
        form.classList.toggle("auth-submitting", busy);
        if (button) {
          button.disabled = busy;
          button.innerHTML = busy ? '<span class="auth-button-spinner" aria-hidden="true"></span><span>Connexion…</span>' : buttonLabel;
        }
      };
      document.body.classList.add("auth-pending");
      setBusy(true);
      showMessage("loginMessage", "Vérification de vos accès…", false);
      try {
        const { data, error } = await client.auth.signInWithPassword({ email:usernameEmail(username), password });
        if (error) {
          showMessage("loginMessage", "Identifiant ou mot de passe incorrect.");
          setBusy(false);
          document.body.classList.remove("auth-pending");
          return;
        }
        const isCallerAccount = data.session?.user?.app_metadata?.role === "caller";
        if ((selectedLoginMode === "caller") !== isCallerAccount) {
          await client.auth.signOut();
          showMessage("loginMessage", selectedLoginMode === "caller" ? "Ce compte n’est pas un accès collaborateur. Choisis Gestion du call." : "Ce compte est réservé à Mon salaire. Choisis Accès collaborateur.");
          setBusy(false);
          document.body.classList.remove("auth-pending");
          return;
        }
        showMessage("loginMessage", "Ouverture de votre espace…", false);
        const transition = playCherryTransition(button);
        const activated = await activate(data.session);
        await transition;
        if (!activated) {
          setBusy(false);
          document.body.classList.remove("auth-pending", "workspace-entering");
        }
      } catch (error) {
        console.error("Connexion CRM:", error);
        showMessage("loginMessage", "Connexion impossible pour le moment. Vérifie ta connexion et réessaie.");
        setBusy(false);
        document.body.classList.remove("auth-pending", "workspace-entering");
      }
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


