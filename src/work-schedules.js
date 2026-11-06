(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = () => window.crmGetLocalState?.() || {};
  const notify = (message) => window.crmToast?.(message);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const defaults = {
    fullDay: { morningStart:"", morningEnd:"", afternoonStart:"", afternoonEnd:"" },
    morning: { morningStart:"", morningEnd:"", afternoonStart:"", afternoonEnd:"" },
    afternoon: { morningStart:"", morningEnd:"", afternoonStart:"", afternoonEnd:"" }
  };
  const labels = { fullDay:"Journée complète", morning:"Matinée", afternoon:"Après-midi", special:"Personnalisé" };
  const parts = [["morningStart","Début matinée"],["morningEnd","Fin matinée"],["afternoonStart","Début après-midi"],["afternoonEnd","Fin après-midi"]];
  const normalizedTime = (value) => /^\d{2}:\d{2}$/.test(String(value || "")) ? String(value) : "";
  const getRules = () => {
    const rules = state().controlRules || {};
    rules.scheduleTemplates = { ...defaults, ...(rules.scheduleTemplates || {}) };
    return rules;
  };
  const templates = () => getRules().scheduleTemplates;
  const templateText = (type) => {
    const t = templates()[type] || {};
    const morning = t.morningStart && t.morningEnd ? t.morningStart + "–" + t.morningEnd : "";
    const afternoon = t.afternoonStart && t.afternoonEnd ? t.afternoonStart + "–" + t.afternoonEnd : "";
    return [morning,afternoon].filter(Boolean).join(" · ") || "Horaires à configurer dans Paramètres";
  };
  const editorMarkup = (prefix) => {
    const opts = Object.entries(labels).map(([value,label]) => '<option value="' + value + '">' + label + '</option>').join("");
    return '<div class="cc-schedule-editor" data-schedule-editor="' + prefix + '">' +
      '<label class="cc-schedule-type">Type d’horaire<select data-schedule-type>' + opts + '</select></label>' +
      '<p class="cc-schedule-hint" data-schedule-hint></p>' +
      '<small>Les heures sont interprétées dans le fuseau suisse (Europe/Zurich).</small></div>';
  };
  const templateComplete = (type) => {
    const t = templates()[type] || {};
    const morning = !!t.morningStart && !!t.morningEnd;
    const afternoon = !!t.afternoonStart && !!t.afternoonEnd;
    if (type === "fullDay") return morning && afternoon;
    if (type === "morning") return morning && !t.afternoonStart && !t.afternoonEnd;
    if (type === "afternoon") return afternoon && !t.morningStart && !t.morningEnd;
    return false;
  };
  const applyEditorState = (editor) => {
    if (!editor) return;
    const type = $("[data-schedule-type]",editor)?.value || "fullDay";
    const hint = $("[data-schedule-hint]",editor);
    if (hint) hint.textContent = type === "special"
      ? (editor.dataset.customSchedule ? "Heures personnalisées renseignées. Elles seront enregistrées sur la fiche." : "Choisis les heures personnalisées dans la fenêtre.")
      : templateComplete(type) ? "Horaires du modèle : " + templateText(type) : "Le modèle n’est pas encore complet. Configure-le dans Paramètres → Horaires.";
  };
  const readSchedule = (editor) => {
    const type = $("[data-schedule-type]",editor)?.value || "";
    if (type === "special") {
      try { const schedule = JSON.parse(editor.dataset.customSchedule || "null"); return schedule?.type === "special" ? schedule : null; } catch { return null; }
    }
    if (!templateComplete(type)) return null;
    return { type, timezone:"Europe/Zurich", ...(templates()[type] || {}) };
  };
  const openCustomScheduleDialog = (editor) => {
    if (!editor || $("#ccCustomScheduleDialog")) return;
    const select = $("[data-schedule-type]",editor), previous = editor.dataset.previousType || "fullDay";
    let existing = {}; try { existing = JSON.parse(editor.dataset.customSchedule || "{}"); } catch {}
    const shade = document.createElement("div"); shade.className = "cc-arrival-shade cc-custom-schedule-shade"; shade.id = "ccCustomScheduleDialog";
    const input = (key,label) => '<label class="cc-schedule-time">' + label + '<input type="time" data-custom-part="' + key + '" value="' + esc(existing[key] || "") + '"></label>';
    shade.innerHTML = '<section class="cc-arrival-card cc-custom-schedule-card" role="dialog" aria-modal="true" aria-labelledby="ccCustomScheduleTitle"><h2 id="ccCustomScheduleTitle">Horaire personnalisé</h2><p>Renseigne une ou deux plages. Fuseau horaire : Europe/Zurich.</p><div class="cc-schedule-custom-grid">' +
      input("morningStart","Début matinée") + input("morningEnd","Fin matinée") + input("afternoonStart","Début après-midi") + input("afternoonEnd","Fin après-midi") +
      '</div><small class="cc-custom-schedule-error" aria-live="polite"></small><div class="cc-schedule-actions"><button type="button" class="btn" data-custom-cancel>Annuler</button><button type="button" class="btn primary" data-custom-save>Enregistrer</button></div></section>';
    document.body.appendChild(shade);
    const close = () => { shade.remove(); if (!editor.dataset.customSchedule && select) select.value = previous; applyEditorState(editor); };
    $("[data-custom-cancel]",shade).addEventListener("click",close);
    shade.addEventListener("click",(event) => { if (event.target === shade) close(); });
    $("[data-custom-save]",shade).addEventListener("click",() => {
      const schedule = { type:"special", timezone:"Europe/Zurich" };
      ["morningStart","morningEnd","afternoonStart","afternoonEnd"].forEach((key) => { schedule[key] = normalizedTime($('[data-custom-part="' + key + '"]',shade)?.value); });
      const morningAny = !!(schedule.morningStart || schedule.morningEnd), afternoonAny = !!(schedule.afternoonStart || schedule.afternoonEnd);
      const morningComplete = !!schedule.morningStart && !!schedule.morningEnd, afternoonComplete = !!schedule.afternoonStart && !!schedule.afternoonEnd;
      const invalid = (morningAny && !morningComplete) || (afternoonAny && !afternoonComplete) || (!morningComplete && !afternoonComplete) ||
        (morningComplete && schedule.morningEnd <= schedule.morningStart) || (afternoonComplete && schedule.afternoonEnd <= schedule.afternoonStart);
      if (invalid) { $(".cc-custom-schedule-error",shade).textContent = "Indique au moins une plage complète, avec une fin après le début."; return; }
      editor.dataset.customSchedule = JSON.stringify(schedule); editor.dataset.previousType = "special"; shade.remove(); applyEditorState(editor);
    });
  };
  const bindEditor = (editor) => {
    if (!editor || editor.dataset.bound === "true") return;
    editor.dataset.bound = "true";
    const select = $("[data-schedule-type]",editor); if (select) editor.dataset.previousType = select.value;
    editor.addEventListener("change",(event) => {
      if (!event.target.matches("[data-schedule-type]")) return;
      const changed = event.target, previous = editor.dataset.previousType || "fullDay";
      if (changed.value === "special") { editor.dataset.previousType = previous; openCustomScheduleDialog(editor); }
      else { editor.dataset.previousType = changed.value; editor.dataset.customSchedule = ""; applyEditorState(editor); }
    });
    applyEditorState(editor);
  };
  const style = document.createElement("style");
  style.textContent =
    ".cc-schedule-editor,.cc-schedule-settings{border:1px solid #493d3c!important;border-radius:12px;background:#211d1d!important;padding:14px;color:#f3ecea!important}" +
    ".cc-schedule-editor{display:grid;gap:9px;margin-top:12px}.cc-schedule-type,.cc-schedule-time{display:grid;gap:6px;font-size:10px;font-weight:700;color:var(--muted,#cbbbbb)}" +
    ".cc-schedule-editor select,.cc-schedule-editor input,.cc-schedule-settings input{width:100%;min-width:0;padding:9px 10px;border:1px solid #493d3c!important;border-radius:8px;background:#292323!important;color:#f3ecea!important;color-scheme:dark;font:inherit}.cc-schedule-editor option{background:#211d1d!important;color:#f3ecea!important}.cc-schedule-editor select:focus,.cc-schedule-settings input:focus{outline:2px solid #c995a0;outline-offset:1px}" +
    ".cc-schedule-editor small,.cc-schedule-hint{margin:0;color:var(--muted,#cbbbbb);font-size:10px;line-height:1.5}.cc-schedule-custom{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.cc-schedule-custom[hidden]{display:none}" +
    ".cc-schedule-settings{display:grid;gap:14px;background:#211d1d!important;color:#f3ecea!important}.cc-schedule-template{padding:14px;border:1px solid #493d3c!important;border-radius:10px;background:#292323!important;color:#f3ecea!important}.cc-schedule-template h3{margin:0 0 10px;font-size:13px;color:#f3ecea!important}.cc-schedule-time{color:#d3c7c4!important}.cc-schedule-settings p,.cc-schedule-message{color:#cbbbbb!important}.cc-schedule-custom-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cc-custom-schedule-card{width:min(520px,100%)}.cc-custom-schedule-error{display:block;color:#e59aa3;font-size:10px;margin-top:10px}" +
    ".cc-schedule-template-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cc-schedule-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.cc-schedule-message{font-size:10px;color:var(--muted,#cbbbbb)}" +
    ".cc-arrival-shade{position:fixed;inset:0;z-index:1500;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72)}.cc-arrival-card{width:min(560px,100%);max-height:90dvh;overflow:auto;border:1px solid var(--line,#493d3c);border-radius:16px;background:var(--panel,#211d1d);color:var(--text,#f3ecea);padding:20px;box-shadow:0 24px 70px #0009}" +
    ".cc-arrival-card h2{margin:0 0 6px;font-size:19px}.cc-arrival-card p{color:var(--muted,#cbbbbb);font-size:11px}@media(max-width:700px){.cc-schedule-template-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-arrival-card{padding:16px}}";
  document.head.appendChild(style);

  function renderSettings() {
    const bar = $("#settingsTabBar"), screen = $("#screen-settings");
    if (!bar || !screen) return;
    let button = $('[data-settings-view="workSchedules"]',bar);
    if (!button) {
      button = document.createElement("button");
      button.type = "button"; button.className = "btn"; button.dataset.settingsView = "workSchedules"; button.setAttribute("role","tab"); button.textContent = "Horaires";
      bar.appendChild(button);
    }
    button.setAttribute("data-admin-only","");
    if (typeof window.crmCurrentRole === "function" && window.crmCurrentRole() && window.crmCurrentRole() !== "admin") button.hidden = true;
    let pane = $("#settingsWorkSchedulesView");
    if (!pane) { pane = document.createElement("div"); pane.id = "settingsWorkSchedulesView"; pane.hidden = true; bar.insertAdjacentElement("afterend",pane); }
    const t = templates();
    const card = (key,title) => {
      const visibleParts = key === "fullDay" ? parts : key === "morning" ? parts.slice(0,2) : parts.slice(2);
      return '<section class="cc-schedule-template"><h3>' + title + '</h3><div class="cc-schedule-template-grid">' +
        visibleParts.map(([part,label]) => '<label class="cc-schedule-time">' + label + '<input type="time" data-template="' + key + '.' + part + '" value="' + esc(t[key]?.[part] || "") + '"></label>').join("") +
        '</div></section>';
    };
    pane.innerHTML = '<div class="cc-schedule-settings"><div><h2 style="margin:0 0 6px">Horaires de référence</h2><p style="margin:0;color:var(--muted);font-size:11px">Définis les modèles utilisés lors de la création des fiches. Fuseau : Europe/Zurich.</p></div>' +
      card("fullDay","Journée complète · matin et après-midi") + card("morning","Matinée uniquement") + card("afternoon","Après-midi uniquement") +
      '<div class="cc-schedule-actions"><button type="button" class="btn primary" id="ccSaveScheduleTemplates">Enregistrer les horaires</button><span class="cc-schedule-message" id="ccScheduleSaveMessage" aria-live="polite"></span></div>' +
      '<p style="margin:0;color:var(--muted);font-size:10px">Un horaire spécial se règle sur la fiche lors de l’ajout ou de l’arrivée du collaborateur.</p></div>';
  }
  function showSettingsPane() {
    renderSettings();
    document.querySelectorAll("#settingsTabBar [data-settings-view]").forEach((button) => {
      const active = button.dataset.settingsView === "workSchedules";
      button.classList.toggle("active",active); button.classList.toggle("primary",active); button.setAttribute("aria-selected",active ? "true" : "false");
    });
    document.querySelectorAll("#screen-settings > [id$='View']").forEach((view) => { view.hidden = view.id !== "settingsWorkSchedulesView"; });
    $("#settingsWorkSchedulesView").hidden = false;
  }
  function saveTemplates() {
    const next = { fullDay:{}, morning:{}, afternoon:{} };
    ["fullDay","morning","afternoon"].forEach((type) => parts.forEach(([part]) => { next[type][part] = normalizedTime($('[data-template="' + type + "." + part + '"]')?.value); }));
    const rules = getRules(); rules.scheduleTemplates = next;
    localStorage.setItem("capsule_controlRules",JSON.stringify(rules));
    const employees = state().employees || [];
    employees.forEach((employee) => {
      const assigned = employee.workSchedule || {};
      if (assigned.type && next[assigned.type]) employee.workSchedule = { ...assigned, ...next[assigned.type], timezone:"Europe/Zurich" };
    });
    localStorage.setItem("capsule_employees",JSON.stringify(employees));
    const message = $("#ccScheduleSaveMessage"); if (message) message.textContent = "Horaires enregistrés pour Europe/Zurich.";
    renderSettings(); window.crmRenderPerformanceModule?.(); notify("Modèles d’horaires enregistrés.");
  }
  function insertEmployeeEditor() {
    const body = $("#modalBody"), form = $("#modalForm");
    if (!body || !form || !form.querySelector('[name="name"]') || body.querySelector("[data-schedule-editor]")) return;
    const grid = body.querySelector(".formgrid"); if (!grid) return;
    const field = document.createElement("div"); field.className = "field full";
    field.innerHTML = "<label>Horaire prévu</label>" + editorMarkup("employee"); grid.appendChild(field);
    const editor = $("[data-schedule-editor]",field);
    bindEditor(editor);
  }
  function attachArrivalEditor(candidateId) {
    const candidate = (state().candidates || []).find((item) => String(item.id) === String(candidateId));
    if (!candidate) { notify("Candidat introuvable."); return; }
    const shade = document.createElement("div"); shade.className = "cc-arrival-shade"; shade.id = "ccArrivalScheduleDialog";
    shade.innerHTML = '<section class="cc-arrival-card" role="dialog" aria-modal="true" aria-labelledby="ccArrivalTitle"><h2 id="ccArrivalTitle">Horaires de ' + esc(candidate.name || candidate.firstName || "nouveau collaborateur") + '</h2><p>Choisis le modèle à appliquer à sa fiche collaborateur.</p>' +
      editorMarkup("arrival") + '<div class="cc-schedule-actions" style="margin-top:16px"><button type="button" class="btn" data-cancel-schedule-arrival>Annuler</button><button type="button" class="btn primary" data-confirm-schedule-arrival>Confirmer l’arrivée</button></div></section>';
    document.body.appendChild(shade);
    const editor = $("[data-schedule-editor]",shade);
    bindEditor(editor);
    $("[data-confirm-schedule-arrival]",shade).addEventListener("click",() => {
      const workSchedule = readSchedule(editor);
      if (!workSchedule) { notify("Configure le modèle dans Paramètres → Horaires, ou complète les plages spéciales."); return; }
      if (typeof window.confirmCandidateArrival !== "function") { notify("Impossible d’ouvrir la fiche collaborateur. Recharge la page."); return; }
      window.confirmCandidateArrival(candidateId);
      const after = state();
      const updatedCandidate = (after.candidates || []).find((item) => String(item.id) === String(candidateId));
      const employee = (after.employees || []).find((item) => String(item.id) === String(updatedCandidate?.convertedEmployeeId || ""));
      if (!employee) { notify("L’arrivée est confirmée, mais la fiche n’a pas été retrouvée."); shade.remove(); return; }
      employee.workSchedule = workSchedule;
      localStorage.setItem("capsule_employees",JSON.stringify(after.employees));
      shade.remove(); window.crmOpenEmployeeProfile?.(employee.id,"attendance"); window.crmRenderPerformanceModule?.();
    });
  }

  const body = $("#modalBody");
  if (body) new MutationObserver(insertEmployeeEditor).observe(body,{childList:true,subtree:true});
  document.addEventListener("click",(event) => {
    const settingTab = event.target.closest("#settingsTabBar [data-settings-view]");
    if (settingTab) {
      if (settingTab.dataset.settingsView === "workSchedules") showSettingsPane();
      else { const pane=$("#settingsWorkSchedulesView"); if (pane) pane.hidden=true; }
    }
    if (event.target.closest("#ccSaveScheduleTemplates")) { saveTemplates(); return; }
    if (event.target.closest("[data-cancel-schedule-arrival]")) { $("#ccArrivalScheduleDialog")?.remove(); return; }
  });
  document.addEventListener("click",(event) => {
    const arrive = event.target.closest("[data-candidate-arrive]");
    if (!arrive) return;
    const candidate = (state().candidates || []).find((item) => String(item.id) === String(arrive.dataset.candidateArrive));
    if (!candidate || !["En attente","Reporté"].includes(candidate.status)) return;
    event.preventDefault(); event.stopImmediatePropagation(); attachArrivalEditor(candidate.id);
  },true);
  document.addEventListener("click",(event) => {
    const button = event.target.closest("#modalForm button[type='button'], #modalForm button[type='submit']");
    if (!button) return;
    const form = $("#modalForm"), editor = $("[data-schedule-editor='employee']",form), nameInput = form?.querySelector('[name="name"]');
    if (!editor || !nameInput) return;
    const workSchedule = readSchedule(editor);
    if (!workSchedule) { event.preventDefault(); event.stopImmediatePropagation(); notify("Choisis un horaire configuré, ou complète l’horaire spécial."); return; }
    const name = String(nameInput.value || "").trim(), email = String(form.querySelector('[name="email"]')?.value || "").trim().toLowerCase();
    const beforeIds = new Set((state().employees || []).map((item) => String(item.id)));
    setTimeout(() => {
      const employees = state().employees || [];
      const employee = employees.find((item) => !beforeIds.has(String(item.id)) && String(item.name || "").trim() === name) ||
        employees.find((item) => !beforeIds.has(String(item.id)) && email && String(item.email || "").trim().toLowerCase() === email);
      if (!employee) return;
      employee.workSchedule = workSchedule;
      localStorage.setItem("capsule_employees",JSON.stringify(employees)); window.crmRenderPerformanceModule?.();
    },80);
  },true);
  const normalizePerson = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const rowEmail = (row) => String(row?.email || row?.brokerlink_email || row?.email_brokerlink || row?.agent_email || "").trim().toLowerCase();
  const firstLoginTime = (value) => {
    if (!value) return "";
    const text = String(value).trim();
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) && /T|\s/.test(text)) {
      const instant = new Date(text);
      if (Number.isFinite(instant.getTime())) return new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Zurich", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(instant);
    }
    const match = text.match(/(?:^|T|\s)(\d{1,2}:\d{2}(?::\d{2})?)/);
    return match ? match[1].slice(0,5) : "";
  };
  function rebuildAutomaticLates() {
    const role = window.crmCurrentRole?.() || "";
    if (!["admin","chef_plateau"].includes(role)) return;
    const employees = state().employees || [];
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem("capsule_kpiRows") || "[]"); } catch {}
    if (!Array.isArray(rows)) rows = [];
    const scheduleTemplates = templates();
    employees.forEach((employee) => {
      const assigned = employee.workSchedule || {};
      const schedule = assigned.type === "special" ? assigned : (scheduleTemplates[assigned.type] || assigned);
      const start = schedule.morningStart || schedule.afternoonStart || "";
      const startMinutes = start ? Number(start.slice(0,2))*60 + Number(start.slice(3,5)) : null;
      const email = String(employee.brokerlinkEmail || employee.brokerlink_email || "").trim().toLowerCase();
      const name = normalizePerson(employee.name);
      const employeeRows = rows.filter((row) => {
        const candidateEmail = rowEmail(row);
        if (email && candidateEmail) return email === candidateEmail;
        return name && normalizePerson(row.name || row.collaborateur || row.employee || row.nom) === name;
      });
      const absences = (() => { try { return JSON.parse(localStorage.getItem("cc_attendance_" + employee.id) || "{}").absences || []; } catch { return []; } })();
      const manualLates = (() => { try { return JSON.parse(localStorage.getItem("cc_attendance_" + employee.id) || "{}").lates || []; } catch { return []; } })().filter((item) => item.source !== "brokerlink-auto");
      const protectedDates = new Set([...manualLates.map((item) => String(item.date || "").slice(0,10)), ...absences.map((item) => String(item.date || "").slice(0,10))]);
      const firstByDate = new Map();
      if (startMinutes !== null) employeeRows.forEach((row) => {
        const date = String(row.date || row.jour || row.date_activite || "").slice(0,10);
        const time = firstLoginTime(row.premiere_connexion || row.first_login || row.firstConnection || row.h_1ere_co);
        if (!date || !time) return;
        const minutes = Number(time.slice(0,2))*60 + Number(time.slice(3,5));
        if (!firstByDate.has(date) || minutes < firstByDate.get(date).minutes) firstByDate.set(date,{minutes});
      });
      const automatic = [];
      if (startMinutes !== null) [...firstByDate.entries()].sort(([a],[b])=>a.localeCompare(b)).forEach(([date,login]) => {
        if (protectedDates.has(date)) return;
        const minutes = login.minutes - startMinutes;
        if (minutes <= 0) return;
        automatic.push({ date, minutes, level:minutes<=10?"green":minutes<=30?"orange":"red", source:"brokerlink-auto", timezone:"Europe/Zurich" });
      });
      const storeKey = "cc_attendance_" + employee.id;
      let store = {};
      try { store = JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch {}
      store.lates = [...manualLates,...automatic];
      if (!Array.isArray(store.absences)) store.absences = [];
      if (!Array.isArray(store.crm)) store.crm = [];
      const serialized = JSON.stringify(store);
      if (localStorage.getItem(storeKey) !== serialized) localStorage.setItem(storeKey,serialized);
    });
  }
  window.crmRebuildAutomaticLates = rebuildAutomaticLates;
  const priorRenderPerformance = window.crmRenderPerformanceModule;
  if (typeof priorRenderPerformance === "function") {
    window.crmRenderPerformanceModule = (...args) => {
      rebuildAutomaticLates();
      return priorRenderPerformance(...args);
    };
  }
  const authGate = $("#authGate");
  if (authGate) new MutationObserver(() => { if (authGate.hidden) rebuildAutomaticLates(); }).observe(authGate,{attributes:true,attributeFilter:["hidden"]});
  renderSettings();
  rebuildAutomaticLates();
})();