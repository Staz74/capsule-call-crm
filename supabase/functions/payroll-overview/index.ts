import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim();
const dateOf = (value: unknown) => {
  const text = String(value ?? "");
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const fr = text.match(/(?:^|\D)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\D|$)/);
  return fr ? fr[3] + "-" + fr[2].padStart(2, "0") + "-" + fr[1].padStart(2, "0") : "";
};
const isWorkday = (value: unknown) => {
  const date = dateOf(value);
  if (!date) return false;
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return day !== 0 && day !== 6;
};
const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const field = (row: Record<string, unknown>, names: string[]) => {
  const set = new Set(names.map(normalize));
  const key = Object.keys(row || {}).find(item => set.has(normalize(item)));
  return key ? row[key] : null;
};
const currentMonth = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return parts.find(part => part.type === "year")!.value + "-" + parts.find(part => part.type === "month")!.value;
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const money = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
};
const dateLabel = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const appointmentAliases = ["rdv_pris", "rendez_vous", "appointments", "appointment_count"];
const openingAliases = ["ouverture_validee", "ouvertures_validees", "ouverture_confirmee", "ouvertures_confirmees", "signature_confirmee", "signatures_confirmees", "signatures_validees", "ouvertures_lpp", "signatures_lca", "confirmed_signatures", "validated_signatures", "signed_accounts", "signatures", "openings", "validated_openings"];
const ranks = [
  { name: "IRON", min: 0, coefficient: 0.25 },
  { name: "GOLD", min: 5, coefficient: 0.50 },
  { name: "DIAMOND", min: 10, coefficient: 0.75 },
  { name: "MASTER", min: 15, coefficient: 0.90 },
  { name: "CHALLENGER", min: 20, coefficient: 1 }
];
const rankFor = (signatures: number) => ranks.slice().reverse().find(rank => signatures >= rank.min) || ranks[0];
const dateAliases = ["date", "jour", "date_activite", "created_at"];
const loginAliases = ["premiere_connexion", "first_login", "heure_premiere_connexion", "h_1ere_co", "first_connection"];

function summarizeFormerEmployee(employee: Record<string, any>, rows: any[], month: string) {
  const monthStart = month + "-01";
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const names = new Set([employee.name, employee.brokerlinkAccountName, employee.brokerlinkId].filter(Boolean).map(normalize));
  const emails = new Set([employee.brokerlinkEmail, employee.brokerlink_email, employee.email_brokerlink].filter(Boolean).map((value: unknown) => String(value).trim().toLowerCase()));
  const matchedRows = rows.filter(row => {
    const email = field(row, ["brokerlink_email", "email_brokerlink", "agent_email", "caller_email", "user_email", "email", "courriel", "mail"]);
    if (email) return emails.has(String(email).trim().toLowerCase());
    const label = field(row, ["collaborateur", "employee", "nom", "nom_complet", "collaborateur_nom", "employee_name", "telephoniste", "caller", "brokerlink_id", "id_brokerlink", "name"]);
    return Boolean(label && names.has(normalize(label)));
  }).filter(row => {
    const date = dateOf(field(row, dateAliases));
    return date >= monthStart && date <= lastDay;
  });

  let appointments = 0, signatures = 0, hasAppointmentData = false, hasSignatureData = false;
  for (const row of matchedRows) {
    const rdv = numeric(field(row, appointmentAliases));
    const signed = numeric(field(row, openingAliases));
    if (rdv !== null) {
      hasAppointmentData = true;
      appointments += rdv;
    }
    if (signed !== null) {
      hasSignatureData = true;
      signatures += signed;
    }
  }

  return {
    employeeId: employee.id,
    name: String(employee.name || ""),
    departureDate: dateOf(employee.archivedAt),
    appointments: hasAppointmentData ? appointments : null,
    signatures: hasSignatureData ? signatures : null,
    hasKpiData: hasAppointmentData || hasSignatureData
  };
}

