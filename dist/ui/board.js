// CKanban - plain JS implementation with per-project notes
(function(){
  const STATUSES = ['links','backlog','inProgress','onHold','complete'];
  const STORAGE_KEY = 'ckanban.board.v1';
  const PROJECT_COLOR_PALETTE = [
    // Vibrant set
    '#2196F3','#03A9F4','#00BCD4','#009688',
    '#4CAF50','#8BC34A','#CDDC39','#FFC107',
    '#FF9800','#FF5722','#9C27B0','#673AB7',
    '#3F51B5','#E91E63','#795548','#607D8B',
    // Desaturated / pastel set
    '#AEC7D8','#A8D5BA','#D9E7A8','#F6D7A7',
    '#F2B8A0','#E7A9C4','#CDB5E8','#B3C5E8',
    '#B7D4F0','#B2E0E2','#B7E6D7','#D7E9F7',
    '#E4D9F7','#F3E5D8','#D9D9D9','#C8D1DA'
  ];
  const DEFAULT_PROJECT_COLOR = '#eceff3';

  // UI state for editing notes (kept outside board model so rerenders preserve drafts)
  const editingNotes = {}; // projectId -> { draft: string }
  const editingProjectName = {}; // projectId -> { draft: string }
  let timeModalCardId = null;
  let timeEntryEdit = null; // { cardId, date, draftDate, draftHours }

  function uuid(){
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function createEmptyBoard(){
    return { version:1, projects:[], cards:{}, bookmarks:[], lastModified:new Date().toISOString() };
  }

  function loadBoard(){
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([STORAGE_KEY], result => {
          resolve(result[STORAGE_KEY] || null);
        });
      } catch(e){ resolve(null); }
    });
  }

  let saveScheduled = null;
  function saveBoard(board){
    if(saveScheduled) clearTimeout(saveScheduled);
    saveScheduled = setTimeout(()=>{
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: board });
      } catch(e){ console.warn('Save failed', e); }
    }, 250);
  }

  const store = (function(){
    let board = createEmptyBoard();
    const listeners = [];
    function emit(){ listeners.forEach(l=>l(board)); }
    return {
      get: ()=> board,
      set: b=> { board = b; saveBoard(board); emit(); },
      update: mut => { const draft = JSON.parse(JSON.stringify(board)); mut(draft); draft.lastModified = new Date().toISOString(); board = draft; saveBoard(board); emit(); },
      subscribe: fn => { listeners.push(fn); return ()=>{ const i=listeners.indexOf(fn); if(i>-1) listeners.splice(i,1); }; }
    };
  })();

  function isDarkColor(hex){
    if(!hex || typeof hex !== 'string') return false;
    const h = hex.replace('#','');
    if(h.length!==6) return false;
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    const luminance = 0.299*r + 0.587*g + 0.114*b;
    return luminance < 140;
  }
  function applyProjectHeaderColor(header, color){
    const c = color || DEFAULT_PROJECT_COLOR;
    header.style.background = c;
    header.style.color = isDarkColor(c) ? '#fff' : '#1e293b';
  }
  function ensureProjectColor(p){ if(!p.color) p.color = DEFAULT_PROJECT_COLOR; }
  function ensureProjectNotes(p){
    if(!p.notes || typeof p.notes !== 'object'){
      p.notes = { text:'', updatedAt:null };
    } else {
      if(typeof p.notes.text !== 'string') p.notes.text='';
      if(!p.notes.updatedAt) p.notes.updatedAt=null;
    }
  }

  // New helper: ensure per-card status change timestamp
  function ensureCardStatus(card){
    if(card && !card.statusChangedAt){
      // Prefer updatedAt if present else createdAt
      card.statusChangedAt = card.updatedAt || card.createdAt || new Date().toISOString();
    }
  }
  function formatStatusTimestamp(iso){
    if(!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2,'0');
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function ensureCardTimeEntries(card){
    if(!card) return;
    if(card.type === 'link'){
      if(card.timeEntries) delete card.timeEntries;
      return;
    }
    if(!card.timeEntries || typeof card.timeEntries !== 'object' || Array.isArray(card.timeEntries)){
      card.timeEntries = {};
      return;
    }
    Object.keys(card.timeEntries).forEach(date => {
      const val = Number(card.timeEntries[date]);
      if(!Number.isFinite(val) || val <= 0){ delete card.timeEntries[date]; }
      else { card.timeEntries[date] = val; }
    });
  }
  function normalizeDateInput(value){
    if(!value) return null;
    const trimmed = value.trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if(/^\d{4}\.\d{2}\.\d{2}$/.test(trimmed)) return trimmed.replace(/\./g,'-');
    return null;
  }
  function normalizeHours(value){
    const num = Number(value);
    if(!Number.isFinite(num)) return null;
    return Math.round(num * 100) / 100;
  }
  function formatHours(value){
    const num = normalizeHours(value);
    return num === null ? '' : String(num);
  }
  function getTimeEntries(card){
    ensureCardTimeEntries(card);
    return Object.keys(card.timeEntries || {}).sort((a,b)=> b.localeCompare(a)).map(date => ({ date, hours: card.timeEntries[date] }));
  }

  // Project / Card Mutations
  function addProject(name){
    if(!name.trim()) return;
    store.update(board => {
      board.projects.push({ id:uuid(), name:name.trim(), createdAt:new Date().toISOString(), order:board.projects.length, collapsed:true, color:DEFAULT_PROJECT_COLOR, columns:{ links:[], backlog:[], inProgress:[], onHold:[], complete:[] }, notes:{ text:'', updatedAt:null } });
    });
  }
  function deleteProject(id){
    store.update(board => {
      const proj = board.projects.find(p=>p.id===id); if(!proj) return;
      const allIds = new Set([...proj.columns.links, ...proj.columns.backlog, ...proj.columns.inProgress, ...proj.columns.onHold, ...proj.columns.complete]);
      allIds.forEach(cid => { delete board.cards[cid]; });
      board.projects = board.projects.filter(p=>p.id!==id);
      board.projects.forEach((p,i)=> p.order=i);
      delete editingNotes[id]; delete editingProjectName[id];
    });
  }
  function addCard(projectId, title){
    if(!title.trim()) return;
    store.update(board => {
      const proj = board.projects.find(p=>p.id===projectId); if(!proj) return;
      const id = uuid();
      const now = new Date().toISOString();
      board.cards[id] = { id, projectId, title:title.trim(), type:'card', createdAt:now, updatedAt:now, statusChangedAt:now };
      proj.columns.backlog.push(id);
    });
  }
  function addLink(projectId, name, url){
    if(!name.trim() || !url.trim()) return;
    store.update(board => {
      const proj = board.projects.find(p=>p.id===projectId); if(!proj) return;
      const id = uuid();
      const now = new Date().toISOString();
      board.cards[id] = { id, projectId, title:name.trim(), url:url.trim(), type:'link', createdAt:now, updatedAt:now, statusChangedAt:now };
      proj.columns.links.push(id);
    });
  }
  function deleteCard(cardId){
    store.update(board => {
      const card = board.cards[cardId]; if(!card) return;
      const proj = board.projects.find(p=>p.id===card.projectId); if(!proj) return;
      STATUSES.forEach(s=> { proj.columns[s] = proj.columns[s].filter(id=> id!==cardId); });
      delete board.cards[cardId];
    });
  }
  function moveCard(cardId, projectId, fromStatus, toStatus, targetIndex){
    if(!STATUSES.includes(fromStatus) || !STATUSES.includes(toStatus)) return;
    store.update(board => {
      const proj = board.projects.find(p=>p.id===projectId); if(!proj) return;
      const fromArr = proj.columns[fromStatus];
      const toArr = proj.columns[toStatus];
      const idx = fromArr.indexOf(cardId); if(idx===-1) return;
      fromArr.splice(idx,1);
      const insertIndex = (typeof targetIndex === 'number' && targetIndex>=0 && targetIndex<=toArr.length) ? targetIndex : toArr.length;
      toArr.splice(insertIndex,0,cardId);
      if(board.cards[cardId]) {
        const now = new Date().toISOString();
        board.cards[cardId].updatedAt = now; // preserve existing updated semantics
        board.cards[cardId].statusChangedAt = now; // new field for move timestamp
      }
    });
  }
  function editCard(cardId, newTitle){
    if(!newTitle.trim()) return;
    store.update(board => {
      if(board.cards[cardId]) { board.cards[cardId].title = newTitle.trim(); board.cards[cardId].updatedAt = new Date().toISOString(); /* do NOT change statusChangedAt here */ }
    });
  }
  function addTimeEntry(cardId, date, hours){
    store.update(board => {
      const card = board.cards[cardId];
      if(!card || card.type === 'link') return;
      ensureCardTimeEntries(card);
      const safeDate = normalizeDateInput(date);
      const safeHours = normalizeHours(hours);
      if(!safeDate || safeHours === null || safeHours <= 0) return;
      const existing = Number(card.timeEntries[safeDate] || 0);
      card.timeEntries[safeDate] = Math.round((existing + safeHours) * 100) / 100;
      card.updatedAt = new Date().toISOString();
    });
  }
  function updateTimeEntry(cardId, oldDate, newDate, hours){
    store.update(board => {
      const card = board.cards[cardId];
      if(!card || card.type === 'link') return;
      ensureCardTimeEntries(card);
      const safeNewDate = normalizeDateInput(newDate);
      const safeHours = normalizeHours(hours);
      if(!safeNewDate || safeHours === null || safeHours <= 0) return;
      const oldKey = normalizeDateInput(oldDate);
      if(oldKey && oldKey === safeNewDate){
        card.timeEntries[safeNewDate] = safeHours;
      } else {
        if(oldKey && card.timeEntries[oldKey]) delete card.timeEntries[oldKey];
        const existing = Number(card.timeEntries[safeNewDate] || 0);
        card.timeEntries[safeNewDate] = Math.round((existing + safeHours) * 100) / 100;
      }
      card.updatedAt = new Date().toISOString();
    });
  }
  function deleteTimeEntry(cardId, date){
    store.update(board => {
      const card = board.cards[cardId];
      if(!card || card.type === 'link') return;
      ensureCardTimeEntries(card);
      const safeDate = normalizeDateInput(date);
      if(!safeDate || !card.timeEntries[safeDate]) return;
      delete card.timeEntries[safeDate];
      card.updatedAt = new Date().toISOString();
    });
  }
  function updateProjectNotes(projectId, text){
    store.update(board => {
      const proj = board.projects.find(p=> p.id===projectId); if(!proj) return;
      ensureProjectNotes(proj);
      proj.notes.text = text;
      proj.notes.updatedAt = new Date().toISOString();
    });
    delete editingNotes[projectId]; // close editor after save
  }

  // Collapse / Expand Mutations
  function toggleProjectCollapse(id){
    store.update(board => {
      const proj = board.projects.find(p=> p.id===id); if(!proj) return;
      proj.collapsed = !proj.collapsed;
    });
  }
  function setAllProjectsCollapsed(collapsed){
    store.update(board => {
      board.projects.forEach(p=> { p.collapsed = collapsed; });
    });
  }

  // Bookmark Mutations
  function addBookmark(name, url){
    if(!name.trim() || !url.trim()) return;
    store.update(board => {
      board.bookmarks = board.bookmarks || [];
      board.bookmarks.push({ id:uuid(), title:name.trim(), url:url.trim(), createdAt:new Date().toISOString(), order:board.bookmarks.length });
    });
  }
  function deleteBookmark(id){
    store.update(board => {
      board.bookmarks = (board.bookmarks||[]).filter(b=> b.id!==id);
      board.bookmarks.forEach((b,i)=> b.order=i);
    });
  }

  // Rendering (Projects & Cards)
  const boardRoot = document.getElementById('boardRoot');

  function el(tag, cls){ const e=document.createElement(tag); if(cls) e.className=cls; return e; }

  function commitProjectNameEdit(projectId, value){
    const newName = (value||'').trim();
    if(!newName){ delete editingProjectName[projectId]; render(); return; }
    store.update(board => { const proj = board.projects.find(p=> p.id===projectId); if(!proj) return; proj.name = newName; });
    delete editingProjectName[projectId];
  }

  function buildNotesSection(project){
    ensureProjectNotes(project);
    const container = el('div','project-notes');
    container.dataset.projectId = project.id;
    const notesObj = project.notes;
    const editState = editingNotes[project.id];

    const header = el('div','notes-header');
    const tSpan = el('span','notes-title'); tSpan.textContent='Project Notes'; header.appendChild(tSpan);
    const actions = el('div','notes-actions');
    const editBtn = el('button','notes-edit-btn'); editBtn.type='button'; editBtn.textContent = editState ? 'Cancel' : 'Edit'; editBtn.title = editState ? 'Cancel editing' : 'Edit notes';
    editBtn.addEventListener('click', () => {
      if(editState){ delete editingNotes[project.id]; render(); }
      else { editingNotes[project.id] = { draft: notesObj.text }; render(); }
    });
    actions.appendChild(editBtn); header.appendChild(actions);
    container.appendChild(header);

    if(editState){
      const editWrap = el('div','notes-edit');
      const ta = el('textarea','notes-textarea');
      ta.value = editState.draft;
      ta.placeholder='Write notes...';
      const buttons = el('div','notes-buttons');
      const saveBtn = el('button','notes-save-btn'); saveBtn.type='button'; saveBtn.textContent='Save'; saveBtn.addEventListener('click', () => { updateProjectNotes(project.id, ta.value.trim()); });
      const cancelBtn = el('button','notes-cancel-btn'); cancelBtn.type='button'; cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click', () => { delete editingNotes[project.id]; render(); });
      const statusSpan = el('span','notes-status');
      ta.addEventListener('input', () => {
        editingNotes[project.id].draft = ta.value;
        statusSpan.textContent = (ta.value !== notesObj.text) ? 'Unsaved changes' : '';
      });
      ta.addEventListener('keydown', e => { if((e.ctrlKey||e.metaKey) && e.key==='Enter'){ e.preventDefault(); updateProjectNotes(project.id, ta.value.trim()); } });
      buttons.appendChild(saveBtn); buttons.appendChild(cancelBtn); buttons.appendChild(statusSpan);
      editWrap.appendChild(ta); editWrap.appendChild(buttons);
      container.appendChild(editWrap);
    } else {
      const view = el('div','notes-view');
      if(notesObj.text){ view.textContent = notesObj.text; }
      else { view.textContent='No notes yet.'; view.classList.add('empty-msg'); }
      container.appendChild(view);
    }
    const meta = el('div','notes-meta');
    if(notesObj.updatedAt){ meta.textContent = 'Last updated: ' + new Date(notesObj.updatedAt).toLocaleString(); }
    container.appendChild(meta);
    return container;
  }

  function render(){
    const { projects, cards } = store.get();
    boardRoot.innerHTML='';
    if(!projects.length){
      const empty = el('div','empty-msg'); empty.textContent = 'No projects yet. Add one above.'; boardRoot.appendChild(empty); return; }
    projects.sort((a,b)=> a.order-b.order).forEach(project => {
      ensureProjectColor(project);
      ensureProjectNotes(project);
      const row = el('div','project-row'); row.dataset.projectId = project.id;
      if(project.collapsed) row.classList.add('collapsed');

       const header = el('div','project-header');
       applyProjectHeaderColor(header, project.color);
       header.setAttribute('aria-expanded', String(!project.collapsed));
        const h2 = el('h2'); h2.classList.add('project-title'); h2.draggable = true;
        const nameEditState = editingProjectName[project.id];
        if(nameEditState){
          const nameForm = el('div','project-name-edit');
          const nameInput = el('input'); nameInput.type='text'; nameInput.value = nameEditState.draft; nameInput.placeholder='Project name'; nameInput.className='project-name-input';
          const saveBtn = el('button'); saveBtn.type='button'; saveBtn.textContent='Save'; saveBtn.title='Save name'; saveBtn.className='project-name-save-btn';
          const cancelBtn = el('button'); cancelBtn.type='button'; cancelBtn.textContent='Cancel'; cancelBtn.title='Cancel'; cancelBtn.className='project-name-cancel-btn';
          nameInput.addEventListener('input', () => { editingProjectName[project.id].draft = nameInput.value; });
          nameInput.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); commitProjectNameEdit(project.id, nameInput.value); } else if(e.key==='Escape'){ e.preventDefault(); delete editingProjectName[project.id]; render(); } });
          saveBtn.addEventListener('click', () => { commitProjectNameEdit(project.id, nameInput.value); });
          cancelBtn.addEventListener('click', () => { delete editingProjectName[project.id]; render(); });
          nameForm.appendChild(nameInput); nameForm.appendChild(saveBtn); nameForm.appendChild(cancelBtn); h2.appendChild(nameForm);
          setTimeout(()=> nameInput.focus(), 0);
        } else {
          h2.textContent = project.name;
        }
        header.appendChild(h2);
       const projActions = el('div','proj-actions');

       const colorWrap = el('div','color-picker-wrap');
       const colorBtn = el('button','project-color-btn'); colorBtn.title='Project color'; colorBtn.setAttribute('aria-haspopup','true'); colorBtn.setAttribute('aria-expanded','false'); colorBtn.draggable=false; colorBtn.style.background = project.color; colorBtn.textContent='🎨';
       colorBtn.addEventListener('mousedown', e=> e.stopPropagation());
       colorBtn.addEventListener('click', ()=> { const open = colorWrap.classList.toggle('open'); colorBtn.setAttribute('aria-expanded', String(open)); });
       const palette = el('div','color-palette');
       PROJECT_COLOR_PALETTE.forEach(c => {
         const sw = el('button','swatch'); sw.type='button'; sw.style.background=c; sw.title=c; sw.draggable=false; if(c===project.color) sw.classList.add('selected');
         sw.addEventListener('mousedown', e=> e.stopPropagation());
         sw.addEventListener('click', ()=> {
           store.update(board => { const proj = board.projects.find(p=> p.id===project.id); if(!proj) return; proj.color = c; });
         });
         palette.appendChild(sw);
       });
       colorWrap.appendChild(colorBtn); colorWrap.appendChild(palette);

       const delBtn = el('button'); delBtn.textContent = 'X'; delBtn.title='Delete project'; delBtn.addEventListener('click',()=>{ if(confirm('Delete project and all its cards?')) deleteProject(project.id); });

        const nameEditBtn = el('button'); nameEditBtn.textContent='✎'; nameEditBtn.title='Edit project name'; nameEditBtn.addEventListener('click', (e)=> { e.stopPropagation(); const st = editingProjectName[project.id]; if(st){ delete editingProjectName[project.id]; } else { editingProjectName[project.id] = { draft: project.name }; } render(); });
        projActions.appendChild(nameEditBtn);
        projActions.appendChild(colorWrap);
       projActions.appendChild(delBtn);
       header.appendChild(projActions);

       header.addEventListener('click', (e) => {
         if(h2.contains(e.target)) return; // title is drag-only
         if(colorWrap.contains(e.target) || delBtn.contains(e.target)) return; // ignore interactive buttons/palette
         toggleProjectCollapse(project.id);
       });

       h2.title = 'Drag to reorder project';
       row.appendChild(header);
       setupProjectHeaderDnD(row, h2);

      const colsWrap = el('div','columns');
      STATUSES.forEach(status => {
        const col = el('div','status-col'); col.dataset.status=status; col.dataset.projectId=project.id; col.classList.add('status-'+status);
        const sh = el('div','status-header');
        const titleSpan = el('span','status-title'); titleSpan.textContent = statusLabel(status); sh.appendChild(titleSpan);
        if(status==='links'){
          const addBtn = document.createElement('button'); addBtn.className='icon-btn add-icon'; addBtn.textContent='+'; addBtn.title='Add Link'; addBtn.addEventListener('click',()=>{
            const name = prompt('Link display name'); if(!name) return; const url = prompt('Link URL (https://...)'); if(!url) return; addLink(project.id, name, url);
          }); sh.appendChild(addBtn);
        }
        if(status==='backlog'){
          const addBtn = document.createElement('button'); addBtn.className='icon-btn add-icon'; addBtn.textContent='+'; addBtn.title='Add Card'; addBtn.addEventListener('click',()=>{
            const t = prompt('Card title'); if(t) addCard(project.id, t);
          }); sh.appendChild(addBtn);
        }
        col.appendChild(sh);
        const list = el('ul','card-list'); list.dataset.status=status; list.dataset.projectId=project.id;
        const ids = project.columns[status];
        if(!ids.length){ const placeholder = el('div','empty-msg'); placeholder.textContent='Empty'; list.appendChild(placeholder); }
        ids.forEach(cid => {
          const card = cards[cid]; if(!card) return;
          ensureCardStatus(card);
          const li = el('li','card'); li.dataset.cardId=cid;
          if(card.type==='link'){
            li.classList.add('link-card');
            li.draggable = true;
            const titleText = (card.title || '');
            const lcTitle = titleText.toLowerCase();
            if(lcTitle.startsWith('[git]')) li.classList.add('link-git');
            else if(lcTitle.startsWith('[jira]')) li.classList.add('link-jira');
            else if(lcTitle.startsWith('[jenkins]')) li.classList.add('link-jenkins');
            else if(lcTitle.startsWith('[verstas]')) li.classList.add('link-verstas');
          } else {
            li.draggable = true;
          }
          const head = el('div','card-head');
          const tsEl = el('div','card-timestamp');
          tsEl.textContent = formatStatusTimestamp(card.statusChangedAt);
          head.appendChild(tsEl);
          const actions = el('div','card-actions');
          const editBtn = el('button'); editBtn.textContent='✎'; editBtn.title='Edit title'; editBtn.addEventListener('click',()=>{
            const nt = prompt('Edit title', card.title); if(nt && nt!==card.title) editCard(cid, nt);
          });
          actions.appendChild(editBtn);
          if(card.type !== 'link'){
            const timeBtn = el('button'); timeBtn.textContent='Time'; timeBtn.title='Track time'; timeBtn.addEventListener('click',()=> openTimeModal(cid));
            actions.appendChild(timeBtn);
          }
          const delCBtn = el('button'); delCBtn.textContent='✕'; delCBtn.title='Delete'; delCBtn.addEventListener('click',()=>{ if(confirm('Delete item?')) deleteCard(cid); });
          actions.appendChild(delCBtn);
          head.appendChild(actions);
          li.appendChild(head);
          const title = el('div','card-title');
          if(card.type==='link' && card.url){
            const a = document.createElement('a'); a.href=card.url; a.target='_blank'; a.rel='noopener'; a.textContent=card.title; title.appendChild(a);
          } else { title.textContent = card.title; }
          li.appendChild(title);
          setupCardDnD(li);
          list.appendChild(li);
        });
        setupListDnD(list);
        col.appendChild(list);
        colsWrap.appendChild(col);
      });
      row.appendChild(colsWrap);
      // Notes section appended after columns
      row.appendChild(buildNotesSection(project));
      boardRoot.appendChild(row);
    });
  }

  function statusLabel(s){
    switch(s){
      case 'links': return 'Links';
      case 'backlog': return 'Backlog';
      case 'inProgress': return 'In Progress';
      case 'onHold': return 'On Hold';
      case 'complete': return 'Complete';
      default: return s;
    }
  }

  // Drag & Drop logic
  function setupCardDnD(cardEl){
    cardEl.addEventListener('dragstart', e => {
      cardEl.classList.add('dragging');
      const cardId = cardEl.dataset.cardId;
      const list = cardEl.parentElement; if(!list) return;
      const fromStatus = list.dataset.status; const projectId = list.dataset.projectId;
      e.dataTransfer.setData('text/plain', JSON.stringify({ cardId, fromStatus, projectId }));
    });
    cardEl.addEventListener('dragend', ()=> cardEl.classList.remove('dragging'));
  }
  function setupListDnD(listEl){
    listEl.addEventListener('dragover', e => {
      e.preventDefault();
      const col = listEl.parentElement; if(col) col.classList.add('drag-over');
    });
    listEl.addEventListener('dragleave', e => { const col = listEl.parentElement; if(col) col.classList.remove('drag-over'); });
    listEl.addEventListener('drop', e => {
      e.preventDefault();
      const col = listEl.parentElement; if(col) col.classList.remove('drag-over');
      let payload; try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch(_) { return; }
      if(!payload) return;
      const { cardId, fromStatus, projectId } = payload;
      const toStatus = listEl.dataset.status;
      const toProject = listEl.dataset.projectId;
      if(projectId !== toProject){ return; }
      const afterElement = getDragAfterElement(listEl, e.clientY);
      const ids = Array.from(listEl.querySelectorAll('.card')).map(c=> c.dataset.cardId);
      const targetIndex = afterElement ? ids.indexOf(afterElement.dataset.cardId) : ids.length;
      moveCard(cardId, projectId, fromStatus, toStatus, targetIndex);
    });
  }
  function getDragAfterElement(listEl, y){
    const elements = [...listEl.querySelectorAll('.card:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    elements.forEach(el => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height/2;
      if(offset < 0 && offset > closest.offset){ closest = { offset, element: el }; }
    });
    return closest.element;
  }

  // Export / Import
  function exportJSON(){
    const board = store.get();
    // Adding notes to export transparently (older exports without notes still import fine)
    const payload = { schema:'kanban.v1', exportedAt:new Date().toISOString(), projects: board.projects, cards: board.cards, bookmarks: board.bookmarks };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ckanban-export.json'; a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 5000);
   }

   function exportPDFReport(){
     const board = store.get();
     const wrapper = document.createElement('div');
     wrapper.className = 'pdf-report-root';
     const style = document.createElement('style');
     style.textContent = `@media print { body * { visibility:hidden; } .pdf-report-root, .pdf-report-root * { visibility:visible; } .pdf-report-root { position:relative; } } .pdf-report-root { font-family: Arial, sans-serif; padding:16px; } .pdf-project { margin-bottom:32px; page-break-inside:avoid; } .pdf-project h2 { margin:0 0 4px; font-size:18px; } .pdf-notes { white-space:pre-wrap; background:#f5f5f5; padding:8px; border:1px solid #ddd; border-radius:4px; font-size:12px; } .pdf-section-title { font-weight:bold; margin-top:12px; font-size:13px; } ul.pdf-cards { margin:4px 0 12px; padding-left:18px; } ul.pdf-cards li { font-size:12px; margin:2px 0; } .pdf-meta { font-size:10px; color:#555; margin-top:4px; }`;
     document.body.appendChild(style);
     board.projects.sort((a,b)=> a.order-b.order).forEach(project => {
       const projDiv = document.createElement('div'); projDiv.className='pdf-project';
       const h = document.createElement('h2'); h.textContent = project.name || 'Untitled Project'; projDiv.appendChild(h);
       // Notes
       const notesTitle = document.createElement('div'); notesTitle.className='pdf-section-title'; notesTitle.textContent='Notes'; projDiv.appendChild(notesTitle);
       const notesDiv = document.createElement('div'); notesDiv.className='pdf-notes'; notesDiv.textContent = (project.notes && project.notes.text) ? project.notes.text : '(No notes)'; projDiv.appendChild(notesDiv);
       // Links
       const linksTitle = document.createElement('div'); linksTitle.className='pdf-section-title'; linksTitle.textContent='Links'; projDiv.appendChild(linksTitle);
       const linksList = document.createElement('ul'); linksList.className='pdf-cards';
       project.columns.links.forEach(cid => { const card = board.cards[cid]; if(!card) return; const li=document.createElement('li'); li.textContent = card.title + (card.url?` (${card.url})`:''); linksList.appendChild(li); });
       if(!project.columns.links.length){ const li=document.createElement('li'); li.textContent='(None)'; linksList.appendChild(li); }
       projDiv.appendChild(linksList);
       // Kanban columns
       ['backlog','inProgress','onHold','complete'].forEach(colKey => {
         const colTitle = document.createElement('div'); colTitle.className='pdf-section-title'; colTitle.textContent = statusLabel(colKey); projDiv.appendChild(colTitle);
         const list = document.createElement('ul'); list.className='pdf-cards';
         const ids = project.columns[colKey];
          ids.forEach(cid => { const card = board.cards[cid]; if(!card) return; const li=document.createElement('li'); li.textContent = card.title; list.appendChild(li); });
          if(!ids.length){ const li=document.createElement('li'); li.textContent='(Empty)'; list.appendChild(li); }
          projDiv.appendChild(list);
          // Time entries summary (per card)
          ids.forEach(cid => {
            const card = board.cards[cid];
            if(!card || card.type === 'link') return;
            ensureCardTimeEntries(card);
            const entries = getTimeEntries(card);
            if(!entries.length) return;
            const timeTitle = document.createElement('div'); timeTitle.className='pdf-section-title'; timeTitle.textContent = 'Time: ' + (card.title || 'Untitled Card');
            projDiv.appendChild(timeTitle);
            const timeList = document.createElement('ul'); timeList.className='pdf-cards';
            entries.forEach(entry => {
              const li = document.createElement('li');
              li.textContent = entry.date + ' - ' + entry.hours + ' hours';
              timeList.appendChild(li);
            });
            const total = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
            const totalLi = document.createElement('li'); totalLi.textContent = 'Total: ' + formatHours(total) + ' hours';
            timeList.appendChild(totalLi);
            projDiv.appendChild(timeList);
          });
        });
       const meta = document.createElement('div'); meta.className='pdf-meta'; meta.textContent = 'Created: ' + new Date(project.createdAt).toLocaleDateString(); projDiv.appendChild(meta);
       wrapper.appendChild(projDiv);
     });
     // Remove any existing old report first
     document.querySelectorAll('.pdf-report-root').forEach(el => el.remove());
     document.body.appendChild(wrapper);
     // Trigger print (user can choose Save as PDF)
     setTimeout(()=> { window.print(); setTimeout(()=> { wrapper.remove(); style.remove(); }, 1000); }, 50);
   }

   function validateImport(data){
    if(!data || data.schema!=='kanban.v1') return false;
    if(!Array.isArray(data.projects) || typeof data.cards !== 'object') return false;
    for(const p of data.projects){
      if(!p.id || !p.columns) return false;
      for(const s of STATUSES){ if(!Array.isArray(p.columns[s])) return false; }
    }
    return true;
  }
  function importJSON(file){
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if(!validateImport(data)){ alert('Invalid JSON schema'); return; }
        (data.projects||[]).forEach(p=> { ensureProjectColor(p); ensureProjectNotes(p); });
        // Ensure existing cards have statusChangedAt
        Object.values(data.cards||{}).forEach(c => { ensureCardStatus(c); ensureCardTimeEntries(c); });
        store.set({ version:1, projects:data.projects, cards:data.cards, bookmarks:data.bookmarks||[], lastModified:new Date().toISOString() });
      } catch(err){ alert('Failed to parse JSON'); }
    };
    reader.readAsText(file);
  }

  function clearAll(){
    if(!confirm('Clear ALL projects, cards & bookmarks?')) return;
    store.set(createEmptyBoard());
  }

  // Bookmarks Panel Rendering
  const bookmarksPanel = document.getElementById('bookmarksPanel');
  const bookmarksList = document.getElementById('bookmarksList');
  const toggleBookmarksBtn = document.getElementById('toggleBookmarksBtn');

  function renderBookmarks(){
    const { bookmarks = [] } = store.get();
    if(!bookmarksList) return;
    bookmarksList.innerHTML='';
    bookmarks.sort((a,b)=> (a.order||0) - (b.order||0)).forEach(bm => {
      const li = document.createElement('li'); li.className='bookmark'; li.dataset.id=bm.id;
      const a = document.createElement('a'); a.href=bm.url; a.target='_blank'; a.rel='noopener'; a.textContent=bm.title; li.appendChild(a);
      const del = document.createElement('button'); del.className='delete'; del.type='button'; del.textContent='✕'; del.title='Delete bookmark'; del.addEventListener('click',()=>{ if(confirm('Delete bookmark?')) deleteBookmark(bm.id); });
      li.appendChild(del);
      bookmarksList.appendChild(li);
    });
    if(bookmarksPanel && bookmarksPanel.classList.contains('open')){
      // adjust max-height for smooth animation if content changed
      bookmarksPanel.style.maxHeight = bookmarksPanel.scrollHeight + 'px';
    }
  }

  function toggleBookmarks(){
    if(!bookmarksPanel) return;
    const open = bookmarksPanel.classList.toggle('open');
    bookmarksPanel.setAttribute('aria-hidden', String(!open));
    if(toggleBookmarksBtn) toggleBookmarksBtn.setAttribute('aria-expanded', String(open));
    if(open){
      bookmarksPanel.style.maxHeight = bookmarksPanel.scrollHeight + 'px';
    } else {
      bookmarksPanel.style.maxHeight = '0px';
    }
  }

  function updateToggleAllBtn(){
    const btn = document.getElementById('toggleAllProjectsBtn');
    if(!btn) return;
    const board = store.get();
    if(!board.projects.length){ btn.disabled=true; btn.textContent='Expand All'; btn.setAttribute('aria-expanded','false'); return; }
    btn.disabled=false;
    const allCollapsed = board.projects.every(p=> p.collapsed);
    btn.textContent = allCollapsed ? 'Expand All' : 'Collapse All';
    btn.setAttribute('aria-expanded', String(!allCollapsed));
  }

  // UI event wiring
  function wireUI(){
     document.getElementById('addProjectBtn').addEventListener('click', () => {
       const inp = document.getElementById('newProjectName');
       addProject(inp.value); inp.value=''; inp.focus();
     });
     document.getElementById('newProjectName').addEventListener('keypress', e => { if(e.key==='Enter'){ document.getElementById('addProjectBtn').click(); }});
     document.getElementById('exportBtn').addEventListener('click', exportJSON);
     document.getElementById('importFile').addEventListener('change', e => { const f=e.target.files[0]; if(f) importJSON(f); e.target.value=''; });
     document.getElementById('clearBtn').addEventListener('click', clearAll);
     if(toggleBookmarksBtn) toggleBookmarksBtn.addEventListener('click', toggleBookmarks);
     const pdfBtn = document.getElementById('pdfBtn');
     if(pdfBtn) pdfBtn.addEventListener('click', exportPDFReport);
     const addBookmarkBtn = document.getElementById('addBookmarkBtn');
     if(addBookmarkBtn) addBookmarkBtn.addEventListener('click', ()=>{
       const name = prompt('Bookmark name'); if(!name) return; const url = prompt('Bookmark URL (https://...)'); if(!url) return; addBookmark(name, url);
     });
     const toggleAllBtn = document.getElementById('toggleAllProjectsBtn');
     if(toggleAllBtn) toggleAllBtn.addEventListener('click', ()=>{
       const board = store.get();
       const allCollapsed = board.projects.every(p=> p.collapsed);
       setAllProjectsCollapsed(!allCollapsed);
     });
      const workedBtn = document.getElementById('workedBtn');
      if(workedBtn) workedBtn.addEventListener('click', ()=>{
        const def = new Date().toISOString().slice(0,10);
        const date = prompt('Enter date (YYYY-MM-DD)', def);
        if(!date) return;
        const d = date.trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ alert('Invalid date format. Use YYYY-MM-DD'); return; }
        openWorkedModal(d);
      });
      const workedHoursBtn = document.getElementById('workedHoursBtn');
      if(workedHoursBtn) workedHoursBtn.addEventListener('click', ()=>{
        const def = new Date().toISOString().slice(0,10);
        const date = prompt('Enter date (YYYY-MM-DD)', def);
        if(!date) return;
        const d = date.trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ alert('Invalid date format. Use YYYY-MM-DD'); return; }
        openWorkedHoursModal(d);
      });
    }

  function handleGlobalClickForColorPickers(e){
    document.querySelectorAll('.color-picker-wrap.open').forEach(el => { if(!el.contains(e.target)) el.classList.remove('open'); });
  }

  // Init
  async function init(){
    const existing = await loadBoard();
      if(existing){
        if(!existing.bookmarks) existing.bookmarks = [];
        (existing.projects||[]).forEach(p=> { if(typeof p.collapsed !== 'boolean') p.collapsed = true; ensureProjectColor(p); ensureProjectNotes(p); });
        Object.values(existing.cards||{}).forEach(c => { ensureCardStatus(c); ensureCardTimeEntries(c); });
        store.set(existing);
      } else { store.set(createEmptyBoard()); }
    wireUI();
    document.addEventListener('click', handleGlobalClickForColorPickers);
    store.subscribe(render);
    store.subscribe(renderBookmarks);
    store.subscribe(updateToggleAllBtn);
    render();
    renderBookmarks();
    updateToggleAllBtn();
    setupQuickBookmarksModal();
  }

  // Quick Bookmarks Modal Logic
  function setupQuickBookmarksModal(){
    const modal = document.getElementById('quickBookmarksModal');
    const input = document.getElementById('quickBookmarksInput');
    const results = document.getElementById('quickBookmarksResults');
    if(!modal || !input || !results) return;

    function openModal(){
      modal.classList.add('open');
      modal.setAttribute('aria-hidden','false');
      input.value='';
      input.focus();
      renderResults();
    }
    function closeModal(){
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
    }
    function isOpen(){ return modal.classList.contains('open'); }

    function scoreBookmark(query, title){
      // basic fuzzy scoring: sequential char match and includes
      if(!query) return 0;
      const q = query.toLowerCase();
      const t = title.toLowerCase();
      if(t.includes(q)) return q.length * 2; // boost substring
      // sequential fuzzy
      let qi=0, ti=0, hits=0;
      while(qi<q.length && ti<t.length){
        if(q[qi]===t[ti]){ hits++; qi++; }
        ti++;
      }
      return hits;
    }

    function renderResults(){
      const { bookmarks = [] } = store.get();
      results.innerHTML='';
      const query = input.value.trim();
      let items = bookmarks.map(b=> ({ b, score: query ? scoreBookmark(query, b.title) : 0 }));
      if(query){ items = items.filter(it => it.score > 0); }
      items.sort((a,b)=> b.score - a.score || a.b.order - b.b.order);
      if(!items.length){
        const li = document.createElement('li'); li.className='qb-empty'; li.textContent = query ? 'No matches' : 'No bookmarks yet'; results.appendChild(li); return;
      }
      items.forEach((it, idx) => {
        const li = document.createElement('li'); li.dataset.id = it.b.id; li.setAttribute('role','option');
        if(idx===0) li.classList.add('active');
        const spanTitle = document.createElement('span'); spanTitle.textContent = it.b.title; li.appendChild(spanTitle);
        const small = document.createElement('small'); small.textContent = it.b.url; li.appendChild(small);
        li.addEventListener('click', ()=> openBookmark(it.b));
        results.appendChild(li);
      });
    }

    function openBookmark(b){ if(!b) return; window.open(b.url,'_blank','noopener'); }

    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', e => {
      if(e.key==='Escape'){ e.preventDefault(); closeModal(); return; }
      if(e.key==='Enter'){ e.preventDefault(); const first = results.querySelector('li.active'); if(first){ const id = first.dataset.id; const { bookmarks=[] } = store.get(); const target = bookmarks.find(x=> x.id===id); openBookmark(target); closeModal(); } return; }
      // simple up/down selection
      if(e.key==='ArrowDown' || e.key==='ArrowUp'){
        e.preventDefault();
        const all = Array.from(results.querySelectorAll('li[role="option"]'));
        if(!all.length) return;
        let idx = all.findIndex(li => li.classList.contains('active'));
        if(idx===-1) idx=0; else {
          idx += (e.key==='ArrowDown'?1:-1);
          if(idx<0) idx = all.length-1; if(idx>=all.length) idx=0;
        }
        all.forEach(li=> li.classList.remove('active'));
        all[idx].classList.add('active');
        all[idx].scrollIntoView({ block:'nearest' });
      }
    });

    document.addEventListener('keydown', e => {
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='b'){ e.preventDefault(); if(isOpen()) closeModal(); else openModal(); }
      else if(e.ctrlKey && e.key.toLowerCase()==='q'){
        e.preventDefault();
        const def = new Date().toISOString().slice(0,10);
        const date = prompt('Enter date (YYYY-MM-DD)', def);
        if(!date) return;
        const d = date.trim();
        if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ alert('Invalid date format. Use YYYY-MM-DD'); return; }
        openWorkedModal(d);
      }
      else if(e.key==='Escape' && isOpen()){ closeModal(); }
    });

    // Re-render results whenever bookmarks change
    store.subscribe(()=> { if(isOpen()) renderResults(); });

    // Close on outside click
    modal.addEventListener('mousedown', e => { if(e.target===modal) closeModal(); });
  }

  // Time Entries Modal
  function openTimeModal(cardId){
    const card = store.get().cards[cardId];
    if(!card || card.type === 'link') return;
    timeModalCardId = cardId;
    timeEntryEdit = null;
    const modal = document.getElementById('timeModal');
    if(!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    renderTimeModal();
  }
  function closeTimeModal(){
    const modal = document.getElementById('timeModal');
    if(!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='';
    timeModalCardId = null;
    timeEntryEdit = null;
  }
  function isTimeModalOpen(){
    const modal = document.getElementById('timeModal');
    return !!(modal && modal.classList.contains('open'));
  }
  function renderTimeModal(){
    const modal = document.getElementById('timeModal');
    if(!modal || !timeModalCardId) return;
    const { cards } = store.get();
    const card = cards[timeModalCardId];
    if(!card){ closeTimeModal(); return; }
    ensureCardTimeEntries(card);
    modal.innerHTML='';
    const inner = document.createElement('div'); inner.className='time-inner';
    const header = document.createElement('div'); header.className='time-header';
    const h2 = document.createElement('h2'); h2.textContent='Time Entries'; header.appendChild(h2);
    const closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.className='time-close-btn'; closeBtn.textContent='Close'; closeBtn.addEventListener('click', closeTimeModal); header.appendChild(closeBtn);
    inner.appendChild(header);
    const title = document.createElement('div'); title.className='time-card-title'; title.textContent = card.title || 'Untitled Card'; inner.appendChild(title);

    const form = document.createElement('div'); form.className='time-form';
    const dateLabel = document.createElement('label'); dateLabel.textContent='Date';
    const dateInput = document.createElement('input'); dateInput.type='text'; dateInput.placeholder='YYYY-MM-DD'; dateInput.value = new Date().toISOString().slice(0,10);
    dateLabel.appendChild(dateInput);
    const hoursLabel = document.createElement('label'); hoursLabel.textContent='Hours';
    const hoursInput = document.createElement('input'); hoursInput.type='number'; hoursInput.step='0.25'; hoursInput.min='0';
    hoursLabel.appendChild(hoursInput);
    const addBtn = document.createElement('button'); addBtn.type='button'; addBtn.className='time-add-btn'; addBtn.textContent='Add';
    const error = document.createElement('div'); error.className='time-error';
    function submitAdd(){
      const date = normalizeDateInput(dateInput.value);
      const hours = normalizeHours(hoursInput.value);
      if(!date){ error.textContent='Enter date in YYYY-MM-DD.'; return; }
      if(hours === null || hours <= 0){ error.textContent='Enter hours > 0.'; return; }
      addTimeEntry(card.id, date, hours);
      hoursInput.value='';
      dateInput.value = date;
      error.textContent='';
      renderTimeModal();
    }
    addBtn.addEventListener('click', submitAdd);
    hoursInput.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); submitAdd(); } });
    dateInput.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); submitAdd(); } });
    form.appendChild(dateLabel); form.appendChild(hoursLabel); form.appendChild(addBtn);
    inner.appendChild(form);
    inner.appendChild(error);

    const entriesWrap = document.createElement('div'); entriesWrap.className='time-entries';
    const entries = getTimeEntries(card);
    if(!entries.length){
      const empty = document.createElement('div'); empty.className='time-empty'; empty.textContent='No time entries yet.'; entriesWrap.appendChild(empty);
    } else {
      entries.forEach(entry => {
        const row = document.createElement('div'); row.className='time-entry';
        if(timeEntryEdit && timeEntryEdit.cardId === card.id && timeEntryEdit.date === entry.date){
          const editForm = document.createElement('div'); editForm.className='time-edit-form';
          const editDate = document.createElement('input'); editDate.type='text'; editDate.value = timeEntryEdit.draftDate || entry.date;
          const editHours = document.createElement('input'); editHours.type='number'; editHours.step='0.25'; editHours.min='0'; editHours.value = formatHours(timeEntryEdit.draftHours ?? entry.hours);
          const editError = document.createElement('div'); editError.className='time-error';
          const saveBtn = document.createElement('button'); saveBtn.type='button'; saveBtn.textContent='Save';
          const cancelBtn = document.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent='Cancel';
          saveBtn.addEventListener('click', () => {
            const nextDate = normalizeDateInput(editDate.value);
            const nextHours = normalizeHours(editHours.value);
            if(!nextDate){ editError.textContent='Enter date in YYYY-MM-DD.'; return; }
            if(nextHours === null || nextHours <= 0){ editError.textContent='Enter hours > 0.'; return; }
            updateTimeEntry(card.id, entry.date, nextDate, nextHours);
            timeEntryEdit = null;
            renderTimeModal();
          });
          cancelBtn.addEventListener('click', () => { timeEntryEdit = null; renderTimeModal(); });
          editForm.appendChild(editDate); editForm.appendChild(editHours); editForm.appendChild(saveBtn); editForm.appendChild(cancelBtn); editForm.appendChild(editError);
          row.appendChild(editForm);
        } else {
          const info = document.createElement('div'); info.className='time-entry-info';
          const dateEl = document.createElement('div'); dateEl.className='time-entry-date'; dateEl.textContent = entry.date;
          const hoursEl = document.createElement('div'); hoursEl.className='time-entry-hours'; hoursEl.textContent = entry.hours + ' hours';
          info.appendChild(dateEl); info.appendChild(hoursEl);
          const actions = document.createElement('div'); actions.className='time-entry-actions';
          const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.textContent='Edit'; editBtn.addEventListener('click', () => {
            timeEntryEdit = { cardId: card.id, date: entry.date, draftDate: entry.date, draftHours: entry.hours };
            renderTimeModal();
          });
          const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.textContent='Delete'; delBtn.className='danger'; delBtn.addEventListener('click', () => {
            if(confirm('Delete this entry?')){ deleteTimeEntry(card.id, entry.date); renderTimeModal(); }
          });
          actions.appendChild(editBtn); actions.appendChild(delBtn);
          row.appendChild(info); row.appendChild(actions);
        }
        entriesWrap.appendChild(row);
      });
    }
    inner.appendChild(entriesWrap);
    const total = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
    const totalEl = document.createElement('div'); totalEl.className='time-total'; totalEl.textContent = 'Total: ' + formatHours(total) + ' hours';
    inner.appendChild(totalEl);
    modal.appendChild(inner);
  }

  // Worked Cards Modal
  let workedDate = null;
  let workedHoursDate = null;
  const WORKED_STATUSES = STATUSES.filter(s => s !== 'links');
  function getCardStatus(card, projects){
    const proj = projects.find(p=> p.id===card.projectId);
    if(!proj) return null;
    for(const s of STATUSES){ if(proj.columns[s].includes(card.id)) return s; }
    return null;
  }
  function openWorkedModal(dateStr){
    const modal = document.getElementById('workedModal');
    if(!modal) return;
    workedDate = dateStr;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    renderWorkedResults();
  }
  function closeWorkedModal(){
    const modal = document.getElementById('workedModal');
    if(!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='';
    workedDate = null;
  }
  function isWorkedModalOpen(){
    const modal = document.getElementById('workedModal');
    return !!(modal && modal.classList.contains('open'));
  }
  function renderWorkedResults(){
    const modal = document.getElementById('workedModal');
    if(!modal || !workedDate) return;
    const { projects, cards } = store.get();
    const groups = {}; WORKED_STATUSES.forEach(s => groups[s]=[]);
    Object.values(cards).forEach(card => {
      if(!card) return;
      ensureCardStatus(card);
      ensureCardTimeEntries(card);
      const datePart = (card.statusChangedAt || '').slice(0,10);
      if(datePart === workedDate){
        const status = getCardStatus(card, projects);
        if(status && WORKED_STATUSES.includes(status)) groups[status].push(card);
      }
    });
    modal.innerHTML='';
    const inner = document.createElement('div'); inner.className='worked-inner';
    const header = document.createElement('div'); header.className='worked-header';
    const h2 = document.createElement('h2'); h2.textContent='Worked: ' + workedDate; header.appendChild(h2);
    const closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.className='worked-close-btn'; closeBtn.textContent='Close'; closeBtn.addEventListener('click', closeWorkedModal); header.appendChild(closeBtn);
    inner.appendChild(header);
    let total=0; WORKED_STATUSES.forEach(s => total += groups[s].length);
    if(total===0){
      const empty = document.createElement('div'); empty.className='worked-empty'; empty.textContent='No cards changed status on this date.'; inner.appendChild(empty);
    } else {
      WORKED_STATUSES.forEach(s => {
        const arr = groups[s]; if(!arr.length) return;
        const section = document.createElement('div'); section.className='worked-group worked-status-' + s;
        const title = document.createElement('div'); title.className='worked-group-title'; title.textContent = statusLabel(s) + ' (' + arr.length + ')'; section.appendChild(title);
        const ul = document.createElement('ul'); ul.className='worked-list';
        arr.sort((a,b)=> a.title.localeCompare(b.title));
        arr.forEach(card => {
          const li = document.createElement('li'); li.textContent=card.title;
          const sm = document.createElement('small'); sm.textContent='Project: ' + (projects.find(p=> p.id===card.projectId)?.name || 'Unknown'); li.appendChild(sm);
          ul.appendChild(li);
        });
        section.appendChild(ul);
        inner.appendChild(section);
      });
    }
    modal.appendChild(inner);
  }
  function openWorkedHoursModal(dateStr){
    const modal = document.getElementById('workedHoursModal');
    if(!modal) return;
    workedHoursDate = dateStr;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    renderWorkedHoursResults();
  }
  function closeWorkedHoursModal(){
    const modal = document.getElementById('workedHoursModal');
    if(!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='';
    workedHoursDate = null;
  }
  function isWorkedHoursModalOpen(){
    const modal = document.getElementById('workedHoursModal');
    return !!(modal && modal.classList.contains('open'));
  }
  function renderWorkedHoursResults(){
    const modal = document.getElementById('workedHoursModal');
    if(!modal || !workedHoursDate) return;
    const { projects, cards } = store.get();
    const rows = [];
    Object.values(cards).forEach(card => {
      if(!card || card.type === 'link') return;
      ensureCardTimeEntries(card);
      const hours = Number((card.timeEntries || {})[workedHoursDate] || 0);
      if(hours > 0){
        const projectName = projects.find(p=> p.id===card.projectId)?.name || 'Unknown';
        rows.push({ card, projectName, hours });
      }
    });
    rows.sort((a,b)=> a.projectName.localeCompare(b.projectName) || a.card.title.localeCompare(b.card.title));
    modal.innerHTML='';
    const inner = document.createElement('div'); inner.className='worked-inner';
    const header = document.createElement('div'); header.className='worked-header';
    const h2 = document.createElement('h2'); h2.textContent='Worked Hours: ' + workedHoursDate; header.appendChild(h2);
    const closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.className='worked-close-btn'; closeBtn.textContent='Close'; closeBtn.addEventListener('click', closeWorkedHoursModal); header.appendChild(closeBtn);
    inner.appendChild(header);
    if(!rows.length){
      const empty = document.createElement('div'); empty.className='worked-empty'; empty.textContent='No time entries on this date.'; inner.appendChild(empty);
    } else {
      const list = document.createElement('ul'); list.className='worked-list';
      rows.forEach(row => {
        const li = document.createElement('li');
        li.textContent = row.card.title + ' - ' + formatHours(row.hours) + ' hours';
        const sm = document.createElement('small'); sm.textContent='Project: ' + row.projectName; li.appendChild(sm);
        list.appendChild(li);
      });
      inner.appendChild(list);
      const total = rows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
      const totalEl = document.createElement('div'); totalEl.className='time-total'; totalEl.textContent = 'Total: ' + formatHours(total) + ' hours';
      inner.appendChild(totalEl);
    }
    modal.appendChild(inner);
  }
  document.addEventListener('keydown', e => { if(e.key==='Escape' && isWorkedModalOpen()) closeWorkedModal(); });
  document.addEventListener('mousedown', e => { const modal = document.getElementById('workedModal'); if(isWorkedModalOpen() && modal===e.target) closeWorkedModal(); });
  store.subscribe(()=> { if(isWorkedModalOpen()) renderWorkedResults(); });
  document.addEventListener('keydown', e => { if(e.key==='Escape' && isWorkedHoursModalOpen()) closeWorkedHoursModal(); });
  document.addEventListener('mousedown', e => { const modal = document.getElementById('workedHoursModal'); if(isWorkedHoursModalOpen() && modal===e.target) closeWorkedHoursModal(); });
  store.subscribe(()=> { if(isWorkedHoursModalOpen()) renderWorkedHoursResults(); });
  document.addEventListener('keydown', e => { if(e.key==='Escape' && isTimeModalOpen()) closeTimeModal(); });
  document.addEventListener('mousedown', e => { const modal = document.getElementById('timeModal'); if(isTimeModalOpen() && modal===e.target) closeTimeModal(); });
  store.subscribe(()=> { if(isTimeModalOpen()) renderTimeModal(); });

  // Project row drag & drop (header bar)
  let projectDrag = null; // {id, startIndex}
  function setupProjectHeaderDnD(rowEl, headerEl){
    headerEl.addEventListener('dragstart', e => {
      const id = rowEl.dataset.projectId;
      const board = store.get();
      const projects = [...board.projects].sort((a,b)=> a.order-b.order);
      const startIndex = projects.findIndex(p=> p.id===id);
      projectDrag = { id, startIndex };
      rowEl.classList.add('project-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', JSON.stringify({ type:'project', id })); } catch(_){ }
    });
    headerEl.addEventListener('dragend', () => {
      rowEl.classList.remove('project-dragging');
      projectDrag = null;
      document.querySelectorAll('.project-row.drop-before, .project-row.drop-after').forEach(el=>{ el.classList.remove('drop-before','drop-after'); });
    });
    rowEl.addEventListener('dragover', e => {
      if(!projectDrag) return; e.preventDefault();
      if(rowEl.dataset.projectId === projectDrag.id) return;
      const box = rowEl.getBoundingClientRect();
      const mid = box.top + box.height/2;
      const before = e.clientY < mid;
      rowEl.classList.toggle('drop-before', before);
      rowEl.classList.toggle('drop-after', !before);
    });
    rowEl.addEventListener('dragleave', ()=>{
      rowEl.classList.remove('drop-before','drop-after');
    });
    rowEl.addEventListener('drop', e => {
      if(!projectDrag) return; e.preventDefault();
      const targetId = rowEl.dataset.projectId;
      if(targetId === projectDrag.id) return;
      const box = rowEl.getBoundingClientRect();
      const before = e.clientY < (box.top + box.height/2);
      reorderProjects(projectDrag.id, targetId, before);
    });
  }
  function reorderProjects(dragId, targetId, insertBefore){
    store.update(board => {
      const ordered = [...board.projects].sort((a,b)=> a.order-b.order);
      const dragIndex = ordered.findIndex(p=> p.id===dragId);
      const targetIndex = ordered.findIndex(p=> p.id===targetId);
      if(dragIndex===-1 || targetIndex===-1) return;
      const [dragProj] = ordered.splice(dragIndex,1);
      const tIndexAfterRemoval = ordered.findIndex(p=> p.id===targetId);
      const newIndex = insertBefore ? tIndexAfterRemoval : tIndexAfterRemoval + 1;
      ordered.splice(newIndex,0,dragProj);
      ordered.forEach((p,i)=> p.order=i);
      board.projects = ordered;
    });
  }

  init();
})();
