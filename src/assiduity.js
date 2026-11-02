(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const today = () => {
    const date = new Date();
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  };
  const aliases = {
    name: ["collaborateur", "employee", "nom", "nom_complet", "collaborateur_nom", "employee_name", "telephoniste", "callee", "calleur"],
    first: ["prenom", "first_name", "firstname"],
    last: ["nom_famille", "last_name", "lastname"],
    date: ["date", "jour", "date_activite", "date_appel", "created_at"],
    calls: ["appels", "calls", "nb_appels", "nb_call", "total_calls", "total"],
    responded: ["contacts", "contacts_joints", "repondues", "fiches_repondues", "answered", "leads_answered"],
    appointments: ["rdv_pris", "rendez_vous", "appointments", "appts", "appointment_count"],
    validated: ["valides", "validated", "fiches_valides", "leads_valides"],
    attended: ["rdv_honores", "rendez_vous_honores", "appointments_attended", "honored_appts"],
    noShowCount: ["no_show_count", "noshow_count", "no_shows", "absences_rdv"],
    noShowRate: ["no_show", "no_show_rate", "taux_no_show", "noshow_rate", "no_show_percent"],
    alerts: ["alertes", "alerts", "alert_count", "alerts_count"],
    firstLogin: ["premiere_connexion", "first_login", "heure_premiere_connexion", "h_1ere_co", "first_connection"],
    connectedTime: ["temps_connecte", "connected_time", "h_total", "temps_total", "time_connected"]
  };
  const field = (row, candidates) => {
    const keys = Object.keys(row || {});
    const match = keys.find((key) => candidates.includes(normalize(key)));
    return match ? row[match] : null;
  };
  const rowName = (row) => {
    const first = field(row, aliases.first), last = field(row, ["nom_famille", "last_name", "lastname", "nom"]);
    if (first && last) return [first, last].filter(Boolean).join(" ").trim();
    const direct = field(row, ["collaborateur", "employee", "nom_complet", "collaborateur_nom", "employee_name", "telephoniste", "callee", "calleur", "nom"]);
    return String(direct || first || last || "").trim();
  };
  const dateOf = (value) => {
    const match = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  };
  const inPeriod = (value, from, to) => {
    const date = dateOf(value);
    return !date || ((!from || date >= from) && (!to || date <= to));
  };
  const numeric = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const sumField = (rows, candidates) => {
    let found = false, sum = 0;
    rows.forEach((row) => {
      const value = numeric(field(row, candidates));
      if (value !== null) { found = true; sum += value; }
    });
    return found ? sum : null;
  };
  const durationMinutes = (value) => {
    const text = String(value ?? "").trim().toLocaleLowerCase("fr");
    if (!text) return null;
    const hm = text.match(/(\d+)\s*h(?:eures?)?\s*(\d+)?\s*m?/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
    const colon = text.match(/^(\d+):(\d{2})(?::\d{2})?$/);
    if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
    const minutes = text.match(/(\d+)\s*min/);
    if (minutes) return Number(minutes[1]);
    return null;
  };
  const totalDuration = (values) => {
    const present = values.filter((value) => value !== null && value !== undefined && value !== "");
    if (!present.length) return null;
    if (present.length === 1) return String(present[0]);
    const minutes = present.map(durationMinutes);
    if (minutes.some((value) => value === null)) return String(present[present.length - 1]);
    const total = minutes.reduce((sum, value) => sum + value, 0);
    return Math.floor(total / 60) + " h " + String(total % 60).padStart(2, "0");
  };
  const timeText = (value) => {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).trim();
    const match = text.match(/(?:^|T|\s)(\d{1,2}:\d{2}(?::\d{2})?)/);
    return match ? match[1].slice(0, 5) : text;
  };
  const formatDate = (value) => {
    const date = dateOf(value);
    return date ? new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "";
  };
  const formatNoShow = (rate) => rate === null ? "—" : (rate <= 1 ? rate * 100 : rate).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";

  function render() {
    const context = window.crmAssiduityContext?.();
    const host = $("#assiduityTable");
    if (!context || !host) return;
    const employees = (context.employees || []).filter((employee) => !employee.archivedAt && employee.status !== "Sorti");
    const choices = $("#assiduityEmployeeChoices");
    const before = choices ? [...choices.querySelectorAll("input:checked")].map((input) => input.value) : [];
    const hadChoices = choices?.dataset.ready === "true";
    if (choices) {
      choices.innerHTML = employees.map((employee) => {
        const id = String(employee.id);
        const checked = !hadChoices || before.includes(id);
        return '<label><input type="checkbox" data-assiduity-employee value="' + esc(id) + '"' + (checked ? " checked" : "") + '> ' + esc(employee.name) + "</label>";
      }).join("") || '<div class="assiduity-muted">Aucun collaborateur actif.</div>';
      choices.dataset.ready = "true";
    }
    const fromInput = $("#assiduityFrom"), toInput = $("#assiduityTo");
    if (fromInput && !fromInput.value) fromInput.value = today();
    if (toInput && !toInput.value) toInput.value = today();
    const from = fromInput?.value || "", to = toInput?.value || "";
    const checked = choices ? [...choices.querySelectorAll("input:checked")].map((input) => input.value) : employees.map((employee) => String(employee.id));
    const selectedIds = new Set(checked);
    const kpiRows = context.kpiRows || [];
    const records = employees.filter((employee) => selectedIds.has(String(employee.id))).map((employee) => {
      const store = context.attendanceStore(employee.id) || {};
      const lates = (store.lates || []).filter((item) => inPeriod(item.date, from, to));
      const absences = (store.absences || []).filter((item) => inPeriod(item.date, from, to));
      const crmRows = (store.crm || []).filter((item) => inPeriod(item.date, from, to));
      const matchingKpis = kpiRows.filter((row) => normalize(rowName(row)) === normalize(employee.name))
        .filter((row) => inPeriod(field(row, aliases.date), from, to));
      const sortedCrm = crmRows.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      const loginCandidates = sortedCrm.map((item) => ({ date: item.date, time: timeText(item.firstLogin || item.first_login || item.firstConnection || item.h_1ere_co) })).filter((item) => item.time);
      matchingKpis.forEach((row) => {
        const value = field(row, aliases.firstLogin);
        if (value) loginCandidates.push({ date: field(row, aliases.date), time: timeText(value) });
      });
      loginCandidates.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.time.localeCompare(b.time));
      const calls = sumField(matchingKpis, aliases.calls);
      const responded = sumField(matchingKpis, aliases.responded);
      const validated = sumField(matchingKpis, aliases.validated);
      const appointments = sumField(matchingKpis, aliases.appointments);
      const attended = sumField(matchingKpis, aliases.attended);
      const noShowCount = sumField(matchingKpis, aliases.noShowCount);
      let noShowRate = null;
      const rateValues = matchingKpis.map((row) => numeric(field(row, aliases.noShowRate))).filter((value) => value !== null);
      if (noShowCount !== null && appointments > 0) noShowRate = noShowCount / appointments;
      else if (attended !== null && appointments > 0) noShowRate = (appointments - attended) / appointments;
      else if (rateValues.length) {
        const weights = matchingKpis.map((row) => numeric(field(row, aliases.appointments)));
        const weightedTotal = rateValues.reduce((total, rate, index) => total + rate * (weights[index] || 1), 0);
        const weightTotal = rateValues.reduce((total, rate, index) => total + (weights[index] || 1), 0);
        noShowRate = weightTotal ? weightedTotal / weightTotal : null;
      }
      const alertValues = [
        ...crmRows.map((item) => numeric(item.alerts ?? item.alertCount ?? item.alertes)),
        ...matchingKpis.map((row) => numeric(field(row, aliases.alerts)))
      ].filter((value) => value !== null);
      const alerts = alertValues.length ? alertValues.reduce((total, value) => total + value, 0) : null;
      const lateMinutes = lates.reduce((total, item) => total + (numeric(item.minutes ?? item.duration) || 0), 0);
      const connectedTime = totalDuration([
        ...crmRows.map((item) => item.connectedTime || item.connected_time || item.h_total),
        ...matchingKpis.map((row) => field(row, aliases.connectedTime))
      ]);
      return {
        employee, firstLogin: loginCandidates[0]?.time || "", loginDate: loginCandidates[0]?.date || "",
        lates: lates.length, lateMinutes, absences: absences.length, alerts,
        calls, responded, validated, appointments, connectedTime, noShowRate, kpiRowCount: matchingKpis.length,
        hasDate: matchingKpis.some((row) => !!field(row, aliases.date))
      };
    });
    records.sort((a, b) => a.employee.name.localeCompare(b.employee.name, "fr"));
    const total = (key) => {
      const values = records.map((row) => row[key]).filter((value) => value !== null && value !== undefined);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const show = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    const setMetric = (id, value, note) => {
      const node = $("#" + id); if (node) node.textContent = value;
      const meta = $("#" + id + "Meta"); if (meta) meta.textContent = note;
    };
    const loginCount = records.filter((row) => row.firstLogin).length;
    setMetric("assiduityPeopleValue", String(records.length), "Collaborateur(s) dans le filtre");
    setMetric("assiduityLateValue", show(total("lates")), "Retards enregistrés sur la période");
    setMetric("assiduityAlertValue", show(total("alerts")), "Alertes remontées par les données importées");
    setMetric("assiduityCallsValue", show(total("calls")), "Appels présents dans les imports KPI");
    setMetric("assiduityAppointmentsValue", show(total("appointments")), "Rendez-vous pris dans les imports KPI");
    const rateRows = records.filter((row) => row.noShowRate !== null && row.appointments > 0);
    const overallRate = rateRows.length ? rateRows.reduce((sum, row) => sum + row.noShowRate * row.appointments, 0) / rateRows.reduce((sum, row) => sum + row.appointments, 0) : null;
    setMetric("assiduityNoShowValue", formatNoShow(overallRate), "Calculé uniquement si les colonnes sont disponibles");
    const summary = $("#assiduityEmployeeSummary");
    if (summary) summary.textContent = checked.length === employees.length ? "Tous les collaborateurs (" + employees.length + ")" : checked.length + " collaborateur(s) sélectionné(s)";
    const dateLabel = from === to ? from : from + " → " + to;
    const sourceNote = $("#assiduitySourceNote");
    if (sourceNote) {
      const hasKpis = records.some((row) => row.kpiRowCount);
      const hasAttendance = records.some((row) => row.firstLogin || row.lates || row.absences || row.alerts !== null);
      sourceNote.textContent = hasKpis || hasAttendance
        ? "Période : " + dateLabel + ". Les champs absents des imports restent affichés « — ». La première connexion affichée est la plus ancienne trouvée sur la période (" + loginCount + " collaborateur(s) avec une heure)." + (records.some((row) => row.kpiRowCount && !row.hasDate) ? " Certains imports n’ont pas de date et ne peuvent pas être ventilés par jour." : "")
        : "Période : " + dateLabel + ". Aucun événement ni KPI correspondant n’est enregistré pour cette période. Les connexions, appels et alertes Brokerlink apparaîtront après import ou intégration de leur source.";
    }
    if (!records.length) {
      host.innerHTML = '<tr><td colspan="11"><div class="empty"><b>Aucun collaborateur sélectionné</b>Sélectionne au moins une personne dans le filtre.</div></td></tr>';
      return;
    }
    host.innerHTML = records.map((row) => {
      const login = row.firstLogin ? row.firstLogin + (row.loginDate ? '<div class="assiduity-muted">' + esc(formatDate(row.loginDate)) + "</div>" : "") : "—";
      const late = row.lates ? row.lates + " · " + row.lateMinutes + " min" : "0";
      return '<tr><td><button type="button" class="assiduity-person-link" data-open-assiduity-profile="' + esc(row.employee.id) + '">' + esc(row.employee.name) + '</button><div class="assiduity-muted">' + esc(row.employee.status || "") + '</div></td><td>' + login + '</td><td>' + late + '</td><td>' + show(row.alerts) + '</td><td>' + show(row.calls) + '</td><td>' + show(row.responded) + '</td><td>' + show(row.validated) + '</td><td>' + show(row.appointments) + '</td><td>' + esc(row.connectedTime || "—") + '</td><td>' + formatNoShow(row.noShowRate) + '</td><td>' + show(row.absences) + "</td></tr>";
    }).join("");
  }

  document.addEventListener("change", (event) => {
    if (event.target.matches("#assiduityFrom, #assiduityTo, [data-assiduity-employee]")) render();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#assiduitySelectAll")) {
      document.querySelectorAll("[data-assiduity-employee]").forEach((input) => { input.checked = true; });
      render();
      return;
    }
    const employeeButton = event.target.closest("[data-open-assiduity-profile]");
    if (employeeButton) window.crmOpenEmployeeProfile?.(employeeButton.dataset.openAssiduityProfile, "attendance");
  });
  window.crmRenderAssiduityModule = render;
})();
