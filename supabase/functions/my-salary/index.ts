import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim();
const dateOf = (value: unknown) => {
  const text = String(value ?? "");
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const fr = text.match(/(?:^|\D)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\D|$)/);
  return fr ? fr[3] + "-" + fr[2].padStart(2,"0") + "-" + fr[1].padStart(2,"0") : "";
};
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).replace(/\s/g,"").replace(",",".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const field = (row: Record<string, unknown>, names: string[]) => {
  const keys = Object.keys(row || {});
  const wanted = new Set(names.map(normalize));
  const key = keys.find((item) => wanted.has(normalize(item)));
  return key ? row[key] : null;
};
const ranks = [
  { name:"IRON", min:0, coefficient:0.25 },
  { name:"GOLD", min:5, coefficient:0.50 },
  { name:"DIAMOND", min:10, coefficient:0.75 },
  { name:"MASTER", min:15, coefficient:0.90 },
  { name:"CHALLENGER", min:20, coefficient:1.00 }
];
const currentMonth = () => {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(new Date());
  return parts.find(p=>p.type==="year")!.value + "-" + parts.find(p=>p.type==="month")!.value;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error:"Méthode non autorisée." },405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const publicKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const auth = createClient(url, publicKey, { global:{headers:{Authorization:authorization}}, auth:{persistSession:false,autoRefreshToken:false} });
    const {data:{user},error:authError} = await auth.auth.getUser();
    if(authError || !user) return json({error:"Session invalide. Reconnecte-toi."},401);
    const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:profile,error:profileError} = await admin.from("crm_profiles").select("id,username,display_name,role,is_active,employee_id").eq("id",user.id).maybeSingle();
    if(profileError) throw profileError;
    if(!profile || !profile.is_active || profile.role!=="caller" || user.app_metadata?.role!=="caller" || !profile.employee_id) return json({error:"Accès réservé au compte collaborateur actif."},403);

    const body = await req.json().catch(()=>({}));
    const month = typeof body.month==="string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) ? body.month : currentMonth();
    const start = month+"-01";
    const endDate = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
    const end = month+"-"+String(endDate).padStart(2,"0");
    const attendanceKey = "local:cc_attendance_"+profile.employee_id;
    const {data:states,error:stateError} = await admin.from("crm_state").select("state_key,payload").in("state_key",["employees","kpiRows",attendanceKey]);
    if(stateError) throw stateError;
    const state = Object.fromEntries((states||[]).map((row:any)=>[row.state_key,row.payload]));
    const employee = (Array.isArray(state.employees)?state.employees:[]).find((item:any)=>String(item?.id)===String(profile.employee_id));
    if(!employee) return json({error:"La fiche collaborateur liée à ce compte est introuvable."},404);

    const employeeNames = new Set([employee.name,employee.brokerlinkAccountName,employee.brokerlinkId].filter(Boolean).map(normalize));
    const sourceRows = Array.isArray(state.kpiRows)?state.kpiRows:[];
    const matchingRows = sourceRows.filter((row:any)=>{
      const candidates=[field(row,["collaborateur","employee","nom","nom_complet","employee_name","telephoniste","caller","brokerlink_id","id_brokerlink"])].filter(Boolean).map(normalize);
      return candidates.some((name:string)=>employeeNames.has(name));
    });
    const monthRows = matchingRows.filter((row:any)=>{const d=dateOf(field(row,["date","jour","date_activite","created_at"]));return d>=start&&d<=end;});
    const apptsAliases=["rdv_pris","rendez_vous","appointments","appointment_count"];
    const openingAliases=["ouverture_validee","ouvertures_validees","ouverture_confirmee","ouvertures_confirmees","ouvertures","signatures_validees","signatures_confirmees","signatures","openings","validated_openings","validated_signatures"];
    let hasAppointments=false, hasOpenings=false, productionMalus=0, appointmentsTotal=0, openingsTotal=0;
    const perDay=new Map<string,number>();
    for(const row of monthRows){
      const d=dateOf(field(row,["date","jour","date_activite","created_at"]));
      const a=number(field(row,apptsAliases));
      const o=number(field(row,openingAliases));
      if(a!==null&&d){hasAppointments=true;perDay.set(d,(perDay.get(d)||0)+a);appointmentsTotal+=a;}
      if(o!==null){hasOpenings=true;openingsTotal+=o;}
    }

    const attendance=state[attendanceKey]&&typeof state[attendanceKey]==="object"?state[attendanceKey]:{};
    const inMonth=(item:any)=>{const d=dateOf(item?.date);return d>=start&&d<=end;};
    const absences=(Array.isArray(attendance.absences)?attendance.absences:[]).filter(inMonth);
    const lates=(Array.isArray(attendance.lates)?attendance.lates:[]).filter(inMonth);
    const absenceDates=new Set(absences.map((item:any)=>dateOf(item.date)));
    let missedAppointments=0;
    for(const [day,count] of perDay.entries()) if(!absenceDates.has(day)) missedAppointments+=Math.max(0,3-count);
    productionMalus=missedAppointments*20000;
    const lateCounts={green:0,orange:0,red:0};
    for(const item of lates){
      const label=normalize(item?.level||item?.color||item?.severity||item?.status||"");
      const mins=number(item?.minutes??item?.retardMinutes??item?.duration);
      const bucket=label.includes("red")||label.includes("rouge")||mins!==null&&mins>30?"red":label.includes("orange")||mins!==null&&mins>10?"orange":"green";
      lateCounts[bucket]++;
    }
    const lateMalus=lateCounts.green*10000+lateCounts.orange*20000+lateCounts.red*40000;
    const absenceMalus=absences.length*(2000000/22);
    const deductions=productionMalus+lateMalus+absenceMalus;
    const preCoefficient=Math.max(0,2000000-deductions);
    const rank=hasOpenings?ranks.slice().reverse().find((r)=>openingsTotal>=r.min)||ranks[0]:null;
    const nextRank=rank?ranks[ranks.indexOf(rank)+1]||null:null;
    const salary=rank?preCoefficient*rank.coefficient:null;
    const nextSalary=nextRank?preCoefficient*nextRank.coefficient:null;
    return json({
      month,username:profile.username,displayName:profile.display_name,employeeName:employee.name,employeeId:profile.employee_id,
      baseSalary:2000000, salaryEstimate:salary, salaryAtNextRank:nextSalary, preCoefficientEstimate:preCoefficient,
      rank:rank?{name:rank.name,coefficient:rank.coefficient,min:rank.min}:null,
      nextRank:nextRank?{name:nextRank.name,coefficient:nextRank.coefficient,min:nextRank.min}:null,
      openings:hasOpenings?openingsTotal:null, openingsRemaining:nextRank?Math.max(0,nextRank.min-openingsTotal):0,
      appointments:hasAppointments?appointmentsTotal:null, productionDays:perDay.size, missedAppointments:hasAppointments?missedAppointments:null,
      productionMalus:hasAppointments?productionMalus:null,lateCounts,lateMalus,absenceDays:absences.length,absenceMalus,
      hasKpiData:monthRows.length>0,hasAppointmentData:hasAppointments,hasOpeningData:hasOpenings,hasAttendanceData:Object.prototype.hasOwnProperty.call(state,attendanceKey),
      deductions:hasAppointments?productionMalus+lateMalus+absenceMalus:null,complete:hasAppointments&&hasOpenings&&Object.prototype.hasOwnProperty.call(state,attendanceKey),
      updatedAt:new Date().toISOString()
    });
  } catch(error) {
    console.error("my-salary:",error);
    return json({error:"Impossible de charger ton estimation de salaire pour le moment."},500);
  }
});