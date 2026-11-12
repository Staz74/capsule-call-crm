import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Content-Type":"application/json" };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const normalize=(value:unknown)=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g," ").trim();
const dateOf=(value:unknown)=>{const text=String(value??"");const iso=text.match(/\d{4}-\d{2}-\d{2}/);if(iso)return iso[0];const fr=text.match(/(?:^|\D)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\D|$)/);return fr?fr[3]+"-"+fr[2].padStart(2,"0")+"-"+fr[1].padStart(2,"0"):"";};
const numeric=(value:unknown):number|null=>{if(value===null||value===undefined||value==="")return null;const match=String(value).replace(/\s/g,"").replace(",",".").match(/-?\d+(?:\.\d+)?/);return match?Number(match[0]):null;};
const field=(row:Record<string,unknown>,names:string[])=>{const set=new Set(names.map(normalize));const key=Object.keys(row||{}).find(item=>set.has(normalize(item)));return key?row[key]:null;};
const currentMonth=()=>{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(new Date());return parts.find(p=>p.type==="year")!.value+"-"+parts.find(p=>p.type==="month")!.value;};
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const ranks=[
 {name:"IRON",min:0,coefficient:0.25},
 {name:"GOLD",min:5,coefficient:0.50},
 {name:"DIAMOND",min:10,coefficient:0.75},
 {name:"MASTER",min:15,coefficient:0.90},
 {name:"CHALLENGER",min:20,coefficient:1}
];
const rankFor=(openings:number)=>ranks.slice().reverse().find(r=>openings>=r.min)||ranks[0];
const money=(value:unknown,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,n):fallback;};
const dateLabel=(date:string)=>new Date(date+"T12:00:00Z").toLocaleDateString("fr-FR",{timeZone:"UTC",weekday:"short",day:"numeric",month:"short"});

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Méthode non autorisée."},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")!;
  const publicKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
  const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
  const publicKey=publicKeys.default||Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader=req.headers.get("Authorization")||"";
  const auth=createClient(url,publicKey,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await auth.auth.getUser();
  if(authError||!user)return json({error:"Session invalide. Reconnecte-toi."},401);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:profile,error:profileError}=await admin.from("crm_profiles").select("id,username,display_name,role,is_active,employee_id").eq("id",user.id).maybeSingle();
  if(profileError)throw profileError;
  if(!profile||!profile.is_active||profile.role!=="caller"||user.app_metadata?.role!=="caller"||!profile.employee_id)return json({error:"Accès réservé au compte collaborateur actif."},403);
  const body=await req.json().catch(()=>({}));
  const month=typeof body.month==="string"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)?body.month:currentMonth();
  const todayDate=today(),monthStart=month+"-01",monthEnd=month+"-31",malusStart=month==="2026-11"?"2026-11-10":monthStart,attendanceKey="local:cc_attendance_"+profile.employee_id;
  const {data:rows,error:stateError}=await admin.from("crm_state").select("state_key,payload").in("state_key",["employees","kpiRows","controlRules",attendanceKey]);
  if(stateError)throw stateError;
  const state=Object.fromEntries((rows||[]).map((row:any)=>[row.state_key,row.payload]));
  const employee=(Array.isArray(state.employees)?state.employees:[]).find((item:any)=>String(item?.id)===String(profile.employee_id));
  if(!employee)return json({error:"La fiche collaborateur liée à ce compte est introuvable."},404);
  const rules=state.controlRules?.salary&&typeof state.controlRules.salary==="object"?state.controlRules.salary:{};
  const fullMonthBaseSalary=money(rules.base,2000000),isNovember2026Prorata=month==="2026-11",baseSalary=isNovember2026Prorata?1500000:fullMonthBaseSalary,target=money(rules.rdvTarget,3);
  const configured={
    base:baseSalary,rdvTarget:target,rdv0:money(rules.rdv0),rdv1:money(rules.rdv1),rdv2:money(rules.rdv2),
    lateGreen:money(rules.lateGreen),lateOrange:money(rules.lateOrange),lateRed:money(rules.lateRed),
    absenceHalf:money(rules.absenceHalf),absenceFull:money(rules.absenceFull),rdvBonus4:money(rules.rdvBonus4),rdvBonus5:money(rules.rdvBonus5),rdvBonus6:money(rules.rdvBonus6),rdvBonus7:money(rules.rdvBonus7)
  };
  const settings={...configured};
  let demoDefaultsApplied=false;
  const names=new Set([employee.name,employee.brokerlinkAccountName,employee.brokerlinkId].filter(Boolean).map(normalize));
  const brokerlinkEmails=new Set([employee.brokerlinkEmail,employee.brokerlink_email,employee.email_brokerlink].filter(Boolean).map((value:string)=>String(value).trim().toLowerCase()));
  const allRows=Array.isArray(state.kpiRows)?state.kpiRows:[];
  const matched=allRows.filter((row:any)=>{
    const email=field(row,["brokerlink_email","email_brokerlink","agent_email","caller_email","user_email","email","courriel","mail"]);
    if(email)return brokerlinkEmails.has(String(email).trim().toLowerCase());
    const label=field(row,["collaborateur","employee","nom","nom_complet","collaborateur_nom","employee_name","telephoniste","caller","brokerlink_id","id_brokerlink"]);
    return label&&names.has(normalize(label));
  });
  let monthRows=matched.filter((row:any)=>{const d=dateOf(field(row,["date","jour","date_activite","created_at"]));return d>=monthStart&&d<=monthEnd;});
  const attendance=state[attendanceKey]&&typeof state[attendanceKey]==="object"?state[attendanceKey]:{};
  let lates=(Array.isArray(attendance.lates)?attendance.lates:[]).filter((item:any)=>{const d=dateOf(item.date);return d>=malusStart&&d<=monthEnd;});
  let absences=(Array.isArray(attendance.absences)?attendance.absences:[]).filter((item:any)=>{const d=dateOf(item.date);return d>=malusStart&&d<=monthEnd;});
  const demoMode=profile.employee_id===3&&profile.username==="christelle.laivao"&&month===currentMonth()&&monthRows.length===0&&lates.length===0&&absences.length===0;
  if(demoMode){
    const demoDates=[month+"-10",month+"-11",month+"-12",month+"-13"];
    monthRows=[
      {date:demoDates[0],collaborateur:employee.name,rdv_pris:1,ouvertures_confirmees:1},
      {date:demoDates[1],collaborateur:employee.name,rdv_pris:3,ouvertures_confirmees:1},
      {date:demoDates[2],collaborateur:employee.name,rdv_pris:2,ouvertures_confirmees:2},
      {date:demoDates[3],collaborateur:employee.name,rdv_pris:2,ouvertures_confirmees:2}
    ];
    lates=[{date:demoDates[1],minutes:18,level:"orange"},{date:demoDates[2],minutes:6,level:"green"}];
    absences=[];
    // Example-only reference values. Real caller accounts always use the saved CRM settings unchanged.
    if(configured.rdv0===0&&configured.rdv1===0&&configured.rdv2===0){configured.rdv0=60000;configured.rdv1=40000;configured.rdv2=20000;demoDefaultsApplied=true;}
    if(configured.lateGreen===0&&configured.lateOrange===0&&configured.lateRed===0){configured.lateGreen=10000;configured.lateOrange=20000;configured.lateRed=40000;demoDefaultsApplied=true;}
    if(configured.absenceHalf===0&&configured.absenceFull===0){configured.absenceHalf=45455;configured.absenceFull=90909;demoDefaultsApplied=true;}
  }
  const schedule=employee.workSchedule&&typeof employee.workSchedule==="object"?employee.workSchedule:{};
  const scheduledStart=String(schedule.morningStart||schedule.afternoonStart||"");
  const scheduledStartMinutes=scheduledStart?Number(scheduledStart.slice(0,2))*60+Number(scheduledStart.slice(3,5)):null;
  if(scheduledStartMinutes!==null){
    const manualLateDates=new Set(lates.map((item:any)=>dateOf(item.date)));
    const absenceDates=new Set(absences.map((item:any)=>dateOf(item.date)));
    const firstLoginByDate=new Map<string,string>();
    const addLogin=(dateValue:unknown,timeValue:unknown)=>{
      const d=dateOf(dateValue),raw=String(timeValue??"").trim(),match=raw.match(/(?:^|T|\s)(\d{1,2}:\d{2})/);
      if(!d||d<monthStart||d>monthEnd||!match)return;
      const time=match[1].padStart(5,"0"),previous=firstLoginByDate.get(d);
      if(!previous||time<previous)firstLoginByDate.set(d,time);
    };
    for(const row of monthRows)addLogin(field(row,["date","jour","date_activite","created_at"]),field(row,["premiere_connexion","first_login","heure_premiere_connexion","h_1ere_co","first_connection"]));
    for(const row of Array.isArray(attendance.crm)?attendance.crm:[])addLogin(row.date,row.firstLogin||row.first_login||row.firstConnection||row.h_1ere_co);
    for(const [d,time] of firstLoginByDate){
      if(manualLateDates.has(d)||absenceDates.has(d))continue;
      const [hours,minutes]=time.split(":").map(Number),delay=hours*60+minutes-scheduledStartMinutes;
      if(delay<=0)continue;
      const level=delay<=10?"green":delay<=30?"orange":"red";
      lates.push({date:d,minutes:delay,level,source:"schedule"});
    }
  }
  // Reapply the payroll cutoff after demo rows and schedule-derived lateness have been added.
  lates=lates.filter((item:any)=>{const d=dateOf(item.date);return d>=malusStart&&d<=monthEnd;});
  absences=absences.filter((item:any)=>{const d=dateOf(item.date);return d>=malusStart&&d<=monthEnd;});
  const appointmentAliases=["rdv_pris","rendez_vous","appointments","appointment_count"];
  const openingAliases=["ouverture_validee","ouvertures_validees","ouverture_confirmee","ouvertures_confirmees","signature_confirmee","signatures_confirmees","signatures_validees","ouvertures_lpp","signatures_lca","confirmed_signatures","validated_signatures","signed_accounts","signatures","openings","validated_openings"];
  const perDay=new Map<string,number>(),opensByDay=new Map<string,number>();
  let appointmentTotal=0,openingsTotal=0,hasAppointmentData=false,hasOpeningData=false;
  for(const row of monthRows){
    const d=dateOf(field(row,["date","jour","date_activite","created_at"]));
    const appointments=numeric(field(row,appointmentAliases)),openings=numeric(field(row,openingAliases));
    if(d&&appointments!==null){hasAppointmentData=true;perDay.set(d,(perDay.get(d)||0)+appointments);appointmentTotal+=appointments;}
    if(openings!==null){hasOpeningData=true;openingsTotal+=openings;if(d)opensByDay.set(d,(opensByDay.get(d)||0)+openings);}
  }
  const absenceDays=new Set(absences.map((item:any)=>dateOf(item.date)));
  const rdvAmount=(count:number)=>count>=target?0:count===2?configured.rdv2:count===1?configured.rdv1:configured.rdv0;
  const maluses:any[]=[];
  let productionMalus=0,missingRdv=0;
  for(const [date,count] of [...perDay.entries()].sort(([a],[b])=>a.localeCompare(b))){
    if(date<malusStart||date>=todayDate||absenceDays.has(date))continue;
    if(count<target){
      const amount=rdvAmount(count);productionMalus+=amount;missingRdv+=Math.max(0,target-count);
      maluses.push({date,label:dateLabel(date),kind:"rdv",detail:count+" rendez-vous sur "+target,amount});
    }
  }
  let lateMalus=0;
  for(const item of lates){
    const mins=numeric(item.minutes??item.duration??item.retardMinutes)??0;
    const level=String(item.level||item.color||item.severity||(mins<=10?"green":mins<=30?"orange":"red")).toLowerCase();
    const key=level.includes("red")||level.includes("rouge")?"lateRed":level.includes("orange")?"lateOrange":"lateGreen";
    const amount=configured[key as keyof typeof configured] as number;
    lateMalus+=amount;
    maluses.push({date:dateOf(item.date),label:dateLabel(dateOf(item.date)),kind:"late",detail:"Retard "+(key==="lateGreen"?"vert":key==="lateOrange"?"orange":"rouge")+" · "+mins+" min",minutes:mins,level:key,amount});
  }
  let absenceMalus=0;
  for(const item of absences){
    const text=normalize(item.duration||item.period||"");
    const half=String(item.halfDay||"").toLowerCase()==="true"||text.includes("demi")||text.includes("matin")||text.includes("apres");
    const amount=half?configured.absenceHalf:configured.absenceFull;
    absenceMalus+=amount;
    maluses.push({date:dateOf(item.date),label:dateLabel(dateOf(item.date)),kind:"absence",detail:"Absence · "+(half?"demi-journée":"journée"),amount});
  }
  maluses.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const totalDeductions=productionMalus+lateMalus+absenceMalus;
  const bonuses:any[]=[];
  let totalBonuses=0;
  for(const [date,count] of [...perDay.entries()].sort(([a],[b])=>a.localeCompare(b))){
    if(date<malusStart||date>monthEnd||absenceDays.has(date))continue;
    const key=count>=7?"rdvBonus7":count===6?"rdvBonus6":count===5?"rdvBonus5":count===4?"rdvBonus4":null;
    if(!key)continue;
    const amount=configured[key as keyof typeof configured] as number;
    if(amount<=0)continue;
    totalBonuses+=amount;
    bonuses.push({date,label:dateLabel(date),kind:"rdvBonus",detail:count+" rendez-vous réalisés",amount});
  }
  const salaryAfterMaluses=Math.max(0,baseSalary-totalDeductions+totalBonuses);
  const openingRank=hasOpeningData?rankFor(openingsTotal):null;
  const nextRank=openingRank?ranks[ranks.indexOf(openingRank)+1]||null:null;
  const remaining=openingRank&&nextRank?Math.max(0,nextRank.min-openingsTotal):null;
  const todayRdv=perDay.has(todayDate)?perDay.get(todayDate):null;
  const todayOpenings=opensByDay.get(todayDate)||0;
  const attendancePercent=demoMode?94:state[attendanceKey]?(Math.max(0,Math.round(100-(absences.length/22*100)))):null;
  const startDate=dateOf(employee.actualStart||employee.date);
  const tenureWeeks=startDate?Math.max(0,Math.floor((Date.now()-new Date(startDate+"T12:00:00Z").getTime())/(7*86400000))):null;
  const rdvMalusConfigured=[settings.rdv0,settings.rdv1,settings.rdv2].some(v=>v>0);
  const lateMalusConfigured=[settings.lateGreen,settings.lateOrange,settings.lateRed].some(v=>v>0);
  const absenceMalusConfigured=[settings.absenceHalf,settings.absenceFull].some(v=>v>0);
  const rdvBonusConfigured=[settings.rdvBonus4,settings.rdvBonus5,settings.rdvBonus6,settings.rdvBonus7].some(v=>v>0);
  return json({
    month,username:profile.username,displayName:profile.display_name,employeeName:employee.name,
    baseSalary,fullMonthBaseSalary,isNovember2026Prorata,salaryAfterMaluses,totalDeductions,totalBonuses,productionMalus,lateMalus,absenceMalus,
    currentRankEstimate:openingRank?salaryAfterMaluses*openingRank.coefficient:null,
    nextRankEstimate:nextRank?salaryAfterMaluses*nextRank.coefficient:null,
    rank:openingRank?{name:openingRank.name,min:openingRank.min,coefficient:openingRank.coefficient}:null,
    nextRank:nextRank?{name:nextRank.name,min:nextRank.min,coefficient:nextRank.coefficient}:null,
    openingsRemaining:remaining,appointmentsToday:todayRdv,appointmentTarget:target,appointmentsTotal:hasAppointmentData?appointmentTotal:null,
    openingsToday:hasOpeningData?todayOpenings:null,lateCount:lates.length,absenceCount:absences.length,attendancePercent,tenureWeeks,
    missingRdv:hasAppointmentData?missingRdv:null,productionDays:perDay.size,maluses,bonuses,
    configuration:configured,settings,demoDefaultsApplied,
    hasKpiData:hasAppointmentData,hasOpeningData,hasAttendanceData:Object.prototype.hasOwnProperty.call(state,attendanceKey),
    rdvMalusConfigured,lateMalusConfigured,absenceMalusConfigured,rdvBonusConfigured,demoMode,updatedAt:new Date().toISOString()
  });
 }catch(error){console.error("my-salary:",error);return json({error:"Impossible de charger ton estimation de salaire pour le moment."},500);}
});