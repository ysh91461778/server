// /js/admin/features/logModal.js
// 수업 기록 모달 (저장/완료 포함)
// - 진도 드래그 구간 변경
// - Ctrl/Cmd+Enter → 완료
// - 숙제: "표" 형식(숙제명/단원명/진행률/남은 숙제) + 행 추가/삭제
// - ✅ 숙제명(교재명)은 한 번 추가하면 유지 (nameCarry)
// - ✅ 단원명~남은숙제는 "최근 기록"을 placeholder 로만 표시 (오늘 값은 value만)
// - 지난번 특이사항도 placeholder 로만 표시
// - 구형 homework(문자열) 호환: 남은 숙제 칸에 1행으로 보여줌 + 저장 시 homework 문자열도 같이 유지
// - ✅ 숙제 진행률: range(0~100, step 10) + 숫자칸 동기화
/* global fetch */

import { $, toast, postJSON, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

console.log('[logModal] HW-TABLE v2 (name persist + placeholders)');

let editingLogSid = null;
let logKeybound = false; // Ctrl+Enter 전역 바인딩 중복 방지

function injectStyles() {
  const old = document.getElementById('logModalStyles');
  if (old) old.remove();

  const s = document.createElement('style');
  s.id = 'logModalStyles';
  s.textContent = `
    #logModal{position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center}
    #logModal .log-card{
      position:relative; width:680px; max-width:95vw; max-height:82vh; overflow:auto;
      padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:#ffffff; color:#0f172a;
      box-shadow:0 12px 34px rgba(0,0,0,.34);
    }
    body.dark #logModal .log-card{ background:#0f172a; color:#e5e7eb; border-color:#334155; }

    #logModal h3{ margin:6px 0 10px; font-size:18px; font-weight:800; }
    #logModal label{ display:block; margin:10px 0 8px; font-size:14px; }

    /* ✅ range + (숫자칸 hwPctNum)은 width:100%에서 제외 */
    #logModal textarea,
    #logModal input:not([type="range"]):not(.hwPctNum){
      width:100%;
      box-sizing:border-box;
      border-radius:10px;
      padding:8px 10px;
      outline:none;
      border:1px solid #cbd5e1;
      background:#ffffff;
      color:#0f172a;
    }
    body.dark #logModal textarea,
    body.dark #logModal input:not([type="range"]):not(.hwPctNum){
      border-color:#475569;
      background:#0b1220;
      color:#e5e7eb;
    }

    /* 진도 그리드 */
    #logProgress{
      display:grid; grid-template-columns:repeat(auto-fill, minmax(82px,1fr));
      gap:8px; margin:8px 0 2px;
    }
    #logProgress .progress-cell{
      display:flex; align-items:center; justify-content:center;
      min-height:44px; padding:8px; border-radius:10px; box-sizing:border-box;
      border:1px solid #e5e7eb; background:#ffffff; color:#0f172a;
      font-size:14px; user-select:none; cursor:pointer; pointer-events:auto; position:relative;
      transition:filter .12s ease, border-color .12s ease;
    }
    body.dark #logProgress .progress-cell{ border-color:#334155; background:#0b1220; color:#e5e7eb; }
    #logProgress .progress-cell:hover{ filter:brightness(1.05); }

    #logProgress .progress-cell[data-state="done"]{ background:#10b98122; border-color:#10b98155; }
    body.dark #logProgress .progress-cell[data-state="done"]{
      background:color-mix(in srgb, #008558ff 18%, transparent); border-color:#0ea56e;
    }
    #logProgress .progress-cell[data-state="interrupted"]{ background:#f59e0b22; border-color:#f59e0b66; }
    body.dark #logProgress .progress-cell[data-state="interrupted"]{
      background:color-mix(in srgb, #fffb00ff 20%, transparent); border-color:#d97706;
    }
    #logProgress .progress-cell[data-state="skip"]{ background:#ef444422; border-color:#ef444466; color:#111; }
    body.dark #logProgress .progress-cell[data-state="skip"]{
      background:color-mix(in srgb, #ff0000ff 20%, transparent); border-color:#b91c1c; color:#fee2e2;
    }

    /* 숙제 표 */
    #hwWrap{ margin-top:6px; }
    #hwTable{
      width:100%;
      border-collapse:separate;
      border-spacing:0;
      border:1px solid #e5e7eb;
      border-radius:12px;
      overflow:hidden;
    }
    body.dark #hwTable{ border-color:#334155; }

    #hwTable thead th{
      text-align:left;
      font-size:12px;
      color:#64748b;
      font-weight:900;
      padding:10px 10px;
      background:#f8fafc;
      border-bottom:1px solid #e5e7eb;
    }
    body.dark #hwTable thead th{
      background:#0b1220;
      color:#94a3b8;
      border-bottom-color:#334155;
    }

    #hwTable td{
      padding:8px 8px;
      border-bottom:1px solid #e5e7eb;
      vertical-align:middle;
    }
    body.dark #hwTable td{ border-bottom-color:#334155; }
    #hwTable tbody tr:last-child td{ border-bottom:none; }

    /* 4컬럼 + 삭제 */
#hwTable .hw-name{ width:20%; }
#hwTable .hw-unit{ width:18%; }
#hwTable .hw-pct{  width:22%; }  /* 진행률 줄이고 */
#hwTable .hw-rem{  width:36%; }  /* ✅ 남은 숙제 크게 */
#hwTable .hw-del{  width:4%; }


    #hwTable input{ height:36px; border-radius:10px; padding:7px 10px; box-sizing:border-box; }
    #hwTable input::placeholder{ color:#94a3b8; }
    body.dark #hwTable input::placeholder{ color:#64748b; }

    .pctBox{ display:flex; align-items:center; gap:10px; width:100%; }
    .hwPctRange{
      flex:1 1 auto;
      min-width:120px;
      height:46px; padding:0; border:0; outline:none;
      background:transparent;
      cursor:grab;
      -webkit-appearance:none;
      appearance:none;
      touch-action:none;
    }
    .hwPctRange:active{ cursor:grabbing; }

    /* ✅ 숫자칸 고정 */
    #hwTable .hwPctNum{
      flex:0 0 72px;
      width:72px;
      text-align:right;
      padding:7px 10px;
    }

    /* WebKit track/thumb */
    .hwPctRange::-webkit-slider-runnable-track{
      height:14px;
      border-radius:999px;
      background:#e5e7eb;
    }
    body.dark .hwPctRange::-webkit-slider-runnable-track{ background:#334155; }
    .hwPctRange::-webkit-slider-thumb{
      -webkit-appearance:none;
      width:30px; height:30px;
      border-radius:50%;
      background:#0f172a;
      border:2px solid #fff;
      margin-top:-8px;
    }
    body.dark .hwPctRange::-webkit-slider-thumb{
      background:#e5e7eb;
      border-color:#0b1220;
    }

    /* Firefox */
    .hwPctRange::-moz-range-track{
      height:14px; border-radius:999px; background:#e5e7eb;
    }
    body.dark .hwPctRange::-moz-range-track{ background:#334155; }
    .hwPctRange::-moz-range-thumb{
      width:30px; height:30px; border-radius:50%;
      background:#0f172a; border:2px solid #fff;
    }

    .hw-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
    .hw-actions button{
      height:34px; padding:0 10px; border-radius:10px;
      border:1px solid #e5e7eb; background:#f8fafc; color:#0f172a; cursor:pointer;
      font-weight:900;
    }
    body.dark .hw-actions button{ border-color:#334155; background:#1f2937; color:#e5e7eb; }

    .hw-del-btn{
      height:34px; width:34px; border-radius:10px;
      border:1px solid #e5e7eb; background:#fff; cursor:pointer;
    }
    body.dark .hw-del-btn{ border-color:#334155; background:#0b1220; color:#e5e7eb; }

    #logModal .actions{ display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
    #logModal .actions button{
      height:36px; padding:0 12px; border-radius:10px; border:1px solid #e5e7eb; background:#f8fafc; color:#0f172a; cursor:pointer;
    }
    body.dark #logModal .actions button{ border-color:#334155; background:#1f2937; color:#e5e7eb; }
    `;
  document.head.appendChild(s);
}

function modalTemplateHTML() {
  return `
      <div id="logModal">
        <div class="log-card">
          <h3 id="logTitle">수업 기록</h3>

          <label>특이사항<br><textarea id="logNotes" rows="4" placeholder=""></textarea></label>

          <label>진도</label>
          <div id="logProgress"></div>

          <label>숙제</label>
          <div id="hwWrap">
            <table id="hwTable" aria-label="숙제 표">
              <thead>
                <tr>
                  <th class="hw-name">숙제명(교재명)</th>
                  <th class="hw-unit">단원명</th>
                  <th class="hw-pct">진행률(0~100%)</th>
                  <th class="hw-rem">남은 숙제</th>
                  <th class="hw-del"></th>
                </tr>
              </thead>
              <tbody id="hwBody"></tbody>
            </table>
            <div class="hw-actions">
              <button type="button" id="hwAddRow">+ 추가</button>
            </div>
          </div>

          <div class="actions">
            <button type="button" id="logSave">저장</button>
            <button type="button" id="logdoneBtn">완료</button>
            <button type="button" id="logClose">닫기</button>
          </div>
        </div>
      </div>`;
}

function ensureModal() {
  document.getElementById('logModal')?.remove();
  injectStyles();
  document.body.insertAdjacentHTML('beforeend', modalTemplateHTML());
}

function shouldSkipForLow(stu, v) {
  if (!stu || stu.level !== '하') return false;
  const ex = v && v.exNum;
  if (!ex || typeof ex !== 'object') return false;
  return Number(ex['하']) === 0;
}

// 공통: /api/watch 날짜키에서 sid 맵 추출(로컬 today → UTC today → 최신키 → watch[sid])
function pickWatchForSid(watchAll, sid, todayStr) {
  sid = String(sid);
  const today = todayStr || todayLocalKey?.() || new Date().toISOString().slice(0, 10);
  const has = (d) => watchAll?.[d]?.[sid];
  const utcToday = new Date().toISOString().slice(0, 10);

  if (has(today)) return watchAll[today][sid];
  if (has(utcToday)) return watchAll[utcToday][sid];

  const dateKeys = Object.keys(watchAll || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  for (let i = dateKeys.length - 1; i >= 0; i--) {
    const d = dateKeys[i];
    if (has(d)) return watchAll[d][sid];
  }
  if (watchAll?.[sid]) return watchAll[sid];
  return {};
}

/* ─────────────────────────────
* 숙제 표 helpers
* ───────────────────────────── */
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normHwRows(x) {
  if (!Array.isArray(x)) return [];
  return x.map(r => ({
    name: String(r?.name ?? '').trim(),
    unit: String(r?.unit ?? '').trim(),
    pct: (r?.pct === '' || r?.pct == null) ? '' : String(r.pct).trim(),
    rem: String(r?.rem ?? '').trim(),
  }));
}

function snap10(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n / 10) * 10));
}

