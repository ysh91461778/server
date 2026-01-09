// /js/admin/features/testModal.js
// 테스트 진도 모달 — 학생 개인 제출기록 기반 "틀린 개수 ≥ 5" 시험만 표시
// 표기: "FINAL / FINAL 1회" -> "FINAL 1회" 로 정리, 날짜 출력 제거(점수만 표시)
/*
  사용 예:
    import { initTestModal } from './features/testModal.js';
    initTestModal();  // 관리자 페이지 진입 시 한 번만
*/
import { $, toast, postJSON, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

let editingSid = null;

/* =============================== */
/* 안전 JSON 로더                  */
/* =============================== */
async function fetchJSONSafe(url, init = {}) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const txt = await res.text();
  if (!res.ok) throw new Error(`[testModal] ${init.method||'GET'} ${url} -> ${res.status}\n${txt.slice(0,200)}`);
  try { return txt.trim() ? JSON.parse(txt) : {}; }
  catch(e){ throw new Error(`[testModal] Bad JSON from ${url}: ${e?.message}\n${txt.slice(0,200)}`); }
}

/* =============================== */
/* 이름 정규화/표시                */
/* =============================== */
// "FINAL / FINAL 1회" → "FINAL 1회"
function canonName(raw){
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split('/').map(v => v.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : s;
}

/* =============================== */
/* 학생 제출 기록 수집             */
/* =============================== */
async function collectStudentTests(sid) {
  const [logs, tests] = await Promise.all([
    fetchJSONSafe('/api/logs').catch(()=> ({})),
    fetchJSONSafe('/api/tests').catch(()=> ({})),
  ]);

  const out = []; // { name, date, score, wrong[] }

  // wrong 필드를 배열로 정규화
  const normalizeWrong = (w) => {
    if (Array.isArray(w)) return w.map(n=>+n).filter(Number.isFinite).sort((a,b)=>a-b);
    if (typeof w === 'string') {
      return w.split(/[^0-9]+/).map(s=>+s).filter(Number.isFinite).sort((a,b)=>a-b);
    }
    return [];
  };

  // /api/logs: { date -> { sid -> { tests:[{name,score,wrong,createdAt}] } } }
  for (const [d, bySid] of Object.entries(logs || {})) {
    const entry = (bySid || {})[sid];
    const arr = Array.isArray(entry?.tests) ? entry.tests : [];
    for (const t of arr) {
      if (!t || typeof t !== 'object') continue;
      const name = canonName(t.name);
      if (!name) continue;
      out.push({
        name,
        date: String(t.createdAt || d || ''),
        score: t.score || null,
        wrong: normalizeWrong(t.wrong),
      });
    }
  }

  // /api/tests: { sid -> [...] } 또는 { date -> { sid -> [...] } } 모두 허용
  const pushTests = (arr) => {
    for (const t of arr) {
      if (!t || typeof t !== 'object') continue;
      const name = canonName(t.name);
      if (!name) continue;
      out.push({
        name,
        date: String(t.createdAt || ''),
        score: t.score || null,
        wrong: normalizeWrong(t.wrong),
      });
    }
  };

  if (Array.isArray(tests?.[sid])) pushTests(tests[sid]);
  for (const v of Object.values(tests || {})) {
    if (v && typeof v === 'object' && Array.isArray(v[sid])) pushTests(v[sid]);
  }

  // 같은 시험명은 최신 기록만 유지
  out.sort((a,b)=> String(a.date).localeCompare(String(b.date)));
  const latestByName = new Map();
  for (const rec of out) latestByName.set(rec.name, rec);
  return Array.from(latestByName.values());
}

/* =============================== */
/* 모달 UI 생성                    */
/* =============================== */
function ensureModal(){
  if ($('testModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="testModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);justify-content:center;align-items:center;z-index:9999">
      <div class="t-card" style="padding:1rem;border-radius:10px;max-height:80%;overflow:auto;width:620px">
        <h3 id="tTitle" style="margin:0 0 .5rem 0">테스트 진도</h3>
        <div id="tGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.75rem"></div>
        <div style="margin-top:.6rem;font-size:12px;opacity:.75">
          • 좌클릭: <b>미응시 → 완료 → 미응시</b> 순환 · 우클릭: <b>미응시</b>로 초기화<br>
          • 목록은 <b>해당 학생의 틀린 문항 수 ≥ 5</b> 시험만 표시합니다. (날짜 표시는 숨김)
        </div>
        <div style="text-align:right;margin-top:.8rem;display:flex;gap:.5rem;justify-content:flex-end">
          <button type="button" id="tSave">저장</button>
          <button type="button" id="tClose">닫기</button>
        </div>
      </div>
    </div>
  `);

  // 다크/라이트 대응 스타일
  const s = document.createElement('style');
  s.id = 'testModalStyles';
  s.textContent = `
    #testModal .t-card{
      background:#ffffff; color:#0f172a; border:1px solid #e5e7eb;
    }
    body.dark #testModal .t-card{
      background:#0f172a; color:#e5e7eb; border-color:#334155;
    }
    .t-cell{
      border:1px solid #e5e7eb; border-radius:12px; padding:.6rem .7rem; cursor:pointer;
      background:#ffffff; display:flex; flex-direction:column; gap:6px;
    }
    body.dark .t-cell{ border-color:#334155; background:#0b1220; }
    .t-cell.is-done{ background:#10b98122; border-color:#10b98155; }
    body.dark .t-cell.is-done{ background:color-mix(in srgb, #10b981 18%, transparent); border-color:#0ea56e; }
    .row{ display:flex; gap:8px; align-items:center; }
    .badge{
      font-size:11px; padding:2px 6px; border-radius:999px; background:#f3f4f6; color:#374151;
    }
    body.dark .badge{ background:#1f2937; color:#cbd5e1; }
    .t-cell.is-done .badge{ background:#10b981; color:#ffffff; }
    .t-name{ font-weight:800; letter-spacing:.2px; }
    .t-meta{ margin-left:auto; font-size:11px; color:#6b7280; white-space:nowrap; }
    body.dark .t-meta{ color:#94a3b8; }
    .hot-list{ display:flex; flex-wrap:wrap; gap:4px 6px; font-size:11px; }
    .hot{ padding:2px 6px; border-radius:999px; border:1px solid #f59e0b80; background:#f59e0b1a; color:#92400e; }
    body.dark .hot{ border-color:#f59e0bcc; background:#f59e0b24; color:#fef3c7; }
  `;
  document.head.appendChild(s);
}

/* =============================== */
/* 열기/렌더                        */
/* =============================== */
async function openModal(sid){
  const modal = $('testModal');
  if (!modal) return;
  editingSid = sid;

  const stu = (state.students||[]).find(x => String(x.id)===String(sid));
  $('tTitle').textContent = stu ? `${stu.name} – ${stu.curriculum}/${stu.subCurriculum||''} 테스트 진도` : '테스트 진도';

  let records = [];
  try {
    records = await collectStudentTests(sid); // [{name,date,score,wrong:[]}] (name은 이미 canon 처리)
  } catch (e) {
    console.warn('[testModal] collectStudentTests failed:', e);
  }

  // 필터: 틀린 개수 ≥ 5
  const retestTargets = (records || [])
    .map(r => ({ ...r, wrongN: Array.isArray(r.wrong) ? r.wrong.length : 0 }))
    .filter(r => r.wrongN >= 5)
    .sort((a,b) => b.wrongN - a.wrongN);

  const zone = $('tGrid');
  zone.innerHTML = '';

  if (!retestTargets.length){
    zone.innerHTML = `<div style="opacity:.7;padding:.5rem">틀린 개수 5개 이상인 시험이 없습니다.</div>`;
  } else {
    retestTargets.forEach(({ name, wrong, wrongN, score }) => {
      const cell = document.createElement('div');
      cell.className = 't-cell is-done';
      cell.dataset.name = name;
      cell.dataset.initial = 'done';
      cell.dataset.state = 'done';

      const wrongList = (wrong && wrong.length) ? wrong.join(', ') : '-';
      const meta = `${score ? ' · ' + score : ''}`;  // ★ 날짜 제거, 점수만 남김

      cell.innerHTML = `
        <div class="row">
          <span class="badge">완료</span>
          <span class="t-name">${name}</span>
          <span class="t-meta">틀린 ${wrongN}개${meta}</span>
        </div>
        <div class="hot-list" title="해당 학생이 틀린 문항들">
          <span class="hot">Q: ${wrongList}</span>
        </div>
      `;

      // 좌클릭: none <-> done 토글
      cell.addEventListener('click', ()=>{
        const next = (cell.dataset.state === 'done') ? 'none' : 'done';
        cell.dataset.state = next;
        cell.classList.toggle('is-done', next === 'done');
        const b = cell.querySelector('.badge');
        if (b){ b.textContent = next==='done' ? '완료' : '미응시'; }
      });

      // 우클릭: none 강제
      cell.addEventListener('contextmenu', (ev)=>{
        ev.preventDefault();
        cell.dataset.state = 'none';
        cell.classList.remove('is-done');
        const b = cell.querySelector('.badge');
        if (b){ b.textContent = '미응시'; }
      });

      zone.appendChild(cell);
    });
  }

  modal.style.display = 'flex';
}

/* =============================== */
/* 닫기/저장                       */
/* =============================== */
function closeModal(){ const m=$('testModal'); if (m) m.style.display='none'; }

async function saveModal(){
  if (!editingSid) return;
  const today = todayLocalKey();

  // 화면 상태 수집
  const out = {};
  document.querySelectorAll('#tGrid .t-cell').forEach(cell=>{
    const name = cell.dataset.name;
    const st = cell.dataset.state || 'none';
    if (st !== 'none') out[name] = st; // 완료만 기록 (none 생략)
  });

  // progress[today][sid].tests 저장
  state.progress[today] = state.progress[today] || {};
  const prev = state.progress[today][editingSid] || {};
  state.progress[today][editingSid] = { ...prev, tests: out };

  await postJSON('/api/progress', state.progress, 'tests:progress:save');

  toast('테스트 진도 저장됨');
  closeModal();

  // 완료/색상 등 재계산 필요 시
  document.dispatchEvent(new CustomEvent('admin:refresh'));
}

/* =============================== */
/* 부트스트랩                      */
/* =============================== */
export function initTestModal(){
  ensureModal();

  // 열기 버튼: 오늘 학생 표의 액션 버튼(🧪)
  document.body.addEventListener('click', (e)=>{
    const btn = e.target.closest('.openTestProgress');
    if (!btn) return;
    const sid = btn.closest('tr[data-sid]')?.dataset.sid;
    if (!sid) return;
    openModal(String(sid));
  });

  // 닫기/저장
  $('tClose')?.addEventListener('click', closeModal);
  document.getElementById('testModal')?.addEventListener('click', (e)=>{
    if (e.target?.id === 'testModal') closeModal();
  });
  $('tSave')?.addEventListener('click', saveModal);

  // 디버그 훅
  window._openTest = (sid) => openModal(String(sid));
}
