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
  let selectedByTheme = Object.create(null), openedSchedule = "", lastProfileId = "", lastProfileTab = "", agendaWeekOffset = 0;

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
      ".cc-agenda-week-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(230px,.75fr);gap:14px;padding:14px 16px 18px}.cc-agenda-week-main,.cc-agenda-side{border:1px solid #493b3e;border-radius:14px;background:rgba(25,21,22,.7);overflow:hidden}.cc-agenda-week-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;background:#272021;border-bottom:1px solid #493b3e}.cc-agenda-week-toolbar strong{display:block;color:#f4e8ea}.cc-agenda-week-toolbar small{display:block;color:#beadaf;margin-top:3px}.cc-agenda-week-controls{display:flex;gap:6px;align-items:center}.cc-agenda-week-controls button{border:1px solid #59474a;background:#34292b;color:#f3dce1;border-radius:8px;padding:6px 9px;cursor:pointer;font:inherit}.cc-agenda-week-grid-wrap{overflow-x:auto}.cc-agenda-week-grid{display:grid;grid-template-columns:repeat(5,minmax(112px,1fr));min-width:610px}.cc-agenda-week-day{min-height:190px;padding:9px;border-right:1px solid #3f3436}.cc-agenda-week-day:last-child{border-right:0}.cc-agenda-week-dayhead{min-height:34px;border-bottom:1px solid #3f3436;padding:0 1px 8px;color:#c9b9bb;font-size:11px}.cc-agenda-week-dayhead strong{display:block;color:#f1e5e7;font-size:12px;text-transform:capitalize}.cc-agenda-week-events{display:grid;gap:7px;padding-top:8px}.cc-week-event{width:100%;text-align:left;border:1px solid #685058;background:linear-gradient(135deg,#3a2b30,#2a2224);color:#f4e8ea;border-radius:9px;padding:8px;cursor:pointer;font:inherit}.cc-week-event:hover{border-color:#e7bec6;transform:translateY(-1px)}.cc-week-event.meeting{border-color:#52687b;background:linear-gradient(135deg,#273642,#252225)}.cc-week-event.done{border-color:#3d7259;background:#203a30}.cc-week-event-time{display:block;color:#e7b9c2;font-size:10px;font-weight:800;margin-bottom:3px}.cc-week-event.meeting .cc-week-event-time{color:#a8d2f2}.cc-week-event strong{display:block;font-size:11px;line-height:1.35}.cc-week-event small{display:block;color:#c9b9bb;font-size:10px;margin-top:4px;line-height:1.35}.cc-week-empty{color:#786b6d;font-size:11px;padding:8px 2px}.cc-agenda-side{padding:13px}.cc-agenda-side h3{margin:0 0 4px;color:#f3e5e8;font-size:14px}.cc-agenda-side>p{margin:0 0 11px;color:#bbaeb0;font-size:11px;line-height:1.45}.cc-agenda-upcoming-list{display:grid;gap:7px}.cc-agenda-upcoming{width:100%;display:grid;grid-template-columns:42px minmax(0,1fr);gap:9px;align-items:center;text-align:left;border:1px solid #493b3e;background:#2b2425;color:#f4e8ea;border-radius:10px;padding:8px;cursor:pointer;font:inherit}.cc-agenda-upcoming:hover{border-color:#d4a4ad}.cc-agenda-upcoming-date{text-align:center;border-radius:8px;background:#3b2d30;color:#f1cbd2;padding:5px 3px;font-size:9px;text-transform:uppercase}.cc-agenda-upcoming-date strong{display:block;font-size:15px}.cc-agenda-upcoming-title{display:block;font-size:11px;font-weight:800}.cc-agenda-upcoming-meta{display:block;margin-top:3px;color:#bcadaf;font-size:10px}.cc-agenda-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.cc-agenda-actions .danger{border-color:#78474d;color:#ffd9de;background:#3a2528}.cc-agenda-history{border-top:1px solid #493b3e;margin-top:12px;padding-top:12px}.cc-agenda-history>summary{cursor:pointer;color:#e6c3ca;font-size:12px;font-weight:800}.cc-agenda-history-list{display:grid;gap:7px;margin-top:9px}.cc-agenda-empty-week{padding:14px;color:#bcaeb0;font-size:12px}",
      "@media(max-width:900px){.cc-agenda-week-layout{grid-template-columns:1fr}.cc-agenda-week-grid{grid-template-columns:repeat(5,minmax(105px,1fr))}}@media(max-width:720px){.cc-agenda-week-layout{padding:10px}.cc-agenda-week-toolbar{align-items:flex-start;flex-direction:column}.cc-agenda-week-controls{width:100%;justify-content:space-between}}",
      ".cc-agenda-empty{margin:14px 16px 18px;padding:18px;border:1px dashed #604f50;border-radius:12px;color:#cbbfc0}.cc-training-dialog{max-width:min(720px,92vw);width:720px;max-height:88vh;overflow:auto;border:1px solid #70595b;border-radius:18px;background:#211b1d;color:#f4e9e9;padding:0;box-shadow:0 24px 90px rgba(0,0,0,.65)}",
      ".cc-training-dialog::backdrop{background:rgba(8,6,7,.72);backdrop-filter:blur(4px)}.cc-dialog-inner{padding:20px}.cc-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid #493b3d;padding-bottom:12px;margin-bottom:14px}.cc-dialog-head h2{margin:3px 0 0;color:#f6e8eb}",
      ".cc-dialog-close{border:1px solid #655052;background:#302627;color:#f5e8ea;border-radius:9px;padding:7px 10px;cursor:pointer}.cc-observation-list{display:grid;gap:8px;margin-top:12px}.cc-observation{border-left:3px solid #d8aab4;background:#2b2224;border-radius:0 10px 10px 0;padding:10px 12px;color:#eee0e2}.cc-observation small{display:block;color:#c7b4b7;margin-bottom:4px}",
      ".cc-history-panel{margin-top:24px}.cc-history-list{display:grid;gap:9px}.cc-history-item{border:1px solid #4d3f41;border-radius:11px;background:rgba(50,38,40,.55);padding:11px 13px}.cc-history-item b{color:#f0d4da}.cc-history-item p{margin:5px 0 0;color:#d1c1c2;line-height:1.45}",
      ".cc-synth-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;margin:0 0 16px}.cc-synth-stat{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid #493b3e;border-radius:14px;background:linear-gradient(130deg,rgba(236,190,198,.08),rgba(31,27,28,.96) 75%)}.cc-synth-stat small{display:block;color:#bca9ac}.cc-synth-stat strong{display:block;font-size:24px}.cc-synth-stat em{font-style:normal;color:#f2c8d0;background:#3b2d30;border:1px solid #67474e;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;white-space:nowrap}",
      "#ccSynthesisExperience{display:grid;gap:14px}.cc-training-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-training-card{--cc-accent:#dfa04e;position:relative;overflow:hidden}.cc-training-card:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--cc-accent)}.cc-training-card .theme-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.cc-training-card[data-priority=high]{--cc-accent:#c85c68}.cc-training-card[data-priority=medium]{--cc-accent:#dfa04e}.cc-training-card[data-priority=low]{--cc-accent:#4aa678}.cc-training-card .cc-topic-origin{color:var(--cc-accent)}.cc-theme-badge{border:1px solid color-mix(in srgb,var(--cc-accent) 55%,#493b3e);color:var(--cc-accent);background:color-mix(in srgb,var(--cc-accent) 13%,#211c1d);border-radius:999px;padding:5px 9px;font-size:10px;font-weight:850;white-space:nowrap}.cc-training-card .cc-person-chip{position:relative;padding-left:28px}.cc-training-card .cc-person-chip:before{content:'+';position:absolute;left:9px;width:14px;height:14px;border-radius:50%;display:grid;place-items:center;background:#473a3d;color:#d3bdc0;font-size:12px;font-weight:900}.cc-training-card .cc-person-chip[aria-pressed=true]{background:linear-gradient(135deg,rgba(233,195,202,.28),rgba(91,58,66,.82));color:#fff1f3}.cc-training-card .cc-person-chip[aria-pressed=true]:before{content:'✓';background:#e9c3ca;color:#302326;font-size:10px}.cc-theme-foot{border-top:1px solid #48393d;margin-top:12px;padding-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cc-theme-selection{color:#e9c3ca;font-weight:800;margin-right:auto;font-size:11px}.cc-prepared-title{font-size:16px;margin:6px 2px 0;color:#f2e5e7}.cc-prepared-list{display:grid;gap:9px;padding:14px 16px}.cc-prepared-empty{padding:18px;color:#cbbfc0;border:1px dashed #604f50;border-radius:12px;margin:14px 16px}.cc-agenda-person-list{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:7px}@media(max-width:850px){.cc-training-grid{grid-template-columns:1fr}.cc-synth-stats{grid-template-columns:1fr}}@media(max-width:720px){.cc-agenda-event{grid-template-columns:1fr;gap:7px}.cc-agenda-date{border:0;border-bottom:1px solid #5c484a;padding:0 0 7px}.cc-training-form{grid-template-columns:1fr}.cc-training-form label.cc-wide{grid-column:auto}.cc-training-dialog{width:auto}}"
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
    let screen=$("screen-formationAgenda");
    if(!screen){screen=document.createElement("section");screen.className="screen";screen.id="screen-formationAgenda";page.append(screen);}
    if(!screen.querySelector("#ccAgendaList")||!screen.querySelector("#ccAgendaSummary")||!screen.querySelector("#ccAgendaCreate")){
      screen.innerHTML='<div class="head"><div><div class="eyebrow">ACCOMPAGNEMENT · FORMATION</div><h1>Formations & agenda</h1><div class="sub">Le calendrier commun des formations, les groupes prévus et les séances réalisées.</div></div><button class="btn primary" type="button" data-agenda-new>＋ Planifier une formation</button></div><div class="panel"><div class="panel-head"><div><div class="panel-title">Agenda partagé</div><div class="panel-desc">La RH et la chef de plateau peuvent planifier. La chef de plateau confirme les séances réalisées ; le directeur opérationnel les consulte.</div></div></div><div class="cc-agenda-toolbar" id="ccAgendaSummary"></div><div id="ccAgendaCreate"></div><div id="ccAgendaList"></div></div>';
    }
    const oldThemeHost=$("ccTrainingThemes"); if(oldThemeHost)oldThemeHost.remove();
    const synthesis=document.querySelector("#screen-synthesis");
    if(synthesis&&!$("ccSynthesisExperience")){
      const subtitle=synthesis.querySelector(".head .sub");if(subtitle)subtitle.textContent="Regroupe les observations récurrentes, choisis les téléphonistes concernés et prépare les formations ciblées.";
      [".synthesis-filter-panel",".synthesis-summary","#synthesisList",".synthesis-meetings"].forEach((selector)=>{const node=synthesis.querySelector(selector);if(node){node.hidden=true;node.style.display="none";}});
      const host=document.createElement("div");host.id="ccSynthesisExperience";
      host.innerHTML='<div class="cc-synth-stats" id="ccSynthesisStats"></div><section class="panel cc-synth-problems"><div class="panel-head"><div><div class="panel-title">Problématiques observées</div><div class="panel-desc">Clique sur un thème pour lire les observations. Clique sur les noms pour choisir les téléphonistes du groupe.</div></div><button type="button" class="btn primary" data-theme-add>＋ Ajouter un thème</button></div><div id="ccThemeGroups" class="cc-training-grid"></div></section><h2 class="cc-prepared-title">Formations préparées pour le Directeur opérationnel</h2><section class="panel"><div class="panel-head"><div><div class="panel-title">Groupes et prochaines séances</div><div class="panel-desc">Toute formation planifiée apparaît aussi dans le module Formations & agenda.</div></div><span class="pill" id="ccPreparedCount">0 groupe</span></div><div id="ccPreparedTrainingList"></div></section>';
      const head=synthesis.querySelector(".head");if(head)head.insertAdjacentElement("afterend",host);else synthesis.prepend(host);
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
    const addTeamRecords=(rows,source)=> (rows||[]).forEach((x,i)=>{
      const searchable=JSON.stringify(x).toLocaleLowerCase("fr"),matched=people().filter((e)=>searchable.includes(personName(e).toLocaleLowerCase("fr")));
      const text=[x.summary,x.issues&&"Points abordés : "+x.issues,x.actions&&"Actions : "+x.actions,x.decisions&&"Décisions : "+x.decisions,x.notes].filter(Boolean).join(" · ");
      const topic=String(x.theme||x.category||x.title||text.split(/[.!?]/)[0]||source).trim().slice(0,100);
      matched.forEach((employee)=>result.push({id:source.toLocaleLowerCase("fr")+":"+(x.id==null?i:x.id)+":"+employee.id,source, date:x.date||"",employee:personName(employee),employeeId:String(employee.id),topic,text:text||"Compte rendu sans détail complémentaire."}));
    });
    addTeamRecords(data.reports,"Rapport");addTeamRecords(data.meetings,"Réunion");
    return result.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  }
  function hash(value) { let h=0; for (const c of String(value)) h=((h*31)+c.charCodeAt(0))|0; return Math.abs(h).toString(36); }
  function themeGroups() {
    const grouped = new Map();
    observations().forEach((x) => {
      const key = x.topic.toLocaleLowerCase("fr").replace(/\s+/g," ").trim() || "observation";
      if (!grouped.has(key)) grouped.set(key,{id:"topic-"+hash(key),title:x.topic,details:"",suggested:true,priority:"low",items:[],employeeIds:[]});
      const group=grouped.get(key); group.items.push(x); if(x.employeeId&&!group.employeeIds.includes(x.employeeId))group.employeeIds.push(x.employeeId);
    });
    grouped.forEach((group)=>{group.priority=group.items.length>=6?"high":group.items.length>=3?"medium":"low";});
    const saved=state().trainingThemes||[];
    const custom=saved.map((x) => ({id:String(x.id),title:String(x.title||"Thème de formation"),details:String(x.details||""),priority:x.priority||"medium",suggested:false,items:observations().filter(o=>(x.observationIds||[]).includes(o.id)),employeeIds:(x.employeeIds||[]).map(String)}));
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
    const names=ids.map(personById).filter(Boolean).map(personName);
    return '<form class="cc-training-form" data-theme-schedule="'+esc(group.id)+'"><p class="cc-wide"><b>Participants :</b> '+esc(names.join(", "))+'</p><label>Date<input type="date" name="date" value="'+today()+'" required></label><label>Heure<input type="time" name="time"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="60"></label><label>Lieu / lien<input name="location" maxlength="180" placeholder="Salle ou lien de réunion"></label><label class="cc-wide">Objectif de la séance<textarea name="details" maxlength="1000">'+esc(group.details||"")+'</textarea></label><button class="btn primary" type="submit">Ajouter à l’agenda du directeur</button><button class="btn" type="button" data-training-dialog-close>Annuler</button></form>';
  }
  function renderThemes() {
    const host=$("ccThemeGroups"); if(!host)return;
    const groups=themeGroups();
    const stats=$("ccSynthesisStats"),uniquePeople=new Set(groups.flatMap((g)=>g.employeeIds||[])),prepared=(state().trainingAgenda||[]).filter((x)=>x.status!=="completed"&&x.status!=="Terminée");
    if(stats)stats.innerHTML='<div class="cc-synth-stat"><div><small>Thèmes à travailler</small><strong>'+groups.length+'</strong></div><em>'+groups.filter((x)=>x.priority==="high").length+' prioritaires</em></div><div class="cc-synth-stat"><div><small>Téléphonistes concernés</small><strong>'+uniquePeople.size+'</strong></div><em>sur les observations</em></div><div class="cc-synth-stat"><div><small>Groupes préparés</small><strong>'+prepared.length+'</strong></div><em>à l’agenda du directeur</em></div>';
    const count=$("ccPreparedCount");if(count)count.textContent=prepared.length+" groupe(s)";
    const preparedHost=$("ccPreparedTrainingList");if(preparedHost)preparedHost.innerHTML=prepared.length?'<div class="cc-prepared-list">'+prepared.map(agendaCard).join("")+'</div>':'<div class="cc-prepared-empty">Aucune formation préparée pour le moment. Sélectionne un thème, choisis les téléphonistes concernés, puis clique sur « Former le groupe ».</div>';
    if(!groups.length){host.innerHTML='<div class="cc-prepared-empty">Aucune problématique n’est encore recensée. Dès qu’une écoute, un coaching, un rapport ou une réunion contient un point lié à un téléphoniste, il sera regroupé ici. Tu peux aussi créer un thème libre.</div>';return;}
    host.innerHTML=groups.map((g) => {const selected=(selectedByTheme[g.id]||[]).length,label=g.priority==="high"?"Prioritaire":g.priority==="medium"?"À travailler":"Suivi léger",scope=g.suggested?g.employeeIds.length+" téléphoniste(s) concerné(s)":"Sélection libre des téléphonistes";return '<article class="cc-training-card" data-priority="'+esc(g.priority||"medium")+'"><div class="theme-head"><div><span class="cc-topic-origin">'+(g.suggested?g.items.length+' observation(s)':'Thème personnalisé')+' · '+scope+'</span><h3><button type="button" class="cc-theme-title" data-theme-detail="'+esc(g.id)+'">'+esc(g.title)+'</button></h3></div><span class="cc-theme-badge">'+label+'</span></div><p>'+esc(g.details||g.items[0]?.text||"Clique sur les noms pour composer un groupe ciblé.")+'</p><small class="hint">Clique sur les noms pour choisir les participants</small>'+chips(g)+'<div class="cc-theme-foot"><span class="cc-theme-selection">'+selected+' sélectionné(s) sur '+(g.suggested?g.employeeIds.length:people().length)+'</span><button type="button" class="btn" data-theme-detail="'+esc(g.id)+'">Voir le détail</button><button class="btn primary" type="button" data-theme-plan="'+esc(g.id)+'">'+(selected?"Former le groupe ("+selected+")":"Choisir les téléphonistes")+'</button></div></article>';}).join("");
  }
  function agendaItems() {
    const trainings=(state().trainingAgenda||[]).map((item)=>({...item,_agendaType:"training"}));
    const meetings=(state().meetings||[]).filter((item)=>item&&item.id!=null).map((item)=>({...item,id:"meeting:"+String(item.id),_sourceId:item.id,_agendaType:"meeting",title:item.title||item.kind||"Réunion"}));
    return [...trainings,...meetings].sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.time||"").localeCompare(String(b.time||"")));
  }
  function isDone(item) { return ["completed","terminée","terminee","done"].includes(String(item.status||"").toLocaleLowerCase("fr")); }
  function agendaCard(item) {
    const done=isDone(item), isMeeting=item._agendaType==="meeting";
    const names=(item.employeeIds||[]).map((id)=>personById(id)).filter(Boolean).map(personName);
    const attendeeLabel=isMeeting?(item.employee||"Équipe"):names.length?names.join(", "):(item.employeeNames||[]).join(", ")||"Équipe";
    const status=done?(isMeeting?"Réalisée":"Terminée"):item.date<today()?"À reprogrammer":isMeeting?"Réunion planifiée":"Planifiée";
    return '<button type="button" class="cc-agenda-event '+(isMeeting?"cc-agenda-meeting":"")+'" data-agenda-detail="'+esc(item.id)+'"><span class="cc-agenda-date">'+esc(dateLabel(item.date))+(item.time?'<br><small>'+esc(timeLabel(item.time))+'</small>':"")+'</span><span><small class="cc-topic-origin">'+(isMeeting?"Réunion":"Formation")+'</small><h3>'+esc(item.title||(isMeeting?"Réunion":"Formation"))+'</h3><span class="cc-agenda-meta">'+esc(attendeeLabel)+(item.location?" · "+esc(item.location):"")+'</span></span><span class="cc-agenda-status '+(done?"done":"")+'">'+esc(status)+'</span></button>';
  }
  function newAgendaForm() {
    document.querySelectorAll("[data-agenda-new]").forEach((button)=>button.hidden=!manager());
    return "";
  }
  function agendaCreateForm() {
    const list=people();
    return '<form class="cc-training-form" data-agenda-create><label>Thème<input name="title" maxlength="120" required placeholder="Sujet de la formation"></label><label>Date<input type="date" name="date" value="'+today()+'" required></label><label>Heure<input type="time" name="time"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="60"></label><label>Lieu / lien<input name="location" maxlength="180" placeholder="Salle ou lien de réunion"></label><label class="cc-wide">Objectif / préparation<textarea name="details" maxlength="1000"></textarea></label><div class="cc-agenda-person-list">'+list.map((e)=>'<label class="cc-person-chip"><input type="checkbox" data-agenda-person value="'+esc(String(e.id))+'"> '+esc(personName(e))+'</label>').join("")+'</div><button class="btn primary" type="submit">Ajouter à l’agenda partagé</button><button class="btn" type="button" data-training-dialog-close>Annuler</button></form>';
  }
  function isoDate(date) { return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); }
  function agendaWeekBounds() {
    const start=new Date(today()+"T12:00:00"),offset=(start.getDay()+6)%7;
    start.setDate(start.getDate()-offset+agendaWeekOffset*7);
    const end=new Date(start);end.setDate(end.getDate()+4);
    return {start:isoDate(start),end:isoDate(end)};
  }
  function agendaWeekCard(item) {
    const meeting=item._agendaType==="meeting",done=isDone(item),name=meeting?(item.employee||"Équipe"):((item.employeeIds||[]).map(personById).filter(Boolean).map(personName).join(", ")||(item.employeeNames||[]).join(", ")||"Équipe");
    return '<button type="button" class="cc-week-event '+(meeting?"meeting ":"")+(done?"done":"")+'" data-agenda-detail="'+esc(item.id)+'"><span class="cc-week-event-time">'+esc(item.time?timeLabel(item.time):"Horaire à définir")+'</span><strong>'+esc(item.title||(meeting?"Réunion":"Formation"))+'</strong><small>'+esc(name)+'</small></button>';
  }
  function agendaUpcomingCard(item) {
    const meeting=item._agendaType==="meeting",date=new Date(String(item.date||"")+"T12:00:00"),name=meeting?(item.employee||"Équipe"):((item.employeeIds||[]).map(personById).filter(Boolean).map(personName).join(", ")||(item.employeeNames||[]).join(", ")||"Équipe");
    return '<button type="button" class="cc-agenda-upcoming" data-agenda-detail="'+esc(item.id)+'"><span class="cc-agenda-upcoming-date">'+esc(new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(date))+'<strong>'+esc(date.getDate())+'</strong></span><span><span class="cc-agenda-upcoming-title">'+esc(item.title||(meeting?"Réunion":"Formation"))+'</span><span class="cc-agenda-upcoming-meta">'+esc(item.time?timeLabel(item.time)+" · ":"")+esc(name)+'</span></span></button>';
  }
  function renderAgenda() {
    let host=$("ccAgendaList");if(!host){mountNavigation();host=$("ccAgendaList");}if(!host)return;
    if($("screen-formationAgenda")?.classList.contains("active")&&$("crumb"))$("crumb").textContent="Formations & agenda";
    const all=agendaItems(),done=all.filter(isDone),pending=all.filter((x)=>!isDone(x));
    const todays=pending.filter((x)=>String(x.date||"").slice(0,10)===today()).length;
    const summary=$("ccAgendaSummary");if(summary)summary.innerHTML='<span class="cc-agenda-count">'+todays+' aujourd’hui</span><span class="cc-agenda-count">'+pending.length+' planifiée(s)</span><span class="cc-agenda-count">'+done.length+' réalisée(s)</span>';
    const form=$("ccAgendaCreate");if(form)form.innerHTML=newAgendaForm();
    const range=agendaWeekBounds(),weekDays=Array.from({length:5},(_,i)=>{const dateObj=new Date(range.start+"T12:00:00");dateObj.setDate(dateObj.getDate()+i);const date=isoDate(dateObj),events=all.filter((x)=>String(x.date||"").slice(0,10)===date).sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));return '<div class="cc-agenda-week-day"><div class="cc-agenda-week-dayhead"><strong>'+esc(new Intl.DateTimeFormat("fr-FR",{weekday:"long"}).format(dateObj))+'</strong>'+esc(new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short"}).format(dateObj))+'</div><div class="cc-agenda-week-events">'+(events.length?events.map(agendaWeekCard).join(""):'<div class="cc-week-empty">Aucune séance</div>')+'</div></div>';}).join("");
    const upcoming=pending.slice(0,5),recent=done.slice().reverse().slice(0,5);
    host.innerHTML='<div class="cc-agenda-week-layout"><div class="cc-agenda-week-main"><div class="cc-agenda-week-toolbar"><div><strong>Agenda des formations</strong><small>Du '+esc(dateLabel(range.start))+' au '+esc(dateLabel(range.end))+'</small></div><div class="cc-agenda-week-controls"><button type="button" data-agenda-week-nav="-1" aria-label="Semaine précédente">‹</button><button type="button" data-agenda-week-nav="0">Cette semaine</button><button type="button" data-agenda-week-nav="1" aria-label="Semaine suivante">›</button></div></div><div class="cc-agenda-week-grid-wrap"><div class="cc-agenda-week-grid">'+weekDays+'</div></div></div><aside class="cc-agenda-side"><h3>Prochaines séances</h3><p>Les formations et réunions planifiées par les comptes autorisés apparaissent ici.</p><div class="cc-agenda-upcoming-list">'+(upcoming.length?upcoming.map(agendaUpcomingCard).join(""):'<div class="cc-agenda-empty-week">Aucune séance planifiée pour le moment.</div>')+'</div>'+(recent.length?'<details class="cc-agenda-history"><summary>Dernières séances réalisées ('+done.length+')</summary><div class="cc-agenda-history-list">'+recent.map(agendaUpcomingCard).join("")+'</div></details>':"")+'</aside></div>';
    renderThemes();
  }
  function eventById(id) {
    const value=String(id||"");
    if(value.startsWith("meeting:")){
      const sourceId=value.slice("meeting:".length),meeting=(state().meetings||[]).find((x)=>String(x.id)===sourceId);
      return meeting?{...meeting,id:value,_sourceId:meeting.id,_agendaType:"meeting"}:null;
    }
    const item=(state().trainingAgenda||[]).find((x)=>String(x.id)===value);
    return item?{...item,_agendaType:"training"}:null;
  }
  function eventDetails(item) {
    const done=isDone(item),isMeeting=item._agendaType==="meeting";
    if(isMeeting){
      const canEdit=manager()&&!done;
      const body='<p><b>Date :</b> '+esc(dateLabel(item.date))+(item.time?' · '+esc(timeLabel(item.time)):"")+'</p><p><b>Personne / équipe :</b> '+esc(item.employee||"Équipe")+'</p>'+(item.summary?'<div class="cc-observation">'+esc(item.summary)+'</div>':"")+'<p><small>Planifiée par '+esc(item.owner||"l’équipe")+'</small></p>'+(canEdit?'<form class="cc-training-form" data-meeting-edit="'+esc(item._sourceId)+'"><label>Sujet de la réunion<input name="title" maxlength="180" required value="'+esc(item.title||item.kind||"Réunion")+'"></label><label>Date<input type="date" name="date" required value="'+esc(String(item.date||"").slice(0,10))+'"></label><label>Heure<input type="time" name="time" value="'+esc(String(item.time||"").slice(0,5))+'"></label><label>Personne / équipe concernée<input name="employee" maxlength="180" value="'+esc(item.employee||"Équipe")+'"></label><label class="cc-wide">Points à traiter<textarea name="summary" maxlength="1000">'+esc(item.summary||"")+'</textarea></label><button class="btn primary" type="submit">Enregistrer les modifications</button><button class="btn" type="button" data-meeting-delete="'+esc(item._sourceId)+'">Supprimer la réunion</button></form>':"");
      openDialog(item.title||"Réunion",body);return;
    }
    const names=(item.employeeIds||[]).map(personById).filter(Boolean).map(personName);
    const body='<p><b>Date :</b> '+esc(dateLabel(item.date))+(item.time?' · '+esc(timeLabel(item.time)):"")+'</p><p><b>Participants :</b> '+esc(names.join(", ")||(item.employeeNames||[]).join(", ")||"Non précisés")+'</p>'+(item.duration?'<p><b>Durée :</b> '+esc(item.duration)+' minutes</p>':"")+(item.location?'<p><b>Lieu :</b> '+esc(item.location)+'</p>':"")+(item.details?'<p>'+esc(item.details)+'</p>':"")+(done?'<div class="cc-observation"><small>Réalisée le '+esc(dateLabel(item.completedOn||item.completedAt))+' · '+esc(item.trainer||"")+'</small>'+esc(item.completionNotes||"Formation confirmée.")+'</div>':"")+(mayComplete()&&!done?'<form class="cc-training-form" data-training-complete="'+esc(item.id)+'"><label class="cc-wide">Compte rendu / points travaillés<textarea name="notes" maxlength="1200" placeholder="Résumé de la séance, acquis et suite prévue"></textarea></label><button class="btn primary" type="submit">Confirmer la formation terminée</button></form>':"")+(manager()&&!done?'<div class="cc-agenda-actions"><button class="btn" type="button" data-training-edit="'+esc(item.id)+'">Modifier</button><button class="btn danger" type="button" data-training-delete="'+esc(item.id)+'">Supprimer</button></div>':"");
    openDialog(item.title||"Formation",body);
  }
  function trainingEditForm(item) {
    const chosen=new Set((item.employeeIds||[]).map(String));
    const participants=people().map((e)=>'<label class="cc-person-chip"><input type="checkbox" data-training-edit-person value="'+esc(String(e.id))+'" '+(chosen.has(String(e.id))?"checked":"")+'> '+esc(personName(e))+'</label>').join("");
    return '<form class="cc-training-form" data-training-update="'+esc(item.id)+'"><label>Thème<input name="title" maxlength="120" required value="'+esc(item.title||"")+'"></label><label>Date<input type="date" name="date" required value="'+esc(String(item.date||"").slice(0,10))+'"></label><label>Heure<input type="time" name="time" value="'+esc(String(item.time||"").slice(0,5))+'"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="'+esc(item.duration||60)+'"></label><label>Lieu / lien<input name="location" maxlength="180" value="'+esc(item.location||"")+'"></label><label class="cc-wide">Objectif / préparation<textarea name="details" maxlength="1000">'+esc(item.details||"")+'</textarea></label><div class="cc-agenda-person-list">'+participants+'</div><button class="btn primary" type="submit">Enregistrer les modifications</button><button class="btn" type="button" data-training-dialog-close>Annuler</button></form>';
  }
  function saveTrainingEdit(form) {
    if(!manager())return;
    const fd=new FormData(form),id=String(form.dataset.trainingUpdate||""),agenda=state().trainingAgenda||[],item=agenda.find((x)=>String(x.id)===id);
    if(!item||isDone(item))return;
    const title=String(fd.get("title")||"").trim(),date=String(fd.get("date")||"").slice(0,10),employeeIds=[...form.querySelectorAll("[data-training-edit-person]:checked")].map((x)=>String(x.value));
    if(!title||!date||!employeeIds.length){window.crmToast?.("Renseigne le thème, la date et au moins un participant.");return;}
    Object.assign(item,{title,date,time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||"").trim(),details:String(fd.get("details")||"").trim(),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),updatedAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);closeDialog();renderAgenda();window.crmToast?.("Formation mise à jour dans l’agenda partagé.");
  }
  function deleteTraining(id) {
    if(!manager())return;
    const agenda=state().trainingAgenda||[],index=agenda.findIndex((x)=>String(x.id)===String(id));
    if(index<0||isDone(agenda[index]))return;
    if(!window.confirm("Supprimer cette formation planifiée ?"))return;
    agenda.splice(index,1);persist("trainingAgenda",agenda);closeDialog();renderAgenda();window.crmToast?.("Formation supprimée de l’agenda.");
  }
  function saveMeeting(form) {
    const data=state(),fd=new FormData(form),id=String(form.dataset.meetingEdit||""),meetings=data.meetings||[],meeting=meetings.find((x)=>String(x.id)===id);
    if(!meeting||!manager())return;
    const title=String(fd.get("title")||"").trim(),date=String(fd.get("date")||"").slice(0,10);
    if(!title||!date){window.crmToast?.("Renseigne le sujet et la date de la réunion.");return;}
    Object.assign(meeting,{title,date,time:String(fd.get("time")||""),employee:String(fd.get("employee")||"").trim()||"Équipe",summary:String(fd.get("summary")||"").trim(),updatedAt:new Date().toISOString()});
    const actions=data.synthesisActions||[],action=actions.find((x)=>String(x.meetingId)===id||String(x.key||"")===String(meeting.synthesisActionKey||meeting.synthesisSource||""));
    if(action)Object.assign(action,{meetingId:meeting.id,meetingDate:date,meetingSummary:meeting.summary,updatedAt:new Date().toISOString()});
    persist("meetings",meetings);if(action)persist("synthesisActions",actions);
    closeDialog();renderAgenda();renderThemes();window.crmRenderSynthesis?.();window.crmToast?.("Réunion mise à jour dans l’agenda partagé.");
  }
  function deleteMeeting(id) {
    if(!manager())return;
    const data=state(),meetings=data.meetings||[],idx=meetings.findIndex((x)=>String(x.id)===String(id));
    if(idx<0)return;
    const meeting=meetings[idx],actions=data.synthesisActions||[],action=actions.find((x)=>String(x.meetingId)===String(meeting.id)||String(x.key||"")===String(meeting.synthesisActionKey||meeting.synthesisSource||""));
    if(!window.confirm("Supprimer cette réunion planifiée ?"))return;
    meetings.splice(idx,1);
    if(action)Object.assign(action,{meetingId:null,meetingDate:"",meetingSummary:"",updatedAt:new Date().toISOString()});
    persist("meetings",meetings);if(action)persist("synthesisActions",actions);
    closeDialog();renderAgenda();renderThemes();window.crmRenderSynthesis?.();window.crmToast?.("Réunion supprimée de l’agenda.");
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
        const synthesis=host.querySelector('[data-permission-module][value="synthesis"]');
        if(synthesis&&!Array.isArray(modules)&&r==="chef_plateau")synthesis.checked=true;
      }
      return result;
    };
    window.ccFormationAgendaPermissionWrapped=true;
  }
  function themeCreateForm() {
    return '<form class="cc-training-form" id="ccThemeCreateForm"><label class="cc-wide">Thème / objectif<input name="themeTitle" maxlength="100" required placeholder="Ex. découverte du besoin"></label><label class="cc-wide">Description de la lacune<textarea name="themeDetails" maxlength="500" placeholder="Décris ce qui est observé et ce qui doit progresser"></textarea></label><label>Priorité<select name="priority"><option value="high">Prioritaire</option><option value="medium" selected>À travailler</option><option value="low">Suivi léger</option></select></label><button class="btn primary" type="submit">Créer le thème</button></form>';
  }
  function createTheme(form) {
    const fd=new FormData(form),title=String(fd.get("themeTitle")||"").trim(),details=String(fd.get("themeDetails")||"").trim(),priority=String(fd.get("priority")||"medium");
    if(!title)return;
    const themes=state().trainingThemes||[];themes.unshift({id:"theme-"+Date.now(),title,details,priority,createdAt:new Date().toISOString(),createdBy:currentUserName(),employeeIds:[]});
    persist("trainingThemes",themes);form.reset();closeDialog();renderThemes();window.crmToast?.("Thème de formation ajouté.");
  }
  function planTheme(form) {
    const fd=new FormData(form),id=form.dataset.themeSchedule,group=themeGroups().find((x)=>String(x.id)===String(id)),employeeIds=(selectedByTheme[id]||[]).slice();
    if(!group||!fd.get("date")||!employeeIds.length){window.crmToast?.("Sélectionne au moins un téléphoniste et une date.");return;}
    const agenda=state().trainingAgenda||[];
    agenda.push({id:"training-"+Date.now(),title:group.title,themeId:id,details:String(fd.get("details")||group.details||""),date:String(fd.get("date")),time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||""),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),status:"planned",createdBy:currentUserName(),createdAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);openedSchedule="";selectedByTheme[id]=[];closeDialog();renderThemes();renderAgenda();window.crmToast?.("Formation ajoutée à l’agenda partagé.");
  }
  function createAgenda(form) {
    const fd=new FormData(form),employeeIds=[...form.querySelectorAll("[data-agenda-person]:checked")].map((x)=>String(x.value));
    if(!String(fd.get("title")||"").trim()||!fd.get("date")||!employeeIds.length){window.crmToast?.("Renseigne le thème, la date et au moins un téléphoniste.");return;}
    const agenda=state().trainingAgenda||[];
    agenda.push({id:"training-"+Date.now(),title:String(fd.get("title")).trim(),details:String(fd.get("details")||""),date:String(fd.get("date")),time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||""),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),status:"planned",createdBy:currentUserName(),createdAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);closeDialog();renderAgenda();window.crmToast?.("Formation ajoutée à l’agenda partagé.");
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
      const add=e.target.closest("[data-theme-add]");if(add){openDialog("Ajouter un thème",themeCreateForm());return;}
      const newAgenda=e.target.closest("[data-agenda-new]");if(newAgenda){if(manager())openDialog("Planifier une formation",agendaCreateForm());return;}
      const plan=e.target.closest("[data-theme-plan]");if(plan){const group=themeGroups().find((x)=>String(x.id)===String(plan.dataset.themePlan));const selected=selectedByTheme[plan.dataset.themePlan]||[];if(!selected.length){window.crmToast?.("Clique sur au moins un téléphoniste pour composer le groupe.");return;}if(group)openDialog("Préparer une formation",themeScheduleForm(group));return;}
      const detail=e.target.closest("[data-theme-detail]");if(detail){themeDetails(detail.dataset.themeDetail);return;}
      const weekNav=e.target.closest("[data-agenda-week-nav]");if(weekNav){const move=Number(weekNav.dataset.agendaWeekNav||0);agendaWeekOffset=move===0?0:agendaWeekOffset+move;renderAgenda();return;}
      const editTraining=e.target.closest("[data-training-edit]");if(editTraining){const item=eventById(editTraining.dataset.trainingEdit);if(item&&!isDone(item)&&manager())openDialog("Modifier la formation",trainingEditForm(item));return;}
      const removeTraining=e.target.closest("[data-training-delete]");if(removeTraining){deleteTraining(removeTraining.dataset.trainingDelete);return;}
      const agenda=e.target.closest("[data-agenda-detail]");if(agenda){const item=eventById(agenda.dataset.agendaDetail);if(item)eventDetails(item);return;}
      const removeMeeting=e.target.closest("[data-meeting-delete]");if(removeMeeting){deleteMeeting(removeMeeting.dataset.meetingDelete);return;}
      if(e.target.closest("[data-training-dialog-close]")){closeDialog();return;}
    });
    document.addEventListener("submit",(e)=>{
      const theme=e.target.closest("#ccThemeCreateForm");if(theme){e.preventDefault();createTheme(theme);return;}
      const schedule=e.target.closest("[data-theme-schedule]");if(schedule){e.preventDefault();planTheme(schedule);return;}
      const create=e.target.closest("[data-agenda-create]");if(create){e.preventDefault();createAgenda(create);return;}
      const updateTraining=e.target.closest("[data-training-update]");if(updateTraining){e.preventDefault();saveTrainingEdit(updateTraining);return;}
      const meeting=e.target.closest("[data-meeting-edit]");if(meeting){e.preventDefault();saveMeeting(meeting);return;}
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