function defaultPctValue(v) {
  const s = (v === '' || v == null) ? '' : String(v).trim();
  if (s === '') return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  return String(Math.max(0, Math.min(100, Math.round(n))));
}

// ✅ 오늘(todayRows): value
// ✅ 최근(latestRows): placeholder(단원/진행률/남은숙제)
// ✅ nameCarryRows: 숙제명 유지(오늘이 비어있을 때도 name을 value로 끌고옴)
function mergeHwRows({ todayRows, latestRows, nameCarryRows }) {
  const a = normHwRows(todayRows);
  const b = normHwRows(latestRows);
  const c = normHwRows(nameCarryRows);

  const n = Math.max(a.length, b.length, c.length, 1);
  const out = [];

  for (let i = 0; i < n; i++) {
    const t = a[i] || { name: '', unit: '', pct: '', rem: '' };
    const l = b[i] || { name: '', unit: '', pct: '', rem: '' };
    const nc = c[i] || { name: '', unit: '', pct: '', rem: '' };

    out.push({
      // value(오늘)
      name: t.name || nc.name || '',
      unit: t.unit || '',
      pct: t.pct || '',
      rem: t.rem || '',

      // placeholder(최근)
      _ph: {
        unit: l.unit || '',
        pct: l.pct || '',
        rem: l.rem || '',
      }
    });
  }
  return out;
}

