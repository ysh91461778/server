const CUR_ORDER = ['공수1','공수2','미적분1','미적분2','대수','기하','확통'];
const LV = { '상':0,'중':1,'하':2 };
const idx = (arr,v)=>{ const i=arr.indexOf(v); return i===-1?999:i; };

function getWrap(){ return document.getElementById('allWrap') || document.getElementById('studentsWrap') || document.getElementById('listWrap'); }
function getTable(){ const w=getWrap(); return w ? (w.querySelector('table') || w.querySelector('.all-table')) : null; }

function ensureRowDatasets(tb){
  const map = {}; (window.students||[]).forEach(s=>map[String(s.id)]=s);
  Array.from(tb.rows).forEach(tr=>{
    const a = tr.querySelector('a[href*="/student/"], a[data-sid]');
    const sid = a?.dataset?.sid || (a?.getAttribute('href')||'').split('/').pop();
    const s = map[sid];
    if (s) {
      tr.dataset.name  = s.name||'';
      tr.dataset.level = s.level||'';
      tr.dataset.cur   = s.curriculum||'';
    } else {
      const cells = tr.cells||[];
      tr.dataset.name  = (a?.textContent || cells[0]?.textContent || '').trim();
      tr.dataset.cur   = (cells[1]?.textContent || '').trim();
      tr.dataset.level = (cells[3]?.textContent || '').trim();
    }
  });
}

export function sortDomRows(mode='name'){
  const table=getTable(); if(!table) return;
  const tb=table.tBodies[0]||table.querySelector('tbody'); if(!tb) return;
  const rows=Array.from(tb.rows).filter(tr=>!tr.classList.contains('grp'));
  ensureRowDatasets(tb);

  rows.sort((ra,rb)=>{
    const nameA=ra.dataset.name||'', nameB=rb.dataset.name||'';
    if (mode==='level'){
      const la=LV[ra.dataset.level] ?? 999, lb=LV[rb.dataset.level] ?? 999;
      if (la!==lb) return la-lb; return nameA.localeCompare(nameB,'ko');
    }
    if (mode==='curriculum'){
      const ca=idx(CUR_ORDER,ra.dataset.cur), cb=idx(CUR_ORDER,rb.dataset.cur);
      if (ca!==cb) return ca-cb; return nameA.localeCompare(nameB,'ko');
    }
    return nameA.localeCompare(nameB,'ko');
  });
  rows.forEach(tr=>tb.appendChild(tr));
}

export function injectAllSortBar(){
  const wrap=getWrap(); if(!wrap) return;
  if (wrap.querySelector('#stuSortBar')) return;
  const bar=document.createElement('div');
  bar.id='stuSortBar';
  bar.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0;';
  bar.innerHTML=`<label style="font-size:13px;color:var(--text,#111)">정렬
    <select id="stuSort" style="margin-left:6px;">
      <option value="name">가나다</option>
      <option value="level">난이도(상→중→하)</option>
      <option value="curriculum">커리큘럼</option>
    </select></label>`;
  wrap.prepend(bar);
  const sel=bar.querySelector('#stuSort');
  sel.value=localStorage.stuSortMode||'name';
  sel.addEventListener('change',()=>{ localStorage.stuSortMode=sel.value; sortDomRows(sel.value); });
}

export function hookAllSort(){
  const tryInit=()=>{ const t=getTable(); if(!t) return false; injectAllSortBar(); sortDomRows(localStorage.stuSortMode||'name'); return true; };
  if (tryInit()) return;
  const wrap=getWrap(); if(!wrap) return;
  const mo=new MutationObserver(()=>{ if(tryInit()) mo.disconnect(); });
  mo.observe(wrap,{childList:true,subtree:true});
}
