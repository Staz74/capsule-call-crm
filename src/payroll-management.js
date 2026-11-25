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
  function renderTable(rows, isSalary) {
    const bodyId = isSalary ? "payrollAutonomousRows" : "payrollBeginnerRows";
    const host = $(bodyId);
    if (!host) return;
    const emptyCols = isSalary ? 6 : 3;
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="' + emptyCols + '"><div class="payroll-empty"><b>Aucun collaborateur ' + (isSalary ? "autonome" : "débutant") + ' active</b>Les fiches concernées apparaîtront ici.</div></td></tr>';
      return;
    }
    host.innerHTML = rows.map(row => {
      const salaryCell = isSalary
        ? '<td class="payroll-money positive">' + (row.bonus ? "+ " + amount(row.bonus) : amount(0)) + '</td><td class="payroll-money negative">' + (row.malus ? "− " + amount(row.malus) : amount(0)) + '</td><td class="payroll-total"><strong>' + amount(row.salary) + '</strong><small>' + escapeHtml(row.rankName ? row.rankName + " · × " + Number(row.rankCoefficient).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "Rang en attente") + ' · base ' + amount(row.baseSalary) + '</small></td>'
        : "";
      const name = '<span class="payroll-name">' + escapeHtml(row.name || "Collaboratrice") + '</span><small class="payroll-status-tag">' + (isSalary ? "Autonome" : "Débutante") + '</small>';
      return '<tr><td>' + name + '</td><td class="payroll-number">' + count(row.appointments) + '</td><td class="payroll-number">' + count(row.signatures) + '</td>' + salaryCell + '</tr>';
    }).join("");
  }
  function render(data) {
    const month = data.month;
    const label = monthLabel(month);
    const period = $("payrollPeriodLabel");
    if (period) period.textContent = "Statistiques de " + label;
    const autonomous = (data.entries || []).filter(row => row.status === "autonome");
    const beginners = (data.entries || []).filter(row => row.status === "debutant");
    const autoCount = $("payrollAutonomousCount"), beginnerCount = $("payrollBeginnerCount");
    if (autoCount) autoCount.textContent = autonomous.length + (autonomous.length === 1 ? " collaborateur" : " collaborateurs");
    if (beginnerCount) beginnerCount.textContent = beginners.length + (beginners.length === 1 ? " collaboratrice" : " collaboratrices");
    renderTable(autonomous, true);
    renderTable(beginners, false);
    setMessage("Calcul basé sur les règles Mon salaire et les KPI Brokerlink synchronisés. Les rendez-vous du week-end restent dans les statistiques, mais ne déclenchent pas de bonus ni de malus.", "info");
  }
  async function load(month) {
    const currentRequest = ++requestId;
    setMessage("Chargement des données…", "loading");
    const host = $("payrollAutonomousRows");
    const beginnerHost = $("payrollBeginnerRows");
    if (host) host.innerHTML = '<tr><td colspan="6"><div class="payroll-empty">Chargement…</div></td></tr>';
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
      if (host) host.innerHTML = '<tr><td colspan="6"><div class="payroll-empty">Les données ne sont pas disponibles.</div></td></tr>';
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