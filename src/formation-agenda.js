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
      ".cc-agenda-meta{font-size:12px;color:#c6b6b7}.cc-agenda-status{font-size:11px;color:#f2d79c;background:#433521;border-radius:999px;padding:6px 9px;white-space:nowrap}.cc-agenda-status.done{color:#b9e1c7;background:#1f3a2b}.cc-agenda-status.not-done{color:#ffd5d9;background:#512d32}",
      ".cc-training-result-actions{display:flex;gap:8px;flex-wrap:wrap}.cc-result-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;white-space:nowrap}.cc-result-pill.done{color:#b9e1c7;background:#1f3a2b;border:1px solid #3d7259}.cc-result-pill.not-done{color:#ffd5d9;background:#512d32;border:1px solid #8a4e55}.cc-result-pill.pending{color:#f2d79c;background:#433521;border:1px solid #735a35}.cc-training-result-current{margin:12px 0;color:#eee1e3}",
      ".cc-training-history{margin:16px 0 2px;padding:16px;border:1px solid #493b3e;border-radius:14px;background:rgba(25,21,22,.82)}.cc-training-history-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:12px}.cc-training-history-head h3{margin:0;color:#f4e8ea;font-size:16px}.cc-training-history-head p{margin:5px 0 0;color:#bcaeb0;font-size:11px;line-height:1.5}.cc-training-history-list{display:grid;gap:7px;max-height:520px;overflow:auto}.cc-training-history-row{width:100%;display:grid;grid-template-columns:135px minmax(0,1fr) auto;gap:12px;align-items:center;text-align:left;border:1px solid #493b3e;border-radius:10px;background:#2b2425;color:#f4e8ea;padding:10px 12px;cursor:pointer;font:inherit}.cc-training-history-row:hover{border-color:#d4a4ad;background:#302729}.cc-training-history-row .cc-agenda-date{font-size:11px}.cc-training-history-row .cc-agenda-date small{display:block;margin-top:3px;color:#c6b6b7}.cc-training-history-detail{min-width:0;display:grid;gap:3px}.cc-training-history-detail strong{font-size:12px}.cc-training-history-detail small,.cc-training-history-detail em{overflow:hidden;text-overflow:ellipsis;color:#c6b6b7;font-size:10px;font-style:normal;white-space:nowrap}.cc-training-history-detail em{color:#d8bec3}@media(max-width:600px){.cc-training-history-row{grid-template-columns:1fr auto;gap:7px}.cc-training-history-row .cc-agenda-date{border:0;padding:0}.cc-training-history-detail{grid-column:1/-1;grid-row:2}}",
      ".cc-agenda-week-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(230px,.75fr);gap:14px;padding:14px 16px 18px}.cc-agenda-week-main,.cc-agenda-side{border:1px solid #493b3e;border-radius:14px;background:rgba(25,21,22,.7);overflow:hidden}.cc-agenda-week-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;background:#272021;border-bottom:1px solid #493b3e}.cc-agenda-week-toolbar strong{display:block;color:#f4e8ea}.cc-agenda-week-toolbar small{display:block;color:#beadaf;margin-top:3px}.cc-agenda-week-controls{display:flex;gap:6px;align-items:center}.cc-agenda-week-controls button{border:1px solid #59474a;background:#34292b;color:#f3dce1;border-radius:8px;padding:6px 9px;cursor:pointer;font:inherit}.cc-agenda-week-grid-wrap{overflow-x:auto}.cc-agenda-week-grid{display:grid;grid-template-columns:repeat(5,minmax(112px,1fr));min-width:610px}.cc-agenda-week-day{min-height:190px;padding:9px;border-right:1px solid #3f3436}.cc-agenda-week-day:last-child{border-right:0}.cc-agenda-week-dayhead{min-height:34px;border-bottom:1px solid #3f3436;padding:0 1px 8px;color:#c9b9bb;font-size:11px}.cc-agenda-week-dayhead strong{display:block;color:#f1e5e7;font-size:12px;text-transform:capitalize}.cc-agenda-week-events{display:grid;gap:7px;padding-top:8px}.cc-week-event{width:100%;text-align:left;border:1px solid #685058;background:linear-gradient(135deg,#3a2b30,#2a2224);color:#f4e8ea;border-radius:9px;padding:8px;cursor:pointer;font:inherit}.cc-week-event:hover{border-color:#e7bec6;transform:translateY(-1px)}.cc-week-event.meeting{border-color:#52687b;background:linear-gradient(135deg,#273642,#252225)}.cc-week-event.done{border-color:#3d7259;background:#203a30}.cc-week-event-time{display:block;color:#e7b9c2;font-size:10px;font-weight:800;margin-bottom:3px}.cc-week-event.meeting .cc-week-event-time{color:#a8d2f2}.cc-week-event strong{display:block;font-size:11px;line-height:1.35}.cc-week-event small{display:block;color:#c9b9bb;font-size:10px;margin-top:4px;line-height:1.35}.cc-week-empty{color:#786b6d;font-size:11px;padding:8px 2px}.cc-agenda-side{padding:13px}.cc-agenda-side h3{margin:0 0 4px;color:#f3e5e8;font-size:14px}.cc-agenda-side>p{margin:0 0 11px;color:#bbaeb0;font-size:11px;line-height:1.45}.cc-agenda-upcoming-list{display:grid;gap:7px}.cc-agenda-upcoming{width:100%;display:grid;grid-template-columns:42px minmax(0,1fr);gap:9px;align-items:center;text-align:left;border:1px solid #493b3e;background:#2b2425;color:#f4e8ea;border-radius:10px;padding:8px;cursor:pointer;font:inherit}.cc-agenda-upcoming:hover{border-color:#d4a4ad}.cc-agenda-upcoming-date{text-align:center;border-radius:8px;background:#3b2d30;color:#f1cbd2;padding:5px 3px;font-size:9px;text-transform:uppercase}.cc-agenda-upcoming-date strong{display:block;font-size:15px}.cc-agenda-upcoming-title{display:block;font-size:11px;font-weight:800}.cc-agenda-upcoming-meta{display:block;margin-top:3px;color:#bcadaf;font-size:10px}.cc-agenda-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.cc-agenda-actions .danger{border-color:#78474d;color:#ffd9de;background:#3a2528}.cc-agenda-history{border-top:1px solid #493b3e;margin-top:12px;padding-top:12px}.cc-agenda-history>summary{cursor:pointer;color:#e6c3ca;font-size:12px;font-weight:800}.cc-agenda-history-list{display:grid;gap:7px;margin-top:9px}.cc-agenda-empty-week{padding:14px;color:#bcaeb0;font-size:12px}",
      "@media(max-width:900px){.cc-agenda-week-layout{grid-template-columns:1fr}.cc-agenda-week-grid{grid-template-columns:repeat(5,minmax(105px,1fr))}}@media(max-width:720px){.cc-agenda-week-layout{padding:10px}.cc-agenda-week-toolbar{align-items:flex-start;flex-direction:column}.cc-agenda-week-controls{width:100%;justify-content:space-between}}",
      ".cc-past-observations{margin:14px;padding:12px 14px;border:1px solid #514244;border-radius:12px;background:#241e20;color:#eee1e3}.cc-past-observations summary{display:flex;justify-content:space-between;gap:10px;align-items:center;cursor:pointer;font-weight:800;color:#e8c0c8}.cc-past-observations summary b{font-size:11px;border-radius:999px;padding:4px 8px;background:#3a2b2e;color:#f4dce0}.cc-past-observations>p{color:#bcaeb0;font-size:11px;line-height:1.5}.cc-past-observations-list{display:grid;gap:7px;max-height:420px;overflow:auto}.cc-past-observation{border-left:3px solid #77676a;border-radius:0 8px 8px 0;padding:8px 10px;background:#2b2426;color:#dfd4d5;font-size:11px;line-height:1.5}.cc-past-observation small{display:block;margin-bottom:3px;color:#bba9ac}.cc-past-observation em{display:block;margin-top:3px;color:#d7b3ba;font-style:normal;font-size:10px}",
      ".cc-agenda-empty{margin:14px 16px 18px;padding:18px;border:1px dashed #604f50;border-radius:12px;color:#cbbfc0}.cc-training-dialog{max-width:min(720px,92vw);width:720px;max-height:88vh;overflow:auto;border:1px solid #70595b;border-radius:18px;background:#211b1d;color:#f4e9e9;padding:0;box-shadow:0 24px 90px rgba(0,0,0,.65)}",
      ".cc-training-dialog::backdrop{background:rgba(8,6,7,.72);backdrop-filter:blur(4px)}.cc-dialog-inner{padding:20px}.cc-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid #493b3d;padding-bottom:12px;margin-bottom:14px}.cc-dialog-head h2{margin:3px 0 0;color:#f6e8eb}",
      ".cc-dialog-close{border:1px solid #655052;background:#302627;color:#f5e8ea;border-radius:9px;padding:7px 10px;cursor:pointer}.cc-observation-list{display:grid;gap:8px;margin-top:12px}.cc-observation{border-left:3px solid #d8aab4;background:#2b2224;border-radius:0 10px 10px 0;padding:10px 12px;color:#eee0e2}.cc-observation small{display:block;color:#c7b4b7;margin-bottom:4px}",
      ".cc-history-panel{margin-top:24px}.cc-history-list{display:grid;gap:9px}.cc-history-item{border:1px solid #4d3f41;border-radius:11px;background:rgba(50,38,40,.55);padding:11px 13px}.cc-history-item b{color:#f0d4da}.cc-history-item p{margin:5px 0 0;color:#d1c1c2;line-height:1.45}",
      ".cc-synth-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;margin:0 0 16px}.cc-synth-stat{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid #493b3e;border-radius:14px;background:linear-gradient(130deg,rgba(236,190,198,.08),rgba(31,27,28,.96) 75%)}.cc-synth-stat small{display:block;color:#bca9ac}.cc-synth-stat strong{display:block;font-size:24px}.cc-synth-stat em{font-style:normal;color:#f2c8d0;background:#3b2d30;border:1px solid #67474e;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;white-space:nowrap}",
      "#ccSynthesisExperience{display:grid;gap:14px}.cc-training-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-training-card{--cc-accent:#dfa04e;position:relative;overflow:hidden}.cc-training-card:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--cc-accent)}.cc-training-card .theme-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.cc-training-card[data-priority=high]{--cc-accent:#c85c68}.cc-training-card[data-priority=medium]{--cc-accent:#dfa04e}.cc-training-card[data-priority=low]{--cc-accent:#4aa678}.cc-training-card .cc-topic-origin{color:var(--cc-accent)}.cc-theme-badge{border:1px solid color-mix(in srgb,var(--cc-accent) 55%,#493b3e);color:var(--cc-accent);background:color-mix(in srgb,var(--cc-accent) 13%,#211c1d);border-radius:999px;padding:5px 9px;font-size:10px;font-weight:850;white-space:nowrap}.cc-training-card .cc-person-chip{position:relative;padding-left:28px}.cc-training-card .cc-person-chip:before{content:'+';position:absolute;left:9px;width:14px;height:14px;border-radius:50%;display:grid;place-items:center;background:#473a3d;color:#d3bdc0;font-size:12px;font-weight:900}.cc-training-card .cc-person-chip[aria-pressed=true]{background:linear-gradient(135deg,rgba(233,195,202,.28),rgba(91,58,66,.82));color:#fff1f3}.cc-training-card .cc-person-chip[aria-pressed=true]:before{content:'✓';background:#e9c3ca;color:#302326;font-size:10px}.cc-theme-foot{border-top:1px solid #48393d;margin-top:12px;padding-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.cc-theme-selection{color:#e9c3ca;font-weight:800;margin-right:auto;font-size:11px}.cc-prepared-title{font-size:16px;margin:6px 2px 0;color:#f2e5e7}.cc-prepared-list{display:grid;gap:9px;padding:14px 16px}.cc-prepared-empty{padding:18px;color:#cbbfc0;border:1px dashed #604f50;border-radius:12px;margin:14px 16px}.cc-agenda-person-list{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:7px}@media(max-width:850px){.cc-training-grid{grid-template-columns:1fr}.cc-synth-stats{grid-template-columns:1fr}}@media(max-width:720px){.cc-agenda-event{grid-template-columns:1fr;gap:7px}.cc-agenda-date{border:0;border-bottom:1px solid #5c484a;padding:0 0 7px}.cc-training-form{grid-template-columns:1fr}.cc-training-form label.cc-wide{grid-column:auto}.cc-training-dialog{width:auto}}",
    ".cc-subtopic-list{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 11px}.cc-subtopic-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;border-radius:999px;padding:4px 7px;border:1px solid #504246;background:#2a2325;color:#e9dfe1;font:inherit;font-size:9px;line-height:1.25;text-align:left;cursor:pointer}.cc-subtopic-chip span{min-width:0}.cc-subtopic-chip small{flex:none;border-radius:999px;padding:1px 5px;background:#332a2c;color:inherit;font-size:9px;font-weight:800}.cc-subtopic-chip[data-priority=high]{border-color:#8a4e55;background:#382326;color:#f2b7bd}.cc-subtopic-chip[data-priority=medium]{border-color:#8a683e;background:#342a1e;color:#edca8e}.cc-subtopic-chip[data-priority=low]{border-color:#386b53;background:#203129;color:#a8ddbd}.cc-agenda-focus-list{display:grid;gap:8px;margin:9px 0;padding:11px 12px;border:1px solid #493b3e;border-radius:11px;background:#292223}.cc-agenda-focus-list>strong{color:#efced4;font-size:11px}.cc-agenda-focus-row{display:grid;grid-template-columns:minmax(110px,.65fr) minmax(0,1.35fr);gap:8px;align-items:start}.cc-agenda-focus-row>b{color:#f3e8e9;font-size:11px}.cc-agenda-focus-row>span{display:flex;flex-wrap:wrap;gap:5px}.cc-focus-chip{display:inline-flex;border-radius:999px;padding:4px 7px;background:#332a2c;color:#d5c5c8;font-size:10px;line-height:1.3}.cc-focus-chip[data-priority=high]{background:#382326;color:#f2b7bd}.cc-focus-chip[data-priority=medium]{background:#342a1e;color:#edca8e}.cc-focus-chip[data-priority=low]{background:#203129;color:#a8ddbd}.cc-subcategory-details{display:grid;gap:10px;margin-top:12px}.cc-subcategory-detail{padding:10px;border:1px solid #493b3e;border-left:3px solid #4aa678;border-radius:10px;background:#282122}.cc-subcategory-detail[data-priority=medium]{border-left-color:#dfa04e}.cc-subcategory-detail[data-priority=high]{border-left-color:#c85c68}.cc-subcategory-head{display:flex;justify-content:space-between;gap:10px;align-items:start;margin-bottom:8px}.cc-subcategory-head>b{color:#f2e7e8;font-size:12px}.cc-subcategory-head>small{color:#bcadaf;white-space:nowrap;font-size:10px}.cc-session-objective{margin:10px 0;padding:10px 12px;border:1px solid #493b3e;border-radius:10px;background:#292223}.cc-session-objective>b{color:#efced4;font-size:11px}.cc-session-objective p{margin:5px 0 0;color:#e2d4d6;white-space:pre-line}.cc-agenda-focus-preview{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin-top:4px;color:#d3c2c5;font-size:10px;line-height:1.35}.cc-training-form .cc-agenda-focus-list{grid-column:1/-1}@media(max-width:600px){.cc-agenda-focus-row{grid-template-columns:1fr;gap:4px}.cc-subcategory-head{flex-direction:column;gap:3px}}",
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
    (data.qualityHistory || []).forEach((x,i) => { if (!activeNames.has(x.employee) || String(x.category||"").trim().toLocaleLowerCase("fr")==="pas besoin de formation") return; const note=String(x.notes||"").trim();result.push({id:"quality:"+(x.id == null ? i : x.id),source:"Écoute qualité",date:x.date||"",employee:x.employee,employeeId:personIdByName(x.employee),topic:String(x.category||note.split(/[.!?\n]/)[0]||"Observation d’écoute").trim().slice(0,100),text:note}); });
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
  let archiveInitPromise = null;
  function observationArchive() { return Array.isArray(state().trainingObservationArchive) ? state().trainingObservationArchive.filter((x) => x && typeof x === "object") : []; }
  function activeObservations() {
    if (state().trainingObservationArchiveInitialized !== true) return [];
    const archived = new Set(observationArchive().map((x) => String(x.observationId || x.id || "")));
    return observations().filter((x) => !archived.has(String(x.id)));
  }
  function ensureObservationArchiveBaseline() {
    if (typeof window.crmCloudIsReady !== "function" || !window.crmCloudIsReady() || state().trainingObservationArchiveInitialized === true || archiveInitPromise) return;
    archiveInitPromise = (async () => {
      const byId = new Map(observationArchive().map((x) => [String(x.observationId || x.id), x]));
      const archivedAt = new Date().toISOString();
      observations().forEach((observation) => {
        if (!byId.has(String(observation.id))) byId.set(String(observation.id), { id:String(observation.id), observationId:String(observation.id), observation, reason:"baseline", archivedAt });
      });
      persist("trainingObservationArchive", [...byId.values()]);
      await window.crmFlushState?.("trainingObservationArchive");
      persist("trainingObservationArchiveInitialized", true);
      await window.crmFlushState?.("trainingObservationArchiveInitialized");
    })().catch((error) => { console.error("Archivage initial des observations:", error); }).finally(() => { archiveInitPromise = null; renderThemes(); });
  }
  function archiveTrainingObservations(item) {
    const employeeIds = new Set((item.employeeIds || []).map(String));
    const focus = (item.focusObservations || []).filter((x) => employeeIds.has(String(x.employeeId)));
    if (!focus.length) return 0;
    const byId = new Map(observationArchive().map((x) => [String(x.observationId || x.id), x]));
    const archivedAt = new Date().toISOString();
    focus.forEach((observation) => {
      const id = String(observation.id || "");
      if (id && !byId.has(id)) byId.set(id, { id, observationId:id, observation, reason:"formation", trainingId:String(item.id), trainingTitle:String(item.title || "Formation"), archivedAt });
    });
    persist("trainingObservationArchive", [...byId.values()]);
    return focus.length;
  }
  function normalizeThemeText(value) { return String(value||"").toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim(); }
  function classifyObservation(item) {
    const topic=String(item.topic||"Observation").trim();
    if(item.source==="Écoute qualité") {
      const catalog=window.ccQualityObservationGroups||[];
      for(const entry of catalog) if(Array.isArray(entry[1])&&entry[1].includes(topic)) return {theme:entry[0],problem:topic};
      const legacy={
        "respect du script":"Trame LPP et proposition",
        "argumentation":"Traitement des objections",
        "ecoute active":"Écoute et relation client",
        "qualification":"Prise de rendez-vous",
        "procedures":"Saisie dans Brokerlink"
      };
      const normalized=normalizeThemeText(topic);
      return {theme:normalized==="autre"?"Autre":(legacy[normalized]||"Autre"),problem:topic};
    }
    if(item.source==="Coaching") return {theme:"Coaching",problem:topic};
    return {theme:"Compte rendu",problem:topic};
  }
  function priorityForCount(count) { return count>=6?"high":count>=3?"medium":"low"; }
  function themeGroups() {
    const grouped=new Map(),catalog=window.ccQualityObservationGroups||[],currentObservations=activeObservations();
    currentObservations.forEach((item)=>{
      const classification=classifyObservation(item),key=normalizeThemeText(classification.theme)||"observation";
      if(!grouped.has(key)) grouped.set(key,{id:"theme-"+hash(key),title:classification.theme,details:"",suggested:true,priority:"low",items:[],employeeIds:[],subcategories:[],_subcategories:new Map()});
      const group=grouped.get(key),subKey=normalizeThemeText(classification.problem)||"observation";
      group.items.push({...item,parentTheme:classification.theme,problem:classification.problem});
      if(item.employeeId&&!group.employeeIds.includes(String(item.employeeId)))group.employeeIds.push(String(item.employeeId));
      if(!group._subcategories.has(subKey))group._subcategories.set(subKey,{title:classification.problem,items:[],employeeIds:[]});
      const sub=group._subcategories.get(subKey);sub.items.push(item);
      if(item.employeeId&&!sub.employeeIds.includes(String(item.employeeId)))sub.employeeIds.push(String(item.employeeId));
    });
    const categoryOrder=new Map(catalog.flatMap(([,labels])=>labels.map((label,index)=>[normalizeThemeText(label),index])));
    grouped.forEach((group)=>{
      group.priority=priorityForCount(group.items.length);
      group.subcategories=[...group._subcategories.values()].map((sub)=>({...sub,priority:priorityForCount(sub.items.length)}))
        .sort((a,b)=>(categoryOrder.get(normalizeThemeText(a.title))??999)-(categoryOrder.get(normalizeThemeText(b.title))??999)||b.items.length-a.items.length||a.title.localeCompare(b.title,"fr"));
      delete group._subcategories;
    });
    const saved=state().trainingThemes||[];
    const custom=saved.map((x)=>({id:String(x.id),title:String(x.title||"Thème de formation"),details:String(x.details||""),priority:x.priority||"medium",suggested:false,items:currentObservations.filter(o=>(x.observationIds||[]).includes(o.id)),employeeIds:(x.employeeIds||[]).map(String),subcategories:[]}));
    const order=[...catalog.map(([title])=>title),"Coaching","Compte rendu","Autre"];
    const suggested=[...grouped.values()].sort((a,b)=>{
      const ai=order.indexOf(a.title),bi=order.indexOf(b.title);
      if(ai<0&&bi<0)return b.items.length-a.items.length||a.title.localeCompare(b.title,"fr");
      if(ai<0)return 1;if(bi<0)return -1;return ai-bi;
    });
    return [...suggested,...custom];
  }
  function focusParticipants(group,employeeIds) {
    return employeeIds.map((id)=>{
      const employee=personById(id),name=employee?personName(employee):"Collaborateur";
      let problems=(group.subcategories||[]).filter((sub)=>sub.employeeIds.map(String).includes(String(id))).map((sub)=>({title:sub.title,priority:sub.priority||"medium"}));
      if(!problems.length)problems=[...new Set((group.items||[]).filter((item)=>String(item.employeeId)===String(id)).map((item)=>item.problem||item.topic).filter(Boolean))].map((title)=>({title,priority:"medium"}));
      if(!problems.length&&group.title)problems=[{title:group.title,priority:group.priority||"medium"}];
      return {employeeId:String(id),employeeName:name,problems};
    });
  }
  function focusSummary(item) {
    return (item.focusByEmployee||[]).map((entry)=>entry.employeeName+" : "+(entry.problems||[]).map((problem)=>typeof problem==="string"?problem:problem.title).filter(Boolean).join(", ")).filter(Boolean).join(" · ");
  }
  function focusMarkup(entries,title) {
    if(!entries?.length)return "";
    return '<div class="cc-agenda-focus-list"><strong>'+esc(title||"Problématiques ciblées")+'</strong>'+entries.map((entry)=>'<div class="cc-agenda-focus-row"><b>'+esc(entry.employeeName||"Collaborateur")+'</b><span>'+((entry.problems||[]).map((problem)=>{const item=typeof problem==="string"?{title:problem,priority:"medium"}:problem;return '<span class="cc-focus-chip" data-priority="'+esc(item.priority||"medium")+'">'+esc(item.title||"Problématique")+'</span>';}).join(""))+'</span></div>').join("")+'</div>';
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
  function subcategoryChips(group) {
    if(!group.suggested||!group.subcategories?.length)return "";
    return '<div class="cc-subtopic-list" aria-label="Problématiques de ce thème">'+group.subcategories.map((sub)=>'<button type="button" class="cc-subtopic-chip" data-priority="'+esc(sub.priority)+'" data-theme-detail="'+esc(group.id)+'" title="Voir les observations liées à cette problématique"><span>'+esc(sub.title)+'</span><small>'+sub.items.length+'</small></button>').join("")+'</div>';
  }
  function themeScheduleForm(group) {
    const ids=selectedByTheme[group.id]||[];
    const names=ids.map(personById).filter(Boolean).map(personName);
    const focus=focusParticipants(group,ids);
    return '<form class="cc-training-form" data-theme-schedule="'+esc(group.id)+'"><p class="cc-wide"><b>Participants :</b> '+esc(names.join(", "))+'</p>'+focusMarkup(focus,"Problématiques déjà observées par participant")+'<label>Date<input type="date" name="date" value="'+today()+'" required></label><label>Heure<input type="time" name="time"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="60"></label><label>Lieu / lien<input name="location" maxlength="180" placeholder="Salle ou lien de réunion"></label><label class="cc-wide">Objectif / préparation<textarea name="details" maxlength="1000" placeholder="Objectif de la séance et exercices à prévoir">'+esc(group.details||"")+'</textarea></label><button class="btn primary" type="submit">Ajouter à l’agenda du directeur</button><button class="btn" type="button" data-training-dialog-close>Annuler</button></form>';
  }
  function pastObservationsMarkup() {
    const currentById=new Map(observations().map((x)=>[String(x.id),x]));
    const records = observationArchive().slice().sort((a,b) => String((b.observation||currentById.get(String(b.observationId||b.id))||{}).date||"").localeCompare(String((a.observation||currentById.get(String(a.observationId||a.id))||{}).date||"")));
    if (!records.length) return "";
    const rows = records.map((entry) => {
      const x = entry.observation || currentById.get(String(entry.observationId || entry.id)) || {}, employee = personById(x.employeeId);
      const label = entry.reason === "formation" ? "Traité en formation · " + String(entry.trainingTitle || "Formation") : "Avant la remise à zéro";
      return '<article class="cc-past-observation"><small>' + esc(x.source || "Observation") + ' · ' + esc(employee ? personName(employee) : x.employee || "Téléphoniste") + ' · ' + esc(dateLabel(x.date)) + '</small><b>' + esc(x.topic || "Observation") + '</b>' + (x.text ? '<div>' + esc(x.text) + '</div>' : "") + '<em>' + esc(label) + '</em></article>';
    }).join("");
    return '<details class="cc-past-observations"><summary><span>Observations passées</span><b>' + records.length + '</b></summary><p>Les écoutes, coachings et comptes rendus originaux restent dans leurs historiques. Ces points ne comptent plus parmi les problématiques actives.</p><div class="cc-past-observations-list">' + rows + '</div></details>';
  }
  function renderThemes() {
    const host=$("ccThemeGroups");if(!host)return;
    ensureObservationArchiveBaseline();
    const groups=themeGroups();
    const stats=$("ccSynthesisStats"),uniquePeople=new Set(groups.flatMap((g)=>g.employeeIds||[])),prepared=(state().trainingAgenda||[]).filter((x)=>x.status!=="completed"&&x.status!=="Terminée");
    if(stats)stats.innerHTML='<div class="cc-synth-stat"><div><small>Thèmes à travailler</small><strong>'+groups.length+'</strong></div><em>'+groups.filter((x)=>x.priority==="high").length+' prioritaires</em></div><div class="cc-synth-stat"><div><small>Téléphonistes concernés</small><strong>'+uniquePeople.size+'</strong></div><em>sur les observations</em></div><div class="cc-synth-stat"><div><small>Groupes préparés</small><strong>'+prepared.length+'</strong></div><em>à l’agenda du directeur</em></div>';
    const count=$("ccPreparedCount");if(count)count.textContent=prepared.length+" groupe(s)";
    const preparedHost=$("ccPreparedTrainingList");if(preparedHost)preparedHost.innerHTML=prepared.length?'<div class="cc-prepared-list">'+prepared.map(agendaCard).join("")+'</div>':'<div class="cc-prepared-empty">Aucune formation préparée pour le moment. Sélectionne un thème, choisis les téléphonistes concernés, puis clique sur « Former le groupe ».</div>';
    if(!groups.length){host.innerHTML='<div class="cc-prepared-empty">Aucune problématique active. Les nouvelles écoutes apparaîtront ici dès qu’elles signaleront un point à travailler.</div>'+pastObservationsMarkup();return;}
    host.innerHTML=groups.map((g)=>{const selected=(selectedByTheme[g.id]||[]).length,label=g.priority==="high"?"Prioritaire":g.priority==="medium"?"À travailler":"Suivi léger",scope=g.suggested?g.employeeIds.length+" téléphoniste(s) concerné(s)":"Sélection libre des téléphonistes",summary=g.suggested?(g.subcategories.length+" problématique(s) regroupée(s) dans ce thème · "+g.items.length+" observation(s)."):(g.details||"Clique sur les noms pour composer un groupe ciblé.");return '<article class="cc-training-card" data-priority="'+esc(g.priority||"medium")+'"><div class="theme-head"><div><span class="cc-topic-origin">'+(g.suggested?g.items.length+' observation(s)':'Thème personnalisé')+' · '+scope+'</span><h3><button type="button" class="cc-theme-title" data-theme-detail="'+esc(g.id)+'">'+esc(g.title)+'</button></h3></div><span class="cc-theme-badge">'+label+'</span></div><p>'+esc(summary)+'</p>'+subcategoryChips(g)+'<small class="hint">Clique sur les noms pour choisir les participants</small>'+chips(g)+'<div class="cc-theme-foot"><span class="cc-theme-selection">'+selected+' sélectionné(s) sur '+(g.suggested?g.employeeIds.length:people().length)+'</span><button type="button" class="btn" data-theme-detail="'+esc(g.id)+'">Voir le détail</button><button class="btn primary" type="button" data-theme-plan="'+esc(g.id)+'">'+(selected?"Former le groupe ("+selected+")":"Choisir les téléphonistes")+'</button></div></article>';}).join("")+pastObservationsMarkup();
  }
  function agendaItems() {
    const trainings=(state().trainingAgenda||[]).map((item)=>({...item,_agendaType:"training"}));
    const meetings=(state().meetings||[]).filter((item)=>item&&item.id!=null).map((item)=>({...item,id:"meeting:"+String(item.id),_sourceId:item.id,_agendaType:"meeting",title:item.title||item.kind||"Réunion"}));
    return [...trainings,...meetings].sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.time||"").localeCompare(String(b.time||"")));
  }
  function isDone(item) { return ["completed","terminée","terminee","done"].includes(String(item.status||"").toLocaleLowerCase("fr")); }
  function isNotDone(item) { return ["not_done","not done","non faite","non réalisée","non realisee","missed"].includes(String(item.status||"").toLocaleLowerCase("fr")); }
  function isResolved(item) { return isDone(item) || isNotDone(item); }
  function agendaCard(item) {
    const done=isDone(item),notDone=isNotDone(item),isMeeting=item._agendaType==="meeting";
    const names=(item.employeeIds||[]).map((id)=>personById(id)).filter(Boolean).map(personName);
    const attendeeLabel=isMeeting?(item.employee||"Équipe"):names.length?names.join(", "):(item.employeeNames||[]).join(", ")||"Équipe";
    const status=done?(isMeeting?"Réalisée":"Faite"):notDone?"Non faite":item.date<today()?"À confirmer":isMeeting?"Réunion planifiée":"Planifiée";
    const focus=focusSummary(item);
    return '<button type="button" class="cc-agenda-event '+(isMeeting?"cc-agenda-meeting":"")+'" data-agenda-detail="'+esc(item.id)+'"><span class="cc-agenda-date">'+esc(dateLabel(item.date))+(item.time?'<br><small>'+esc(timeLabel(item.time))+'</small>':"")+'</span><span><small class="cc-topic-origin">'+(isMeeting?"Réunion":"Formation")+'</small><h3>'+esc(item.title||(isMeeting?"Réunion":"Formation"))+'</h3><span class="cc-agenda-meta">'+esc(attendeeLabel)+(item.location?" · "+esc(item.location):"")+'</span>'+(focus?'<small class="cc-agenda-focus-preview" title="'+esc(focus)+'">'+esc(focus)+'</small>':"")+'</span><span class="cc-agenda-status '+(done?"done":notDone?"not-done":"")+'">'+esc(status)+'</span></button>';
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
    const meeting=item._agendaType==="meeting",done=isDone(item),notDone=isNotDone(item),name=meeting?(item.employee||"Équipe"):((item.employeeIds||[]).map(personById).filter(Boolean).map(personName).join(", ")||(item.employeeNames||[]).join(", ")||"Équipe"),focus=focusSummary(item);
    return '<button type="button" class="cc-week-event '+(meeting?"meeting ":"")+(done?"done ":notDone?"not-done":"")+'" data-agenda-detail="'+esc(item.id)+'"><span class="cc-week-event-time">'+esc(item.time?timeLabel(item.time):"Horaire à définir")+'</span><strong>'+esc(item.title||(meeting?"Réunion":"Formation"))+'</strong><small>'+esc(name)+(notDone?" · Non faite":done?" · Faite":"")+'</small>'+(focus?'<small class="cc-agenda-focus-preview" title="'+esc(focus)+'">'+esc(focus)+'</small>':"")+'</button>';
  }
  function agendaUpcomingCard(item) {
    const meeting=item._agendaType==="meeting",date=new Date(String(item.date||"")+"T12:00:00"),name=meeting?(item.employee||"Équipe"):((item.employeeIds||[]).map(personById).filter(Boolean).map(personName).join(", ")||(item.employeeNames||[]).join(", ")||"Équipe"),focus=focusSummary(item);
    return '<button type="button" class="cc-agenda-upcoming" data-agenda-detail="'+esc(item.id)+'"><span class="cc-agenda-upcoming-date">'+esc(new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(date))+'<strong>'+esc(date.getDate())+'</strong></span><span><span class="cc-agenda-upcoming-title">'+esc(item.title||(meeting?"Réunion":"Formation"))+'</span><span class="cc-agenda-upcoming-meta">'+esc(item.time?timeLabel(item.time)+" · ":"")+esc(name)+'</span>'+(focus?'<small class="cc-agenda-focus-preview" title="'+esc(focus)+'">'+esc(focus)+'</small>':"")+'</span></button>';
  }
  function renderTrainingHistory() {
    const records=(state().trainingAgenda||[])
      .filter((item)=>item&&item.id!=null&&(String(item.date||"").slice(0,10)<=today()||isResolved(item)))
      .slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||String(b.time||"").localeCompare(String(a.time||"")));
    const body=records.map((item)=>{
      const names=(item.employeeIds||[]).map(personById).filter(Boolean).map(personName);
      const attendees=names.join(", ")||(item.employeeNames||[]).join(", ")||"Équipe";
      const done=isDone(item),notDone=isNotDone(item),label=done?"Faite":notDone?"Non faite":"À confirmer";
      const tone=done?"done":notDone?"not-done":"pending";
      const note=String(item.completionNotes||"").trim();
      return '<button type="button" class="cc-training-history-row" data-agenda-detail="'+esc(item.id)+'"><span class="cc-agenda-date">'+esc(dateLabel(item.date))+(item.time?'<small>'+esc(timeLabel(item.time))+'</small>':"")+'</span><span class="cc-training-history-detail"><strong>'+esc(item.title||"Formation")+'</strong><small>'+esc(attendees)+'</small>'+(note?'<em>'+esc(note)+'</em>':"")+'</span><span class="cc-result-pill '+tone+'">'+label+'</span></button>';
    }).join("");
    return '<section class="cc-training-history"><div class="cc-training-history-head"><div><h3>Historique des formations</h3><p>Séances passées, avec leur résultat. Clique sur une séance pour consulter ou mettre à jour son statut.</p></div><span class="cc-agenda-count">'+records.length+' séance(s)</span></div>'+(records.length?'<div class="cc-training-history-list">'+body+'</div>':'<div class="cc-agenda-empty-week">Aucune formation passée pour le moment.</div>')+'</section>';
  }
  function renderAgenda() {
    let host=$("ccAgendaList");if(!host){mountNavigation();host=$("ccAgendaList");}if(!host)return;
    if($("screen-formationAgenda")?.classList.contains("active")&&$("crumb"))$("crumb").textContent="Formations & agenda";
    const all=agendaItems(),done=all.filter(isDone),notDone=all.filter(isNotDone),pending=all.filter((x)=>!isResolved(x));
    const todays=pending.filter((x)=>String(x.date||"").slice(0,10)===today()).length;
    const summary=$("ccAgendaSummary");if(summary)summary.innerHTML='<span class="cc-agenda-count">'+todays+' aujourd’hui</span><span class="cc-agenda-count">'+pending.length+' planifiée(s)</span><span class="cc-agenda-count">'+done.length+' réalisée(s)</span><span class="cc-agenda-count">'+notDone.length+' non faite(s)</span>';
    const form=$("ccAgendaCreate");if(form)form.innerHTML=newAgendaForm();
    const range=agendaWeekBounds(),weekDays=Array.from({length:5},(_,i)=>{const dateObj=new Date(range.start+"T12:00:00");dateObj.setDate(dateObj.getDate()+i);const date=isoDate(dateObj),events=all.filter((x)=>String(x.date||"").slice(0,10)===date).sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));return '<div class="cc-agenda-week-day"><div class="cc-agenda-week-dayhead"><strong>'+esc(new Intl.DateTimeFormat("fr-FR",{weekday:"long"}).format(dateObj))+'</strong>'+esc(new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short"}).format(dateObj))+'</div><div class="cc-agenda-week-events">'+(events.length?events.map(agendaWeekCard).join(""):'<div class="cc-week-empty">Aucune séance</div>')+'</div></div>';}).join("");
    const upcoming=pending.slice(0,5);
    host.innerHTML='<div class="cc-agenda-week-layout"><div class="cc-agenda-week-main"><div class="cc-agenda-week-toolbar"><div><strong>Agenda des formations</strong><small>Du '+esc(dateLabel(range.start))+' au '+esc(dateLabel(range.end))+'</small></div><div class="cc-agenda-week-controls"><button type="button" data-agenda-week-nav="-1" aria-label="Semaine précédente">‹</button><button type="button" data-agenda-week-nav="0">Cette semaine</button><button type="button" data-agenda-week-nav="1" aria-label="Semaine suivante">›</button></div></div><div class="cc-agenda-week-grid-wrap"><div class="cc-agenda-week-grid">'+weekDays+'</div></div></div><aside class="cc-agenda-side"><h3>Prochaines séances</h3><p>Les formations et réunions planifiées par les comptes autorisés apparaissent ici.</p><div class="cc-agenda-upcoming-list">'+(upcoming.length?upcoming.map(agendaUpcomingCard).join(""):'<div class="cc-agenda-empty-week">Aucune séance planifiée pour le moment.</div>')+'</div></aside></div>'+renderTrainingHistory();
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
    const done=isDone(item),notDone=isNotDone(item),resolved=done||notDone,isMeeting=item._agendaType==="meeting";
    if(isMeeting){
      const canEdit=manager()&&!done;
      const body='<p><b>Date :</b> '+esc(dateLabel(item.date))+(item.time?' · '+esc(timeLabel(item.time)):"")+'</p><p><b>Personne / équipe :</b> '+esc(item.employee||"Équipe")+'</p>'+(item.summary?'<div class="cc-observation">'+esc(item.summary)+'</div>':"")+'<p><small>Planifiée par '+esc(item.owner||"l’équipe")+'</small></p>'+(canEdit?'<form class="cc-training-form" data-meeting-edit="'+esc(item._sourceId)+'"><label>Sujet de la réunion<input name="title" maxlength="180" required value="'+esc(item.title||item.kind||"Réunion")+'"></label><label>Date<input type="date" name="date" required value="'+esc(String(item.date||"").slice(0,10))+'"></label><label>Heure<input type="time" name="time" value="'+esc(String(item.time||"").slice(0,5))+'"></label><label>Personne / équipe concernée<input name="employee" maxlength="180" value="'+esc(item.employee||"Équipe")+'"></label><label class="cc-wide">Points à traiter<textarea name="summary" maxlength="1000">'+esc(item.summary||"")+'</textarea></label><button class="btn primary" type="submit">Enregistrer les modifications</button><button class="btn" type="button" data-meeting-delete="'+esc(item._sourceId)+'">Supprimer la réunion</button></form>':"");
      openDialog(item.title||"Réunion",body);return;
    }
    const names=(item.employeeIds||[]).map(personById).filter(Boolean).map(personName),focus=focusMarkup(item.focusByEmployee,"Problématiques ciblées par participant");
    const resultDate=done?(item.completedOn||item.completedAt):(notDone?(item.notCompletedOn||item.notCompletedAt):"");
    const resultLabel=done?"Formation faite":notDone?"Formation non faite":"À confirmer";
    const resultClass=done?"done":notDone?"not-done":"pending";
    const resultInfo=resolved?'<div class="cc-observation"><small>'+esc(resultLabel)+' le '+esc(dateLabel(resultDate))+(item.resultRecordedBy?' · '+esc(item.resultRecordedBy):"")+'</small>'+esc(item.completionNotes||(done?"Formation confirmée.":"Aucun motif indiqué."))+'</div>':"";
    const resultForm=mayComplete()?'<form class="cc-training-form" data-training-result="'+esc(item.id)+'"><label class="cc-wide">'+(resolved?"Compte rendu / motif":"Compte rendu / motif (facultatif)")+'<textarea name="notes" maxlength="1200" placeholder="Résumé de la séance ou raison si elle n’a pas eu lieu">'+esc(item.completionNotes||"")+'</textarea></label><div class="cc-training-result-actions cc-wide"><button class="btn primary" type="submit" name="outcome" value="completed">'+(done?"Confirmer comme faite":"Marquer comme faite")+'</button><button class="btn danger" type="submit" name="outcome" value="not_done">'+(notDone?"Confirmer comme non faite":"Marquer comme non faite")+'</button></div></form>':"";
    const editActions=manager()&&!resolved?'<div class="cc-agenda-actions"><button class="btn" type="button" data-training-edit="'+esc(item.id)+'">Modifier</button><button class="btn danger" type="button" data-training-delete="'+esc(item.id)+'">Supprimer</button></div>':"";
    const body='<p><b>Date :</b> '+esc(dateLabel(item.date))+(item.time?' · '+esc(timeLabel(item.time)):"")+'</p><p><b>Participants :</b> '+esc(names.join(", ")||(item.employeeNames||[]).join(", ")||"Non précisés")+'</p>'+(item.duration?'<p><b>Durée :</b> '+esc(item.duration)+' minutes</p>':"")+(item.location?'<p><b>Lieu :</b> '+esc(item.location)+'</p>':"")+focus+(item.details?'<div class="cc-session-objective"><b>Objectif / préparation</b><p>'+esc(item.details)+'</p></div>':"")+'<div class="cc-training-result-current"><b>Statut : <span class="cc-result-pill '+resultClass+'">'+esc(resultLabel)+'</span></b></div>'+resultInfo+resultForm+editActions;
    openDialog(item.title||"Formation",body);
  }
  function trainingEditForm(item) {
    const chosen=new Set((item.employeeIds||[]).map(String)),group=item.themeId?themeGroups().find((x)=>String(x.id)===String(item.themeId)):null;
    const focus=group?focusParticipants(group,[...chosen]):(item.focusByEmployee||[]).filter((x)=>chosen.has(String(x.employeeId)));
    const participants=people().map((e)=>'<label class="cc-person-chip"><input type="checkbox" data-training-edit-person value="'+esc(String(e.id))+'" '+(chosen.has(String(e.id))?"checked":"")+'> '+esc(personName(e))+'</label>').join("");
    return '<form class="cc-training-form" data-training-update="'+esc(item.id)+'"><label>Thème<input name="title" maxlength="120" required value="'+esc(item.title||"")+'"></label><label>Date<input type="date" name="date" required value="'+esc(String(item.date||"").slice(0,10))+'"></label><label>Heure<input type="time" name="time" value="'+esc(String(item.time||"").slice(0,5))+'"></label><label>Durée (minutes)<input type="number" name="duration" min="15" max="480" value="'+esc(item.duration||60)+'"></label><label>Lieu / lien<input name="location" maxlength="180" value="'+esc(item.location||"")+'"></label>'+focusMarkup(focus,"Problématiques concernées")+'<label class="cc-wide">Objectif / préparation<textarea name="details" maxlength="1000">'+esc(item.details||"")+'</textarea></label><div class="cc-agenda-person-list">'+participants+'</div><button class="btn primary" type="submit">Enregistrer les modifications</button><button class="btn" type="button" data-training-dialog-close>Annuler</button></form>';
  }
  function saveTrainingEdit(form) {
    if(!manager())return;
    const fd=new FormData(form),id=String(form.dataset.trainingUpdate||""),agenda=state().trainingAgenda||[],item=agenda.find((x)=>String(x.id)===id);
    if(!item||isResolved(item))return;
    const title=String(fd.get("title")||"").trim(),date=String(fd.get("date")||"").slice(0,10),employeeIds=[...form.querySelectorAll("[data-training-edit-person]:checked")].map((x)=>String(x.value));
    if(!title||!date||!employeeIds.length){window.crmToast?.("Renseigne le thème, la date et au moins un participant.");return;}
    const focusGroup=item.themeId?themeGroups().find((x)=>String(x.id)===String(item.themeId)):null,focusByEmployee=focusGroup?focusParticipants(focusGroup,employeeIds):(item.focusByEmployee||[]).filter((x)=>employeeIds.includes(String(x.employeeId))),focusObservations=focusGroup?focusGroup.items.filter((x)=>employeeIds.includes(String(x.employeeId))).map((x)=>({...x})):(item.focusObservations||[]).filter((x)=>employeeIds.includes(String(x.employeeId)));
    Object.assign(item,{title,date,time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||"").trim(),details:String(fd.get("details")||"").trim(),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),focusByEmployee,focusObservations,updatedAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);closeDialog();renderAgenda();window.crmToast?.("Formation mise à jour dans l’agenda partagé.");
  }
  function deleteTraining(id) {
    if(!manager())return;
    const agenda=state().trainingAgenda||[],index=agenda.findIndex((x)=>String(x.id)===String(id));
    if(index<0||isResolved(agenda[index]))return;
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
    const sections=(group.subcategories||[]).map((sub)=>'<section class="cc-subcategory-detail" data-priority="'+esc(sub.priority)+'"><div class="cc-subcategory-head"><b>'+esc(sub.title)+'</b><small>'+sub.items.length+' observation(s) · '+sub.employeeIds.length+' téléphoniste(s)</small></div><div class="cc-observation-list">'+sub.items.map((x)=>{const person=personById(x.employeeId);return '<div class="cc-observation"><small>'+esc(x.source)+' · '+esc(person?personName(person):x.employee)+' · '+esc(dateLabel(x.date))+'</small>'+esc(x.text||"Aucun détail enregistré.")+'</div>';}).join("")+'</div></section>').join("");
    const fallback=group.items.map((x)=>{const person=personById(x.employeeId);return '<div class="cc-observation"><small>'+esc(x.source)+' · '+esc(person?personName(person):x.employee)+' · '+esc(dateLabel(x.date))+'</small>'+esc(x.text||"Aucun détail enregistré.")+'</div>';}).join("");
    openDialog(group.title,'<p>'+esc(group.details||"Les sous-catégories regroupent les points précis observés sous ce thème de formation.")+'</p><p><b>'+group.items.length+'</b> observation(s) · <b>'+group.subcategories.length+'</b> problématique(s) précise(s).</p><div class="cc-subcategory-details">'+(sections||'<div class="cc-observation-list">'+(fallback||'<div class="cc-agenda-empty">Aucune observation liée. Le thème a été créé manuellement.</div>')+'</div>')+'</div>');
  }
  function saveTrainingHistory(item, notes) {
    const rows=state().trainingHistory||[];
    (item.employeeIds||[]).map(String).forEach((employeeId)=>{
      const employee=personById(employeeId);if(!employee)return;
      const existing=rows.find((x)=>String(x.eventId)===String(item.id)&&String(x.employeeId)===employeeId);
      const focus=(item.focusByEmployee||[]).find((x)=>String(x.employeeId)===employeeId)||null;
      const record={id:existing?.id||("training-"+String(item.id)+"-"+employeeId),eventId:String(item.id),employeeId,employee:personName(employee),date:item.completedOn||today(),topic:item.title||"Formation",title:item.title||"Formation",details:item.details||"",focusByEmployee:focus,notes:notes||"",status:"completed",trainer:item.trainer||currentUserName(),createdAt:item.completedAt||new Date().toISOString()};
      if(existing)Object.assign(existing,record);else rows.push(record);
    });
    persist("trainingHistory",rows);
  }
  function refreshProfile(id, tab) {
    const content=$("profileContent");if(!content)return;
    const employee=people().find((e)=>String(e.id)===String(id));if(!employee)return;
    const records=(state().trainingHistory||[]).filter((x)=>String(x.employeeId)===String(employee.id)||x.employee===personName(employee)).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
    let section=$("ccProfileTrainingHistory");
    if(!section){section=document.createElement("section");section.id="ccProfileTrainingHistory";section.className="panel cc-history-panel";const summary=$("qualitySummaryResult");(summary||content).insertAdjacentElement("afterend",section);}
    section.innerHTML='<div class="panel-head"><div><div class="panel-title">Historique des formations</div><div class="panel-desc">Les formations terminées sont conservées ici avec les coachings de ce collaborateur.</div></div><span class="pill">'+records.length+' séance(s)</span></div>'+(records.length?'<div class="cc-history-list" style="padding:0 16px 16px">'+records.map((x)=>{const focus=(x.focusByEmployee?.problems||[]).map((p)=>typeof p==="string"?p:p.title).filter(Boolean);return '<article class="cc-history-item"><b>'+esc(x.title||x.topic||"Formation")+'</b><div class="cc-agenda-meta">'+esc(dateLabel(x.date))+' · '+esc(x.trainer||"Équipe")+'</div>'+(focus.length?'<p><b>Points travaillés :</b> '+esc(focus.join(", "))+'</p>':"")+(x.details?'<p>'+esc(x.details)+'</p>':"")+(x.notes?'<p><b>Compte rendu :</b> '+esc(x.notes)+'</p>':"")+'</article>';}).join("")+'</div>':'<div class="profile-note" style="margin:0 16px 16px">Aucune formation réalisée pour ce collaborateur.</div>');
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
    const agenda=state().trainingAgenda||[],focusByEmployee=focusParticipants(group,employeeIds),focusObservations=group.items.filter((item)=>employeeIds.includes(String(item.employeeId))).map((item)=>({...item}));
    agenda.push({id:"training-"+Date.now(),title:group.title,themeId:id,details:String(fd.get("details")||group.details||""),focusByEmployee,focusObservations,date:String(fd.get("date")),time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||""),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),status:"planned",createdBy:currentUserName(),createdAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);openedSchedule="";selectedByTheme[id]=[];closeDialog();renderThemes();renderAgenda();window.crmToast?.("Formation ajoutée à l’agenda partagé.");
  }
  function createAgenda(form) {
    const fd=new FormData(form),employeeIds=[...form.querySelectorAll("[data-agenda-person]:checked")].map((x)=>String(x.value));
    if(!String(fd.get("title")||"").trim()||!fd.get("date")||!employeeIds.length){window.crmToast?.("Renseigne le thème, la date et au moins un téléphoniste.");return;}
    const agenda=state().trainingAgenda||[];
    agenda.push({id:"training-"+Date.now(),title:String(fd.get("title")).trim(),details:String(fd.get("details")||""),date:String(fd.get("date")),time:String(fd.get("time")||""),duration:Number(fd.get("duration")||60),location:String(fd.get("location")||""),employeeIds,employeeNames:employeeIds.map(personById).filter(Boolean).map(personName),status:"planned",createdBy:currentUserName(),createdAt:new Date().toISOString()});
    persist("trainingAgenda",agenda);closeDialog();renderAgenda();window.crmToast?.("Formation ajoutée à l’agenda partagé.");
  }
  async function saveTrainingResult(form, outcome) {
    const item=eventById(form.dataset.trainingResult);if(!item||!mayComplete())return;
    if(!["completed","not_done"].includes(outcome))return;
    const notes=String(new FormData(form).get("notes")||"").trim(),now=new Date().toISOString(),user=currentUserName();
    const agenda=state().trainingAgenda||[],idx=agenda.findIndex((x)=>String(x.id)===String(item.id));if(idx<0)return;
    if(outcome==="completed"){
      item.status="completed";item.completedOn=today();item.completedAt=now;item.notCompletedOn="";item.notCompletedAt="";item.trainer=user;item.resultRecordedBy=user;item.completionNotes=notes;
      delete item.nonCompletionReason;
      const resolvedCount=archiveTrainingObservations(item);
      saveTrainingHistory(item,notes);
      agenda[idx]=item;persist("trainingAgenda",agenda);
      let synced=true;
      try { await Promise.all(["trainingAgenda","trainingHistory","trainingObservationArchive"].map((key)=>window.crmFlushState?.(key))); } catch(error) { synced=false;console.error("Synchronisation du résultat de formation:",error); }
      closeDialog();renderAgenda();renderThemes();window.crmRefreshTrainingHistoryProfile?.();
      window.crmToast?.(synced?(resolvedCount?"Formation marquée comme faite. Les observations ciblées sont archivées et l’historique est mis à jour.":"Formation marquée comme faite. L’historique des participants est à jour."):"Résultat enregistré, mais la synchronisation Supabase a échoué. Réessaie dans quelques instants.");
      return;
    }
    item.status="not_done";item.notCompletedOn=today();item.notCompletedAt=now;item.completedOn="";item.completedAt="";item.trainer=user;item.resultRecordedBy=user;item.completionNotes=notes;
    const archive=observationArchive().filter((entry)=>!(entry.reason==="formation"&&String(entry.trainingId)===String(item.id)));
    if(archive.length!==observationArchive().length)persist("trainingObservationArchive",archive);
    const history=(state().trainingHistory||[]).filter((entry)=>String(entry.eventId)!==String(item.id));
    persist("trainingHistory",history);
    agenda[idx]=item;persist("trainingAgenda",agenda);
    let synced=true;
    try { await Promise.all(["trainingAgenda","trainingHistory","trainingObservationArchive"].map((key)=>window.crmFlushState?.(key))); } catch(error) { synced=false;console.error("Synchronisation du résultat de formation:",error); }
    closeDialog();renderAgenda();renderThemes();window.crmRefreshTrainingHistoryProfile?.();
    window.crmToast?.(synced?"Formation marquée comme non faite.":"Résultat enregistré, mais la synchronisation Supabase a échoué. Réessaie dans quelques instants.");
  }

  function init() {
    addStyle();mountNavigation();wrapProfileRenderer();wrapSynthesisRenderer();ensurePermissionEditor();
    renderAgenda();renderThemes();
    window.addEventListener("cc:crm-cloud-ready",()=>{renderAgenda();renderThemes();});
    window.addEventListener("cc:synthesis-data-updated",renderThemes);
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
      const editTraining=e.target.closest("[data-training-edit]");if(editTraining){const item=eventById(editTraining.dataset.trainingEdit);if(item&&!isResolved(item)&&manager())openDialog("Modifier la formation",trainingEditForm(item));return;}
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
      const result=e.target.closest("[data-training-result]");if(result){e.preventDefault();saveTrainingResult(result,e.submitter?.value||"");}
    });
    window.setInterval(()=>{wrapSynthesisRenderer();wrapProfileRenderer();ensurePermissionEditor();},1000);
    window.crmRenderFormationAgenda=renderAgenda;
    window.crmRenderSynthesisThemes=renderThemes;
    window.crmRefreshTrainingHistoryProfile=()=>{if(lastProfileId&&lastProfileTab==="quality")window.renderProfile?.(lastProfileId,lastProfileTab);};
    window.crmFormationAgendaInit=init;
  }
  init();
})();