function renderHwTable(mergedRows) {
  const tbody = $('hwBody');
  if (!tbody) return;

  const rows = Array.isArray(mergedRows) ? mergedRows : [];
  const n = Math.max(rows.length, 1);

  // ✅ "최근 숙제(placeholder)"가 하나도 없으면 "숙제 없음"
  const hasPrevAny = rows.some(r => {
    const ph = r?._ph || {};
    return !!((ph.unit || '').trim() || (ph.pct || '').toString().trim() || (ph.rem || '').trim());
  });
  const EMPTY_PH_TEXT = '숙제 없음';

  const rowHtml = (i) => {
    const r = rows[i] || { name: '', unit: '', pct: '', rem: '', _ph: {} };
    const ph = r._ph || {};

    const nameVal = (r.name || '').trim();
    const unitVal = (r.unit || '').trim();
    const remVal = (r.rem || '').trim();

    // pct: 오늘 값은 비어있을 수 있음 (placeholder만 보여주기)
    const pctNumVal = (r.pct === '' || r.pct == null) ? '' : String(snap10(r.pct));
    const pctRangeVal = pctNumVal === '' ? '100' : pctNumVal;

    const phUnit = hasPrevAny ? (ph.unit || '') : EMPTY_PH_TEXT;
    const phPct = hasPrevAny ? (ph.pct === '' ? '' : String(ph.pct)) : EMPTY_PH_TEXT;
    const phRem = hasPrevAny ? (ph.rem || '') : EMPTY_PH_TEXT;

    return `
      <tr data-idx="${i}">
        <td class="hw-name">
          <input class="hwName" type="text"
                 value="${escapeAttr(nameVal)}"
                 placeholder="">
        </td>

        <td class="hw-unit">
          <input class="hwUnit" type="text"
                 value="${escapeAttr(unitVal)}"
                 placeholder="${escapeAttr(phUnit)}">
        </td>

        <td class="hw-pct">
          <div class="pctBox">
            <input class="hwPctRange" type="range" min="0" max="100" step="10"
                   value="${escapeAttr(pctRangeVal)}"
                   aria-label="진행률 슬라이더">
            <input class="hwPctNum" type="number" inputmode="numeric" min="0" max="100" step="10"
                   value="${escapeAttr(pctNumVal)}"
                   placeholder="${escapeAttr(phPct)}">
          </div>
        </td>

        <td class="hw-rem">
          <input class="hwRem" type="text"
                 value="${escapeAttr(remVal)}"
                 placeholder="${escapeAttr(phRem)}">
        </td>

        <td class="hw-del">
          <button type="button" class="hw-del-btn" title="삭제">✕</button>
        </td>
      </tr>`;
  };

  tbody.innerHTML = Array.from({ length: n }, (_, i) => rowHtml(i)).join('');
}



