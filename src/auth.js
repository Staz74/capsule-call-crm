(() => {
  const cfg = window.CRM_SUPABASE_CONFIG;
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  window.crmSupabase = client;
  let currentUser = null, currentProfile = null, cloudReady = false, bootstrapCodeVisible = false, accountCache = [], selectedLoginMode = "staff";
  let liveEmployeeStateVersion = null, liveCollaboratorRefreshPending = false, liveCollaboratorRefreshTimer = null, liveCollaboratorWatcherStarted = false, liveCollaboratorLogWarned = false;
  const liveStateVersions = new Map();
  const queues = new Map(), cloudBase = new Map();
  const $ = (id) => document.getElementById(id);
  function normalizeEmployeeStatuses(input) { return (Array.isArray(input)?input:[]).map(employee=>employee?.status==="Actif"?{...employee,status:"Autonome"}:employee); }
  function taskBoardDate() { return typeof dashboardZurichDate === "function" ? dashboardZurichDate() : new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Zurich",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
  function normalizeTaskList(input, resetOldDone = false) {
    const today = taskBoardDate();
    return (Array.isArray(input) ? input : []).filter(task => {
      const title = String(task?.title || task?.name || "").trim();
      const action = String(task?.action || "");
      const lower = title.toLocaleLowerCase("fr");
      if (!title || ["ouvrir le formulaire","enregistrer le compte rendu"].includes(lower)) return false;
      if (/days$/i.test(action) && String(task?.source || "").toLocaleLowerCase("fr").includes("contrôle")) return false;
      if (resetOldDone && ["Terminée","Terminé","Effectué","Done"].includes(String(task?.status || ""))) {
        const completed = String(task.completedOn || task.completed_on || task.completedAt || task.completed_at || "").slice(0,10);
        if (!completed || completed < today) return false;
      }
      return true;
    }).map(task => ["En cours","In progress"].includes(String(task.status || "")) ? { ...task, status:"À faire" } : task);
  }
  const dataKeys = ["employees","candidates","archivedEmployees","archivedCandidates","appPermissions","tasks","taskHistory","qualityHistory","coachingHistory","synthesisActions","onboardingHistory","attendanceHistory","reports","meetings","docs","kpiRows","controlRules"];
  const storedOriginal = Storage.prototype.setItem;
  const removedOriginal = Storage.prototype.removeItem;
  const scopedKey = (key) => key.startsWith("capsule_") ? key.slice(8) : (key.startsWith("cc_onboarding_steps_") || key.startsWith("cc_attendance_")) ? "local:" + key : null;
  Storage.prototype.setItem = function(key, value) {
    const syncKey = this === localStorage && scopedKey(String(key));
    if (syncKey === "tasks" && this === localStorage) { try { value = JSON.stringify(normalizeTaskList(JSON.parse(value), true)); } catch {} }
    // Profile cards can save an older in-memory employee array after the separate
    // Brokerlink form has updated localStorage. Preserve the latest linked email.
    if (syncKey === "employees" && this === localStorage) {
      try {
        const nextEmployees = normalizeEmployeeStatuses(JSON.parse(value));
        const previousEmployees = JSON.parse(this.getItem("capsule_employees") || "[]");
        if (Array.isArray(nextEmployees) && Array.isArray(previousEmployees)) {
          const previousById = new Map(previousEmployees.map(employee => [String(employee.id), employee]));
          value = JSON.stringify(nextEmployees.map(employee => {
            const previous = previousById.get(String(employee.id));
            if (previous?.brokerlinkEmail && !employee.brokerlinkEmail) {
              return { ...employee, brokerlinkEmail: previous.brokerlinkEmail };
            }
            return employee;
          }));
        }
      } catch {}
    }
    storedOriginal.call(this, key, value);
    if (["employees","tasks","kpiRows"].includes(syncKey) || String(syncKey || "").startsWith("local:cc_attendance_")) {
      window.dispatchEvent(new Event("cc:dashboard-data-updated"));
    }
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
  if (typeof window.toast === "function") {
    const originalToast = window.toast;
    window.toast = (message, ...args) => originalToast(
      String(message).replace("Fiche collaborateur enregistrée dans ce navigateur.", "Fiche enregistrée. Synchronisation avec la base en cours…"),
      ...args
    );
  }

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
      if (key === "archivedEmployees" && currentProfile && ["admin", "rh", "chef_plateau"].includes(currentProfile.role)) {
        const { data: archiveResult, error: archiveError } = await client.functions.invoke("manage-accounts", { body: { action:"deactivate-archived-callers" } });
        if (archiveError || archiveResult?.error) throw archiveError || new Error(archiveResult.error);
      }
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
    if (Array.isArray(remote.get("employees"))) {
      const oldEmployees=remote.get("employees"), normalizedEmployees=normalizeEmployeeStatuses(oldEmployees);
      if(JSON.stringify(oldEmployees)!==JSON.stringify(normalizedEmployees)) {
        if(["admin","rh","chef_plateau"].includes(currentProfile?.role)) {
          const {data:normalizedData,error:normalizedError}=await client.rpc("crm_merge_state",{p_state_key:"employees",p_base:oldEmployees,p_next:normalizedEmployees});
          if(normalizedError)throw normalizedError;
          remote.set("employees",Array.isArray(normalizedData)?normalizedData:normalizedEmployees);
        } else remote.set("employees",normalizedEmployees);
        cloudBase.set("employees",remote.get("employees"));
      }
    }
    if (["admin","rh","chef_plateau"].includes(currentProfile?.role) && Array.isArray(local.employees) && Array.isArray(remote.get("employees"))) {
      const remoteEmployees = remote.get("employees"), localEmployees=normalizeEmployeeStatuses(local.employees), remoteIds = new Set(remoteEmployees.map(employee => String(employee?.id)));
      const archived = new Set((Array.isArray(remote.get("archivedEmployees")) ? remote.get("archivedEmployees") : []).map(employee => String(employee?.id ?? employee)));
      const localOnly = localEmployees.filter(employee => employee?.id != null && !remoteIds.has(String(employee.id)) && !archived.has(String(employee.id)) && !employee.archivedAt);
      if (localOnly.length) {
        const mergedEmployees = [...remoteEmployees, ...localOnly];
        const { data: mergedData, error: mergeError } = await client.rpc("crm_merge_state", { p_state_key:"employees", p_base:remoteEmployees, p_next:mergedEmployees });
        if (mergeError) throw mergeError;
        const result = Array.isArray(mergedData) ? mergedData : mergedEmployees;
        remote.set("employees", result); cloudBase.set("employees", result);
      }
    }
    if (Array.isArray(remote.get("tasks"))) {
      const remoteTasks = remote.get("tasks"), cleanTasks = normalizeTaskList(remoteTasks, true);
      if (JSON.stringify(remoteTasks) !== JSON.stringify(cleanTasks) && ["admin","rh","chef_plateau"].includes(currentProfile?.role)) {
        const { data: cleanData, error: cleanError } = await client.rpc("crm_merge_state", { p_state_key:"tasks", p_base:remoteTasks, p_next:cleanTasks });
        if (cleanError) throw cleanError;
        const result = Array.isArray(cleanData) ? cleanData : cleanTasks;
        remote.set("tasks", result); cloudBase.set("tasks", result);
      } else if (JSON.stringify(remoteTasks) !== JSON.stringify(cleanTasks)) {
        remote.set("tasks", cleanTasks); cloudBase.set("tasks", cleanTasks);
      }
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

  function refreshAppStateIfStale() {
    const state = typeof window.crmGetLocalState === "function" ? window.crmGetLocalState() : null;
    if (!state) return false;
    let stale = false;
    for (const key of dataKeys) {
      let cached = null;
      try {
        const raw = localStorage.getItem("capsule_" + key);
        cached = raw === null ? null : JSON.parse(raw);
      } catch { stale = true; break; }
      if (JSON.stringify(state[key] ?? null) !== JSON.stringify(cached)) { stale = true; break; }
    }
    const marker = "ccHydratedStateReload";
    if (!stale) { sessionStorage.removeItem(marker); return false; }
    if (sessionStorage.getItem(marker) === currentUser?.id) return false;
    sessionStorage.setItem(marker, currentUser?.id || "pending");
    setSync("Mise à jour des données…");
    location.reload();
    return true;
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
    const requested = configured || pages[role] || []; const salaryAccess = role === "admin" || requested.includes("salaryAccess"); const allowed = role === "admin" ? [...pages.admin] : role === "caller" ? [...pages.caller] : [...new Set(requested.filter((page) => page !== "salaryAccess").map((page) => page === "kpi" || page === "assiduity" ? "performance" : page))];
    if (salaryAccess && role !== "admin" && !allowed.includes("settings")) allowed.push("settings");
    const uploadControls = document.querySelector(".doc-upload-controls"); if (uploadControls) uploadControls.hidden = !(role === "admin" || role === "rh");
    document.querySelectorAll("#nav [data-page]").forEach((button) => { button.hidden = !allowed.includes(button.dataset.page); });
    document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = role !== "admin"; });
    window.crmCanPage = (page) => page === "salaryAccess" ? salaryAccess : allowed.includes(page);
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
    const crmStaffRoles = new Set(["rh","chef_plateau","directeur_operationnel","imperator"]);
    const crmUsers = accountCache.filter(user => crmStaffRoles.has(user.role));
    const table = $("accountUserList"); if (!table) return;
    if (!$("ccCrmAccountDeleteStyle")) {
      const style = document.createElement("style"); style.id = "ccCrmAccountDeleteStyle";
      style.textContent = ".account-row{grid-template-columns:minmax(0,1fr) 150px 110px auto auto 36px!important}.account-row .account-delete{width:34px;height:34px;min-width:34px;padding:0;display:grid;place-items:center;border:1px solid #81535b;background:#39272b;color:#f0bcc5;border-radius:9px;cursor:pointer}.account-row .account-delete:hover{background:#56323a;color:#ffe2e6;border-color:#b26d7b}.account-row .account-delete svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}@media(max-width:800px){.account-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}.account-row .account-delete{justify-self:start}}";
      document.head.appendChild(style);
    }
    table.innerHTML = crmUsers.length ? crmUsers.map((user) => `
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
        <button class="account-delete" type="button" data-delete-crm-account aria-label="Supprimer l’accès CRM de ${escapeHtml(user.display_name)}" title="Supprimer l’accès CRM">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
        </button>
      </div>`).join("") : '<div class="empty"><b>Aucun compte CRM créé</b>Crée ici un accès RH, chef de plateau, directeur opérationnel ou Imperator.</div>';
    renderSalaryAccessRegistry();
  }
  const issuedSalaryPasswords = new Map();
  function salaryAccessRoleAllowed(role=currentProfile?.role) {
    if(role==="admin")return true;
    try { const access=JSON.parse(localStorage.getItem("capsule_appPermissions")||"{}")?.moduleAccess?.[role]; return Array.isArray(access)&&access.includes("salaryAccess"); } catch { return false; }
  }
  function setupSalaryAccessRolePermissions() {
    if(typeof window.renderRolePermissionEditor==="function"&&!window.ccSalaryAccessPermissionEditorWrapped){
      const original=window.renderRolePermissionEditor;
      window.renderRolePermissionEditor=function(...args){
        const result=original.apply(this,args),host=$("permissionModuleList");
        if(host){
          let label=host.querySelector('[data-cc-salary-access-option]');
          if(!label){label=document.createElement("label");label.className="permission-module";label.dataset.ccSalaryAccessOption="true";label.innerHTML='<input type="checkbox" data-permission-module value="salaryAccess"><span>Accès Mon Salaire</span>';host.append(label);}
          let saved={};try{saved=JSON.parse(localStorage.getItem("capsule_appPermissions")||"{}")}catch{}
          const role=$("permissionRole")?.value||"",modules=saved?.moduleAccess?.[role];
          const checkbox=label.querySelector("input");if(checkbox)checkbox.checked=Array.isArray(modules)&&modules.includes("salaryAccess");
        }
        return result;
      };
      window.ccSalaryAccessPermissionEditorWrapped=true;
    }
    if(currentProfile?.role==="admin")return;
    if(salaryAccessRoleAllowed()){
      const bar=$("settingsTabBar"),button=bar?.querySelector('[data-settings-view="salaryAccess"]');
      if(button){button.hidden=false;button.removeAttribute("data-admin-only")}
    }
  }
  function renderSalaryAccessRegistry() {
    if (!salaryAccessRoleAllowed()) return;
    const bar = $("settingsTabBar"), screen = $("screen-settings");
    if (!bar || !screen) return;
    let button = bar.querySelector('[data-settings-view="salaryAccess"]');
    if (!button) {
      button = document.createElement("button"); button.type = "button"; button.className = "btn";
      button.dataset.settingsView = "salaryAccess"; button.setAttribute("role", "tab"); button.textContent = "Accès Mon Salaire";
      bar.append(button);
    }
    button.hidden = false; button.removeAttribute("data-admin-only");
    let pane = $("settingsSalaryAccessView");
    if (!pane) { pane = document.createElement("div"); pane.id = "settingsSalaryAccessView"; pane.hidden = true; bar.insertAdjacentElement("afterend", pane); }
    if (!$("ccSalaryAccessRegistryStyle")) {
      const style = document.createElement("style"); style.id = "ccSalaryAccessRegistryStyle";
      style.textContent = "#settingsSalaryAccessView{color:#f3ecea}#settingsSalaryAccessView .cc-salary-access-panel{background:#211d1d;border:1px solid #493d3c;border-radius:14px;padding:18px}#settingsSalaryAccessView .cc-salary-access-panel h2{margin:0 0 6px;font-size:17px}#settingsSalaryAccessView .cc-salary-access-note{color:#cbbbbb;font-size:11px;line-height:1.6;margin:0 0 16px}#settingsSalaryAccessView .cc-salary-access-table{width:100%;border-collapse:collapse;font-size:12px}#settingsSalaryAccessView .cc-salary-access-table th,#settingsSalaryAccessView .cc-salary-access-table td{padding:12px 10px;border-bottom:1px solid #493d3c;text-align:left;vertical-align:middle}#settingsSalaryAccessView .cc-salary-access-table th{color:#d4c6c4;font-size:9px;letter-spacing:.08em}#settingsSalaryAccessView .cc-salary-access-table td{color:#f3ecea}#settingsSalaryAccessView .cc-salary-access-table code{display:inline-block;padding:5px 8px;border:1px solid #493d3c;border-radius:7px;background:#292323;color:#f4d7db;font-size:11px;user-select:all}#settingsSalaryAccessView .cc-salary-access-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#settingsSalaryAccessView .cc-salary-access-status{display:block;margin-top:5px;color:#cbbbbb;font-size:10px}#settingsSalaryAccessView .cc-salary-access-empty{padding:24px;color:#cbbbbb;text-align:center;font-size:12px}@media(max-width:760px){#settingsSalaryAccessView .cc-salary-access-table,#settingsSalaryAccessView .cc-salary-access-table tbody,#settingsSalaryAccessView .cc-salary-access-table tr,#settingsSalaryAccessView .cc-salary-access-table td{display:block;width:100%}#settingsSalaryAccessView .cc-salary-access-table thead{display:none}#settingsSalaryAccessView .cc-salary-access-table tr{padding:10px 0;border-bottom:1px solid #493d3c}#settingsSalaryAccessView .cc-salary-access-table td{border:0;padding:5px 2px}}";
      document.head.append(style);
    }
    let employees = []; try { employees = JSON.parse(localStorage.getItem("capsule_employees") || "[]"); } catch {}
    employees = employees.filter(employee => !employee.archivedAt && employee.status !== "Sorti");
    const accounts = new Map(accountCache.filter(user => user.role === "caller" && user.employee_id).map(user => [String(user.employee_id), user]));
    const rows = employees.map(employee => {
      const id = String(employee.id), account = accounts.get(id), issued = issuedSalaryPasswords.get(id);
      const status = !account ? "Aucun accès créé" : account.is_active ? "Actif" : "Désactivé";
      const credentials = account
        ? '<code>@' + escapeHtml(account.username) + '</code><small class="cc-salary-access-status">' + (issued ? "Mot de passe temporaire visible dans cette session." : "Mot de passe non récupérable. Génère-en un nouveau pour le copier.") + '</small>' + (issued ? '<div class="cc-salary-access-actions" style="margin-top:7px"><code>' + escapeHtml(issued) + '</code><button type="button" class="btn" data-copy-salary-password="' + escapeHtml(id) + '">Copier identifiant + mot de passe</button><button type="button" class="btn" data-hide-salary-password="' + escapeHtml(id) + '">Masquer</button></div>' : "")
        : '<span>' + (currentProfile?.role==="admin" ? "—" : "Aucun accès Mon Salaire créé") + '</span>';
      const action = account
        ? '<button type="button" class="btn" data-reset-salary-access="' + escapeHtml(account.id) + '" data-employee-id="' + escapeHtml(id) + '">' + (account.is_active ? "Générer un mot de passe" : "Réactiver + définir un mot de passe") + '</button>'
        : (currentProfile?.role==="admin" ? '<button type="button" class="btn primary" data-open-salary-access="' + escapeHtml(id) + '">Créer l’accès</button>' : '<span class="cc-salary-access-status">À créer par l’administrateur</span>');
      return '<tr><td><b>' + escapeHtml(employee.name || "Collaborateur") + '</b></td><td>' + credentials + '</td><td>' + status + '</td><td>' + action + '<small class="cc-salary-access-status" data-salary-status="' + escapeHtml(id) + '" aria-live="polite"></small></td></tr>';
    }).join("");
    pane.innerHTML = '<div class="cc-salary-access-panel"><h2>Accès Mon Salaire</h2><p class="cc-salary-access-note">Liste des collaborateurs actifs et de leur identifiant. Un mot de passe déjà défini ne peut pas être récupéré. Génère-en un nouveau pour l’afficher et copier ensemble l’identifiant et le mot de passe. Le nouveau mot de passe reste visible dans cette session seulement.</p>' +
      (rows ? '<div class="tablewrap"><table class="cc-salary-access-table"><thead><tr><th>COLLABORATEUR ACTIF</th><th>IDENTIFIANT ET MOT DE PASSE</th><th>ACCÈS</th><th>ACTION</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="cc-salary-access-empty">Aucun collaborateur actif.</div>') + '</div>';
  }
  function setupSalaryAccessSettingsRouting() {
    if(typeof window.switchSettingsView==="function"&&!window.ccSalaryAccessSettingsRouting){
      const original=window.switchSettingsView;
      window.switchSettingsView=function(view,...args){
        if(currentProfile?.role!=="admin"&&salaryAccessRoleAllowed()){
          let saved={};try{saved=JSON.parse(localStorage.getItem("capsule_appPermissions")||"{}")}catch{}
          const explicitlyHasSettings=Array.isArray(saved?.moduleAccess?.[currentProfile.role])&&saved.moduleAccess[currentProfile.role].includes("settings");
          if(!explicitlyHasSettings)return showSalaryAccessRegistry();
        }
        if(view==="salaryAccess")return showSalaryAccessRegistry();
        return original.call(this,view,...args);
      };
      window.crmSwitchSettingsView=window.switchSettingsView;window.ccSalaryAccessSettingsRouting=true;
    }
  }
  function showSalaryAccessRegistry() {
    if(!salaryAccessRoleAllowed())return;
    renderSalaryAccessRegistry();
    document.querySelectorAll("#screen-settings > [id$='View']").forEach(view => { view.hidden = view.id !== "settingsSalaryAccessView"; });
    document.querySelectorAll("#settingsTabBar [data-settings-view]").forEach(tab => {
      const active = tab.dataset.settingsView === "salaryAccess";
      tab.classList.toggle("active", active); tab.classList.toggle("primary", active); tab.setAttribute("aria-selected", String(active));
    });
    const pane=$("settingsSalaryAccessView");if(pane)pane.hidden = false;
    if(currentProfile?.role!=="admin"&&pane){
      pane.innerHTML='<div class="cc-salary-access-panel"><h2>Accès Mon Salaire</h2><p class="cc-salary-access-note">Chargement des accès…</p></div>';
      invokeAdmin({action:"salary-access-list"}).then(data=>{accountCache=data?.users||[];renderSalaryAccessRegistry()}).catch(error=>{pane.innerHTML='<div class="cc-salary-access-panel"><h2>Accès Mon Salaire</h2><p class="cc-salary-access-note">'+escapeHtml(error.message||"Impossible de charger les accès.")+'</p></div>'});
    }
  }


  let dashboardOperationalTimer = 0, dashboardKpiCacheRaw = null, dashboardKpiCache = [];
  function dashboardZurichDate() {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en", {
      timeZone:"Europe/Zurich", year:"numeric", month:"2-digit", day:"2-digit"
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  }
  function dashboardShiftIso(date, days) {
    const value = new Date(date + "T12:00:00Z");
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0,10);
  }
  function dashboardWeekStart(date) {
    const day = new Date(date + "T12:00:00Z").getUTCDay();
    return dashboardShiftIso(date, -((day + 6) % 7));
  }
  function dashboardWeekdays(from, to) {
    const result = [];
    for (let date = from; date <= to; date = dashboardShiftIso(date, 1)) {
      const day = new Date(date + "T12:00:00Z").getUTCDay();
      if (day !== 0 && day !== 6) result.push(date);
    }
    return result;
  }
  function dashboardData() {
    let state = {};
    try { state = window.crmGetLocalState?.() || {}; } catch {}
    let kpis = [];
    try {
      const raw = localStorage.getItem("capsule_kpiRows") || "";
      if (raw !== dashboardKpiCacheRaw) {
        dashboardKpiCacheRaw = raw;
        dashboardKpiCache = raw ? JSON.parse(raw) : [];
      }
      kpis = Array.isArray(dashboardKpiCache) ? dashboardKpiCache : [];
    } catch { kpis = Array.isArray(state.kpiRows) ? state.kpiRows : []; }
    if (!kpis.length && Array.isArray(state.kpiRows)) kpis = state.kpiRows;
    return { ...state, kpiRows:kpis };
  }
  function dashboardEmail(row) {
    return String(row?.brokerlink_email || row?.brokerlinkEmail || row?.email || "").trim().toLowerCase();
  }
  function dashboardMinutes(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (/\d{4}-\d\d-\d\dT/.test(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        const parts = new Intl.DateTimeFormat("en", { timeZone:"Europe/Zurich", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return Number(values.hour) * 60 + Number(values.minute);
      }
    }
    const match = text.match(/(?:^|T|\s)(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }
  function dashboardScoreState(points, kind) {
    if (!Number.isFinite(points)) return "missing";
    if (kind === "performance") return points >= 7 ? "red" : points >= 4 ? "orange" : "green";
    return points >= 7 ? "red" : points >= 4 ? "orange" : "green";
  }
  function dashboardSchedule(employee, rules) {
    const assigned = employee?.workSchedule || {};
    const template = rules?.scheduleTemplates?.[assigned.type] || {};
    const value = (key) => assigned[key] || template[key] || "";
    const start = assigned.type === "afternoon" ? value("afternoonStart") : (value("morningStart") || value("afternoonStart"));
    const end = value("afternoonEnd") || value("morningEnd");
    return { start:dashboardMinutes(start), end:dashboardMinutes(end), type:assigned.type || "" };
  }
  function dashboardAttendance(employee, rows, store, expectedDates, currentDate, rules) {
    if (!expectedDates.length || !expectedDates.every(date => rows.has(date))) return { state:"missing", points:null, reason:"Données Brokerlink de la semaine en attente." };
    const schedule = dashboardSchedule(employee, rules);
    if (schedule.start === null) return { state:"missing", points:null, reason:"Horaire prévu à renseigner pour calculer les retards." };
    const lates = Array.isArray(store?.lates) ? store.lates : [];
    const absences = Array.isArray(store?.absences) ? store.absences : [];
    const inWeek = (item) => String(item?.date || "").slice(0,10) >= expectedDates[0] && String(item?.date || "").slice(0,10) <= currentDate;
    const manual = lates.filter(inWeek);
    const manualLateDates = new Set(manual.map(item => String(item.date || "").slice(0,10)));
    const lateMinutes = manual.map(item => Number(item.minutes ?? item.duration) || 0);
    for (const date of expectedDates) {
      if (manualLateDates.has(date)) continue;
      const row = rows.get(date);
      const firstLogin = row?.premiere_connexion ?? row?.first_login ?? row?.firstLogin;
      const loginMinute = dashboardMinutes(firstLogin);
      if (loginMinute !== null && loginMinute > schedule.start) lateMinutes.push(loginMinute - schedule.start);
    }
    const unexcused = absences.filter(item => inWeek(item) && String(item.justified || "").trim().toLowerCase() === "non").length;
    const alerts = expectedDates.reduce((sum, date) => {
      const row = rows.get(date) || {};
      return sum + Math.max(0, Number(row.alertes_plus_10min ?? row.alertes ?? 0) || 0);
    }, 0);
    const delayPoints = lateMinutes.reduce((sum, minutes) => sum + (minutes <= 10 ? 1 : minutes <= 30 ? 2 : 3), 0);
    const alertPoints = Math.floor(alerts / 3);
    const points = delayPoints + unexcused * 4 + alertPoints;
    const groups = { short:lateMinutes.filter(x => x > 0 && x <= 10).length, medium:lateMinutes.filter(x => x > 10 && x <= 30).length, long:lateMinutes.filter(x => x > 30).length };
    const reasons = [];
    if (groups.short) reasons.push(groups.short + " retard(s) 0–10 min");
    if (groups.medium) reasons.push(groups.medium + " retard(s) 11–30 min");
    if (groups.long) reasons.push(groups.long + " retard(s) > 30 min");
    if (unexcused) reasons.push(unexcused + " absence(s) non justifiée(s)");
    if (alerts) reasons.push(alerts + " alerte(s)" + (alertPoints ? " (" + alertPoints + " pt(s))" : ""));
    return { state:dashboardScoreState(points,"attendance"), points, reasons:reasons.join(" · ") || "Aucun retard, absence non justifiée ou groupe de 3 alertes cette semaine.", alerts, delayCount:lateMinutes.length, unexcused };
  }
  function dashboardPerformance(employee, rows, expectedDates, currentDate, todayMinutes, rules) {
    if (!expectedDates.length || !expectedDates.every(date => rows.has(date))) return { state:"missing", points:null, rdv:0, reason:"Données Brokerlink de la semaine en attente." };
    const schedule = dashboardSchedule(employee, rules);
    const todayRow = rows.get(currentDate);
    const todayRdv = Math.max(0, Number(todayRow?.rdv_pris ?? 0) || 0);
    const includeToday = schedule.end !== null && todayMinutes !== null && todayMinutes >= schedule.end;
    const completeDates = expectedDates.filter(date => date < currentDate || (date === currentDate && includeToday));
    if (!completeDates.length) return { state:"pending", points:null, rdv:0, todayRdv, reason:"La première journée de la semaine est encore en cours." };
    const daily = completeDates.map(date => Math.max(0, Number(rows.get(date)?.rdv_pris ?? 0) || 0));
    const points = daily.reduce((sum, count) => sum + (count >= 6 ? -3 : 3 - count), 0);
    const rdv = daily.reduce((sum, count) => sum + count, 0);
    return { state:dashboardScoreState(points,"performance"), points, rdv, todayRdv:includeToday ? 0 : todayRdv, reason:(includeToday ? "Résultat cumulé des journées terminées." : "Journées terminées; aujourd’hui en cours.") };
  }
  function dashboardSignalMarkup(label, status, points, detail) {
    const state = status === "red" ? "Rouge" : status === "orange" ? "Orange" : status === "green" ? "Vert" : status === "pending" ? "En cours" : "En attente";
    const score = Number.isFinite(points) ? (label === "Performance" && points < 0 ? "−" + Math.abs(points) : (label === "Performance" ? "+" : "") + points) + " pt" + (Math.abs(points) === 1 ? "" : "s") : state;
    const hint = detail ? ' title="' + escapeHtml(detail) + '"' : "";
    return '<div class="cc-dash-signal ' + status + '"' + hint + '><span class="cc-dash-dot" aria-hidden="true"></span><small>' + label + '</small><b>' + escapeHtml(score) + '</b></div>';
  }
  function renderEmployeeTableSignals(records) {
    const table = $("employeesTable");
    if (!table) return;
    const byId = new Map(records.map(record => [String(record.employee.id), record]));
    if (!$("ccEmployeeSignalStyle")) {
      const style = document.createElement("style");
      style.id = "ccEmployeeSignalStyle";
      style.textContent = ".cc-employee-signal-set{display:inline-flex;vertical-align:middle;align-items:center;gap:6px;margin-left:10px;flex-wrap:wrap}.cc-employee-signal{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border:1px solid #514143;border-radius:999px;background:#2b2324;color:#e9dfe0;white-space:nowrap}.cc-employee-signal small{font-size:9px;font-weight:800;letter-spacing:.035em;color:#e9dfe0}.cc-employee-signal .cc-dash-dot{width:8px;height:8px;box-shadow:0 0 8px currentColor}.cc-employee-signal.green{color:#67d6a5;border-color:#376a54;background:#1d3029}.cc-employee-signal.orange{color:#f0b85c;border-color:#785e38;background:#342b20}.cc-employee-signal.red{color:#ef8190;border-color:#79424a;background:#382428}.cc-employee-signal.missing,.cc-employee-signal.pending{color:#aaa0a1}.cc-employee-signal.missing .cc-dash-dot,.cc-employee-signal.pending .cc-dash-dot{background:#8a8182;box-shadow:none}@media(max-width:800px){.cc-employee-signal-set{margin-left:6px;gap:4px}.cc-employee-signal{padding:2px 5px}.cc-employee-signal small{font-size:8px}}";
      document.head.appendChild(style);
    }
    for (const row of table.querySelectorAll("tr.employee-click-row[data-profile]")) {
      const id = String(row.dataset.profile), record = byId.get(id), cell = row.cells?.[0];
      if (!cell || !record) continue;
      let set = cell.querySelector(".cc-employee-signal-set");
      if (!set) {
        set = document.createElement("span");
        set.className = "cc-employee-signal-set";
        const name = cell.querySelector(".profile-name-button");
        if (name) name.insertAdjacentElement("afterend", set);
        else cell.appendChild(set);
      }
      const { attend, performance } = record;
      const signature = [attend.state,attend.points,attend.reason,performance.state,performance.points,performance.rdv,performance.reason].join("|");
      if (set.dataset.signature === signature) continue;
      set.dataset.signature = signature;
      const badge = (label, value, detail) => '<span class="cc-employee-signal ' + value.state + '" title="' + escapeHtml(label + ": " + (Number.isFinite(value.points) ? value.points + " point(s) · " : "") + detail) + '" aria-label="' + escapeHtml(label + ": " + detail) + '"><span class="cc-dash-dot" aria-hidden="true"></span><small>' + label.toUpperCase() + '</small></span>';
      set.innerHTML = badge("Assiduité",attend,attend.reason) + badge("Performance",performance,(performance.reason || "") + (Number.isFinite(performance.rdv) ? " · " + performance.rdv + " RDV" : ""));
    }
  }
  function renderDashboardOperationalData() {
    const host = $("ccDashboardWatchList");
    if (!host) return;
    const state = dashboardData(), employees = (state.employees || []).filter(employee => !employee.archivedAt && ["Actif","Autonome","Débutant"].includes(employee.status));
    const now = new Date(), today = dashboardZurichDate(), monday = dashboardWeekStart(today);
    const expectedDates = dashboardWeekdays(monday, today);
    const nowParts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone:"Europe/Zurich", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(now).map(part => [part.type, part.value]));
    const todayMinutes = Number(nowParts.hour) * 60 + Number(nowParts.minute);
    const kpiByEmail = new Map();
    for (const row of state.kpiRows || []) {
      const email = dashboardEmail(row), date = String(row?.date || "").slice(0,10);
      if (!email || date < monday || date > today) continue;
      if (!kpiByEmail.has(email)) kpiByEmail.set(email, new Map());
      const dates = kpiByEmail.get(email);
      const existing = dates.get(date);
      if (!existing || row.source === "brokerlink-api") dates.set(date, row);
    }
    const records = [];
    for (const employee of employees) {
      const email = String(employee.brokerlinkEmail || "").trim().toLowerCase();
      const rows = kpiByEmail.get(email) || new Map();
      const store = window.crmPerformanceContext?.().attendanceStore?.(employee.id) || {};
      const attend = email ? dashboardAttendance(employee, rows, store, expectedDates, today, state.controlRules || {}) : { state:"missing", points:null, reason:"E-mail Brokerlink manquant sur la fiche." };
      const performance = email ? dashboardPerformance(employee, rows, expectedDates, today, todayMinutes, state.controlRules || {}) : { state:"missing", points:null, rdv:0, reason:"E-mail Brokerlink manquant sur la fiche." };
      records.push({employee,attend,performance});
    }
    renderEmployeeTableSignals(records);
    renderDailyListenMetric();
    const severity = status => status === "red" ? 2 : status === "orange" ? 1 : 0;
    const flagged = records.filter(row => severity(row.attend.state) > 0 || severity(row.performance.state) > 0)
      .sort((a,b) => Math.max(severity(b.attend.state),severity(b.performance.state)) - Math.max(severity(a.attend.state),severity(a.performance.state)) || (Number(b.attend.points)||0) - (Number(a.attend.points)||0) || (Number(b.performance.points)||0) - (Number(a.performance.points)||0));
    const pending = records.filter(row => row.attend.state === "missing" || row.performance.state === "missing" || row.performance.state === "pending");
    const greens = records.filter(row => row.attend.state === "green" && row.performance.state === "green").length;
    const rowsHtml = flagged.map(({employee,attend,performance}) => {
      const details = 'Assiduité : ' + (attend.points === null ? attend.reason : attend.points + ' pt(s) · ' + attend.reason) + ' | Performance : ' + (performance.points === null ? performance.reason : performance.points + ' pt(s), ' + performance.rdv + ' RDV · ' + performance.reason);
      return '<button type="button" class="cc-dash-watch-row" data-open-dashboard-collaborator="' + escapeHtml(employee.id) + '" aria-label="Ouvrir la fiche de ' + escapeHtml(employee.name) + '. ' + escapeHtml(details) + '"><span class="cc-dash-watch-person"><span class="cc-dash-initial">' + escapeHtml(initial(employee.name)) + '</span><span><b>' + escapeHtml(employee.name) + '</b><small>Ouvrir la fiche · ' + (severity(attend.state) >= severity(performance.state) ? 'Assiduité ' + (attend.state === 'red' ? 'rouge' : 'orange') : 'Performance ' + (performance.state === 'red' ? 'rouge' : 'orange')) + '</small></span></span>' + dashboardSignalMarkup("Assiduité",attend.state,attend.points,attend.reason) + dashboardSignalMarkup("Performance",performance.state,performance.points,performance.reason) + '<span class="cc-dash-watch-reason">' + escapeHtml(details) + '</span></button>';
    }).join("");
    const pendingNote = pending.length ? '<div class="cc-dash-pending-note">' + pending.length + ' collaborateur(s) avec des données ou horaires en attente; leurs marqueurs restent neutres.</div>' : "";
    const empty = !flagged.length ? '<div class="cc-dash-empty">' + (pending.length ? 'Les données Brokerlink de cette semaine ou certains horaires ne sont pas encore disponibles. Les voyants restent neutres jusqu’à leur réception.' : 'Aucun indicateur orange ou rouge cette semaine.') + '</div>' : "";
    host.innerHTML = rowsHtml + empty + pendingNote + (greens ? '<div class="cc-dash-green-summary"><span class="cc-dash-dot"></span>' + greens + ' collaborateur(s) avec assiduité et performance au vert.</div>' : "");
  }
  function renderDashboardTodayTasks() {
    const list = $("dashTasks");
    if (!list) return;
    const state = dashboardData(), today = dashboardZurichDate();
    const tasks = (state.tasks || []).filter(task => task?.status !== "Terminée" && task?.due && String(task.due).slice(0,10) <= today)
      .sort((a,b) => String(a.due).localeCompare(String(b.due)) || String(a.title).localeCompare(String(b.title))).slice(0,8);
    list.innerHTML = tasks.length ? tasks.map(task => {
      const due = String(task.due).slice(0,10), overdue = due < today;
      const when = overdue ? 'En retard · ' + due : 'Aujourd’hui';
      return '<div class="dashboard-task dashboard-task-clickable" data-task-open="' + escapeHtml(task.id) + '" role="button" tabindex="0"><div><b>' + escapeHtml(task.title || "Action à réaliser") + '</b><small>' + escapeHtml(task.desc || "") + '</small></div><div class="dashboard-task-meta"><span>' + escapeHtml(task.owner || "Non attribuée") + '</span><span class="' + (overdue ? 'cc-dash-overdue' : '') + '">' + escapeHtml(when) + '</span><span>' + escapeHtml(task.priority || "Normale") + '</span></div></div>';
    }).join("") : '<div class="empty">Aucune tâche en retard ou prévue aujourd’hui. L’équipe est à jour.</div>';
  }
  function ensureDashboardOperationalView() {
    const screen = $("screen-dashboard"), summary = screen?.querySelector(".dashboard-summary"), taskPanel = screen?.querySelector(".dashboard-tasks-panel");
    if (!screen || !summary || !taskPanel) return;
    let focus = $("ccDashboardFocus");
    if (!focus) {
      focus = document.createElement("section"); focus.id = "ccDashboardFocus"; focus.className = "cc-dashboard-focus";
      focus.innerHTML = '<div class="cc-dashboard-today-slot"></div><section class="panel cc-dashboard-watch"><div class="panel-head"><div><div class="panel-title">Collaborateurs à accompagner</div><div class="panel-desc">Marqueurs hebdomadaires · les rouges apparaissent en premier.</div></div><span class="pill">Assiduité · Performance</span></div><div id="ccDashboardWatchList" class="cc-dash-watch-list"></div></section>';
      summary.insertAdjacentElement("afterend", focus);
    }
    const slot = focus.querySelector(".cc-dashboard-today-slot");
    if (taskPanel.parentElement !== slot) slot.appendChild(taskPanel);
    taskPanel.style.marginTop = "0";
    taskPanel.classList.add("cc-dashboard-tasks-panel");
    const title = taskPanel.querySelector(".panel-title"); if (title) title.textContent = "À faire aujourd’hui";
    const desc = taskPanel.querySelector(".panel-desc"); if (desc) desc.textContent = "Actions prévues aujourd’hui et éléments en retard, avec leur responsable.";
    const styleId = "ccDashboardOperationalStyle";
    if (!$(styleId)) {
      const style = document.createElement("style"); style.id = styleId;
      style.textContent = "#screen-dashboard .dashboard-main{grid-template-columns:minmax(0,1fr)!important}#screen-dashboard .dashboard-main>.panel:nth-child(2){display:none!important}#ccDashboardFocus{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(330px,.9fr);gap:14px;align-items:start;margin:0 0 16px}#ccDashboardFocus .cc-dashboard-tasks-panel{margin:0!important;min-width:0}#ccDashboardFocus .dashboard-task{gap:12px;padding:12px 16px}#ccDashboardFocus .cc-dash-overdue{color:#f08e9a!important;font-weight:800}#ccDashboardFocus .cc-dashboard-watch{min-width:0}#ccDashboardFocus .cc-dash-watch-list{padding:2px 14px 12px}#ccDashboardFocus .cc-dash-watch-row{width:100%;border:0;border-top:1px solid #403637;background:transparent;color:#f3ecea;text-align:left;display:grid;grid-template-columns:minmax(0,1fr) 78px 78px;gap:8px;align-items:center;padding:11px 2px;cursor:pointer}#ccDashboardFocus .cc-dash-watch-row:hover{background:#ffffff06}#ccDashboardFocus .cc-dash-watch-person{display:flex;gap:9px;align-items:center;min-width:0}#ccDashboardFocus .cc-dash-initial{width:30px;height:30px;flex:0 0 30px;border-radius:10px;display:grid;place-items:center;background:#3b2c30;color:#f4d7db;font-size:10px;font-weight:800}#ccDashboardFocus .cc-dash-watch-person b{display:block;font-size:10px;color:#f2e8e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ccDashboardFocus .cc-dash-watch-person small{display:block;margin-top:3px;color:#b9aaac;font-size:8px}#ccDashboardFocus .cc-dash-signal{display:grid;justify-items:center;gap:3px;min-width:0}#ccDashboardFocus .cc-dash-dot{width:13px;height:13px;border-radius:50%;display:block;background:#777;box-shadow:0 0 0 4px #7772,0 0 12px #7778}#ccDashboardFocus .cc-dash-signal.green .cc-dash-dot,#ccDashboardFocus .cc-dash-green-summary .cc-dash-dot{background:#70d6a0;box-shadow:0 0 0 4px #70d6a022,0 0 13px #70d6a099}#ccDashboardFocus .cc-dash-signal.orange .cc-dash-dot{background:#f2b85e;box-shadow:0 0 0 4px #f2b85e22,0 0 13px #f2b85e99}#ccDashboardFocus .cc-dash-signal.red .cc-dash-dot{background:#ff7180;box-shadow:0 0 0 4px #ff718022,0 0 13px #ff718099}#ccDashboardFocus .cc-dash-signal small{font-size:7px;color:#cdbfc1;font-weight:800;letter-spacing:.08em}#ccDashboardFocus .cc-dash-signal b{font-size:8px;color:#e9dadd;font-weight:750}#ccDashboardFocus .cc-dash-watch-reason{grid-column:1/-1;margin:0 0 0 39px;color:#bbaeb0;font-size:8px;line-height:1.5}#ccDashboardFocus .cc-dash-empty{padding:14px 4px;color:#cbbbbb;font-size:10px;line-height:1.6}#ccDashboardFocus .cc-dash-pending-note{border-top:1px solid #403637;padding:9px 2px;color:#bbaeb0;font-size:8px}#ccDashboardFocus .cc-dash-green-summary{border-top:1px solid #403637;padding:10px 2px 0;display:flex;gap:9px;align-items:center;color:#c9d9cf;font-size:9px}#ccDashboardFocus .cc-dash-green-summary .cc-dash-dot{width:9px;height:9px}@media(max-width:1060px){#ccDashboardFocus{grid-template-columns:1fr}#ccDashboardFocus .cc-dashboard-watch{min-width:0}}@media(max-width:700px){#ccDashboardFocus .cc-dash-watch-row{grid-template-columns:minmax(0,1fr) 65px 65px;gap:5px}#ccDashboardFocus .cc-dash-watch-person b{font-size:9px}#ccDashboardFocus .cc-dash-watch-reason{margin-left:0}#ccDashboardFocus .cc-dash-signal small{font-size:6px}}";
      document.head.appendChild(style);
    }
    if (!window.crmDashboardRenderWrapped && typeof window.renderDash === "function") {
      const originalRender = window.renderDash;
      const wrappedRender = function(...args) {
        const result = originalRender.apply(this, args);
        window.setTimeout(renderDashboardOperationalData, 0);
        window.setTimeout(renderDashboardTodayTasks, 0);
        window.setTimeout(renderDailyListenMetric, 0);
        return result;
      };
      window.crmDashboardRenderWrapped = true;
      window.renderDash = wrappedRender;
    }
    if (!window.ccDashboardDataEventsInstalled) {
      window.ccDashboardDataEventsInstalled = true;
      const employeeTable = $("employeesTable");
      if (employeeTable && !window.ccEmployeeSignalObserver) {
        let employeeSignalTimer;
        window.ccEmployeeSignalObserver = new MutationObserver(() => {
          window.clearTimeout(employeeSignalTimer);
          employeeSignalTimer = window.setTimeout(renderDashboardOperationalData, 80);
        });
        window.ccEmployeeSignalObserver.observe(employeeTable, { childList:true, subtree:true });
      }
      window.addEventListener("cc:dashboard-data-updated", () => {
        window.clearTimeout(dashboardOperationalTimer);
        dashboardOperationalTimer = window.setTimeout(() => {
          renderDashboardOperationalData();
          renderDashboardTodayTasks();
          renderProfileMonthlyMetrics();
        }, 80);
      });
      window.addEventListener("storage", event => {
        if (event.key === "capsule_kpiRows" || event.key === "capsule_employees" || event.key === "capsule_tasks" || event.key?.startsWith("cc_attendance_")) {
          window.setTimeout(() => { renderDashboardOperationalData(); renderDashboardTodayTasks(); }, 100);
        }
      });
      document.addEventListener("click", event => {
        const open = event.target.closest("[data-open-dashboard-collaborator]");
        if (open) window.crmOpenEmployeeProfile?.(Number(open.dataset.openDashboardCollaborator), "attendance");
      });
      if (window.crmGo && !window.crmDashboardNavWrapped) {
        const originalGo = window.crmGo;
        window.crmGo = function(page, ...args) {
          const result = originalGo.call(this, page, ...args);
          if (page === "dashboard") window.setTimeout(() => { renderDashboardOperationalData(); renderDashboardTodayTasks(); }, 0);
          return result;
        };
        window.crmDashboardNavWrapped = true;
      }
      let lastDay = dashboardZurichDate();
      window.setInterval(() => {
        const today = dashboardZurichDate();
        if (today !== lastDay) {
          lastDay = today;
          renderDashboardOperationalData();
          renderDashboardTodayTasks();
        }
      }, 60000);
    }
    renderDashboardOperationalData();
    renderDashboardTodayTasks();
  }

  function ensureBrokerlinkPasswordView() {
    if (currentProfile?.role !== "admin") return;
    const bar = $("settingsTabBar"), screen = $("screen-settings");
    if (!bar || !screen) return;
    let tab = bar.querySelector('[data-settings-view="brokerlinkPassword"]');
    if (!tab) {
      tab = document.createElement("button"); tab.type = "button"; tab.className = "btn";
      tab.dataset.settingsView = "brokerlinkPassword"; tab.setAttribute("role", "tab");
      tab.textContent = "Mot de passe Brokerlink"; tab.setAttribute("data-admin-only", ""); bar.append(tab);
    }
    tab.hidden = false;
    let pane = $("settingsBrokerlinkPasswordView");
    if (!pane) {
      pane = document.createElement("div"); pane.id = "settingsBrokerlinkPasswordView"; pane.hidden = true;
      bar.insertAdjacentElement("afterend", pane);
    }
    if (!$("ccBrokerlinkPasswordStyle")) {
      const style = document.createElement("style"); style.id = "ccBrokerlinkPasswordStyle";
      style.textContent = "#settingsBrokerlinkPasswordView{color:#f3ecea}#settingsBrokerlinkPasswordView .cc-bl-panel{background:#211d1d;border:1px solid #493d3c;border-radius:14px;padding:20px;max-width:780px}#settingsBrokerlinkPasswordView h2{margin:0 0 8px;font-size:18px}#settingsBrokerlinkPasswordView p{color:#cbbbbb;font-size:12px;line-height:1.65}#settingsBrokerlinkPasswordView .cc-bl-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:18px}#settingsBrokerlinkPasswordView .cc-bl-form label{display:grid;gap:6px;color:#d4c6c4;font-size:11px}#settingsBrokerlinkPasswordView input{min-width:0;background:#292323!important;color:#f3ecea!important;border:1px solid #5b4948!important;border-radius:9px;padding:11px 12px}#settingsBrokerlinkPasswordView .cc-bl-result{margin-top:16px;padding:14px;border:1px solid #6b4d52;border-radius:11px;background:#302124}#settingsBrokerlinkPasswordView .cc-bl-password{display:block;margin:10px 0;padding:12px;background:#211d1d;border-radius:8px;color:#f4d7db;font:600 15px ui-monospace,monospace;word-break:break-all;user-select:all}#settingsBrokerlinkPasswordView .cc-bl-status{display:block;margin-top:12px;color:#f4d7db;font-size:12px;min-height:18px}#settingsBrokerlinkPasswordView .cc-bl-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:650px){#settingsBrokerlinkPasswordView .cc-bl-form{grid-template-columns:1fr}#settingsBrokerlinkPasswordView .cc-bl-panel{padding:15px}}";
      document.head.append(style);
    }
    if (!pane.dataset.ready) {
      pane.innerHTML = '<section class="cc-bl-panel"><h2>Changer un mot de passe Brokerlink</h2><p>Saisis l’adresse e-mail Brokerlink du collaborateur. Le site générera un mot de passe temporaire et demandera son remplacement à Brokerlink. Le mot de passe actuel ne peut pas être consulté et aucun e-mail ne sera envoyé : transmets le nouveau mot de passe au collaborateur en privé. Les sessions Brokerlink déjà ouvertes seront fermées.</p><form class="cc-bl-form" id="brokerlinkPasswordForm"><label for="brokerlinkAgentEmail">E-mail Brokerlink du collaborateur<input id="brokerlinkAgentEmail" name="agent" type="email" autocomplete="off" maxlength="254" required placeholder="nom@brokerlink.ch"></label><button class="btn primary" type="submit">Générer et changer</button></form><div class="cc-bl-result" id="brokerlinkPasswordResult" hidden><b>Nouveau mot de passe</b><code class="cc-bl-password" id="brokerlinkGeneratedPassword"></code><div class="cc-bl-actions"><button type="button" class="btn" data-copy-brokerlink-password>Copier</button><button type="button" class="btn" data-hide-brokerlink-password>Masquer</button></div></div><small class="cc-bl-status" id="brokerlinkPasswordStatus" role="status" aria-live="polite"></small></section>';
      pane.dataset.ready = "true";
    }
  }
  function showBrokerlinkPasswordView() {
    if (currentProfile?.role !== "admin") return;
    ensureBrokerlinkPasswordView();
    document.querySelectorAll("#screen-settings > [id$='View']").forEach(view => { view.hidden = view.id !== "settingsBrokerlinkPasswordView"; });
    document.querySelectorAll("#settingsTabBar [data-settings-view]").forEach(tab => {
      const active = tab.dataset.settingsView === "brokerlinkPassword";
      tab.classList.toggle("active", active); tab.classList.toggle("primary", active); tab.setAttribute("aria-selected", String(active));
    });
    $("settingsBrokerlinkPasswordView").hidden = false;
  }
  document.addEventListener("submit", async event => {
    const form = event.target.closest("#brokerlinkPasswordForm");
    if (!form) return;
    event.preventDefault();
    const email = $("brokerlinkAgentEmail").value.trim().toLowerCase();
    const button = form.querySelector('button[type="submit"]'), status = $("brokerlinkPasswordStatus");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = "Saisis une adresse e-mail valide."; return; }
    if (!window.confirm("Changer immédiatement le mot de passe Brokerlink de " + email + " ? Ses sessions ouvertes seront fermées. Tu devras lui transmettre le nouveau mot de passe en privé.")) return;
    const password = generateTemporaryPassword();
    button.disabled = true; status.textContent = "Demande de changement à Brokerlink…";
    $("brokerlinkPasswordResult").hidden = true;
    $("brokerlinkGeneratedPassword").textContent = "";
    try {
      const { data, error } = await client.functions.invoke("brokerlink-change-password", { body: { agent: email, password } });
      if (error) throw new Error(data?.error || await edgeFailure(error, "Le changement a échoué."));
      if (data?.error || !data?.updated) throw new Error(data?.error || "Brokerlink n’a pas confirmé le changement.");
      $("brokerlinkGeneratedPassword").textContent = password;
      $("brokerlinkPasswordResult").hidden = false;
      status.textContent = "Mot de passe changé. Transmets-le en privé au collaborateur; son ancienne session a été fermée.";
      form.reset();
    } catch (error) {
      status.textContent = error.message || "Impossible de changer ce mot de passe.";
    } finally { button.disabled = false; }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("[data-hide-brokerlink-password]")) return;
    $("brokerlinkGeneratedPassword").textContent = "";
    $("brokerlinkPasswordResult").hidden = true;
    $("brokerlinkPasswordStatus").textContent = "Mot de passe masqué.";
  });

  function generateTemporaryPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
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
      const script = document.createElement("script");
      const authScript = [...document.scripts].find(item => item.src.includes("/src/auth.js"));
      const assetVersion = authScript ? new URL(authScript.src).searchParams.get("v") : "";
      script.src = "./src/salary.js" + (assetVersion ? "?v=" + encodeURIComponent(assetVersion) : "");
      script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
    window.crmMountSalary(profile);
    return true;
  }
  window.crmCallerLogout = async () => {
    cloudReady = false;
    await client.auth.signOut(); currentUser = currentProfile = null; location.reload();
  };

  async function applyRemoteCollaboratorRefresh() {
    if (!liveCollaboratorRefreshPending || !currentUser || !cloudReady) return;
    const modalOpen = $("modalbg")?.classList.contains("open");
    const active = document.activeElement;
    const editingField = active?.matches?.("input,textarea,select,[contenteditable='true']") && active.id !== "globalSearch";
    if (modalOpen || editingField) {
      window.clearTimeout(liveCollaboratorRefreshTimer);
      liveCollaboratorRefreshTimer = window.setTimeout(applyRemoteCollaboratorRefresh, 1500);
      return;
    }
    liveCollaboratorRefreshPending = false;
    try {
      await Promise.allSettled([...queues.values()]);
      await syncState();
      if (!refreshAppStateIfStale()) {
        window.renderEmployees?.();
        window.renderOnboarding?.();
        window.renderDash?.();
        window.renderTasks?.();
      }
    } catch (error) {
      console.warn("CRM remote refresh:", error);
      liveCollaboratorRefreshPending = true;
      liveCollaboratorRefreshTimer = window.setTimeout(applyRemoteCollaboratorRefresh, 5000);
    }
  }

  function scheduleRemoteStateRefresh() {
    if (!currentUser || !cloudReady) return;
    liveCollaboratorRefreshPending=true;
    window.clearTimeout(liveCollaboratorRefreshTimer);
    liveCollaboratorRefreshTimer=window.setTimeout(applyRemoteCollaboratorRefresh,250);
  }
  async function pollRemoteCollaboratorChanges() {
    if (!currentUser || !cloudReady) return;
    const { data, error } = await client.from("crm_state").select("state_key,updated_at").in("state_key",dataKeys);
    if (error) {
      if (!liveCollaboratorLogWarned) { console.warn("CRM live state fallback sync:",error); liveCollaboratorLogWarned=true; }
      return;
    }
    liveCollaboratorLogWarned=false;
    let changed=false;
    for (const row of data||[]) {
      const version=row?.updated_at||null, key=row?.state_key;
      if (!key) continue;
      if (!liveStateVersions.has(key)) { liveStateVersions.set(key,version); continue; }
      if (liveStateVersions.get(key)!==version) { liveStateVersions.set(key,version); changed=true; }
    }
    if (changed) scheduleRemoteStateRefresh();
  }

  function crmLocalData(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem("capsule_" + key)); return value == null ? fallback : value; } catch { return fallback; }
  }
  function renderDailyListenMetric() {
    const metric=$("listensMetric"), meta=$("listensMeta"); if(!metric||!meta)return;
    const state=typeof window.crmGetLocalState==="function"?window.crmGetLocalState():{};
    const employees=(state.employees||crmLocalData("employees",[])).filter(employee=>!employee.archivedAt && ["Autonome","Débutant","Actif"].includes(employee.status));
    const rules=state.controlRules||crmLocalData("controlRules",{}), history=state.qualityHistory||crmLocalData("qualityHistory",[]);
    const today=taskBoardDate(),weekday=new Date(today+"T12:00:00Z").getUTCDay();
    let target=0; const names=new Set();
    for(const employee of employees){
      const stage=employee.status==="Débutant"?"beginner":"autonomy",rule=rules?.quality?.[stage];
      const weekly=Math.max(0,Number(rule?.listens)||0); if(!weekly)continue;
      const days=Array.isArray(rule?.listenDays)&&rule.listenDays.length?rule.listenDays.map(Number):[1,2,3,4,5];
      if(!days.includes(weekday))continue;
      target+=Math.max(1,Math.ceil(weekly/days.length));
      names.add(String(employee.name||"").trim().toLocaleLowerCase("fr"));
    }
    const done=(Array.isArray(history)?history:[]).filter(item=>String(item.date||"").slice(0,10)===today&&names.has(String(item.employee||"").trim().toLocaleLowerCase("fr"))).length;
    metric.textContent=done+" / "+target;
    meta.textContent=target?Math.max(0,target-done)+" écoute(s) à réaliser aujourd’hui":"Aucune écoute prévue aujourd’hui";
  }
  function setupTaskBoardEnhancements() {
    const styleId="ccTaskBoardEnhancements";
    if(!$(styleId)){const style=document.createElement("style");style.id=styleId;style.textContent="#taskBoard.board{grid-template-columns:repeat(2,minmax(0,1fr))!important}#taskBoard .task-progress-btn{display:none!important}#taskBoard .lane.cc-hidden-progress{display:none!important}@media(max-width:760px){#taskBoard.board{grid-template-columns:1fr!important}}";document.head.appendChild(style)}
    const paint=()=>{
      const board=$("taskBoard");if(!board)return;
      board.querySelectorAll(".lane").forEach(lane=>{
        const head=lane.querySelector(".lanehead");if(!head)return;
        const label=String(head.firstChild?.textContent||head.textContent||"").trim();
        if(/^En cours/i.test(label)){lane.classList.add("cc-hidden-progress");return}
        lane.classList.remove("cc-hidden-progress");
        if(/^Terminées/i.test(label))head.firstChild.textContent="Terminé";
        lane.querySelectorAll(".task").forEach(card=>{
          const title=String(card.querySelector(".task-topline b")?.textContent||"").trim().toLocaleLowerCase("fr");
          if(!title||["ouvrir le formulaire","enregistrer le compte rendu"].includes(title))card.remove();
        });
        const count=head.querySelector("span"),nextCount=String(lane.querySelectorAll(".task").length);if(count&&count.textContent!==nextCount)count.textContent=nextCount;
      });
      board.querySelectorAll(".task-progress-btn").forEach(button=>button.remove());
    };
    if(typeof window.syncControlTaskAfterRecord==="function"&&!window.ccDailyTaskCompletionWrapped){
      const recordTask=window.syncControlTaskAfterRecord;
      window.syncControlTaskAfterRecord=function(taskId,kind,record){
        const result=recordTask.apply(this,arguments);
        window.setTimeout(()=>{
          try{
            const raw=localStorage.getItem("capsule_tasks"),tasks=raw?JSON.parse(raw):[];
            const task=tasks.find(item=>String(item.id)===String(taskId));
            if(!task||["Terminée","Terminé","Effectué"].includes(String(task.status||"")))return;
            const today=taskBoardDate(),now=new Date().toISOString();
            task.status="Terminée";task.completedAt=now;task.completedOn=today;task.completedBy=String(record?.evaluator||record?.coach||record?.owner||"Équipe");
            const taskRaw=localStorage.getItem("capsule_taskHistory"),history=taskRaw?JSON.parse(taskRaw):[];
            if(!history.some(item=>String(item.taskId)===String(taskId)&&String(item.completedOn||"").slice(0,10)===today)){
              history.unshift({id:Date.now(),taskId:task.id,title:task.title,owner:task.completedBy,source:task.source|| (kind==="quality"?"Qualité":"Coaching"),completedAt:now,completedOn:today,details:record||{},summary:String(record?.notes||record?.result||record?.objective||"Enregistrement terminé.")});
              localStorage.setItem("capsule_taskHistory",JSON.stringify(history));
            }
            localStorage.setItem("capsule_tasks",JSON.stringify(tasks));
            window.renderTasks?.();window.renderTaskHistory?.();window.renderDash?.();
          }catch(error){console.warn("CRM daily task completion:",error)}
        },0);
        return result;
      };
      window.ccDailyTaskCompletionWrapped=true;
    }
    if(typeof window.renderTasks==="function"&&!window.ccTaskRenderWrapped){
      const render=window.renderTasks;
      window.renderTasks=function(...args){const result=render.apply(this,args);window.setTimeout(paint,0);return result};
      window.ccTaskRenderWrapped=true;
    }
    const board=$("taskBoard");
    if(board&&!window.ccTaskBoardObserver){window.ccTaskBoardObserver=new MutationObserver(paint);window.ccTaskBoardObserver.observe(board,{childList:true,subtree:true})}
    paint();
  }
  function setupDailyTaskReset() {
    if(window.ccDailyTaskResetStarted)return;
    window.ccDailyTaskResetStarted=true;
    let seenDate=taskBoardDate();
    window.setInterval(()=>{
      const nowDate=taskBoardDate();if(nowDate===seenDate)return;
      seenDate=nowDate;
      const old=crmLocalData("tasks",[]),next=normalizeTaskList(old,true);
      if(JSON.stringify(old)!==JSON.stringify(next)){
        localStorage.setItem("capsule_tasks",JSON.stringify(next));
        window.setTimeout(async()=>{await Promise.allSettled([...queues.values()]);location.reload()},500);
      } else {
        window.renderTasks?.();window.renderDash?.();window.renderTaskHistory?.();
      }
    },30000);
  }
  function setupEmployeeStatusColors() {
    const styleId="ccEmployeeStatusColors";
    if(!$(styleId)){const style=document.createElement("style");style.id=styleId;style.textContent="#employeesTable tr.cc-employee-autonome{background:linear-gradient(90deg,rgba(74,166,120,.14),rgba(74,166,120,.035) 75%,transparent)}#employeesTable tr.cc-employee-autonome>td{background-color:rgba(74,166,120,.045)}#employeesTable tr.cc-employee-debutant{background:linear-gradient(90deg,rgba(228,157,76,.16),rgba(228,157,76,.04) 75%,transparent)}#employeesTable tr.cc-employee-debutant>td{background-color:rgba(228,157,76,.05)}#employeesTable tr.cc-employee-autonome:hover{background-color:rgba(74,166,120,.1)}#employeesTable tr.cc-employee-debutant:hover{background-color:rgba(228,157,76,.1)}#employeesTable .cc-employee-status-autonome{background:#214b3c!important;color:#a8efc6!important;border-color:#4ba879!important;font-size:11px!important;font-weight:800!important}#employeesTable .cc-employee-status-debutant{background:#513b25!important;color:#ffd28c!important;border-color:#c98b42!important;font-size:11px!important;font-weight:800!important}";document.head.appendChild(style)}
    const table=$("employeesTable");if(!table)return;
    const paint=()=>table.querySelectorAll("tr").forEach(row=>{
      row.classList.remove("cc-employee-autonome","cc-employee-debutant");
      const statusCell=row.cells?.[2],status=String(statusCell?.textContent||"").trim();
      const badge=statusCell?.querySelector(".pill");badge?.classList.remove("cc-employee-status-autonome","cc-employee-status-debutant");
      if(status==="Autonome"){row.classList.add("cc-employee-autonome");badge?.classList.add("cc-employee-status-autonome")}
      if(status==="Débutant"){row.classList.add("cc-employee-debutant");badge?.classList.add("cc-employee-status-debutant")}
    });
    if(!window.ccEmployeeStatusObserver){window.ccEmployeeStatusObserver=new MutationObserver(paint);window.ccEmployeeStatusObserver.observe(table,{childList:true,subtree:true})}
    paint();
  }
  function currentProfileRdvMonth() {
    const values=Object.fromEntries(new Intl.DateTimeFormat("en",{timeZone:"Europe/Zurich",year:"numeric",month:"2-digit"}).formatToParts(new Date()).map(part=>[part.type,part.value]));
    return values.year+"-"+values.month;
  }
  function profileRdvMonthOptions() {
    const first="2026-11",last=currentProfileRdvMonth(),options=[];
    for(let value=first;value<=last;){
      const date=new Date(value+"-01T12:00:00Z"),label=new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"Europe/Zurich"}).format(date);
      options.push({value,label:label.charAt(0).toLocaleUpperCase("fr")+label.slice(1)});
      const year=Number(value.slice(0,4)),month=Number(value.slice(5,7));
      value=month===12?(year+1)+"-01":year+"-"+String(month+1).padStart(2,"0");
    }
    return options;
  }
  function renderProfileMonthlyAppointments() {
    const value=$("profileAppointments");if(!value)return;
    const card=value.closest(".card");if(!card)return;
    const context=window.crmPerformanceContext?.()||{};
    const employeeId=String(window.crmSelectedProfileEmployeeId||"");
    const employee=(context.employees||[]).find(item=>String(item.id)===employeeId);
    const title=card.querySelector(".metric-top"),meta=card.querySelector(".meta");
    let select=card.querySelector("#profileAppointmentsMonth");
    const options=profileRdvMonthOptions();
    if(!select){
      select=document.createElement("select");select.id="profileAppointmentsMonth";select.setAttribute("aria-label","Mois des rendez-vous pris");select.style.cssText="margin-top:8px;padding:6px 9px;border:1px solid #594747;border-radius:8px;background:#292323;color:#f3ecea;font:inherit";
      const place=value.parentElement||card;place.insertAdjacentElement("afterend",select);
    }
    const current=options.map(item=>item.value), saved=sessionStorage.getItem("ccProfileRdvMonth")||currentProfileRdvMonth();
    const selected=current.includes(select.value)?select.value:current.includes(saved)?saved:current[current.length-1];
    select.innerHTML=options.map(item=>'<option value="'+escapeHtml(item.value)+'">'+escapeHtml(item.label)+'</option>').join("");
    select.value=selected||"";
    if(title)title.textContent="Rendez-vous pris · "+(options.find(item=>item.value===select.value)?.label||"novembre 2026");
    if(!employee){value.textContent="—";if(meta)meta.textContent="Fiche collaborateur introuvable";return}
    const email=String(employee.brokerlinkEmail||employee.brokerlink_email||"").trim().toLowerCase();
    if(!email){value.textContent="—";if(meta)meta.textContent="E-mail Brokerlink manquant sur la fiche";return}
    let rows=context.kpiRows||[];
    try{const cached=JSON.parse(localStorage.getItem("capsule_kpiRows")||"null");if(Array.isArray(cached))rows=cached}catch{}
    const matching=rows.filter(row=>{
      if(row?.source!=="brokerlink-api")return false;
      const rowEmail=String(row.brokerlink_email||row.email||"").trim().toLowerCase();
      return rowEmail===email&&String(row.date||row.jour||"").slice(0,7)===select.value;
    });
    let total=0,hasMetric=false;
    for(const row of matching){const raw=row.rdv_pris??row.rendez_vous??row.appointments;if(raw!==null&&raw!==undefined&&raw!==""){const numeric=Number(String(raw).replace(",",".").replace(/\s/g,""));if(Number.isFinite(numeric)){total+=numeric;hasMetric=true}}}
    value.textContent=hasMetric?total.toLocaleString("fr-FR"):"—";
    if(meta)meta.textContent=hasMetric?matching.length+" jour(s) Brokerlink · total du mois":"Aucune donnée Brokerlink pour ce mois";
    select.onchange=()=>{sessionStorage.setItem("ccProfileRdvMonth",select.value);renderProfileMonthlyAppointments()};
  }
  function setupProfileMonthlyAppointments() {
    if(typeof window.renderProfile==="function"&&!window.ccProfileAppointmentsWrapped){
      const original=window.renderProfile;
      window.renderProfile=function(...args){const result=original.apply(this,args);window.setTimeout(renderProfileMonthlyAppointments,0);return result};
      window.ccProfileAppointmentsWrapped=true;
    }
    if(!window.ccProfileAppointmentsEvents){
      window.ccProfileAppointmentsEvents=true;
      window.addEventListener("cc:dashboard-data-updated",()=>window.setTimeout(renderProfileMonthlyAppointments,0));
      document.addEventListener("change",event=>{if(event.target?.id==="profileAppointmentsMonth"){sessionStorage.setItem("ccProfileRdvMonth",event.target.value);renderProfileMonthlyAppointments()}});
    }
  }

  async function setupLiveCollaboratorSync() {
    if (!currentUser || !cloudReady) return;
    const { data, error } = await client.from("crm_state").select("state_key,updated_at").in("state_key",dataKeys);
    if (error) { console.warn("CRM live state sync setup:",error); }
    else for (const row of data||[]) liveStateVersions.set(row.state_key,row.updated_at||null);
    if (!liveCollaboratorWatcherStarted) {
      liveCollaboratorWatcherStarted=true;
      window.setInterval(pollRemoteCollaboratorChanges,15000);
      document.addEventListener("focusout",()=>{if(liveCollaboratorRefreshPending){window.clearTimeout(liveCollaboratorRefreshTimer);liveCollaboratorRefreshTimer=window.setTimeout(applyRemoteCollaboratorRefresh,250)}});
      const modal=$("modalbg");
      if(modal)new MutationObserver(()=>{if(liveCollaboratorRefreshPending&&!modal.classList.contains("open")){window.clearTimeout(liveCollaboratorRefreshTimer);liveCollaboratorRefreshTimer=window.setTimeout(applyRemoteCollaboratorRefresh,250)}}).observe(modal,{attributes:true,attributeFilter:["class"]});
    }
    if (!window.ccCrmStateRealtimeChannel) {
      window.ccCrmStateRealtimeChannel=client.channel("crm-state-live")
        .on("postgres_changes",{event:"*",schema:"public",table:"crm_state",filter:"state_key=neq.kpiRows"},payload=>{
          const row=payload?.new||payload?.old;
          if(row?.state_key&&row?.updated_at)liveStateVersions.set(row.state_key,row.updated_at);
          scheduleRemoteStateRefresh();
        })
        .subscribe(status=>{
          if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")console.warn("CRM Realtime is temporarily unavailable; automatic polling remains active.");
        });
    }
  }

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
    if (refreshAppStateIfStale()) return false;
    if (["admin", "rh", "chef_plateau"].includes(profile.role)) {
      try { await invokeAdmin({ action:"deactivate-archived-callers" }); }
      catch (archiveError) { console.warn("Archived salary access sync:", archiveError); }
    }
    applyPermissions(profile.role);
    setupSalaryAccessRolePermissions();
    setupSalaryAccessSettingsRouting();
    if(profile.role==="admin"||salaryAccessRoleAllowed(profile.role))renderSalaryAccessRegistry();
    setupProfileMonthlyAppointments();
    await setupLiveCollaboratorSync();
    setupTaskBoardEnhancements();
    setupEmployeeStatusColors();
    setupDailyTaskReset();
    if (window.crmCanPage?.("dashboard")) ensureDashboardOperationalView();
    if (profile.role === "admin") ensureBrokerlinkPasswordView();
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
  function renderProfileMonthlyMetrics() {
    if (!currentProfile || currentProfile.role === "caller") return;
    const employeeId = Number(window.crmSelectedProfileEmployeeId);
    if (!employeeId) return;
    let state = {};
    try { state = window.crmGetLocalState?.() || {}; } catch {}
    let employees = Array.isArray(state.employees) ? state.employees : [];
    if (!employees.length) { try { employees = JSON.parse(localStorage.getItem("capsule_employees") || "[]"); } catch {} }
    const employee = employees.find(item => Number(item.id) === employeeId);
    if (!employee) return;
    const launchDate = "2026-11-10";
    const today = dashboardZurichDate();
    const monthKey = value => String(value || "").slice(0,7);
    const monthName = key => {
      const [year,month] = key.split("-").map(Number);
      return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"Europe/Zurich"}).format(new Date(Date.UTC(year,month-1,15,12)));
    };
    const email = String(employee.brokerlinkEmail || "").trim().toLowerCase();
    const rowsByDate = new Map();
    if (email) for (const row of dashboardData().kpiRows || []) {
      const date = String(row?.date || "").slice(0,10);
      if (dashboardEmail(row) !== email || date < launchDate || date > today) continue;
      const previous = rowsByDate.get(date);
      if (!previous || row.source === "brokerlink-api") rowsByDate.set(date,row);
    }
    const appointmentRows = [...rowsByDate.values()];
    const appointments = appointmentRows.reduce((sum,row) => sum + Math.max(0,Number(row?.rdv_pris ?? row?.appointments ?? 0) || 0),0);
    const appointmentValue = $("profileAppointments");
    if (appointmentValue) appointmentValue.textContent = appointmentRows.length ? String(appointments) : "—";
    const appointmentMeta = appointmentValue?.closest(".card")?.querySelector(".meta");
    if (appointmentMeta) appointmentMeta.textContent = !email ? "E-mail Brokerlink manquant sur la fiche" : appointmentRows.length ? "Rendez-vous Brokerlink depuis le 10 nov. 2026" : "En attente des données Brokerlink depuis le 10 nov.";
    const attendedValue = $("profileAttended");
    const attended = appointmentRows.reduce((sum,row) => {
      const value = row?.rdv_honores ?? row?.rendez_vous_honores ?? row?.appointments_attended ?? row?.attended_appointments;
      return sum + (value === undefined || value === null || value === "" ? 0 : Math.max(0,Number(value) || 0));
    },0);
    const hasAttended = appointmentRows.some(row => row?.rdv_honores !== undefined || row?.rendez_vous_honores !== undefined || row?.appointments_attended !== undefined || row?.attended_appointments !== undefined);
    if (attendedValue) attendedValue.textContent = hasAttended ? String(attended) : "—";
    const attendedMeta = attendedValue?.closest(".card")?.querySelector(".meta");
    if (attendedMeta) attendedMeta.textContent = hasAttended ? "Rendez-vous honorés transmis par Brokerlink" : "Non fourni par l’API Brokerlink actuellement";
    let store = {};
    try { store = window.crmPerformanceContext?.().attendanceStore?.(employee.id) || {}; } catch {}
    if (!Array.isArray(store.lates)) { try { store = JSON.parse(localStorage.getItem("cc_attendance_" + employee.id) || "{}"); } catch { store = {}; } }
    const lates = (store.lates || []).filter(item => {
      const date = String(item?.date || "").slice(0,10);
      return date >= launchDate && date <= today && Number(item?.minutes ?? item?.duration) > 0;
    });
    const byMonth = new Map();
    for (const item of lates) {
      const key = monthKey(item.date);
      if (!byMonth.has(key)) byMonth.set(key,{green:0,orange:0,red:0,total:0});
      const bucket = byMonth.get(key), minutes = Number(item.minutes ?? item.duration) || 0;
      bucket[minutes <= 10 ? "green" : minutes <= 30 ? "orange" : "red"]++;
      bucket.total++;
    }
    const launchMonth = monthKey(launchDate), currentMonth = monthKey(today);
    for (let cursor=launchMonth; cursor<=currentMonth;) {
      if (!byMonth.has(cursor)) byMonth.set(cursor,{green:0,orange:0,red:0,total:0});
      const [year,month] = cursor.split("-").map(Number);
      cursor = month === 12 ? (year+1)+"-01" : year+"-"+String(month+1).padStart(2,"0");
    }
    const current = byMonth.get(currentMonth) || {green:0,orange:0,red:0,total:0};
    const summary = $("profileAttendanceSummary");
    if (summary) summary.textContent = current.total + " retard(s)";
    const summaryMeta = summary?.closest(".card")?.querySelector(".meta");
    if (summaryMeta) summaryMeta.textContent = "Ce mois-ci · suivi depuis le 10 nov. 2026";
    const rowsHtml = [...byMonth.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([month,bucket])=>'<div class="cc-profile-month-row"><b>'+escapeHtml(monthName(month))+'</b><span class="green">'+bucket.green+' vert(s)</span><span class="orange">'+bucket.orange+' orange</span><span class="red">'+bucket.red+' rouge(s)</span><strong>'+bucket.total+'</strong></div>').join("");
    const lateCard = $("profileContent")?.querySelector(".attendance-late-card");
    if (lateCard) {
      const list = lateCard.querySelector(".late-counters");
      if (list) {
        const values = [current.green,current.orange,current.red];
        [...list.querySelectorAll(".late-counter b")].forEach((node,index)=>{ if (values[index] !== undefined) node.textContent=String(values[index]); });
      }
      let history = lateCard.querySelector(".cc-profile-monthly-lates");
      if (!history) { history=document.createElement("section"); history.className="cc-profile-monthly-lates"; lateCard.appendChild(history); }
      const signature = [...byMonth.entries()].map(([month,bucket])=>month+":"+bucket.green+","+bucket.orange+","+bucket.red).join("|");
      if (history.dataset.signature !== signature) {
        history.dataset.signature=signature;
        history.innerHTML='<h4>Retards par mois</h4><p>Calcul à partir du 10 novembre 2026, date de démarrage du CRM.</p><div class="cc-profile-month-head"><span>Mois</span><span>Retards</span><span></span><span></span><span>Total</span></div>'+rowsHtml;
      }
      if (!$("ccProfileMonthlyLateStyle")) {
        const style=document.createElement("style");style.id="ccProfileMonthlyLateStyle";
        style.textContent=".cc-profile-monthly-lates{margin-top:16px;padding-top:14px;border-top:1px solid #493b3e}.cc-profile-monthly-lates h4{margin:0 0 4px;color:#f1d4d8;font-size:13px}.cc-profile-monthly-lates>p{margin:0 0 10px;color:#b7aaac;font-size:10px}.cc-profile-month-head,.cc-profile-month-row{display:grid;grid-template-columns:minmax(90px,1fr) repeat(3,minmax(80px,.8fr)) 42px;gap:8px;align-items:center}.cc-profile-month-head{padding:6px 9px;color:#b7aaac;font-size:9px;text-transform:uppercase}.cc-profile-month-row{padding:9px;border-top:1px solid #403638;background:#241e20;color:#eadfe0;font-size:10px}.cc-profile-month-row>b{text-transform:capitalize}.cc-profile-month-row .green{color:#70d7a8}.cc-profile-month-row .orange{color:#f0b85c}.cc-profile-month-row .red{color:#ef8190}.cc-profile-month-row>strong{text-align:right;color:#f6e9e9}@media(max-width:600px){.cc-profile-month-head,.cc-profile-month-row{grid-template-columns:minmax(72px,1fr) repeat(3,minmax(55px,.8fr)) 30px;gap:4px;padding-left:6px;padding-right:6px;font-size:8px}}";
        document.head.appendChild(style);
      }
    }
  }
  function setupEmployeeUiSimplification() {
    if (!$("ccEmployeeUiSimplificationStyle")) {
      const style=document.createElement("style");style.id="ccEmployeeUiSimplificationStyle";
      style.textContent="#screen-employees th:nth-child(2),#screen-employees td:nth-child(2),#screen-employees th:nth-child(5),#screen-employees td:nth-child(5),#screen-employees th:nth-child(6),#screen-employees td:nth-child(6){display:none!important}#screen-employees #employeesTable td:first-child{min-width:260px}.cc-employee-signal-set{display:flex!important;width:max-content;max-width:100%;flex-wrap:wrap;align-items:center;gap:9px!important;margin:3px 0 0 39px!important}.cc-employee-signal{padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;gap:4px!important}.cc-employee-signal small{font-size:9px!important;font-weight:500!important;letter-spacing:0!important;text-transform:none!important;color:#cbbfc0!important}.cc-employee-signal .cc-dash-dot{width:7px!important;height:7px!important}";
      document.head.appendChild(style);
    }
    ["screen-employees","screen-onboarding"].forEach(id=>document.querySelectorAll("#"+id+' [data-modal="employee"]').forEach(button=>button.textContent="＋ Ajouter un collaborateur"));
    const statusFilter=$("statusFilter");
    if(statusFilter) [...statusFilter.options].filter(option=>["Actif","En pause"].includes(option.value)).forEach(option=>option.remove());
    const normalizeCreateForm=()=>{
      const modal=$("modalbg"), title=$("modalTitle")?.textContent?.trim();
      if(!modal?.classList.contains("open") || title!=="Nouveau collaborateur")return;
      const select=$("modalBody")?.querySelector('select[name="status"]');
      if(!select)return;
      [...select.options].filter(option=>["Actif","En pause"].includes(option.value)).forEach(option=>option.remove());
      select.value="En onboarding";
      const field=select.closest(".field");
      if(field)field.hidden=true;
    };
    if(!window.ccEmployeeCreateModalWrapped && typeof window.openModal==="function"){
      const original=window.openModal;
      window.openModal=function(type,...args){const result=original.call(this,type,...args);if(type==="employee")normalizeCreateForm();return result};
      window.ccEmployeeCreateModalWrapped=true;
    }
    normalizeCreateForm();
    const profileStatus=$("profileContent")?.querySelector("#pfStatus");
    if(profileStatus){
      if(profileStatus.value==="Actif" && [...profileStatus.options].some(option=>option.value==="Autonome"))profileStatus.value="Autonome";
      [...profileStatus.options].filter(option=>["Actif","En pause"].includes(option.value)).forEach(option=>option.remove());
    }
  }
  function trackEmployeeProfile() {
    const wrap=(name)=>{
      const original=window[name];if(typeof original!=="function"||original.__ccTracked)return;
      const tracked=function(id,...args){window.crmSelectedProfileEmployeeId=Number(id);const result=original.call(this,id,...args);setTimeout(renderEmployeeSalaryAccessCard,0);return result};
      tracked.__ccTracked=true;window[name]=tracked;
    };
    ["openEmployeeProfile","renderProfile","crmOpenEmployeeProfile"].forEach(wrap);
    const refresh=()=>setTimeout(()=>{renderBrokerlinkEmailCard();renderEmployeeScheduleCard();renderEmployeeSalaryAccessCard();normalizeProfileAttendanceKpis();renderProfileMonthlyMetrics();setupEmployeeUiSimplification()},0);
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
    const form=card.querySelector("#ccEmployeeWorkScheduleForm"),scheduleSelect=form.querySelector("[name='scheduleType']");if(scheduleSelect)scheduleSelect.dataset.lastScheduleType=type;
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

  function setupOnboardingStatusControls() {
    const table = $("onboardingTable");
    if (!table || table.dataset.ccStatusControls === "1") return;
    table.dataset.ccStatusControls = "1";
    const style = document.createElement("style");
    style.textContent = `
      #screen-onboarding #onboardingTable .person > div:last-child > b {
        color: #f6e7e9 !important; font-size: 14px !important; font-weight: 750 !important; line-height: 1.3;
      }
      #screen-onboarding #onboardingTable .person > div:last-child > small {
        color: #ccb9bc !important; font-size: 11px !important;
      }
      #screen-onboarding #onboardingTable .cc-onboard-status-select {
        box-sizing: border-box; min-width: 148px; max-width: 100%; padding: 7px 10px;
        border: 1px solid #77535b; border-radius: 8px; background: #342629;
        color: #f3dfe3; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
      }
      #screen-onboarding #onboardingTable .cc-onboard-status-select option {
        background: #261f21; color: #f3dfe3;
      }
    `;
    document.head.appendChild(style);

    const paint = () => {
      table.querySelectorAll('button[data-onboard-detail]').forEach(button => {
        if (!button.textContent.trim().startsWith("Détails")) return;
        const employeeId = Number(button.dataset.onboardDetail);
        const employee = typeof employees !== "undefined" && Array.isArray(employees)
          ? employees.find(item => Number(item.id) === employeeId) : null;
        if (!employee) return;
        const select = document.createElement("select");
        select.className = "cc-onboard-status-select";
        select.dataset.ccStatusEmployee = String(employeeId);
        select.setAttribute("aria-label", "Modifier le statut de " + employee.name);
        select.innerHTML = '<option value="" selected>Changer le statut…</option><option value="Débutant">Débutant</option><option value="Autonome">Autonomie</option>';
        button.replaceWith(select);
      });
    };

    table.addEventListener("click", event => {
      if (event.target.closest(".cc-onboard-status-select")) event.stopPropagation();
    });
    table.addEventListener("change", event => {
      const select = event.target.closest(".cc-onboard-status-select");
      if (!select) return;
      event.stopPropagation();
      const employeeId = Number(select.dataset.ccStatusEmployee);
      const employee = typeof employees !== "undefined" && Array.isArray(employees)
        ? employees.find(item => Number(item.id) === employeeId) : null;
      const nextStatus = select.value;
      if (!employee || !["Débutant", "Autonome"].includes(nextStatus)) return;
      const previousStatus = employee.status || "En onboarding";
      if (previousStatus === nextStatus) { select.value = ""; return; }
      const prompt = nextStatus === "Débutant"
        ? "Passer " + employee.name + " au statut Débutant ? Le suivi renforcé sera appliqué."
        : "Passer " + employee.name + " au statut Autonome ? Le rythme autonome sera appliqué.";
      if (!window.confirm(prompt)) { select.value = ""; return; }

      employee.status = nextStatus;
      employee.progress = nextStatus === "Autonome" ? 100 : 80;
      employee.step = nextStatus === "Autonome"
        ? "Autonomie validée par le responsable"
        : "Entrée en production";
      try {
        const key = "cc_onboarding_steps_" + employeeId;
        const stages = JSON.parse(localStorage.getItem(key) || "{}");
        for (let index = 0; index < 4; index++) stages[index] = "completed";
        if (nextStatus === "Autonome") stages[4] = "completed";
        else delete stages[4];
        localStorage.setItem(key, JSON.stringify(stages));
      } catch (error) { console.error("Onboarding status update:", error); }

      if (typeof recordOnboardingHistory === "function") {
        recordOnboardingHistory(employeeId, "Statut passé à " + nextStatus,
          "Statut modifié depuis le parcours d’onboarding (" + previousStatus + " → " + nextStatus + ").");
      }
      localStorage.setItem("capsule_employees", JSON.stringify(employees));
      if (typeof ensureMandatoryTasks === "function") ensureMandatoryTasks();
      if (typeof renderEmployees === "function") renderEmployees();
      if (typeof renderOnboarding === "function") renderOnboarding();
      if (typeof renderDash === "function") renderDash();
      if (typeof renderOnboardingDetail === "function") renderOnboardingDetail(employeeId);
      if (typeof window.toast === "function") window.toast(employee.name + " est maintenant " + nextStatus + ".");
    });

    new MutationObserver(paint).observe(table, { childList: true, subtree: true });
    paint();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    setupLoginModePicker(); trackEmployeeProfile(); setupOnboardingStatusControls(); setupEmployeeUiSimplification();
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
    document.addEventListener("click", async event => {
      const tab = event.target.closest('#settingsTabBar [data-settings-view="salaryAccess"]');
      if (tab) { showSalaryAccessRegistry(); return; }
      const brokerlinkTab = event.target.closest('#settingsTabBar [data-settings-view="brokerlinkPassword"]');
      if (brokerlinkTab) { showBrokerlinkPasswordView(); return; }
      const copyBrokerlinkPassword = event.target.closest("[data-copy-brokerlink-password]");
      if (copyBrokerlinkPassword) {
        const value = $("brokerlinkGeneratedPassword")?.textContent || "";
        if (!value) return;
        try { await navigator.clipboard.writeText(value); $("brokerlinkPasswordStatus").textContent = "Mot de passe copié. Transmets-le en privé au collaborateur."; }
        catch { $("brokerlinkPasswordStatus").textContent = "Copie impossible depuis ce navigateur. Sélectionne le mot de passe affiché."; }
        return;
      }
      const open = event.target.closest("[data-open-salary-access]");
      if (open) { window.crmOpenEmployeeProfile?.(Number(open.dataset.openSalaryAccess), "attendance"); return; }
      const hidePassword = event.target.closest("[data-hide-salary-password]");
      if (hidePassword) { issuedSalaryPasswords.delete(String(hidePassword.dataset.hideSalaryPassword)); showSalaryAccessRegistry(); return; }
      const copyPassword = event.target.closest("[data-copy-salary-password]");
      if (copyPassword) {
        const employeeId=String(copyPassword.dataset.copySalaryPassword),value=issuedSalaryPasswords.get(employeeId);
        if (!value) return;
        const account=accountCache.find(item=>String(item.employee_id)===employeeId),status=document.querySelector('[data-salary-status="'+CSS.escape(employeeId)+'"]');
        const credentials="Identifiant : @"+String(account?.username||"")+"\nMot de passe : "+value;
        try { await navigator.clipboard.writeText(credentials); if(status)status.textContent="Identifiant et mot de passe copiés."; }
        catch { if(status)status.textContent="Copie impossible depuis ce navigateur. Sélectionne les deux informations affichées."; }
        return;
      }
      const reset = event.target.closest("[data-reset-salary-access]");
      if (reset) {
        const employeeId = String(reset.dataset.employeeId), status = document.querySelector('[data-salary-status="' + CSS.escape(employeeId) + '"]');
        const password = generateTemporaryPassword(); reset.disabled = true;
        if (status) status.textContent = "Remplacement du mot de passe…";
        try {
          if(currentProfile?.role==="admin") await invokeAdmin({ action:"update", id:reset.dataset.resetSalaryAccess, role:"caller", isActive:true, password });
          else await invokeAdmin({ action:"salary-access-reset", id:reset.dataset.resetSalaryAccess, password });
          issuedSalaryPasswords.set(employeeId, password);
          if(currentProfile?.role==="admin") await listAccounts();
          showSalaryAccessRegistry();
          const updatedStatus = document.querySelector('[data-salary-status="' + CSS.escape(employeeId) + '"]');
          if (updatedStatus) updatedStatus.textContent = "Mot de passe remplacé. Transmets-le au collaborateur.";
        } catch (error) {
          if (status) status.textContent = error.message || "Impossible de remplacer le mot de passe.";
          reset.disabled = false;
        }
      }
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
        } else if (event.target.closest("[data-delete-crm-account]")) {
          const target = accountCache.find(user => user.id === row.dataset.accountId);
          if (!target || !["rh","chef_plateau","directeur_operationnel","imperator"].includes(target.role)) {
            throw new Error("Seuls les comptes de gestion CRM peuvent être supprimés ici.");
          }
          const accepted = window.confirm("Supprimer l’accès CRM de @" + target.username + " ? Cette action supprimera uniquement son compte de gestion. La fiche collaborateur et tout accès Mon Salaire resteront inchangés.");
          if (!accepted) return;
          await invokeAdmin({ action:"delete-crm-account", id:target.id });
          await listAccounts();
          showMessage("accountMessage", "Accès CRM supprimé.", false);
        }
      } catch (error) { showMessage("accountMessage", error.message); }
    });
    await checkBootstrapStatus();
    const { data: { session } } = await client.auth.getSession();
    if (session) await activate(session);
  });
})();


