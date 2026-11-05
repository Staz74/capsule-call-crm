(() => {
  const esc=(value)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const amount=value=>value==null?"—":Math.round(Number(value)||0).toLocaleString("fr-FR")+" Ar";
  const monthNow=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
  const monthLabel=value=>new Date(value+"-01T12:00:00").toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  const tiers=[
    {name:"CHALLENGER",min:20,coefficient:1,color:"#85d9f5",dark:"#145273",glow:"#72e5ff",icon:"challenger"},
    {name:"MASTER",min:15,coefficient:.9,color:"#dcadff",dark:"#4a1676",glow:"#d084ff",icon:"master"},
    {name:"DIAMOND",min:10,coefficient:.75,color:"#9fd9ff",dark:"#1b2f7a",glow:"#74c6ff",icon:"diamond"},
    {name:"GOLD",min:5,coefficient:.5,color:"#f6d27a",dark:"#6e4a12",glow:"#f2c14e",icon:"gold"},
    {name:"IRON",min:0,coefficient:.25,color:"#b9c2d9",dark:"#262120",glow:"#c9a27e",icon:"iron"}
  ];
  let currentProfile=null,requestNumber=0;
  const personFirst=name=>String(name||"").trim().split(/\s+/)[0]||"";

  function crest(rank,size=78){
    const tier=tiers.find(item=>item.name===rank?.name)||tiers[4],id="cc"+tier.icon+size;
    const crown=tier.icon==="master"||tier.icon==="challenger";
    const rays=tier.icon==="challenger"?'<path d="M50 22V3M37 25 24 8M63 25 76 8" stroke="'+tier.glow+'" stroke-width="2" stroke-linecap="round"/>':"";
    const crownPath=crown?'<path d="m36 25 2-15 8 9 4-16 4 16 8-9 2 15Z" fill="url(#metal)"/>':"";
    return '<svg class="rank-crest" style="--rank-glow:'+tier.glow+'" width="'+size+'" height="'+Math.round(size*.7)+'" viewBox="0 0 100 70" aria-hidden="true"><defs><linearGradient id="metal'+id+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+(tier.icon==="iron"?"#d1c6ba":tier.color)+'"/><stop offset=".52" stop-color="'+tier.glow+'"/><stop offset="1" stop-color="'+tier.dark+'"/></linearGradient><linearGradient id="shield'+id+'" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+tier.color+'"/><stop offset="1" stop-color="'+tier.dark+'"/></linearGradient></defs>'+rays+'<g fill="url(#metal'+id+')" stroke="'+tier.dark+'" stroke-width="1.2" stroke-linejoin="round"><path d="M45 49C31 50 18 40 11 25 8 19 6 12 5 5c9 6 17 9 25 14 9 6 14 13 15 24Z"/><path d="M55 49c14 1 27-9 34-24 3-6 5-13 6-20-9 6-17 9-25 14-9 6-14 13-15 24Z"/></g><path d="m50 12 17 10-2 22c-2 12-8 19-15 25-7-6-13-13-15-25l-2-22Z" fill="url(#shield'+id+')" stroke="'+tier.dark+'" stroke-width="1.8" stroke-linejoin="round"/><path d="m50 19 11 7-2 17c-1 8-5 13-9 17-4-4-8-9-9-17l-2-17Z" fill="none" stroke="#fff" stroke-opacity=".55"/><path d="m50 27 8 12-8 14-8-14Z" fill="'+tier.glow+'" stroke="#fff" stroke-opacity=".55"/><path d="m50 27-8 12h8Z" fill="#fff" fill-opacity=".5"/>'+crownPath+'</svg>';
  }

  function portalShell(profile){
    let host=document.getElementById("crmSalaryPortal");
    if(host)return host;
    host=document.createElement("div");host.id="crmSalaryPortal";host.className="salary-stage";
    host.innerHTML='<div class="salary-art" aria-hidden="true"><svg viewBox="0 0 1280 380" preserveAspectRatio="none"><path d="M180 380 520 190l50-30 40-10h40l50 10 50 30 360 190Z" fill="#2A1520"/><path d="m570 160 40-10h40l40 10-22 16-28-12-28 18-24-14Z" fill="#E8C6D0" fill-opacity=".75"/><path d="M0 380v-50c200-30 400 15 640-5s440 20 640-5v60Z" fill="#1A0D13"/></svg><svg class="salary-blossom-branch" viewBox="0 0 520 260"><defs><symbol id="salaryFlower" viewBox="-10 -10 20 20"><g fill="#F7B9CB"><ellipse cy="-5" rx="3.4" ry="5"/><ellipse cy="-5" rx="3.4" ry="5" transform="rotate(72)"/><ellipse cy="-5" rx="3.4" ry="5" transform="rotate(144)"/><ellipse cy="-5" rx="3.4" ry="5" transform="rotate(216)"/><ellipse cy="-5" rx="3.4" ry="5" transform="rotate(288)"/></g><circle r="1.8" fill="#C9506F"/></symbol></defs><path d="M-10 40C80 60 160 30 250 70s130 10 190 60M120 50c30 40 20 90 50 140" fill="none" stroke="#3B2220" stroke-width="9" stroke-linecap="round"/><use href="#salaryFlower" x="23" y="33" width="34" height="34"/><use href="#salaryFlower" x="75" y="42" width="40" height="40"/><use href="#salaryFlower" x="142" y="30" width="36" height="36"/><use href="#salaryFlower" x="194" y="45" width="42" height="42"/><use href="#salaryFlower" x="253" y="69" width="34" height="34"/><use href="#salaryFlower" x="310" y="72" width="40" height="40"/><use href="#salaryFlower" x="374" y="84" width="32" height="32"/><use href="#salaryFlower" x="427" y="110" width="36" height="36"/><use href="#salaryFlower" x="132" y="92" width="36" height="36"/><use href="#salaryFlower" x="146" y="156" width="38" height="38"/></svg></div><div class="salary-petals" aria-hidden="true"></div><header class="salary-header"><div class="salary-header-title"><div class="salary-month" id="salaryMonthLabel"></div><h1>MON SALAIRE</h1></div><div class="salary-header-actions"><div class="salary-select-wrap"><label for="salaryMonth">Mois</label><select id="salaryMonth"></select></div><div class="salary-user"><span id="salaryUserTag"></span></div><button type="button" id="salaryLogout">Déconnexion</button></div></header><main class="salary-layout"><section class="salary-left"><div id="salaryNotice" class="salary-notice" aria-live="polite"></div><div class="salary-stats" id="salaryStats"></div><section class="salary-card salary-pay-card" id="salaryPay"></section><section class="salary-card salary-maluses-card"><div class="salary-section-heading"><h2>Malus du mois</h2><div class="salary-tip"><button type="button" aria-label="Comment sont calculés les malus">?</button><div class="salary-tipbox" id="salaryTip"></div></div></div><div id="salaryMaluses" class="salary-maluses-list"></div></section></section><aside class="salary-card salary-rank-card"><div id="salaryRank"></div><div class="salary-rank-ladder" id="salaryRankLadder"></div><div class="salary-rank-footer" id="salaryRankFooter"></div></aside></main><footer class="salary-footer">Estimation fondée sur les paramètres du CRM et les données enregistrées pour ta fiche. Le montant définitif reste confirmé par l’administration.</footer>';
    document.body.appendChild(host);
    const picker=host.querySelector("#salaryMonth"),now=monthNow();
    for(let offset=0;offset<12;offset++){const date=new Date();date.setDate(1);date.setMonth(date.getMonth()-offset);const value=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0");const option=document.createElement("option");option.value=value;option.textContent=monthLabel(value);picker.append(option)}
    picker.value=now;picker.addEventListener("change",load);
    host.querySelector("#salaryLogout").addEventListener("click",()=>window.crmCallerLogout?.());
    spawnPetals(host);
    return host;
  }
  function spawnPetals(host){
    const layer=host.querySelector(".salary-petals");
    if(!layer||window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return;
    for(let i=0;i<20;i++){const petal=document.createElement("i");petal.className="salary-petal";petal.style.left=(Math.random()*100)+"%";petal.style.animationDelay=(-Math.random()*16)+"s";petal.style.animationDuration=(12+Math.random()*10)+"s";petal.style.opacity=(.34+Math.random()*.5).toFixed(2);petal.style.transform="scale("+(0.65+Math.random()*.75)+")";layer.append(petal)}
  }

  async function load(){
    const host=portalShell(currentProfile),notice=host.querySelector("#salaryNotice"),version=++requestNumber,month=host.querySelector("#salaryMonth").value||monthNow();
    notice.textContent="Chargement de l’estimation…";notice.className="salary-notice";
    const {data,error}=await window.crmSupabase.functions.invoke("my-salary",{body:{month}});
    if(version!==requestNumber)return;
    if(error||data?.error){notice.textContent=data?.error||"Impossible de charger l’estimation pour le moment.";notice.classList.add("error");return}
    host.querySelector("#salaryMonthLabel").textContent=monthLabel(data.month);
    render(data,host);host.classList.add("salary-entered");
  }

  function stats(data){
    const rdv=data.appointmentsToday==null?"—":data.appointmentsToday+" / "+data.appointmentTarget;
    const tardies=data.demoMode||data.hasAttendanceData?String(data.lateCount):"—";
    const attendance=data.attendancePercent==null?"—":data.attendancePercent+" %";
    const openings=data.openingsRemaining==null?"—":String(data.openingsRemaining);
    const openingMeta=data.nextRank?"jusqu’à "+data.nextRank.name:data.rank?"Rang maximum":"Données en attente";
    return [['RDV aujourd’hui',rdv,'rdv'],['Retards du mois',tardies,'late'],['Assiduité',attendance,'attendance'],['Ouvertures restantes',openings,'openings',openingMeta]].map(([label,value,kind,meta])=>'<article class="salary-stat"><div>'+label+'</div><strong class="serif '+kind+'">'+value+'</strong>'+(meta?'<small>'+esc(meta)+'</small>':'')+'</article>').join("");
  }
  function salaryTip(config){
    return '<b>Rendez-vous · objectif '+config.rdvTarget+' / jour</b><br>2 RDV : −'+amount(config.rdv2)+' · 1 RDV : −'+amount(config.rdv1)+' · 0 RDV : −'+amount(config.rdv0)+'<br><b>Retards</b><br>0–10 min : −'+amount(config.lateGreen)+' · 11–30 min : −'+amount(config.lateOrange)+' · +30 min : −'+amount(config.lateRed)+'<br><b>Absences</b><br>Demi-journée : −'+amount(config.absenceHalf)+' · Journée : −'+amount(config.absenceFull);
  }
  function renderPay(data){
    const estimate=data.salaryAfterMaluses??data.baseSalary;
    const estimateLabel=data.hasKpiData?"Base "+amount(data.baseSalary)+" · − "+amount(data.totalDeductions)+" de malus":"Base paramétrée "+amount(data.baseSalary)+" · en attente des données KPI";
    const current=data.currentRankEstimate==null?"—":amount(data.currentRankEstimate);
    const next=data.nextRankEstimate==null?"—":amount(data.nextRankEstimate);
    return '<div class="salary-pay-label">Salaire du mois après malus (en temps réel)</div><div class="salary-pay-value serif">'+amount(estimate)+'</div><div class="salary-pay-meta">'+estimateLabel+'</div><div class="salary-estimates"><div><span>Estimation avec ton rang actuel'+(data.rank?' ('+esc(capitalize(data.rank.name))+' × '+data.rank.coefficient+')':'')+'</span><b class="serif">'+current+'</b></div><div class="next-estimate"><span>Si tu passes '+(data.nextRank?esc(capitalize(data.nextRank.name)):"au rang suivant")+(data.nextRank?' (× '+data.nextRank.coefficient+')':'')+'</span><b class="serif">'+next+'</b></div></div>';
  }
  const capitalize=value=>String(value||"").toLowerCase().replace(/^./,s=>s.toUpperCase());
  function renderMaluses(data){
    const host=document.getElementById("salaryMaluses");
    if(!data.maluses?.length){host.innerHTML='<div class="salary-empty">Aucun malus enregistré pour ce mois.</div>';return}
    host.innerHTML=data.maluses.map(item=>{
      const amountText=item.amount>0?"− "+amount(item.amount):(data.demoMode?"0 Ar · paramétré à 0":"0 Ar");
      return '<div class="salary-malus-row '+(item.amount===0?"no-deduction":"")+'"><span class="salary-malus-date">'+esc(item.label||"—")+'</span><span class="salary-malus-copy">'+esc(item.detail)+'</span><b>'+amountText+'</b></div>';
    }).join("");
  }
  function renderRank(data){
    const box=document.getElementById("salaryRank"),ladder=document.getElementById("salaryRankLadder"),footerHost=document.getElementById("salaryRankFooter");
    if(!data.rank){
      box.innerHTML='<div class="salary-rank-head"><div class="salary-rank-medal">'+crest(tiers[4],150)+'</div><div class="salary-rank-name">En attente</div><div class="salary-rank-next">Le rang et son coefficient apparaîtront avec les ouvertures confirmées.</div></div>';
    }else{
      const rankTier=tiers.find(t=>t.name===data.rank.name)||tiers[4];
      const progress=Math.max(0,Math.min(100,Math.round((data.rank.name==="CHALLENGER"?100:(data.openingsRemaining==null?0:((5-data.openingsRemaining)/5*100))))));
      box.innerHTML='<div class="salary-rank-head"><div class="salary-rank-medal">'+crest(data.rank,150)+'</div><div class="salary-rank-name" style="color:'+rankTier.color+'">'+esc(data.rank.name)+'</div><div class="salary-rank-coefficient">Coefficient × '+data.rank.coefficient+'</div><div class="salary-rank-message">'+(data.nextRank?'Encore '+data.openingsRemaining+' ouverture'+(data.openingsRemaining===1?'':'s')+' pour '+capitalize(data.nextRank.name):'Rang maximum atteint')+'</div><div class="salary-rank-progress"><span style="width:'+progress+'%"></span></div><div class="salary-rank-progress-label"><span>'+esc(data.rank.name)+'</span><span>'+(data.nextRank?esc(data.nextRank.name):'MAX')+'</span></div></div>';
    }
    const activeIndex=data.rank?tiers.findIndex(t=>t.name===data.rank.name):-1;
    const bandProgress=data.rank&&data.nextRank?Math.max(0,Math.min(1,(5-(data.openingsRemaining||0))/5)):1;
    const ladderFill=data.rank?Math.round(((4-activeIndex+bandProgress)/4)*100):0;
    ladder.innerHTML='<div class="salary-ladder-title">Paliers du classement</div><div class="salary-ladder-rows" style="--rank-fill:'+ladderFill+'%">'+tiers.map((tier,index)=>{
      const active=tier.name===data.rank?.name,passed=activeIndex>=0&&index>activeIndex;
      return '<div class="salary-tier '+(active?"active ":"")+(passed?"passed":"")+'"><div class="salary-tier-icon">'+crest(tier,76)+'</div><div class="salary-tier-copy"><b style="color:'+tier.color+'">'+capitalize(tier.name)+'</b><small>'+tier.min+(tier.name==="CHALLENGER"?"+":"")+" ouvertures · × "+String(tier.coefficient).replace(".",",")+'</small></div>'+(active?'<span class="salary-tier-check">✓</span>':"")+'</div>';
    }).join("")+'</div>';
    const regularity=data.attendancePercent==null?"—":data.attendancePercent+" %";
    const tenure=data.tenureWeeks==null?"—":data.tenureWeeks+" semaine"+(data.tenureWeeks===1?"":"s");
    const footer='<div class="salary-rank-stat"><div class="salary-round">'+regularity+'</div><div><small>RÉGULARITÉ</small><b>'+regularity+' d’assiduité</b></div></div><div class="salary-rank-stat"><div class="salary-round blue">'+(data.tenureWeeks==null?"—":data.tenureWeeks)+'</div><div><small>ANCIENNETÉ</small><b>'+tenure+'</b></div></div>';
    footerHost.innerHTML=footer;
  }
  function render(data,host){
    const notice=host.querySelector("#salaryNotice");
    if(data.demoMode){notice.innerHTML='<b>EXEMPLE · DONNÉES FICTIVES</b><span>Simulation pour Christelle, non enregistrée dans les historiques. Les montants de malus suivent les valeurs des Paramètres.</span>'+((!data.rdvMalusConfigured||!data.lateMalusConfigured||!data.absenceMalusConfigured)?'<span>Dans cet exemple uniquement, les montants réglés à 0 Ar utilisent la grille de référence. Les comptes réels suivent strictement les valeurs de Contrôle & règles.</span>':"");notice.className="salary-notice demo"}
    else if(!data.hasKpiData||!data.hasOpeningData){notice.textContent="Estimation partielle · le montant de base vient des Paramètres; les indicateurs manquants seront ajoutés après import des données Brokerlink.";notice.className="salary-notice partial"}
    else{notice.textContent="Données KPI et paramètres du mois pris en compte.";notice.className="salary-notice complete"}
    host.querySelector("#salaryStats").innerHTML=stats(data);
    host.querySelector("#salaryPay").innerHTML=renderPay(data);
    host.querySelector("#salaryMaluses").parentElement.querySelector("#salaryTip").innerHTML=salaryTip(data.configuration);
    renderMaluses(data);renderRank(data);
    host.querySelector(".salary-main-content")?.classList.add("ready");
  }
  window.crmMountSalary=profile=>{
    currentProfile=profile;const host=portalShell(profile);host.querySelector("#salaryUserTag").textContent="@"+(profile.username||"")+" · CALLER";load();
  };
})();