function summarizeEmployee(employee: Record<string, any>, rows: any[], attendance: Record<string, any>, salaryRules: Record<string, any>, month: string, todayDate: string) {
  const monthStart = month + "-01";
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const malusStart = month === "2026-11" ? "2026-11-10" : monthStart;
  const configured = {
    base: month === "2026-11" ? 1500000 : money(salaryRules.base, 2000000),
    rdvTarget: money(salaryRules.rdvTarget, 3),
    rdv0: money(salaryRules.rdv0),
    rdv1: money(salaryRules.rdv1),
    rdv2: money(salaryRules.rdv2),
    lateGreen: money(salaryRules.lateGreen),
    lateOrange: money(salaryRules.lateOrange),
    lateRed: money(salaryRules.lateRed),
    absenceHalf: money(salaryRules.absenceHalf),
    absenceFull: money(salaryRules.absenceFull),
    rdvBonusPerExtra: money(salaryRules.rdvBonusPerExtra, 10000)
  };
  const names = new Set([employee.name, employee.brokerlinkAccountName, employee.brokerlinkId].filter(Boolean).map(normalize));
  const emails = new Set([employee.brokerlinkEmail, employee.brokerlink_email, employee.email_brokerlink].filter(Boolean).map((value: unknown) => String(value).trim().toLowerCase()));
  const matchedRows = rows.filter(row => {
    const email = field(row, ["brokerlink_email", "email_brokerlink", "agent_email", "caller_email", "user_email", "email", "courriel", "mail"]);
    if (email) return emails.has(String(email).trim().toLowerCase());
    const label = field(row, ["collaborateur", "employee", "nom", "nom_complet", "collaborateur_nom", "employee_name", "telephoniste", "caller", "brokerlink_id", "id_brokerlink"]);
    return Boolean(label && names.has(normalize(label)));
  }).filter(row => {
    const date = dateOf(field(row, dateAliases));
    return date >= monthStart && date <= lastDay;
  });

  let appointments = 0, signatures = 0, hasAppointmentData = false, hasSignatureData = false;
  const appointmentsByDate = new Map<string, number>();
  const workdayAppointments = new Map<string, number>();
  for (const row of matchedRows) {
    const date = dateOf(field(row, dateAliases));
    const rdv = numeric(field(row, appointmentAliases));
    const signed = numeric(field(row, openingAliases));
    if (rdv !== null) {
      hasAppointmentData = true;
      appointments += rdv;
      if (date) {
        appointmentsByDate.set(date, (appointmentsByDate.get(date) || 0) + rdv);
        if (isWorkday(date)) workdayAppointments.set(date, (workdayAppointments.get(date) || 0) + rdv);
      }
    }
    if (signed !== null) {
      hasSignatureData = true;
      signatures += signed;
    }
  }

  let lates = (Array.isArray(attendance.lates) ? attendance.lates : [])
    .filter((item: any) => { const date = dateOf(item.date); return date >= malusStart && date <= lastDay && isWorkday(date); });
  let absences = (Array.isArray(attendance.absences) ? attendance.absences : [])
    .filter((item: any) => { const date = dateOf(item.date); return date >= malusStart && date <= lastDay && isWorkday(date); });

  const schedule = employee.workSchedule && typeof employee.workSchedule === "object" ? employee.workSchedule : {};
  const scheduledStart = String(schedule.morningStart || schedule.afternoonStart || "");
  const scheduledStartMinutes = scheduledStart ? Number(scheduledStart.slice(0, 2)) * 60 + Number(scheduledStart.slice(3, 5)) : null;
  if (scheduledStartMinutes !== null) {
    const manualLateDates = new Set(lates.map((item: any) => dateOf(item.date)));
    const absenceDates = new Set(absences.map((item: any) => dateOf(item.date)));
    const firstLoginByDate = new Map<string, string>();
    const addLogin = (dateValue: unknown, timeValue: unknown) => {
      const date = dateOf(dateValue), raw = String(timeValue ?? "").trim(), match = raw.match(/(?:^|T|\s)(\d{1,2}:\d{2})/);
      if (!date || date < monthStart || date > lastDay || !isWorkday(date) || !match) return;
      const time = match[1].padStart(5, "0"), previous = firstLoginByDate.get(date);
      if (!previous || time < previous) firstLoginByDate.set(date, time);
    };
    for (const row of matchedRows) addLogin(field(row, dateAliases), field(row, loginAliases));
    for (const row of Array.isArray(attendance.crm) ? attendance.crm : []) {
      addLogin(row.date, row.firstLogin || row.first_login || row.firstConnection || row.h_1ere_co);
    }
    for (const [date, time] of firstLoginByDate) {
      if (manualLateDates.has(date) || absenceDates.has(date)) continue;
      const [hours, minutes] = time.split(":").map(Number);
      const delay = hours * 60 + minutes - scheduledStartMinutes;
      if (delay <= 0) continue;
      const level = delay <= 10 ? "green" : delay <= 30 ? "orange" : "red";
      lates.push({ date, minutes: delay, level, source: "schedule" });
    }
  }

  const absenceDays = new Set(absences.map((item: any) => dateOf(item.date)));
  const rdvAmount = (count: number) => count >= configured.rdvTarget ? 0 : count === 2 ? configured.rdv2 : count === 1 ? configured.rdv1 : configured.rdv0;
  let productionMalus = 0, lateMalus = 0, absenceMalus = 0, totalBonuses = 0;
  const maluses: any[] = [], bonuses: any[] = [];
  for (const [date, count] of [...workdayAppointments.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (date < malusStart || date >= todayDate || absenceDays.has(date)) continue;
    if (count < configured.rdvTarget) {
      const amount = rdvAmount(count);
      productionMalus += amount;
      maluses.push({ date, detail: count + " rendez-vous sur " + configured.rdvTarget, amount });
    }
  }
  for (const item of lates) {
    const date = dateOf(item.date);
    if (!date || date < malusStart || date > lastDay || !isWorkday(date)) continue;
    const minutes = numeric(item.minutes ?? item.duration ?? item.retardMinutes) ?? 0;
    const level = String(item.level || item.color || item.severity || (minutes <= 10 ? "green" : minutes <= 30 ? "orange" : "red")).toLowerCase();
    const key = level.includes("red") || level.includes("rouge") ? "lateRed" : level.includes("orange") ? "lateOrange" : "lateGreen";
    const amount = configured[key as keyof typeof configured] as number;
    lateMalus += amount;
    maluses.push({ date, detail: "Retard " + (key === "lateGreen" ? "vert" : key === "lateOrange" ? "orange" : "rouge"), amount });
  }
  for (const item of absences) {
    const date = dateOf(item.date);
    if (!date || date < malusStart || date > lastDay || !isWorkday(date)) continue;
    const text = normalize(item.duration || item.period || "");
    const half = String(item.halfDay || "").toLowerCase() === "true" || text.includes("demi") || text.includes("matin") || text.includes("apres");
    const amount = half ? configured.absenceHalf : configured.absenceFull;
    absenceMalus += amount;
    maluses.push({ date, detail: "Absence · " + (half ? "demi-journée" : "journée"), amount });
  }
  for (const [date, count] of [...workdayAppointments.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (date < malusStart || date > lastDay || absenceDays.has(date) || count <= configured.rdvTarget) continue;
    const extraAppointments = count - configured.rdvTarget;
    const amount = extraAppointments * configured.rdvBonusPerExtra;
    if (amount <= 0) continue;
    totalBonuses += amount;
    bonuses.push({ date, amount });
  }

  const totalDeductions = productionMalus + lateMalus + absenceMalus;
  const salaryBeforeRank = Math.max(0, configured.base - totalDeductions + totalBonuses);
  const currentRank = hasSignatureData ? rankFor(signatures) : null;
  const currentRankIndex = currentRank ? ranks.findIndex(rank => rank.name === currentRank.name) : -1;
  const nextRank = currentRankIndex >= 0 ? ranks[currentRankIndex + 1] || null : null;
  const calculatedSalary = currentRank ? Math.round(salaryBeforeRank * currentRank.coefficient) : null;
  const nextRankSalary = nextRank ? Math.round(salaryBeforeRank * nextRank.coefficient) : null;
  const employeeStatus = normalize(employee.status);
  return {
    employeeId: employee.id,
    name: String(employee.name || ""),
    status: employeeStatus === "autonome" ? "autonome" : "debutant",
    appointments: hasAppointmentData ? appointments : null,
    signatures: hasSignatureData ? signatures : null,
    bonus: totalBonuses,
    malus: totalDeductions,
    baseSalary: configured.base,
    rankName: currentRank?.name ?? null,
    rankCoefficient: currentRank?.coefficient ?? null,
    salary: calculatedSalary,
    nextRankName: nextRank?.name ?? null,
    nextRankCoefficient: nextRank?.coefficient ?? null,
    nextRankSalary,
    hasKpiData: hasAppointmentData || hasSignatureData,
    bonusDetails: bonuses.length,
    malusDetails: maluses.length,
    productionDays: appointmentsByDate.size
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    const auth = createClient(url, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: authError } = await auth.auth.getUser();
    if (authError || !user) return json({ error: "Session invalide. Reconnecte-toi." }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("crm_profiles")
      .select("id,role,is_active").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_active || profile.role !== "admin" || user.app_metadata?.role !== "admin") {
      return json({ error: "Accès réservé à l’administrateur." }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const month = typeof body.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) ? body.month : currentMonth();
    const todayDate = today();
    const { data: baseRows, error: baseError } = await admin.from("crm_state")
      .select("state_key,payload").in("state_key", ["employees", "archivedEmployees", "kpiRows", "controlRules"]);
    if (baseError) throw baseError;
    const state = Object.fromEntries((baseRows || []).map((row: any) => [row.state_key, row.payload]));
    const allEmployees = Array.isArray(state.employees) ? state.employees : [];
    const eligible = allEmployees.filter((employee: any) => {
      if (!employee || employee.archivedAt || employee.status === "Sorti") return false;
      const status = normalize(employee.status);
      return status === "autonome" || status === "debutant";
    });
    const activeEmployeeIds = new Set(allEmployees.map((employee: any) => String(employee?.id ?? "")));
    const archivedEmployees = Array.isArray(state.archivedEmployees) ? state.archivedEmployees : [];
    const monthStart = month + "-01";
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const formerEligible = archivedEmployees.filter((employee: any) => {
      const departureDate = dateOf(employee?.archivedAt);
      return employee && departureDate >= monthStart && departureDate <= lastDay && !activeEmployeeIds.has(String(employee.id ?? ""));
    });
    const rows = Array.isArray(state.kpiRows) ? state.kpiRows : [];
    const formerEntries = formerEligible.map((employee: any) => summarizeFormerEmployee(employee, rows, month))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, "fr"));
    const attendanceKeys = eligible.map((employee: any) => "local:cc_attendance_" + employee.id);
    let attendanceRows: any[] = [];
    if (attendanceKeys.length) {
      const { data, error } = await admin.from("crm_state").select("state_key,payload").in("state_key", attendanceKeys);
      if (error) throw error;
      attendanceRows = data || [];
    }
    const attendanceByKey = new Map(attendanceRows.map(row => [row.state_key, row.payload]));
    const salaryRules = state.controlRules?.salary && typeof state.controlRules.salary === "object" ? state.controlRules.salary : {};
    const entries = eligible.map((employee: any) => {
      const key = "local:cc_attendance_" + employee.id;
      const attendance = attendanceByKey.get(key);
      const status = normalize(employee.status);
      return summarizeEmployee(employee, rows, attendance && typeof attendance === "object" ? attendance : {}, salaryRules, month, todayDate);
    }).sort((a: any, b: any) => a.name.localeCompare(b.name, "fr"));
    return json({ month, entries, formerEntries, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("payroll-overview:", error);
    return json({ error: "Impossible de charger le tableau de gestion des salaires." }, 500);
  }
});
