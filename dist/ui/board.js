// CKanban - plain JS implementation
(function(){
  const STATUSES = ['links','backlog','inProgress','onHold','complete'];
  const STORAGE_KEY = 'ckanban.board.v1';

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

  // Project / Card Mutations
  function addProject(name){
    if(!name.trim()) return;
    store.update(board => {
      board.projects.push({ id:uuid(), name:name.trim(), createdAt:new Date().toISOString(), order:board.projects.length, collapsed:true, columns:{ links:[], backlog:[], inProgress:[], onHold:[], complete:[] } });
    });
  }
  function deleteProject(id){
    store.update(board => {
      const proj = board.projects.find(p=>p.id===id); if(!proj) return;
      const allIds = new Set([...proj.columns.links, ...proj.columns.backlog, ...proj.columns.inProgress, ...proj.columns.onHold, ...proj.columns.complete]);
      allIds.forEach(cid => { delete board.cards[cid]; });
      board.projects = board.projects.filter(p=>p.id!==id);
      board.projects.forEach((p,i)=> p.order=i);
    });
  }
  function addCard(projectId, title){
    if(!title.trim()) return;
    store.update(board => {
      const proj = board.projects.find(p=>p.id===projectId); if(!proj) return;
      const id = uuid();
      board.cards[id] = { id, projectId, title:title.trim(), type:'card', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
      proj.columns.backlog.push(id);
    });
  }
  function addLink(projectId, name, url){
    if(!name.trim() || !url.trim()) return;
    store.update(board => {
      const proj = board.projects.find(p=>p.id===projectId); if(!proj) return;
      const id = uuid();
      board.cards[id] = { id, projectId, title:name.trim(), url:url.trim(), type:'link', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
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
      if(board.cards[cardId]) board.cards[cardId].updatedAt = new Date().toISOString();
    });
  }
  function editCard(cardId, newTitle){
    if(!newTitle.trim()) return;
    store.update(board => {
      if(board.cards[cardId]) { board.cards[cardId].title = newTitle.trim(); board.cards[cardId].updatedAt = new Date().toISOString(); }
    });
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

  function render(){
    const { projects, cards } = store.get();
    boardRoot.innerHTML='';
    if(!projects.length){
      const empty = el('div','empty-msg'); empty.textContent = 'No projects yet. Add one above.'; boardRoot.appendChild(empty); return; }
    projects.sort((a,b)=> a.order-b.order).forEach(project => {
      const row = el('div','project-row'); row.dataset.projectId = project.id;
      if(project.collapsed) row.classList.add('collapsed');

      const header = el('div','project-header');
      const h2 = el('h2'); h2.textContent = project.name; header.appendChild(h2);
      const projActions = el('div','proj-actions');
      const collapseBtn = el('button'); collapseBtn.className='collapse-toggle'; collapseBtn.textContent = project.collapsed ? '▸' : '▾'; collapseBtn.title = project.collapsed ? 'Expand project' : 'Collapse project'; collapseBtn.setAttribute('aria-expanded', String(!project.collapsed)); collapseBtn.addEventListener('click', ()=> toggleProjectCollapse(project.id));
      projActions.appendChild(collapseBtn);
      const delBtn = el('button'); delBtn.textContent = 'Delete'; delBtn.title='Delete project'; delBtn.addEventListener('click',()=>{ if(confirm('Delete project and all its cards?')) deleteProject(project.id); });
      projActions.appendChild(delBtn);
      header.appendChild(projActions);
      header.draggable = true;
      header.title = 'Drag to reorder project';
      row.appendChild(header);
      setupProjectHeaderDnD(row, header);

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
          const title = el('div','card-title');
          if(card.type==='link' && card.url){
            const a = document.createElement('a'); a.href=card.url; a.target='_blank'; a.rel='noopener'; a.textContent=card.title; title.appendChild(a);
          } else { title.textContent = card.title; }
          li.appendChild(title);
          const actions = el('div','card-actions');
          const editBtn = el('button'); editBtn.textContent='✎'; editBtn.title='Edit title'; editBtn.addEventListener('click',()=>{
            const nt = prompt('Edit title', card.title); if(nt && nt!==card.title) editCard(cid, nt);
          });
          const delCBtn = el('button'); delCBtn.textContent='✕'; delCBtn.title='Delete'; delCBtn.addEventListener('click',()=>{ if(confirm('Delete item?')) deleteCard(cid); });
          actions.appendChild(editBtn); actions.appendChild(delCBtn); li.appendChild(actions);
          setupCardDnD(li);
          list.appendChild(li);
        });
        setupListDnD(list);
        col.appendChild(list);
        colsWrap.appendChild(col);
      });
      row.appendChild(colsWrap);
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
    const payload = { schema:'kanban.v1', exportedAt:new Date().toISOString(), projects: board.projects, cards: board.cards, bookmarks: board.bookmarks };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ckanban-export.json'; a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 5000);
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
  }

  // Init
  async function init(){
    const existing = await loadBoard();
    if(existing){
      if(!existing.bookmarks) existing.bookmarks = [];
      (existing.projects||[]).forEach(p=> { if(typeof p.collapsed !== 'boolean') p.collapsed = true; });
      store.set(existing);
    } else { store.set(createEmptyBoard()); }
    wireUI();
    store.subscribe(render);
    store.subscribe(renderBookmarks);
    store.subscribe(updateToggleAllBtn);
    render();
    renderBookmarks();
    updateToggleAllBtn();
  }

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
      try { e.dataTransfer.setData('text/plain', JSON.stringify({ type:'project', id })); } catch(_){}
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