function addHwRow(nameCarry = '') {
  const tbody = $('hwBody');
  if (!tbody) return;

  tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td class="hw-name">
          <input class="hwName" type="text" value="${escapeAttr(nameCarry)}" placeholder="">
        </td>

        <td class="hw-unit">
          <input class="hwUnit" type="text" value="" placeholder="">
        </td>

        <td class="hw-pct">
          <div class="pctBox">
            <input class="hwPctRange" type="range" min="0" max="100" step="10" value="100" aria-label="진행률 슬라이더">
            <input class="hwPctNum" type="number" inputmode="numeric" min="0" max="100" step="10" value="" placeholder="">
          </div>
        </td>

        <td class="hw-rem">
          <input class="hwRem" type="text" value="" placeholder="">
        </td>

        <td class="hw-del">
          <button type="button" class="hw-del-btn" title="삭제">✕</button>
        </td>
      </tr>`);
}

function collectHwTable() {
  const tbody = $('hwBody');
  if (!tbody) return [];
  const out = [];

  tbody.querySelectorAll('tr').forEach(tr => {
    const name = (tr.querySelector('.hwName')?.value || '').trim();
    const unit = (tr.querySelector('.hwUnit')?.value || '').trim();
    const rem = (tr.querySelector('.hwRem')?.value || '').trim();

    // 숫자박스 기준 저장 (비면 저장도 비게)
    let pctRaw = (tr.querySelector('.hwPctNum')?.value ?? '').toString().trim();
    let pct = '';
    if (pctRaw !== '') {
      let n = Number(pctRaw);
      if (Number.isFinite(n)) {
        n = snap10(Math.max(0, Math.min(100, n)));
        pct = String(n);
      }
    }

    // 완전 빈 행 제거
    if (!name && !unit && !pct && !rem) return;

    out.push({ name, unit, pct, rem });
  });

  return out;
}

function hwRowToSummary(r) {
  const name = (r.name || '').trim();
  const unit = (r.unit || '').trim();
  const pct = (r.pct === '' ? '' : `${String(r.pct).trim()}%`);
  const rem = (r.rem || '').trim();

  const parts = [];
  if (name) parts.push(name);
  if (unit) parts.push(unit);
  if (pct) parts.push(pct);
  if (rem) parts.push(rem);
  return parts.join(' ');
}

function buildHwSummary(rows) {
  const lines = (rows || [])
    .map(hwRowToSummary)
    .map(s => s.trim())
    .filter(Boolean);
  return lines.join(' / ');
}

export function initLogModal() {
  ensureModal();

  const logModal = $('logModal');
  const logTitle = $('logTitle');
  const logNotes = $('logNotes');
  const logSave = $('logSave');
  const logDone = $('logdoneBtn');
  const logClose = $('logClose');
  const progEl = $('logProgress');

  // ─────────────────────────────
  // 숙제 이벤트(위임)
  // ─────────────────────────────
  $('hwBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hw-del-btn');
    if (!btn) return;
    btn.closest('tr')?.remove();

    const tbody = $('hwBody');
    if (tbody && tbody.querySelectorAll('tr').length === 0) addHwRow('');
  });

  // ✅ range ↔ number 동기화
  // - range를 움직이면 number에 value 넣어줌
  // - number는 입력 중 공백 허용, change에서 snap10 적용
  $('hwBody')?.addEventListener('input', (e) => {
    const t = e.target;
    const tr = t.closest('tr');
    if (!tr) return;

    const range = tr.querySelector('.hwPctRange');
    const num = tr.querySelector('.hwPctNum');
    if (!range || !num) return;

    if (t.classList.contains('hwPctRange')) {
      num.value = String(range.value);
    } else if (t.classList.contains('hwPctNum')) {
      if (num.value === '') return;
      let v = Number(num.value);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      num.value = String(v);
      range.value = String(v);
    }
  });

  $('hwBody')?.addEventListener('change', (e) => {
    const t = e.target;
    const tr = t.closest('tr');
    if (!tr) return;

    const range = tr.querySelector('.hwPctRange');
    const num = tr.querySelector('.hwPctNum');
    if (!range || !num) return;

    if (t.classList.contains('hwPctNum')) {
      if (num.value === '') return;
      let v = Number(num.value);
      if (!Number.isFinite(v)) return;
      v = snap10(Math.max(0, Math.min(100, v)));
      num.value = String(v);
      range.value = String(v);
    }
  });

  $('hwAddRow')?.addEventListener('click', () => {
    // 현재 마지막 name을 들고 가서 다음 줄 기본값으로 유지(원하면 빈칸으로 바꿔도 됨)
    const lastName = Array.from(document.querySelectorAll('#hwBody .hwName'))
      .map(i => (i.value || '').trim())
      .filter(Boolean)
      .slice(-1)[0] || '';
    addHwRow(lastName);
  });

  // Ctrl+Enter / Cmd+Enter → 완료
  if (!logKeybound) {
    logKeybound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || (!e.ctrlKey && !e.metaKey)) return;

      const modal = document.getElementById('logModal');
      if (!modal) return;
      const visible = window.getComputedStyle(modal).display !== 'none';
      if (!visible) return;

      e.preventDefault();
      e.stopPropagation();
      document.getElementById('logdoneBtn')?.click();
    }, true);
  }

  const nextStateOf = (s) =>
    s === 'none' ? 'done'
      : s === 'done' ? 'interrupted'
        : s === 'interrupted' ? 'none'
          : 'none';

  const updateCellState = (cell, next) => {
    if (!cell) return;
    cell.dataset.state = next;
    cell.dataset.cleared = (next === 'none' && cell.dataset.initial !== 'none') ? '1' : '';
  };

  // ─────────────────────────────
  // 드래그로 "구간" 상태 변경 (마우스)
  // ─────────────────────────────
  let pointerDown = false;
  let dragActive = false;
  let dragTarget = null;
  let startState = 'none';
  let startIndex = -1;
  let suppressClickOnce = false;

  let dragCells = [];
  let dragInitialStates = [];

  const rebuildDragCells = () => {
    dragCells = Array.from(progEl.querySelectorAll('.progress-cell'));
    dragInitialStates = dragCells.map(c => c.dataset.state || 'none');
  };

  function applyDragRange(currentCell) {
    if (!pointerDown || !dragActive) return;
    const curIndex = dragCells.indexOf(currentCell);
    if (curIndex === -1 || startIndex === -1) return;

    const lo = Math.min(startIndex, curIndex);
    const hi = Math.max(startIndex, curIndex);

    dragCells.forEach((cell, idx) => {
      const initial = dragInitialStates[idx] || 'none';
      const next = (idx >= lo && idx <= hi) ? dragTarget : initial;
      updateCellState(cell, next);
    });
  }

  const handleMove = (e) => {
    if (!pointerDown) return;
    const cell = e.target.closest('.progress-cell');
    if (!cell) return;

    if (!dragActive) {
      dragActive = true;
      dragTarget = nextStateOf(startState);
    }
    applyDragRange(cell);
    e.preventDefault();
  };

  progEl.addEventListener('mousemove', handleMove);
  progEl.addEventListener('mouseover', handleMove);

  document.addEventListener('mouseup', () => {
    if (!pointerDown) return;
    pointerDown = false;
    if (dragActive) suppressClickOnce = true;

    dragActive = false;
    dragTarget = null;
    startState = 'none';
    startIndex = -1;
  });

  progEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const cell = e.target.closest('.progress-cell');
    if (!cell) return;

    rebuildDragCells();

    startIndex = dragCells.indexOf(cell);
    if (startIndex === -1) return;

    pointerDown = true;
    dragActive = false;
    dragTarget = null;
    startState = cell.dataset.state || 'none';
  });

  // 열기 (📝 버튼)
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('.editLog');
    if (!btn) return;

    editingLogSid = btn.closest('tr')?.dataset.sid;

    const stu = state.students.find(x => String(x.id) === String(editingLogSid));
    if (!stu) { alert('학생 정보를 찾을 수 없습니다.'); return; }

    logTitle.textContent = `${stu.name} – ${stu.curriculum}`;
    const today = todayLocalKey();

    // 날짜 목록: progress + logs 합집합
    const dates = Array.from(new Set([
      ...Object.keys(state.progress || {}),
      ...Object.keys(state.logs || {}),
    ]))
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
      .sort();

    // 1) 누적 진도상태(오늘 포함) 취합
    const progEntry = {};
    dates.forEach(d => {
      const day = (state.progress?.[d] || {})[editingLogSid] || {};
      Object.entries(day).forEach(([mid, st]) => { progEntry[String(mid)] = st; });
    });

    // 2) 오늘 로그값
    const logEntry = (state.logs[today] || {})[editingLogSid] || {};
    logNotes.value = logEntry.notes || '';

    // 특이사항 placeholder
    logNotes.placeholder = '';
    if (!logEntry.notes) {
      for (let i = dates.length - 1; i >= 0; i--) {
        const d = dates[i];
        if (d >= today) continue;
        const prev = (state.logs[d] || {})[editingLogSid];
        if (prev?.notes) { logNotes.placeholder = prev.notes; break; }
      }
    }

    // ─────────────────────────────
    // 숙제: 규칙
    // - 숙제명(교재명): 한번 입력하면 유지 (nameCarry)
    // - 단원/진행률/남은숙제: 최근 과거를 placeholder로만 표시
    // - 오늘 값은 value로만 표시
    // ─────────────────────────────
    let todayRows = [];
    if (Array.isArray(logEntry.homeworkTable)) {
      todayRows = normHwRows(logEntry.homeworkTable);
    } else if (typeof logEntry.homework === 'string' && logEntry.homework.trim()) {
      // 구형 호환(남은숙제에 1행)
      todayRows = [{ name: '', unit: '', pct: '', rem: logEntry.homework.trim() }];
    }

    // 최신 과거(placeholder용: unit/pct/rem)
    let latestRows = [];
    // nameCarry용: name만 유지시키기 위해 "가장 최근에 name이 있었던 행들"을 긁어옴
    let nameCarryRows = [];

    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      if (d >= today) continue;
      const prev = (state.logs[d] || {})[editingLogSid];
      if (!prev) continue;

      if (Array.isArray(prev.homeworkTable) && prev.homeworkTable.length) {
        const rows = normHwRows(prev.homeworkTable);

        // placeholder는 최신 1개만
        if (latestRows.length === 0) latestRows = rows;

        // nameCarry는 name이 있는 최신 1개만
        if (nameCarryRows.length === 0 && rows.some(r => (r.name || '').trim())) {
          nameCarryRows = rows.map(r => ({ name: r.name, unit: '', pct: '', rem: '' }));
        }

        if (latestRows.length && nameCarryRows.length) break;
      }

      // 구형 문자열
      if (typeof prev.homework === 'string' && prev.homework.trim()) {
        if (latestRows.length === 0) latestRows = [{ name: '', unit: '', pct: '', rem: prev.homework.trim() }];
        // nameCarry는 만들 수 없으니 스킵
        if (latestRows.length) break;
      }
    }

    const merged = mergeHwRows({ todayRows, latestRows, nameCarryRows });
    renderHwTable(merged);

    // 진도 셀 렌더
    progEl.innerHTML = '';
    state.videos
      .filter(v => v.curriculum === stu.curriculum && v.subCurriculum === stu.subCurriculum)
      .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))
      .forEach(v => {
        const cell = document.createElement('div');
        cell.className = 'progress-cell';
        cell.textContent = `${v.chapter}차시`;
        cell.dataset.mid = String(v.mid);

        const autoSkip = shouldSkipForLow(stu, v);
        const initial = progEntry[String(v.mid)] || (autoSkip ? 'skip' : 'none');
        cell.dataset.initial = initial;
        cell.dataset.state = initial;
        cell.dataset.cleared = '';

        cell.addEventListener('click', () => {
          if (suppressClickOnce) { suppressClickOnce = false; return; }
          const s = cell.dataset.state || 'none';
          updateCellState(cell, nextStateOf(s));
        });

        cell.addEventListener('contextmenu', ev => {
          ev.preventDefault();
          updateCellState(cell, 'skip');
        });

        progEl.append(cell);
      });

    logModal.style.display = 'flex';

    try {
      if (window.showStudentTooltipForSid) {
        window.showStudentTooltipForSid(editingLogSid, { variant: 'log', fixed: true });
      }
    } catch (err) {
      console.warn('[logModal] show tooltip failed:', err);
    }
  });

  // 닫기
  const close = () => {
    logModal.style.display = 'none';
    editingLogSid = null;
    try { if (window.hideStudentTooltip) window.hideStudentTooltip(); } catch { }
  };
  logClose.addEventListener('click', close);
  logModal.addEventListener('click', (e) => { if (e.target === logModal) close(); });

  // 저장 공통
  async function saveBase(doneFlag) {
    const today = todayLocalKey();

    const newProg = {};
    document.querySelectorAll('#logProgress .progress-cell').forEach(cell => {
      const st = cell.dataset.state;
      const initial = cell.dataset.initial || 'none';
      const mid = String(cell.dataset.mid);

      if (st !== 'none') newProg[mid] = st;
      else if (initial !== 'none' || cell.dataset.cleared === '1') newProg[mid] = 'none';
    });

    // 완료 시 watch 자동 반영(기존 로직 유지)
    try {
      if (doneFlag) {
        const TH_DONE = 95;
        const TH_INTERRUPTED = 5;
        const pctOf = (w) => (!w || !Number(w.dur))
          ? 0
          : Math.max(0, Math.min(100, Math.floor(((Number(w.last) || 0) / Number(w.dur)) * 100)));
        const autoState = (w) => (!w)
          ? null
          : (w.completed || pctOf(w) >= TH_DONE) ? 'done'
            : (pctOf(w) >= TH_INTERRUPTED) ? 'interrupted'
              : null;

        let watchAll = {};
        try { watchAll = await fetch('/api/watch', { cache: 'no-store' }).then(r => r.json()); } catch { watchAll = {}; }

        const raw = pickWatchForSid(watchAll, editingLogSid, today) || {};
        const watchByMid = {};
        Object.keys(raw || {}).forEach(k => { watchByMid[String(k)] = raw[k]; });

        const watchProg = {};
        document.querySelectorAll('#logProgress .progress-cell[data-mid]').forEach(cell => {
          const mid = String(cell.dataset.mid);
          const w = watchByMid[mid];
          const st = autoState(w);
          if (st) watchProg[mid] = st;
        });

        Object.assign(newProg, watchProg);
      }
    } catch (e) {
      console.warn('[logModal] watch merge failed:', e);
    }

    // 최신 logs 다시 받아오기(기존 유지)
    let latestLogs;
    try { latestLogs = await fetch('/api/logs', { cache: 'no-store' }).then(r => r.json()); }
    catch { latestLogs = state.logs || {}; }
    state.logs = latestLogs;

    // progress 저장
    if (!state.progress) state.progress = {};
    state.progress[today] = state.progress[today] || {};
    state.progress[today][editingLogSid] = newProg;
    await postJSON('/api/progress', state.progress, doneFlag ? 'logDone:progress' : 'logSave:progress');

    // 진도 요약(기존 유지)
    const oldDates = Object.keys(state.progress).filter(d => d < today);
    const oldTotal = {};
    oldDates.forEach(d => {
      Object.entries(state.progress[d]?.[editingLogSid] || {}).forEach(([mid, st]) => { oldTotal[String(mid)] = st; });
    });
    const label = (mid, st) => {
      if (st === 'none') return null;
      const v = state.videos.find(v => String(v.mid) === String(mid));
      if (!v) return null;
      const base = `${v.chapter}차시`;
      return st === 'done' ? base : (st === 'interrupted' ? `${base}(중단)` : (st === 'skip' ? `${base}(건너뜀)` : null));
    };
    const summary = Object.entries(newProg)
      .filter(([mid, st]) => oldTotal[String(mid)] !== st && st !== 'none')
      .map(([mid, st]) => label(mid, st))
      .filter(Boolean)
      .join(', ');

    // 숙제 표 저장 + 구형 문자열도 유지
    const hwRows = collectHwTable();
    const hwSummary = buildHwSummary(hwRows);

    const dayMap = state.logs[today] = state.logs[today] || {};
    const prev = dayMap[editingLogSid] || {};
    dayMap[editingLogSid] = {
      ...prev,
      notes: logNotes.value.trim(),
      topic: summary,

      // 구형 호환
      homework: hwSummary,

      // 신형
      homeworkTable: hwRows,

      done: !!doneFlag,
      archived: (typeof prev.archived !== 'undefined') ? prev.archived : false,
      progress: newProg
    };

    await postJSON('/api/logs', state.logs, doneFlag ? 'logDone:logs' : 'logSave:logs');
  }

  logSave.addEventListener('click', async () => {
    await saveBase(false);
    toast('수업 기록 저장됨');
    close();
    document.dispatchEvent(new CustomEvent('admin:refresh'));
  });

  logDone.addEventListener('click', async () => {
    await saveBase(true);
    toast('완료 처리됨');
    close();
    document.dispatchEvent(new CustomEvent('admin:refresh'));
  });
}

/* ─────────────────────────────────────────────
* 자동 판정 애드온(견고 버전): 날짜키/타입 불일치 + 렌더 타이밍 보강
* ────────────────────────────────────────────*/
(() => {
  const WATCH_URL = '/api/watch';
  const TH_DONE = 95, TH_INTERRUPTED = 5;

  const pctOf = (w) => (!w || !Number(w.dur))
    ? 0
    : Math.max(0, Math.min(100, Math.floor(((Number(w.last) || 0) / Number(w.dur)) * 100)));
  const autoState = (w) => (!w)
    ? null
    : (w.completed || pctOf(w) >= TH_DONE) ? 'done'
      : (pctOf(w) >= TH_INTERRUPTED) ? 'interrupted'
        : null;

  function applyAutoWhenReady(watchByMid) {
    let tries = 0;
    const tick = () => {
      const grid = document.getElementById('logProgress');
      if (!grid || !grid.children.length) {
        if (tries++ < 10) return setTimeout(tick, 100);
        return;
      }
      grid.querySelectorAll('.progress-cell[data-mid]').forEach(cell => {
        const mid = String(cell.dataset.mid);
        const w = watchByMid[mid];
        const st = autoState(w);
        if (!st) return;
        cell.dataset.initial = st;
        cell.dataset.state = st;
        cell.dataset.cleared = '';
      });
    };
    tick();
  }

  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.editLog');
    if (!btn) return;

    const tr = btn.closest('tr[data-sid]');
    const sid = tr?.dataset?.sid;
    if (!sid) return;

    let watchAll = {};
    try { watchAll = await fetch(WATCH_URL, { cache: 'no-store' }).then(r => r.json()); } catch { watchAll = {}; }
    const raw = pickWatchForSid(watchAll, sid) || {};

    const watchByMid = {};
    Object.keys(raw).forEach(k => { watchByMid[String(k)] = raw[k]; });

    requestAnimationFrame(() => applyAutoWhenReady(watchByMid));
  }, false);
})();
