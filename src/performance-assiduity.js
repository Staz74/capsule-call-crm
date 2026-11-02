(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    name: ["collaborateur", "employee", "nom", "nom_complet", "collaborateur_nom", "employee_name", "telephoniste", "callee", "calleur"],
    first: ["prenom", "first_name", "firstname"],
    last: ["nom_famille", "last_name", "lastname"],
    date: ["date", "jour", "date_activite", "date_appel", "created_at"],
    files: ["fiches_traitees", "fiches_traite", "nb_fiches", "fiches", "fiches_traitees_total", "dossiers_traites", "leads_processed", "processed_leads", "total_fiches"],
    calls: ["appels", "calls", "nb_appels", "nb_call", "total_calls", "sortants", "appels_passes"],
    responded: ["contacts", "contacts_joints", "repondues", "fiches_repondues", "answered", "leads_answered"],
    appointments: ["rdv_pris", "rendez_vous", "appointments", "appts", "appointment_count"],
    alerts: ["alertes", "alerts", "alert_count", "alerts_count"],
    firstLogin: ["premiere_connexion", "first_login", "heure_premiere_connexion", "h_1ere_co", "first_connection"]
  };
  const field = (row, candidates) => {
    const keys = Object.keys(row || {}), match = keys.find((key) => candidates.includes(normalize(key)));
    return match ? row[match] : null;
  };
  const rowName = (row) => {
    const first = field(row, aliases.first), last = field(row, ["nom_famille", "last_name", "lastname", "nom"]);
    if (first && last) return [first, last].filter(Boolean).join(" ").trim();
    const direct = field(row, aliases.name);
    return String(direct || first || last || "").trim();
  };
  const dateOf = (value) => {
    const text = String(value ?? "");
    const iso = text.match(/\d{4}-\d{2}-\d{2}/);
    if (iso) return iso[0];
    const fr = text.match(/(?:^|\D)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\D|$)/);
    return fr ? fr[3] + "-" + fr[2].padStart(2, "0") + "-" + fr[1].padStart(2, "0") : "";
  };
  const inPeriod = (value, from, to) => {
    const date = dateOf(value);
    if (!date) return !from && !to;
    return (!from || date >= from) && (!to || date <= to);
  };
  const number = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const sumField = (rows, keys) => {
    let found = false, result = 0;
    rows.forEach((row) => { const value = number(field(row, keys)); if (value !== null) { found = true; result += value; } });
    return found ? result : null;
  };
  const timeText = (value) => {
    if (!value) return "";
    const match = String(value).match(/(?:^|T|\s)(\d{1,2}:\d{2}(?::\d{2})?)/);
    return match ? match[1].slice(0, 5) : String(value).trim();
  };
  const formatDate = (value) => {
    const date = dateOf(value);
    return date ? new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  };
  const show = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const employeesOf = (context) => (context.employees || []).filter((employee) => !employee.archivedAt && employee.status !== "Sorti").sort((a, b) => a.name.localeCompare(b.name, "fr"));

  function renderPicker(prefix, employees) {
    const choices = $("#" + prefix + "EmployeeChoices"), summary = $("#" + prefix + "EmployeeSummary");
    if (!choices) return [];
    const previous = [...choices.querySelectorAll("input:checked")].map((input) => input.value);
    const initialized = choices.dataset.ready === "true";
    choices.innerHTML = employees.map((employee) => {
      const id = String(employee.id), checked = !initialized || previous.includes(id);
      return '<label><input type="checkbox" data-' + prefix + '-employee value="' + esc(id) + '"' + (checked ? " checked" : "") + '> ' + esc(employee.name) + "</label>";
    }).join("") || '<div class="assiduity-muted">Aucun collaborateur actif.</div>';
    choices.dataset.ready = "true";
    const selected = [...choices.querySelectorAll("input:checked")].map((input) => input.value);
    if (summary) summary.textContent = selected.length === employees.length ? "Tous les collaborateurs (" + employees.length + ")" : selected.length + " collaborateur(s) sélectionné(s)";
    return selected;
  }

  function dateRange(prefix) {
    return { from: $("#" + prefix + "From")?.value || "", to: $("#" + prefix + "To")?.value || "" };
  }
  function selectedIds(prefix, choices) { return new Set([...choices.querySelectorAll("input:checked")].map((input) => input.value)); }

  function renderPerformance(context, employees) {
    const choices = $("#performanceEmployeeChoices"), host = $("#performanceKpiTable");
    if (!choices || !host) return;
    const selected = selectedIds("performance", choices), { from, to } = dateRange("performance");
    const rows = context.kpiRows || [];
    const records = employees.filter((employee) => selected.has(String(employee.id))).map((employee) => {
      const matching = rows.filter((row) => normalize(rowName(row)) === normalize(employee.name) && inPeriod(field(row, aliases.date), from, to));
      return { employee, files: sumField(matching, aliases.files), calls: sumField(matching, aliases.calls), responded: sumField(matching, aliases.responded), appointments: sumField(matching, aliases.appointments) };
    });
    records.sort((a, b) => a.employee.name.localeCompare(b.employee.name, "fr"));
    const noEmployee = '<tr><td colspan="5"><div class="empty"><b>Aucun collaborateur sélectionné</b>Sélectionne une ou plusieurs personnes dans le filtre.</div></td></tr>';
    host.innerHTML = !records.length ? noEmployee : records.map((row) => '<tr><td><button type="button" class="assiduity-person-link" data-open-performance-profile="' + esc(row.employee.id) + '">' + esc(row.employee.name) + '</button></td><td>' + show(row.files) + '</td><td>' + show(row.calls) + '</td><td>' + show(row.responded) + '</td><td>' + show(row.appointments) + '</td></tr>').join("");
    const note = $("#performanceSourceNote");
    if (note) note.textContent = (from || to ? "Période : " + (from ? formatDate(from) : "début") + " → " + (to ? formatDate(to) : "aujourd’hui") + ". " : "Période : toutes les dates. ") + "Les colonnes absentes du fichier restent affichées « — ». Les lignes sans date ne sont incluses que lorsque la période n’est pas filtrée.";
  }

  function renderAttendance(context, employees) {
    const choices = $("#attendanceEmployeeChoices"), host = $("#attendanceTable"), absenceHost = $("#unjustifiedAbsenceTable");
    if (!choices || !host || !absenceHost) return;
    const selected = selectedIds("attendance", choices), { from, to } = dateRange("attendance");
    const kpiRows = context.kpiRows || [];
    const records = employees.filter((employee) => selected.has(String(employee.id))).map((employee) => {
      const store = context.attendanceStore(employee.id) || {};
      const lates = (store.lates || []).filter((item) => inPeriod(item.date, from, to));
      const absences = (store.absences || []).filter((item) => inPeriod(item.date, from, to));
      const crmRows = (store.crm || []).filter((item) => inPeriod(item.date, from, to));
      const matchingKpis = kpiRows.filter((row) => normalize(rowName(row)) === normalize(employee.name) && inPeriod(field(row, aliases.date), from, to));
      const logins = [
        ...crmRows.map((item) => ({ date: item.date, time: timeText(item.firstLogin || item.first_login || item.firstConnection || item.h_1ere_co) })),
        ...matchingKpis.map((row) => ({ date: field(row, aliases.date), time: timeText(field(row, aliases.firstLogin)) }))
      ].filter((item) => item.time).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.time.localeCompare(b.time));
      const alertValues = [...crmRows.map((item) => number(item.alerts ?? item.alertCount ?? item.alertes)), ...matchingKpis.map((row) => number(field(row, aliases.alerts)))].filter((value) => value !== null);
      const lateCounts = { green: 0, orange: 0, red: 0 };
      lates.forEach((item) => { const minutes = number(item.minutes ?? item.duration) || 0; lateCounts[minutes <= 10 ? "green" : minutes <= 30 ? "orange" : "red"]++; });
      return { employee, firstLogin: logins[0] || null, lateCounts, alerts: alertValues.length ? alertValues.reduce((sum, value) => sum + value, 0) : null, absences };
    }).sort((a, b) => a.employee.name.localeCompare(b.employee.name, "fr"));
    host.innerHTML = records.length ? records.map((row) => '<tr><td><button type="button" class="assiduity-person-link" data-open-performance-profile="' + esc(row.employee.id) + '">' + esc(row.employee.name) + '</button></td><td>' + (row.firstLogin ? '<span>' + esc(row.firstLogin.time) + '</span><small class="assiduity-muted">' + esc(formatDate(row.firstLogin.date)) + '</small>' : '—') + '</td><td><span class="late-count late-green">' + row.lateCounts.green + '</span></td><td><span class="late-count late-orange">' + row.lateCounts.orange + '</span></td><td><span class="late-count late-red">' + row.lateCounts.red + '</span></td><td>' + show(row.alerts) + '</td><td>' + row.absences.length + '</td></tr>').join("") : '<tr><td colspan="7"><div class="empty"><b>Aucun collaborateur sélectionné</b>Sélectionne au moins une personne dans le filtre.</div></td></tr>';
    const unexcused = records.flatMap((row) => row.absences.filter((absence) => normalize(absence.justified) === "non" || normalize(absence.justified).includes("non_justifie")).map((absence) => ({ employee: row.employee, absence }))).sort((a, b) => String(b.absence.date || "").localeCompare(String(a.absence.date || "")));
    absenceHost.innerHTML = unexcused.length ? unexcused.map(({ employee, absence }) => '<tr><td><button type="button" class="assiduity-person-link" data-open-performance-profile="' + esc(employee.id) + '">' + esc(employee.name) + '</button></td><td>' + esc(formatDate(absence.date)) + '</td><td>' + esc(absence.duration || "—") + '</td><td>' + esc(absence.reason || "—") + '</td></tr>').join("") : '<tr><td colspan="4"><div class="empty"><b>Aucune absence non justifiée</b>Seules les absences déclarées comme « Non justifiée » dans la fiche collaborateur apparaissent ici.</div></td></tr>';
    const note = $("#attendanceSourceNote");
    if (note) note.textContent = (from || to ? "Période : " + (from ? formatDate(from) : "début") + " → " + (to ? formatDate(to) : "aujourd’hui") + ". " : "Période : toutes les dates. ") + "Les retards et absences viennent des déclarations dans les fiches collaborateurs. Les alertes et premières connexions apparaissent uniquement si une source de données les fournit.";
  }

  function render() {
    const context = window.crmPerformanceContext?.();
    if (!context) return;
    const employees = employeesOf(context);
    renderPicker("performance", employees);
    renderPicker("attendance", employees);
    renderPerformance(context, employees);
    renderAttendance(context, employees);
  }
  function setTab(tab) {
    document.querySelectorAll("[data-performance-tab]").forEach((button) => {
      const active = button.dataset.performanceTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-performance-pane]").forEach((pane) => { pane.hidden = pane.dataset.performancePane !== tab; });
    if (tab === "assiduity") setAttendanceView("summary");
  }
  function setAttendanceView(view) {
    document.querySelectorAll("[data-attendance-view]").forEach((button) => {
      const active = button.dataset.attendanceView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-attendance-pane]").forEach((pane) => { pane.hidden = pane.dataset.attendancePane !== view; });
  }
  document.addEventListener("change", (event) => {
    if (event.target.matches("#performanceFrom, #performanceTo, #attendanceFrom, #attendanceTo, [data-performance-employee], [data-attendance-employee]")) render();
  });
  document.addEventListener("click", (event) => {
    const selectAll = event.target.closest("[data-select-all-employees]");
    if (selectAll) {
      const prefix = selectAll.dataset.selectAllEmployees;
      document.querySelectorAll("[data-" + prefix + "-employee]").forEach((input) => { input.checked = true; });
      render(); return;
    }
    const tab = event.target.closest("[data-performance-tab]");
    if (tab) { setTab(tab.dataset.performanceTab); return; }
    const view = event.target.closest("[data-attendance-view]");
    if (view) { setAttendanceView(view.dataset.attendanceView); return; }
    const employee = event.target.closest("[data-open-performance-profile]");
    if (employee) window.crmOpenEmployeeProfile?.(employee.dataset.openPerformanceProfile, "attendance");
  });
  window.crmRenderPerformanceModule = render;
  window.crmSetPerformanceTab = setTab;
})();
