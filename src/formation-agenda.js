(() => {
  "use strict";
  if (window.ccFormationAgendaInitialized) return;
  window.ccFormationAgendaInitialized = true;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const state = () => window.crmGetLocalState?.() || {};
  const persist = (key, value) => localStorage.setItem("capsule_" + key, JSON.stringify(value));
  const role = () => window.crmCurrentRole?.() || "";
  const manager = () => ["admin","chef_plateau","rh"].includes(role());
  const mayComplete = () => ["admin","chef_plateau"].includes(role());
  const today = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
  const dateLabel = (value) => { if (!value) return "Date à définir"; const d = new Date(String(value).slice(0,10)+"T12:00:00"); return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(d); };
  const timeLabel = (value) => value ? String(value).slice(0,5) : "";
  const people = () => (state().employees || []).filter((e) => !e.archivedAt);
  const personName = (e) => e?.name || e?.displayName || [e?.firstName,e?.lastName].filter(Boolean).join(" ") || "Collaborateur";
  const personById = (id) => people().find((e) => String(e.id) === String(id));
  const personIdByName = (name) => { const e = people().find((x) => personName(x) === String(name || "")); return e ? String(e.id) : ""; };
  const currentUserName = () => window.crmCurrentProfile?.()?.username || window.crmCurrentProfile?.()?.display_name || "Équipe";
  let selectedByTheme = Object.create(null), openedSchedule = "", lastProfileId = "", lastProfileTab = "";

  function addStyle() {
    if ($("ccFormationAgendaStyle")) return;
    const style = document.createElement("style"); style.id = "ccFormationAgendaStyle";
    style.textContent = [
      "#ccTrainingThemes{margin-top:16px}.cc-training-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;padding:14px}",
      ".cc-training-card,.cc-agenda-event{border:1px solid var(--line,#493d3b);background:linear-gradient(145deg,rgba(54,39,40,.92),rgba(34,28,29,.96));border-radius:15px;padding:15px;color:var(--text,#f4e9e9)}",
      ".cc-training-card h3,.cc-agenda-event h3{margin:0 0 6px;color:var(--text,#f4e9e9);font-size:15px}.cc-training-card p,.cc-agenda-event p{color:var(--muted,#c9babb);margin:6px 0 12px;line-height:1.5}",
      ".cc-topic-origin{font-size:11px;color:#e6b6c0;letter-spacing:.06em;text-transform:uppercase}.cc-people-chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 12px}",
      ".cc-person-chip{border:1px solid #614b4d;background:#302627;color:#f2e5e8;border-radius:999px;padding:7px 10px;cursor:pointer;font:inherit;font-size:12px}.cc-person-chip[aria-pressed=true]{background:#e7bec6;color:#38282b;border-color:#e7bec6;box-shadow:0 0 0 2px rgba(231,190,198,.17)}.cc-person-chip:hover{border-color:#e7bec6}",
      ".cc-theme-title{padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}.cc-theme-title:hover{text-decoration:underline;text-decoration-color:#dbaab4}",
      ".cc-training-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px;padding:12px;border:1px solid #5d484a;border-radius:12px;background:rgba(20,16,17,.32)}.cc-training-form label{display:grid;gap:5px;color:#e8d5d8;font-size:12px}.cc-training-form label.cc-wide{grid-column:1/-1}",
      ".cc-training-form input,.cc-training-form textarea,.cc-training-form select{width:100%;box-sizing:border-box;border:1px solid #665052;border-radius:9px;background:#211b1c;color:#f7eeee;padding:9px;font:inherit}.cc-training-form textarea{min-height:68px;resize:vertical}.cc-training-form button{justify-self:start}",
      ".cc-agenda-toolbar{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px 2px}.cc-agenda-count{border:1px solid #5a4749;border-radius:999px;padding:7px 11px;background:#2b2224;color:#efdee1;font-size:12px}.cc-agenda-list{display:grid;gap:10px;padding:14px 16px 18px}",
      ".cc-agenda-event{display:grid;grid-template-columns:100px minmax(0,1fr) auto;gap:12px;align-items:center;cursor:pointer;text-align:left;font:inherit}.cc-agenda-event:hover{border-color:#d4a4ad;transform:translateY(-1px)}.cc-agenda-date{border-right:1px solid #5c484a;padding-right:12px;color:#e8c3ca;font-weight:700;font-size:13px}",
      ".cc-agenda-meta{font-size:12px;color:#c6b6b7}.cc-agenda-status{font-size:11px;color:#f2d79c;background:#433521;border-radius:999px;padding:6px 9px;white-space:nowrap}.cc-agenda-status.done{color:#b9e1c7;background:#1f3a2b}",
      ".cc-agenda-empty{margin:14px 16px 18px;padding:18px;border:1px dashed #604f50;border-radius:12px;color:#cbbfc0}.cc-training-dialog{max-width:min(720px,92vw);width:720px;max-height:88vh;overflow:auto;border:1px solid #70595b;border-radius:18px;background:#211b1d;color:#f4e9e9;padding:0;box-shadow:0 24px 90px rgba(0,0,0,.65)}",
      ".cc-training-dialog::backdrop{background:rgba(8,6,7,.72);backdrop-filter:blur(4px)}.cc-dialog-inner{padding:20px}.cc-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid #493b3d;padding-bottom:12px;margin-bottom:14px}.cc-dialog-head h2{margin:3px 0 0;color:#f6e8eb}",
      ".cc-dialog-close{border:1px solid #655052;background:#302627;color:#f5e8ea;border-radius:9px;padding:7px 10px;cursor:pointer}.cc-observation-list{display:grid;gap:8px;margin-top:12px}.cc-observation{border-left:3px solid #d8aab4;background:#2b2224;border-radius:0 10px 10px 0;padding:10px 12px;color:#eee0e2}.cc-observation small{display:block;color:#c7b4b7;margin-bottom:4px}",
      ".cc-history-panel{margin-top:24px}.cc-history-list{display:grid;gap:9px}.cc-history-item{border:1px solid #4d3f41;border-radius:11px;background:rgba(50,38,40,.55);padding:11px 13px}.cc-history-item b{color:#f0d4da}.cc-history-item p{margin:5px 0 0;color:#d1c1c2;line-height:1.45}",
      ".cc-agenda-person-list{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:7px}@media(max-width:720px){.cc-agenda-event{grid-template-columns:1fr;gap:7px}.cc-agenda-date{border:0;border-bottom:1px solid #5c484a;padding:0 0 7px}.cc-training-form{grid-template-columns:1fr}.cc-training-form label.cc-wide{grid-column:auto}.cc-training-dialog{width:auto}}"
    ].join("");
    document.head.append(style);
  }

  function mountNavigation() {
    const nav = $("nav"), page = document.querySelector(".page");
    if (!nav || !page) return false;
    if (!nav.querySelector('[data-page="formationAgenda"]')) {
      const button = document.createElement("button");
      button.type = "button"; button.dataset.page = "formationAgenda";
      button.innerHTML = '<span class="ico">▦</span>Formations & agenda';
      const synthesis = nav.querySelector('[data-page="synthesis"]');
      if (synthesis) synthesis.insertAdjacentElement("afterend", button); else nav.append(button);
    }
    if (!$("screen-formationAgenda")) {
      const screen = document.createElement("section"); screen.className = "screen"; screen.id = "screen-formationAgenda";
      screen.innerHTML = '<div class="head"><div><div class="eyebrow">ACCOMPAGNEMENT · FORMATION</div><h1>Formations & agenda</h1><div class="sub">Le calendrier commun des formations, les groupes prévus et les séances réalisées.</div></div></div><div class="panel"><div class="panel-head"><div><div class="panel-title">Agenda partagé</div><div class="panel-desc">La RH et la chef de plateau peuvent planifier. La chef de plateau confirme les séances réalisées ; le directeur opérationnel les consulte.</div></div></div><div class="cc-agenda-toolbar" id="ccAgendaSummary"></div><div id="ccAgendaCreate"></div><div id="ccAgendaList"></div></div>';
      page.append(screen);
    }
    if (!document.querySelector("#screen-synthesis #ccTrainingThemes")) {
      const host = document.createElement("section"); host.id = "ccTrainingThemes"; host.className = "panel";
      host.innerHTML = '<div class="panel-head"><div><div class="panel-title">Thèmes à travailler en formation</div><div class="panel-desc">Regroupe les lacunes récurrentes, choisis les téléphonistes concernés, puis planifie une séance.</div></div></div><div class="cc-training-form" style="margin:0 14px 8px"><label>Ajouter un thème libre<input name="themeTitle" form="ccThemeCreateForm" maxlength="100" placeholder="Ex. découverte du besoin" required></label><label>Description<textarea name="themeDetails" form="ccThemeCreateForm" maxlength="500" placeholder="Objectif ou point à travailler"></textarea></label><form id="ccThemeCreateForm" class="cc-theme-create-form"><button class="btn primary" type="submit">＋ Créer le thème</button></form></div><div id="ccThemeGroups" class="cc-training-grid"></div>';
      const meetings = document.querySelector("#screen-synthesis .synthesis-meetings");
      if (meetings) meetings.insertAdjacentElement("beforebegin", host);
      else $("screen-synthesis")?.append(host);
    }
    return true;
  }

  function ensureDialog() {
    if ($("ccTrainingDialog")) return $("ccTrainingDialog");
    const dialog = document.createElement("dialog"); dialog.id = "ccTrainingDialog"; dialog.className = "cc-training-dialog";
    document.body.append(dialog); return dialog;
  }
  function openDialog(title, body) {
    const dialog = ensureDialog();
    dialog.innerHTML = '<div class="cc-dialog-inner"><div class="cc-dialog-head"><div><span class="cc-topic-origin">Capsule Call · Formation</span><h2>'+esc(title)+'</h2></div><button class="cc-dialog-close" type="button" data-training-dialog-close>Fermer</button></div>'+body+'</div>';
    if (typeof dialog.showModal === "function") { try { dialog.showModal(); } catch { dialog.setAttribute("open",""); } } else dialog.setAttribute("open","");
  }
  function closeDialog() { const d = $("ccTrainingDialog"); if (d?.open && d.close) d.close(); else d?.removeAttribute("open"); }
  function observations() {
    const data = state(), result = [], activeNames = new Set(people().map(personName));
    (data.qualityHistory || []).forEach((x,i) => { if (!activeNames.has(x.employee)) return; const note=String(x.notes||"").trim();result.push({id:"quality:"+(x.id == null ? i : x.id),source:"Écoute qualité",date:x.date||"",employee:x.employee,employeeId:personIdByName(x.employee),topic:String(x.category||note.split(/[.!?\\n]/)[0]||"Observation d’écoute").trim().slice(0,100),text:note}); });
    (data.coachingHistory || []).forEach((x,i) => { if (!activeNames.has(x.employee)) return; result.push({id:"coaching:"+(x.id == null ? i : x.id),source:"Coaching",date:x.date||"",employee:x.employee,employeeId:personIdByName(x.employee),topic:String(x.category||x.objective||"Observation de coaching").trim(),text:[x.objective&&"Objectif : "+x.objective,x.content&&"Contenu : "+x.content,x.result&&"Résultat : "+x.result].filter(Boolean).join(" · ")}); });
    return result.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  }
  function hash(value) { let h=0; for (const c of String(value)) h=((h*31)+c.charCodeAt(0))|0; return Math.abs(h).toString(36); }
  function themeGroups() {
    const grouped = new Map();
    observations().forEach((x) => {
      const key = x.topic.toLocaleLowerCase("fr").replace(/\s+/g," ").trim() || "observation";
      if (!grouped.has(key)) grouped.set(key,{id:"topic-"+hash(key),title:x.topic,details:"",suggested:true,items:[],employeeIds:[]});
      const group=grouped.get(key); group.items.push(x); if(x.employeeId&&!group.employeeIds.includes(x.employeeId))group.employeeIds.push(x.employeeId);
    });
    const saved=state().trainingThemes||[];
    const custom=saved.map((x) => ({id:String(x.id),title:String(x.title||"Thème de formation"),details:String(x.details||""),suggested:false,items:observations().filter(o=>(x.observationIds||[]).includes(o.id)),employeeIds:(x.employeeIds||[]).map(String)}));
    return [...custom,...grouped.values()].sort((a,b) => Number(b.items.length)-Number(a.items.length)||a.title.localeCompare(b.title,"fr"));
  }
  function chips(group) {
    const candidates = group.suggested ? group.employeeIds.map(personById).filter(Boolean) : people().filter((e) => !group.employeeIds.length || group.employeeIds.includes(String(e.id)));
    const chosen = selectedByTheme[group.id] || [];
    if (!candidates.length) return '<div class="cc-agenda-empty">Aucun collaborateur associé à ce thème pour le moment.</div>';
    return '<div class="cc-people-chips" aria-label="Sélectionner les téléphonistes">'+candidates.map((e) => {
      const id=String(e.id),on=chosen.includes(id);
      return '<button type="button" class="cc-person-chip" data-theme-person="'+esc(group.id)+'" data-employee-id="'+esc(id)+'" aria-pressed="'+(on?"true":"false")+'">'+(on?"✓ ":"＋ ")+esc(personName(e))+'</button>';
    }).join("")+'</div>';
  }
  function themeScheduleForm(group) {
    const ids=selectedByTheme[group.id]||[];
    return '<form class="cc-training-form" data-theme-schedule="'+esc(group.id)+'"><label>Date<input type="date" name="date" value="'+today()+'" required></label><label>Heure<input type="time" name="time"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="60"></label><label>Lieu / lien<input name="location" maxlength="180" placeholder="Salle ou lien de réunion"></label><label class="cc-wide">Objectif de la séance<textarea name="details" maxlength="1000">'+esc(group.details||"")+'</textarea></label><button class="btn primary" type="submit">Planifier pour '+ids.length+' personne(s)</button><button class="btn" type="button" data-theme-cancel="'+esc(group.id)+'">Annuler</button></form>';
  }
  function renderThemes() {
    const host=$("ccThemeGroups"); if(!host)return;
    const groups=themeGroups();
    if(!groups.length){host.innerHTML='<div class="cc-agenda-empty">Les observations des écoutes et des coachings apparaîtront ici sous forme de thèmes. Tu peux aussi créer un thème libre ci-dessus.</div>';return;}
    host.innerHTML=groups.map((g) => '<article class="cc-training-card"><span class="cc-topic-origin">'+(g.suggested?g.items.length+' observation(s)':'Thème personnalisé')+'</span><h3><button type="button" class="cc-theme-title" data-theme-detail="'+esc(g.id)+'">'+esc(g.title)+'</button></h3><p>'+esc(g.details||g.items[0]?.text||"Choisis les personnes à réunir autour de ce thème.")+'</p>'+chips(g)+'<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-theme-plan="'+esc(g.id)+'">Former ce groupe</button></div>'+(openedSchedule===g.id?themeScheduleForm(g):"")+'</article>').join("");
  }
  function agendaCard(item) {
    const done=item.status==="completed"||item.status==="Terminée";
    const names=(item.employeeIds||[]).map((id)=>personById(id)).filter(Boolean).map(personName);
    const attendeeLabel=names.length?names.join(", "):(item.employeeNames||[]).join(", ")||"Équipe";
    return '<button type="button" class="cc-agenda-event" data-agenda-detail="'+esc(item.id)+'"><span class="cc-agenda-date">'+esc(dateLabel(item.date))+(item.time?'<br><small>'+esc(timeLabel(item.time))+'</small>':"")+'</span><span><h3>'+esc(item.title||"Formation")+'</h3><span class="cc-agenda-meta">'+esc(attendeeLabel)+(item.location?" · "+esc(item.location):"")+'</span></span><span class="cc-agenda-status '+(done?"done":"")+'">'+(done?"Terminée":item.date<today()?"À reprogrammer":"Planifiée")+'</span></button>';
  }
  function newAgendaForm() {
    if(!manager())return "";
    const list=people();
    return '<details style="margin:8px 16px 0"><summary class="btn">＋ Planifier une formation</summary><form class="cc-training-form" data-agenda-create><label>Thème<input name="title" maxlength="120" required placeholder="Sujet de la formation"></label><label>Date<input type="date" name="date" value="'+today()+'" required></label><label>Heure<input type="time" name="time"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="60"></label><label>Lieu / lien<input name="location" maxlength="180" placeholder="Salle ou lien de réunion"></label><label class="cc-wide">Objectif / préparation<textarea name="details" maxlength="1000"></textarea></label><div class="cc-agenda-person-list">'+list.map((e)=>'<label class="cc-person-chip"><input type="checkbox" data-agenda-person value="'+esc(String(e.id))+'"> '+esc(personName(e))+'</label>').join("")+'</div><button class="btn primary" type="submit">Ajouter à l’agenda</button></form></details>';
  }
  function renderAgenda() {
    const host=$("ccAgendaList"); if(!host)return;
    if($("screen-formationAgenda")?.classList.contains("active")&&$("crumb"))$("crumb").textContent="Formations & agenda";
    const all=(state().trainingAgenda||[]).slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.time||"").localeCompare(String(b.time||"")));
    const done=all.filter((x)=>x.status==="completed"||x.status==="Terminée");
    const pending=all.filter((x)=>x.status!=="completed"&&x.status!=="Terminée");
    const todays=pending.filter((x)=>String(x.date||"").slice(0,10)===today()).length;
    const summary=$("ccAgendaSummary"); if(summary)summary.innerHTML='<span class="cc-agenda-count">'+todays+' aujourd’hui</span><span class="cc-agenda-count">'+pending.length+' à venir / à reprogrammer</span><span class="cc-agenda-count">'+done.length+' réalisée(s)</span>';
    const form=$("ccAgendaCreate");if(form)form.innerHTML=newAgendaForm();
    host.innerHTML=(pending.length?'<div class="panel-desc" style="padding:12px 16px 0">À venir</div><div class="cc-agenda-list">'+pending.map(agendaCard).join("")+'</div>':'<div class="cc-agenda-empty">Aucune formation planifiée pour le moment.</div>')+(done.length?'<div class="panel-desc" style="padding:10px 16px 0">Formations réalisées</div><div class="cc-agenda-list">'+done.slice().reverse().map(agendaCard).join("")+'</div>':"");
  }
  function eventById(id) { return (state().trainingAgenda||[]).find((x)=>String(x.id)===String(id)); }
  function eventDetails(item) {
    const done=item.status==="completed"||item.status==="Terminée", names=(item.employeeIds||[]).map(personById).filter(Boolean).map(personName);
    const body='<p><b>Date :</b> '+esc(dateLabel(item.date))+(item.time?' · '+esc(timeLabel(item.time)):"")+'</p><p><b>Participants :</b> '+esc(names.join(", ")||(item.employeeNames||[]).join(", ")||"Non précisés")+'</p>'+(item.duration?'<p><b>Durée :</b> '+esc(item.duration)+' minutes</p>':"")+(item.location?'<p><b>Lieu :</b> '+esc(item.location)+'</p>':"")+(item.details?'<p>'+esc(item.details)+'</p>':"")+(done?'<div class="cc-observation"><small>Réalisée le '+esc(dateLabel(item.completedOn||item.completedAt))+' · '+esc(item.trainer||"")+'</small>'+esc(item.completionNotes||"Formation confirmée.")+'</div>':"")+(mayComplete()&&!done?'<form class="cc-training-form" data-training-complete="'+esc(item.id)+'"><label class="cc-wide">Compte rendu / points travaillés<textarea name="notes" maxlength="1200" placeholder="Résumé de la séance, acquis et suite prévue"></textarea></label><button class="btn primary" type="submit">Confirmer la formation terminée</button></form>':"");
    openDialog(item.title||"Formation",body);
  }
  function themeDetails(id) {
    const group=themeGroups().find((x)=>String(x.id)===String(id));if(!group)return;
    const rows=group.items.map((x)=>{const person=personById(x.employeeId);return '<div class="cc-observation"><small>'+esc(x.source)+' · '+esc(person?personName(person):x.employee)+' · '+esc(dateLabel(x.date))+'</small>'+esc(x.text||"Aucun détail enregistré.")+'</div>';}).join("");
    openDialog(group.title,'<p>'+esc(group.details||"Thème proposé à partir des observations existantes.")+'</p><p><b>'+group.items.length+'</b> observation(s) associée(s).</p><div class="cc-observation-list">'+(rows||'<div class="cc-agenda-empty">Aucune observation liée. Le thème a été créé manuellement.</div>')+'</div>');
  }
  function saveTrainingHistory(item, notes) {
    const rows=state().trainingHistory||[];
    (item.employeeIds||[]).map(String).forEach((employeeId) => {
      const employee=personById(employeeId); if(!employee)return;
      const existing=rows.find((x)=>String(x.eventId)===String(item.id)&&String(x.employeeId)===employeeId);
      const record={id:existing?.id||("training-"+String(item.id)+"-"+employeeId),eventId:String(item.id),employeeId,employee:personName(employee),date:item.completedOn||today(),topic:item.title||"Formation",title:item.title||"Formation",details:item.details||"",notes:notes||"",trainer:item.trainer||currentUserName(),createdAt:item.completedAt||new Date().toISOString()};
      if(existing)Object.assign(existing,record);else rows.push(record);
    });
    persist("trainingHistory",rows);
  }
  function refreshProfile(id, tab) {
    const content=$("profileContent"); if(!content)return;
    const employee=people().find((e)=>String(e.id)===String(id)); if(!employee)return;
    const records=(state().trainingHistory||[]).filter((x)=>String(x.employeeId)===String(employee.id)||x.employee===personName(employee)).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
    let section=$("ccProfileTrainingHistory");
    if(!section){section=document.createElement("section");section.id="ccProfileTrainingHistory";section.className="panel cc-history-panel";const summary=$("qualitySummaryResult");(summary||content).insertAdjacentElement("afterend",section);}
    section.innerHTML='<div class="panel-head"><div><div class="panel-title">Historique des formations</div><div class="panel-desc">Les formations terminées sont conservées ici avec les coachings de ce collaborateur.</div></div><span class="pill">'+records.length+' séance(s)</span></div>'+(records.length?'<div class="cc-history-list" style="padding:0 16px 16px">'+records.map((x)=>'<article class="cc-history-item"><b>'+esc(x.title||x.topic||"Formation")+'</b><div class="cc-agenda-meta">'+esc(dateLabel(x.date))+' · '+esc(x.trainer||"Équipe")+'</div>'+(x.details?'<p>'+esc(x.details)+'</p>':"")+(x.notes?'<p><b>Compte rendu :</b> '+esc(x.notes)+'</p>':"")+'</article>').join("")+'</div>':'<div class="profile-note" style="margin:0 16px 16px">Aucune formation réalisée pour ce collaborateur.</div>');
    section.hidden=tab!=="quality";
  }
  function wrapProfileRenderer() {
    if(typeof window.renderProfile!=="function"||window.ccTrainingProfileWrapped)return;
    const original=window.renderProfile;
    window.renderProfile=function(id,tab) {
      const result=original.apply(this,arguments);lastProfileId=String(id);lastProfileTab=tab||"info";
      if(lastProfileTab==="quality")refreshProfile(lastProfileId,lastProfileTab);
      return result;
    };
    window.ccTrainingProfileWrapped=true;
    window.crmRefreshTrainingHistoryProfile=()=>{if(lastProfileId&&lastProfileTab==="quality")window.renderProfile(lastProfileId,lastProfileTab);};
  }
  function wrapSynthesisRenderer() {
    if(typeof window.crmRenderSynthesis!=="function"||window.ccTrainingSynthesisWrapped)return;
    const original=window.crmRenderSynthesis;
    window.crmRenderSynthesis=function(){const result=original.apply(this,arguments);renderThemes();return result;};
    window.ccTrainingSynthesisWrapped=true;renderThemes();
  }
  function ensurePermissionEditor() {
    if(typeof window.renderRolePermissionEditor!=="function"||window.ccFormationAgendaPermissionWrapped)return;
    const original=window.renderRolePermissionEditor;
    window.renderRolePermissionEditor=function() {
      const result=original.apply(this,arguments),host=$("permissionModuleList");
      if(host){
        let label=host.querySelector("[data-formation-agenda-option]");
        if(!label){label=document.createElement("label");label.className="permission-module";label.dataset.formationAgendaOption="true";label.innerHTML='<input type="checkbox" data-permission-module value="formationAgenda"><span>Formations & agenda</span>';host.append(label);}
        let saved={};try{saved=JSON.parse(localStorage.getItem("capsule_appPermissions")||"{}");}catch{}
        const r=$("permissionRole")?.value||"",modules=saved?.moduleAccess?.[r],defaults=["admin","rh","chef_plateau","directeur_operationnel"];
        const check=label.querySelector("input");if(check)check.checked=Array.isArray(modules)?modules.includes("formationAgenda"):defaults.includes(r);
      }
      return result;
    };
    window.ccFormationAgendaPermissionWrapped=true;
  }
  function createTheme(form) {
    const fd=new FormData(form),title=String(fd.get("themeTitle")||"").trim(),details=String(fd.get("themeDetails")||"").trim();
    if(!title)return;
    const themes=state().trainingThemes||[];themes.unshift({id:"theme-"+Date.now(),title,details,createdAt:new Date().toISOString(),createdBy:currentUserName(),employeeIds:[]});
    persist("trainingThemes",themes);form.reset();renderThemes();window.crmToast?.("Thème de formation ajouté.");
  }
  function planTheme(form) {
    const fd=new FormData(form),id=form.dataset.themeSchedule,group=themeGroups().find((x)=>String(x.id)===String(id)),employeeIds=(selectedByTheme[id]||[]).slice();
    if(!group||!fd.get("date")||!employeeIds.length){window.crmToast?.("Sélectionne au moins un téléphoniste et une date.");return;}
    const agenda=state().trainingAgenda||[];
    agenda.push({id:"training-"+Date.now(),title:group.title,themeId:id,details:String(fd.get("details")||group.details||""),date:String(fd.get("date")),time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||""),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),status:"planned",createdBy:currentUserName(),createdAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);openedSchedule="";selectedByTheme[id]=[];renderThemes();renderAgenda();window.crmToast?.("Formation ajoutée à l’agenda partagé.");
  }
  function createAgenda(form) {
    const fd=new FormData(form),employeeIds=[...form.querySelectorAll("[data-agenda-person]:checked")].map((x)=>String(x.value));
    if(!String(fd.get("title")||"").trim()||!fd.get("date")||!employeeIds.length){window.crmToast?.("Renseigne le thème, la date et au moins un téléphoniste.");return;}
    const agenda=state().trainingAgenda||[];
    agenda.push({id:"training-"+Date.now(),title:String(fd.get("title")).trim(),details:String(fd.get("details")||""),date:String(fd.get("date")),time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||""),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),status:"planned",createdBy:currentUserName(),createdAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);renderAgenda();window.crmToast?.("Formation ajoutée à l’agenda partagé.");
  }
  function completeTraining(form) {
    const item=eventById(form.dataset.trainingComplete);if(!item||!mayComplete())return;
    const notes=String(new FormData(form).get("notes")||"").trim();
    item.status="completed";item.completedOn=today();item.completedAt=new Date().toISOString();item.trainer=currentUserName();item.completionNotes=notes;
    const agenda=state().trainingAgenda||[];const idx=agenda.findIndex((x)=>String(x.id)===String(item.id));if(idx>=0)agenda[idx]=item;
    persist("trainingAgenda",agenda);saveTrainingHistory(item,notes);closeDialog();renderAgenda();window.crmRefreshTrainingHistoryProfile?.();window.crmToast?.("Formation terminée. L’historique des participants a été mis à jour.");
  }

  function init() {
    addStyle();mountNavigation();wrapProfileRenderer();wrapSynthesisRenderer();ensurePermissionEditor();
    renderAgenda();renderThemes();
    const nav=$("nav");
    nav?.addEventListener("click",(e)=>{const b=e.target.closest('[data-page="formationAgenda"]');if(!b)return;queueMicrotask(()=>{renderAgenda();const crumb=$("crumb");if(crumb)crumb.textContent="Formations & agenda";});});
    document.addEventListener("click",(e)=>{
      const person=e.target.closest("[data-theme-person]");
      if(person){const id=person.dataset.themePerson,employeeId=String(person.dataset.employeeId),current=selectedByTheme[id]||[];selectedByTheme[id]=current.includes(employeeId)?current.filter((x)=>x!==employeeId):[...current,employeeId];renderThemes();return;}
      const plan=e.target.closest("[data-theme-plan]");if(plan){openedSchedule=plan.dataset.themePlan;renderThemes();return;}
      const cancel=e.target.closest("[data-theme-cancel]");if(cancel){openedSchedule="";renderThemes();return;}
      const detail=e.target.closest("[data-theme-detail]");if(detail){themeDetails(detail.dataset.themeDetail);return;}
      const agenda=e.target.closest("[data-agenda-detail]");if(agenda){const item=eventById(agenda.dataset.agendaDetail);if(item)eventDetails(item);return;}
      if(e.target.closest("[data-training-dialog-close]")){closeDialog();return;}
    });
    document.addEventListener("submit",(e)=>{
      const theme=e.target.closest("#ccThemeCreateForm");if(theme){e.preventDefault();createTheme(theme);return;}
      const schedule=e.target.closest("[data-theme-schedule]");if(schedule){e.preventDefault();planTheme(schedule);return;}
      const create=e.target.closest("[data-agenda-create]");if(create){e.preventDefault();createAgenda(create);return;}
      const done=e.target.closest("[data-training-complete]");if(done){e.preventDefault();completeTraining(done);}
    });
    window.setInterval(()=>{wrapSynthesisRenderer();wrapProfileRenderer();ensurePermissionEditor();},1000);
    window.crmRenderFormationAgenda=renderAgenda;
    window.crmRenderSynthesisThemes=renderThemes;
    window.crmRefreshTrainingHistoryProfile=()=>{if(lastProfileId&&lastProfileTab==="quality")window.renderProfile?.(lastProfileId,lastProfileTab);};
    window.crmFormationAgendaInit=init;
  }
  init();
})();

