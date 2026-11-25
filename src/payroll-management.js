(() => {
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const amount = value => value == null ? "—" : Math.round(Number(value) || 0).toLocaleString("fr-FR") + " Ar";
  const count = value => value == null ? "—" : Math.round(Number(value) || 0).toLocaleString("fr-FR");
  const currentMonth = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    return parts.find(part => part.type === "year").value + "-" + parts.find(part => part.type === "month").value;
  };
  const monthLabel = month => new Date(month + "-01T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  let requestId = 0, listenersReady = false;
  function setMessage(text, kind) {
    const node = $("payrollStatus");
    if (!node) return;
    node.textContent = text || "";
    node.className = "payroll-status" + (kind ? " " + kind : "");
    node.hidden = !text;
  }
  const percentage = (numerator, denominator) => {
    if (numerator == null || denominator == null || Number(denominator) <= 0) return "—";
    return (Number(numerator) / Number(denominator) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";
  };
  const conversionCell = (numerator, denominator) => {
    const rate = percentage(numerator, denominator);
    if (rate === "—") return '<span class="payroll-conversion-empty">—</span>';
    return '<span class="payroll-conversion"><strong>' + rate + '</strong><small>' + count(numerator) + ' / ' + count(denominator) + '</small></span>';
  };
  const sumAvailable = (rows, key) => {
    const available = rows.filter(row => row[key] != null);
    return available.length ? available.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) : null;
  };
  function ensureConversionHeader(host) {
    const row = host.closest("table")?.querySelector("thead tr") || host.closest("table")?.querySelector("tr");
    if (!row || row.querySelector("[data-payroll-conversion-header]")) return;
    const header = document.createElement("th");
    header.dataset.payrollConversionHeader = "true";
    header.scope = "col";
    header.title = "Signatures confirmées divisées par les rendez-vous pris";
    header.textContent = "Conversion RDV → signature";
    const bonusHeader = Array.from(row.children).find(cell => /bonus/i.test(cell.textContent || ""));
    const signatureHeader = Array.from(row.children).find(cell => /signature/i.test(cell.textContent || ""));
    if (bonusHeader) row.insertBefore(header, bonusHeader);
    else if (signatureHeader) signatureHeader.after(header);
    else row.append(header);
  }
  function ensureNextRankHeader(host) {
    const row = host.closest("table")?.querySelector("thead tr") || host.closest("table")?.querySelector("tr");
    if (!row || row.querySelector("[data-payroll-next-rank-header]")) return;
    const header = document.createElement("th");
    header.dataset.payrollNextRankHeader = "true";
    header.scope = "col";
    header.textContent = "Salaire au prochain palier";
    header.title = "Estimation au coefficient du palier suivant, avec les mêmes bonus et malus";
    row.append(header);
  }
  function renderTable(rows, isSalary) {
    const bodyId = isSalary ? "payrollAutonomousRows" : "payrollBeginnerRows";
    const host = $(bodyId);
    if (!host) return;
    if (isSalary) { ensureConversionHeader(host); ensureNextRankHeader(host); }
    const emptyCols = isSalary ? 8 : 3;
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="' + emptyCols + '"><div class="payroll-empty"><b>Aucun collaborateur ' + (isSalary ? "autonome" : "débutant") + ' actif</b>Les fiches concernées apparaîtront ici.</div></td></tr>';
      return;
    }
    const bodyRows = rows.map(row => {
      const salaryCell = isSalary
        ? '<td class="payroll-money positive">' + (row.bonus ? "+ " + amount(row.bonus) : amount(0)) + '</td><td class="payroll-money negative">' + (row.malus ? "− " + amount(row.malus) : amount(0)) + '</td><td class="payroll-total"><strong>' + amount(row.salary) + '</strong><small>' + escapeHtml(row.rankName ? row.rankName + " · × " + Number(row.rankCoefficient).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "Rang en attente") + ' · base ' + amount(row.baseSalary) + '</small></td>'
        : "";
      const name = '<span class="payroll-name">' + escapeHtml(row.name || "Collaboratrice") + '</span><small class="payroll-status-tag">' + (isSalary ? "Autonome" : "Débutante") + '</small>';
      const conversion = isSalary ? '<td class="payroll-number">' + conversionCell(row.signatures, row.appointments) + '</td>' : "";
      const nextRankCell = !isSalary ? "" : row.nextRankSalary != null && row.nextRankName
        ? '<td class="payroll-next-salary"><strong>' + amount(row.nextRankSalary) + '</strong><small>Palier ' + escapeHtml(row.nextRankName) + ' · × ' + Number(row.nextRankCoefficient).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) + '</small></td>'
        : '<td class="payroll-next-salary"><span>' + (row.rankName === "CHALLENGER" ? "Palier maximum atteint" : "À calculer") + '</span>' + (row.rankName ? '<small>Rang actuel : ' + escapeHtml(row.rankName) + '</small>' : "") + '</td>';
      return '<tr><td>' + name + '</td><td class="payroll-number">' + count(row.appointments) + '</td><td class="payroll-number">' + count(row.signatures) + '</td>' + conversion + salaryCell + nextRankCell + '</tr>';
    });
    if (isSalary) {
      const totalAppointments = sumAvailable(rows, "appointments");
      const totalSignatures = sumAvailable(rows, "signatures");
      const totalBonus = sumAvailable(rows, "bonus");
      const totalMalus = sumAvailable(rows, "malus");
      const totalSalary = sumAvailable(rows, "salary");
      const partial = ["appointments", "signatures", "salary"].some(key => rows.some(row => row[key] == null));
      const totalName = '<span class="payroll-name">Total autonomes (' + rows.length + ')</span><small class="payroll-status-tag">' + (partial ? "Somme des données disponibles" : "Période complète") + '</small>';
      bodyRows.push('<tr class="payroll-summary-row"><td>' + totalName + '</td><td class="payroll-number">' + count(totalAppointments) + '</td><td class="payroll-number">' + count(totalSignatures) + '</td><td class="payroll-number">' + conversionCell(totalSignatures, totalAppointments) + '</td><td class="payroll-money positive">' + amount(totalBonus) + '</td><td class="payroll-money negative">' + amount(totalMalus) + '</td><td class="payroll-total"><strong>' + amount(totalSalary) + '</strong><small>Total calculé</small></td><td class="payroll-next-salary"><span>—</span><small>Projection individuelle</small></td></tr>');
    }
    host.innerHTML = bodyRows.join("");
  }
  function ensureFormerPanel() {
    const existing = $("payrollFormerPanel");
    if (existing) return existing;
    const beginnerHost = $("payrollBeginnerRows");
    const reference = beginnerHost?.closest(".payroll-panel")
      || beginnerHost?.closest(".panel")
      || beginnerHost?.closest("section")
      || $("screen-payroll");
    if (!reference) return null;
    const panel = document.createElement("section");
    panel.id = "payrollFormerPanel";
    panel.className = reference.classList.contains("payroll-panel") ? reference.className : "panel payroll-panel";
    panel.innerHTML = '<div class="panel-head"><div class="payroll-panel-title"><h3>Collaborateurs partis ce mois</h3><span id="payrollFormerCount" class="payroll-count">0 collaborateur</span></div></div><div class="payroll-table-wrap"><table class="payroll-table payroll-former-table"><thead><tr><th scope="col">Collaborateur</th><th scope="col">Rendez-vous pris</th><th scope="col">Signatures confirmées</th></tr></thead><tbody id="payrollFormerRows"><tr><td colspan="3"><div class="payroll-empty">Chargement…</div></td></tr></tbody></table></div>';
    if (reference.id === "screen-payroll") reference.append(panel);
    else reference.insertAdjacentElement("afterend", panel);
    return panel;
  }
  function renderFormerTable(rows) {
    const host = $("payrollFormerRows");
    const countNode = $("payrollFormerCount");
    if (!host) return;
    if (countNode) countNode.textContent = rows.length + (rows.length === 1 ? " collaborateur" : " collaborateurs");
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="3"><div class="payroll-empty"><b>Aucun départ enregistré pendant ce mois</b>Les statistiques des collaborateurs partis durant la période apparaîtront ici.</div></td></tr>';
      return;
    }
    const bodyRows = rows.map(row => {
      const departure = row.departureDate
        ? new Date(row.departureDate + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        : "";
      const name = '<span class="payroll-name">' + escapeHtml(row.name || "Collaboratrice") + '</span><small class="payroll-status-tag">' + (departure ? "Départ le " + escapeHtml(departure) : "Partie pendant la période") + '</small>';
      return '<tr><td>' + name + '</td><td class="payroll-number">' + count(row.appointments) + '</td><td class="payroll-number">' + count(row.signatures) + '</td></tr>';
    });
    const totalAppointments = sumAvailable(rows, "appointments");
    const totalSignatures = sumAvailable(rows, "signatures");
    const partial = rows.some(row => row.appointments == null || row.signatures == null);
    bodyRows.push('<tr class="payroll-summary-row"><td><span class="payroll-name">Total des collaborateurs partis (' + rows.length + ')</span><small class="payroll-status-tag">' + (partial ? "Somme des données disponibles" : "Période complète") + '</small></td><td class="payroll-number">' + count(totalAppointments) + '</td><td class="payroll-number">' + count(totalSignatures) + '</td></tr>');
    host.innerHTML = bodyRows.join("");
  }
  function render(data) {
    const month = data.month;
    const label = monthLabel(month);
    const period = $("payrollPeriodLabel");
    if (period) period.textContent = "Statistiques de " + label;
    const autonomous = (data.entries || []).filter(row => row.status === "autonome");
    const beginners = (data.entries || []).filter(row => row.status === "debutant");
    const former = Array.isArray(data.formerEntries) ? data.formerEntries : [];
    ensureFormerPanel();
    const autoCount = $("payrollAutonomousCount"), beginnerCount = $("payrollBeginnerCount");
    if (autoCount) autoCount.textContent = autonomous.length + (autonomous.length === 1 ? " collaborateur" : " collaborateurs");
    if (beginnerCount) beginnerCount.textContent = beginners.length + (beginners.length === 1 ? " collaboratrice" : " collaboratrices");
    renderTable(autonomous, true);
    renderTable(beginners, false);
    renderFormerTable(former);
    setMessage("Calcul basé sur les règles Mon salaire et les KPI Brokerlink synchronisés. Les collaborateurs archivés pendant le mois sélectionné restent visibles ici pour faciliter le rapprochement.", "info");
  }
  async function load(month) {
    const currentRequest = ++requestId;
    setMessage("Chargement des données…", "loading");
    const host = $("payrollAutonomousRows");
    const beginnerHost = $("payrollBeginnerRows");
    if (host) host.innerHTML = '<tr><td colspan="8"><div class="payroll-empty">Chargement…</div></td></tr>';
    if (beginnerHost) beginnerHost.innerHTML = '<tr><td colspan="3"><div class="payroll-empty">Chargement…</div></td></tr>';
    try {
      if (!window.crmSupabase?.functions) throw new Error("La connexion au CRM n’est pas prête. Réessaie dans quelques instants.");
      const { data, error } = await window.crmSupabase.functions.invoke("payroll-overview", { body: { month } });
      if (currentRequest !== requestId) return;
      if (error) throw error;
      if (!data || !Array.isArray(data.entries)) throw new Error(data?.error || "Réponse invalide du serveur.");
      render(data);
    } catch (error) {
      if (currentRequest !== requestId) return;
      const message = String(error?.message || error || "Erreur inconnue");
      setMessage(message, "error");
      if (host) host.innerHTML = '<tr><td colspan="8"><div class="payroll-empty">Les données ne sont pas disponibles.</div></td></tr>';
      if (beginnerHost) beginnerHost.innerHTML = '<tr><td colspan="3"><div class="payroll-empty">Les données ne sont pas disponibles.</div></td></tr>';
    }
  }
  window.crmRenderPayrollModule = () => {
    if (window.crmCurrentRole?.() !== "admin") {
      setMessage("Ce module est réservé à l’administrateur.", "error");
      return;
    }
    const picker = $("payrollMonth");
    if (!picker) return;
    if (!picker.value) picker.value = currentMonth();
    if (!listenersReady) {
      picker.addEventListener("change", () => load(picker.value || currentMonth()));
      $("payrollRefresh")?.addEventListener("click", () => load(picker.value || currentMonth()));
      listenersReady = true;
    }
    load(picker.value);
  };
})();