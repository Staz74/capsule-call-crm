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
  const monthStart=month+"-01",monthEnd=month+"-31",attendanceKey="local:cc_attendance_"+profile.employee_id;
  const {data:rows,error:stateError}=await admin.from("crm_state").select("state_key,payload").in("state_key",["employees","kpiRows","controlRules",attendanceKey]);
  if(stateError)throw stateError;
  const state=Object.fromEntries((rows||[]).map((row:any)=>[row.state_key,row.payload]));
  const employee=(Array.isArray(state.employees)?state.employees:[]).find((item:any)=>String(item?.id)===String(profile.employee_id));
  if(!employee)return json({error:"La fiche collaborateur liée à ce compte est introuvable."},404);
  const rules=state.controlRules?.salary&&typeof state.controlRules.salary==="object"?state.controlRules.salary:{};
  const baseSalary=money(rules.base,2000000),target=money(rules.rdvTarget,3);
  const configured={
    base:baseSalary,rdvTarget:target,rdv0:money(rules.rdv0),rdv1:money(rules.rdv1),rdv2:money(rules.rdv2),
    lateGreen:money(rules.lateGreen),lateOrange:money(rules.lateOrange),lateRed:money(rules.lateRed),
    absenceHalf:money(rules.absenceHalf),absenceFull:money(rules.absenceFull)
  };
  const names=new Set([employee.name,employee.brokerlinkAccountName,employee.brokerlinkId].filter(Boolean).map(normalize));
  const allRows=Array.isArray(state.kpiRows)?state.kpiRows:[];
  const matched=allRows.filter((row:any)=>{
    const label=field(row,["collaborateur","employee","nom","nom_complet","collaborateur_nom","employee_name","telephoniste","caller","brokerlink_id","id_brokerlink"]);
    return label&&names.has(normalize(label));
  });
  let monthRows=matched.filter((row:any)=>{const d=dateOf(field(row,["date","jour","date_activite","created_at"]));return d>=monthStart&&d<=monthEnd;});
  const attendance=state[attendanceKey]&&typeof state[attendanceKey]==="object"?state[attendanceKey]:{};
  let lates=(Array.isArray(attendance.lates)?attendance.lates:[]).filter((item:any)=>{const d=dateOf(item.date);return d>=monthStart&&d<=monthEnd;});
  let absences=(Array.isArray(attendance.absences)?attendance.absences:[]).filter((item:any)=>{const d=dateOf(item.date);return d>=monthStart&&d<=monthEnd;});
  const demoMode=profile.employee_id===3&&profile.username==="christelle.laivao"&&month===currentMonth()&&monthRows.length===0&&lates.length===0&&absences.length===0;
  if(demoMode){
    const demoDates=[month+"-02",month+"-03",month+"-04",month+"-05"];
    monthRows=[
      {date:demoDates[0],collaborateur:employee.name,rdv_pris:1,ouvertures_confirmees:1},
      {date:demoDates[1],collaborateur:employee.name,rdv_pris:3,ouvertures_confirmees:1},
      {date:demoDates[2],collaborateur:employee.name,rdv_pris:2,ouvertures_confirmees:2},
      {date:demoDates[3],collaborateur:employee.name,rdv_pris:2,ouvertures_confirmees:2}
    ];
    lates=[{date:demoDates[1],minutes:18,level:"orange"},{date:demoDates[2],minutes:6,level:"green"}];
    absences=[];
  }
  const appointmentAliases=["rdv_pris","rendez_vous","appointments","appointment_count"];
  const openingAliases=["ouverture_validee","ouvertures_validees","ouverture_confirmee","ouvertures_confirmees","signatures_validees","signatures_confirmees","signatures","openings","validated_openings","validated_signatures"];
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
    if(absenceDays.has(date))continue;
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
  const salaryAfterMaluses=Math.max(0,baseSalary-totalDeductions);
  const openingRank=hasOpeningData?rankFor(openingsTotal):null;
  const nextRank=openingRank?ranks[ranks.indexOf(openingRank)+1]||null:null;
  const remaining=openingRank&&nextRank?Math.max(0,nextRank.min-openingsTotal):null;
  const todayDate=today();
  const todayRdv=perDay.has(todayDate)?perDay.get(todayDate):null;
  const todayOpenings=opensByDay.get(todayDate)||0;
  const attendancePercent=demoMode?94:state[attendanceKey]?(Math.max(0,Math.round(100-(absences.length/22*100)))):null;
  const startDate=dateOf(employee.actualStart||employee.date);
  const tenureWeeks=startDate?Math.max(0,Math.floor((Date.now()-new Date(startDate+"T12:00:00Z").getTime())/(7*86400000))):null;
  const rdvMalusConfigured=[configured.rdv0,configured.rdv1,configured.rdv2].some(v=>v>0);
  const lateMalusConfigured=[configured.lateGreen,configured.lateOrange,configured.lateRed].some(v=>v>0);
  const absenceMalusConfigured=[configured.absenceHalf,configured.absenceFull].some(v=>v>0);
  return json({
    month,username:profile.username,displayName:profile.display_name,employeeName:employee.name,
    baseSalary,salaryAfterMaluses,totalDeductions,productionMalus,lateMalus,absenceMalus,
    currentRankEstimate:openingRank?salaryAfterMaluses*openingRank.coefficient:null,
    nextRankEstimate:nextRank?salaryAfterMaluses*nextRank.coefficient:null,
    rank:openingRank?{name:openingRank.name,min:openingRank.min,coefficient:openingRank.coefficient}:null,
    nextRank:nextRank?{name:nextRank.name,min:nextRank.min,coefficient:nextRank.coefficient}:null,
    openingsRemaining:remaining,appointmentsToday:todayRdv,appointmentTarget:target,appointmentsTotal:hasAppointmentData?appointmentTotal:null,
    openingsToday:hasOpeningData?todayOpenings:null,lateCount:lates.length,absenceCount:absences.length,attendancePercent,tenureWeeks,
    missingRdv:hasAppointmentData?missingRdv:null,productionDays:perDay.size,maluses,
    configuration:configured,
    hasKpiData:hasAppointmentData,hasOpeningData,hasAttendanceData:Object.prototype.hasOwnProperty.call(state,attendanceKey),
    rdvMalusConfigured,lateMalusConfigured,absenceMalusConfigured,demoMode,updatedAt:new Date().toISOString()
  });
 }catch(error){console.error("my-salary:",error);return json({error:"Impossible de charger ton estimation de salaire pour le moment."},500);}
});