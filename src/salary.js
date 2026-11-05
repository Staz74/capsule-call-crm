(() => {
  const money = (value) => value == null ? "—" : Math.round(Number(value)).toLocaleString("fr-FR") + " Ar";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const monthNow = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); };
  const monthLabel = (month) => { const d = new Date(month+"-01T12:00:00"); return d.toLocaleDateString("fr-FR",{month:"long",year:"numeric"}); };
  let activeProfile = null, requestVersion = 0;

  function shell() {
    if(document.getElementById("crmSalaryPortal")) return document.getElementById("crmSalaryPortal");
    const host=document.createElement("div");
    host.id="crmSalaryPortal";
    host.className="crm-salary-portal";
    host.innerHTML='<header class="salary-top"><div class="salary-brand"><span class="salary-mark">CC</span><div><b>Capsule Call</b><small>MON SALAIRE</small></div></div><div class="salary-account"><span id="salaryUsername"></span><button type="button" id="salaryLogout">Déconnexion</button></div></header><main class="salary-main"><section class="salary-welcome"><div><div class="salary-kicker">ESPACE COLLABORATEUR</div><h1>Mon salaire</h1><p>Une estimation de ta rémunération du mois, actualisée avec les données disponibles.</p></div><label class="salary-month">Mois<select id="salaryMonth"></select></label></section><div id="salaryStatus" class="salary-status" aria-live="polite">Chargement de ton estimation…</div><section id="salaryContent" hidden></section><footer class="salary-foot">Cette estimation suit le barème configuré par Capsule Call. Le montant définitif est confirmé par l’administration.</footer></main>';
    document.body.append(host);
    const picker=host.querySelector("#salaryMonth"), now=monthNow();
    for(let offset=0;offset<12;offset++){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-offset);const value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");const option=document.createElement("option");option.value=value;option.textContent=monthLabel(value);picker.append(option);}
    picker.value=now;
    picker.addEventListener("change",load);
    host.querySelector("#salaryLogout").addEventListener("click",()=>window.crmCallerLogout?.());
    return host;
  }

  const load = async () => {
    const host=shell(), status=host.querySelector("#salaryStatus"), content=host.querySelector("#salaryContent");
    const version=++requestVersion, month=host.querySelector("#salaryMonth").value||monthNow();
    status.textContent="Mise à jour de l’estimation…";status.className="salary-status";content.hidden=true;
    const {data,error}=await window.crmSupabase.functions.invoke("my-salary",{body:{month}});
    if(version!==requestVersion)return;
    if(error||data?.error){status.className="salary-status is-error";status.textContent=data?.error||"Impossible de charger ton estimation. Réessaie dans un instant.";return;}
    status.textContent=data.complete?"Données du mois à jour":"Estimation partielle · certaines données ne sont pas encore disponibles.";
    status.className="salary-status "+(data.complete?"is-ok":"is-partial");
    content.innerHTML=render(data);content.hidden=false;
  };

  function render(data) {
    const deductions=data.deductions;
    const salary=data.salaryEstimate;
    const estimateReady=data.hasAppointmentData&&data.hasOpeningData;
    const missing=[];
    if(!data.hasAppointmentData)missing.push("les rendez-vous quotidiens Brokerlink");
    if(!data.hasOpeningData)missing.push("les signatures/ouvertures confirmées Brokerlink");
    if(!data.hasAttendanceData)missing.push("les retards et absences saisis dans le CRM");
    const currentRank=data.rank?.name||"En attente";
    const progress=data.rank&&data.nextRank?Math.min(100,Math.round((data.openings-data.rank.min)/(data.nextRank.min-data.rank.min)*100)):data.rank?100:0;
    const rankText=data.openingsRemaining>0&&data.nextRank?"Encore "+data.openingsRemaining+" ouverture"+(data.openingsRemaining>1?"s":"")+" pour atteindre "+data.nextRank.name:null;
    const maluses=[
      {name:"Rendez-vous manquants", detail:data.missedAppointments==null?"Données à recevoir":data.missedAppointments+" rendez-vous", amount:data.productionMalus},
      {name:"Retards verts",detail:data.lateCounts.green+" retard(s)",amount:data.lateCounts.green*10000},
      {name:"Retards orange",detail:data.lateCounts.orange+" retard(s)",amount:data.lateCounts.orange*20000},
      {name:"Retards rouges",detail:data.lateCounts.red+" retard(s)",amount:data.lateCounts.red*40000},
      {name:"Absences",detail:data.absenceDays+" jour(s)",amount:data.absenceMalus}
    ];
    return '<div class="salary-grid"><section class="salary-card salary-primary"><div class="salary-card-label">ESTIMATION APRÈS MALUS · '+esc(monthLabel(data.month).toLocaleUpperCase("fr-FR"))+'</div><div class="salary-amount">'+(salary==null?"À calculer":money(salary))+'</div><div class="salary-caption">'+(estimateReady?"Après application du coefficient "+(data.rank?.coefficient??"—")+" · "+esc(currentRank):"Montant provisoire indisponible tant que les KPI de rang et de production ne sont pas reçus.")+'</div><div class="salary-breakdown"><span>Base mensuelle</span><b>'+money(data.baseSalary)+'</b><span>Malus recensés</span><b>'+(deductions==null?"En attente":money(deductions))+'</b></div></section><section class="salary-card salary-rank"><div class="salary-card-label">TON RANG</div><div class="salary-rank-name">'+esc(currentRank)+'</div><div class="salary-coefficient">'+(data.rank?"Coefficient × "+data.rank.coefficient:"Coefficient en attente")+'</div><div class="salary-gauge"><span style="width:'+progress+'%"></span></div><div class="salary-rank-foot"><span>'+esc(currentRank)+'</span><span>'+esc(data.nextRank?.name||"Rang maximum")+'</span></div><div class="salary-next">'+(rankText?esc(rankText):data.rank?"Tu as atteint le rang maximum.":"Les ouvertures validées s’afficheront ici dès réception des KPI.")+'</div></section></div><div class="salary-stats"><article><small>RENDEZ-VOUS PRIS</small><b>'+(data.appointments==null?"—":data.appointments)+'</b></article><article><small>OUVERTURES RESTANTES</small><b>'+(data.openings==null?"—":data.nextRank?data.openingsRemaining:"MAX")+'</b></article><article><small>JOURS AVEC KPI</small><b>'+data.productionDays+'</b></article></div><div class="salary-lower"><section class="salary-card"><div class="salary-section-title"><div><small>DÉTAIL DU MOIS</small><h2>Malus recensés</h2></div><span>'+esc(monthLabel(data.month))+'</span></div><div class="salary-malus-list">'+maluses.map(item=>'<div class="salary-malus-row"><div><b>'+esc(item.name)+'</b><small>'+esc(item.detail)+'</small></div><strong>'+money(item.amount)+'</strong></div>').join("")+'</div></section><section class="salary-card salary-projection"><div class="salary-section-title"><div><small>PROJECTION</small><h2>Rang suivant</h2></div></div><div class="salary-projection-value">'+(data.salaryAtNextRank==null?"—":money(data.salaryAtNextRank))+'</div><p>'+(data.nextRank?"Estimation avec le coefficient "+data.nextRank.coefficient+" du rang "+esc(data.nextRank.name)+".":"Aucun rang supérieur.")+'</p></section></div>'+(missing.length?'<div class="salary-missing"><b>Des données manquent pour fiabiliser cette estimation.</b><span>En attente de '+esc(missing.join(", "))+'.</span></div>':"");
  }

  window.crmMountSalary = (profile) => {
    activeProfile=profile;
    const host=shell();
    host.querySelector("#salaryUsername").textContent="@"+(profile.username||"");
    document.body.classList.add("crm-caller");
    load();
  };
})();