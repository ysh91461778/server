// /js/admin/features/logModal.js
// 수업 기록 모달 (저장/완료 포함)
// - 진도 드래그 구간 변경
// - Ctrl/Cmd+Enter → 완료(=하원)
// - 숙제: "2줄" 형식(정확히 반반)
//    1줄: 교재 / 이번 숙제(+진행률바 같은 줄, 오른쪽) / 삭제
//    2줄: 코멘트(50%) / 다음 숙제(50%) / 삭제
// - ✅ 교재(교재명)은 한 번 추가하면 유지 (bookCarry)
// - ✅ 이번숙제~다음숙제는 "최근 기록"을 placeholder 로만 표시 (오늘 값은 value만)
// - ✅ '다음 숙제'에 기입한 내용이 다음 수업 때 '이번 숙제' placeholder로 뜸
// - 구형 homework(문자열) 호환: 코멘트 칸에 1행 + 저장 시 homework 문자열도 같이 유지
// - 구형 homeworkTable(4칸: name/unit/pct/rem) 호환: 교재=name, 이번숙제=unit, 코멘트=rem 로 매핑
// - ✅ 숙제 진행률: range(0~100, step 10)만 유지 + 바 위에 % bubble 표시
// - ✅ "완료" 대신 "하원" 표기 + 하원 시간 기록
// - ✅ (변경) "저장"은 그냥 저장만
// - ✅ (추가) "숙제 배정 완료" 버튼: 저장 + hwAssigned 체크
// - ✅ (유지) "숙제 검사 완료" 버튼: 저장 + hwChecked 체크(+ hwAssigned도 함께 체크)
// - ✅ (핵심) logs 저장은 /api/logs/patch(부분 저장)만 사용 => 동시 작업 날아감 방지
/* global fetch */

import { $, toast, postJSON, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

console.log('[logModal] HW-TABLE v6.5 (PATCH logs to prevent overwrite)');

let editingLogSid = null;
let logKeybound = false; // Ctrl/Cmd+Enter 전역 바인딩 중복 방지

function pad2(n) { return String(n).padStart(2, '0'); }
function nowHHMM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function nowISO() { return new Date().toISOString(); }

async function patchLogEntry(date, sid, entry, clearKeys) {
  const body = { date, sid, entry: entry || {} };
  if (Array.isArray(clearKeys) && clearKeys.length) body.__clear = clearKeys;
  const res = await fetch('/api/logs/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok || !data?.ok) {
    const msg = data?.error ? `patch 실패: ${data.error}` : 'patch 실패';
    throw new Error(msg);
  }
}

function injectStyles() {
  const old = document.getElementById('logModalStyles');
  if (old) old.remove();

  const s = document.createElement('style');
  s.id = 'logModalStyles';
  s.textContent = `
    #logModal{position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center}
    #logModal .log-card{
      position:relative; width:760px; max-width:96vw; max-height:82vh; overflow:auto;
      padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:#ffffff; color:#0f172a;
      box-shadow:0 12px 34px rgba(0,0,0,.34);
    }
    body.dark #logModal .log-card{ background:#0f172a; color:#e5e7eb; border-color:#334155; }

    #logModal h3{ margin:6px 0 10px; font-size:18px; font-weight:800; }
    #logModal label{ display:block; margin:10px 0 8px; font-size:14px; }

    #logModal textarea,
    #logModal input:not([type="range"]){
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
    body.dark #logModal input:not([type="range"]){
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

    /* ─────────────────────────────
      숙제(2줄)
    ───────────────────────────── */
    #hwWrap{ margin-top:6px; }
    #hwBox{
      border:1px solid #e5e7eb;
      border-radius:12px;
      overflow:hidden;
      background:#fff;
    }
    body.dark #hwBox{ border-color:#334155; background:#0b1220; }

    .hwHeader{
      padding:10px 10px;
      background:#f8fafc;
      border-bottom:1px solid #e5e7eb;
    }
    body.dark .hwHeader{
      background:#0b1220;
      border-bottom-color:#334155;
    }

    .hwHeaderTop, .hwHeaderBot{
      display:grid;
      gap:8px 12px;
      align-items:start;
    }
    .hwHeaderTop{ grid-template-columns: 1.1fr 1fr 44px; }
    .hwHeaderBot{ grid-template-columns: 1fr 1fr 44px; margin-top:8px; }

    .hwHeader .h{
      font-size:12px;
      color:#64748b;
      font-weight:900;
      white-space:nowrap;
    }
    body.dark .hwHeader .h{ color:#94a3b8; }
    .hwHeader .h-del{ text-align:right; opacity:.65; }

    #hwBody{
      padding:10px 10px;
      display:flex;
      flex-direction:column;
      gap:12px;
    }

    .hwItem{ display:flex; flex-direction:column; gap:8px; }

    .hwTop{
      display:grid;
      grid-template-columns: 1.1fr 1fr 44px;
      gap:8px 12px;
      align-items:start;
    }
    .hwBot{
      display:grid;
      grid-template-columns: 1fr 1fr 44px;
      gap:8px 12px;
      align-items:start;
    }

    .hwDelCell{
      display:flex;
      justify-content:flex-end;
      align-self:start;
      padding-top:2px;
    }

    #hwBody input{ height:36px; border-radius:10px; padding:7px 10px; box-sizing:border-box; }
    #hwBody input::placeholder{ color:#94a3b8; }
    body.dark #hwBody input::placeholder{ color:#64748b; }

    .thisCell{
      display:grid;
      grid-template-columns: 1fr 210px;
      gap:10px;
      align-items:start;
      min-width:0;
    }
    .thisCell .thisInputWrap{ min-width:0; }
    .thisCell .thisInputWrap input{ min-width:0; }

    .pctWrap{
      position:relative;
      padding-top:16px;
      min-width:0;
    }

    .pctBubble{
      position:absolute;
      top:0;
      left:0;
      transform:translateX(-50%);
      padding:2px 7px;
      border-radius:999px;
      font-size:12px;
      font-weight:900;
      background:#ffffff;
      border:1px solid #e5e7eb;
      color:#0f172a;
      pointer-events:none;
      white-space:nowrap;
    }
    body.dark .pctBubble{
      background:#0f172a;
      border-color:#334155;
      color:#e5e7eb;
    }
    .pctBubble.is-ph{ opacity:.55; font-weight:800; }

    .hwPctRange{
      width:100%;
      height:46px; padding:0; border:0; outline:none;
      background:transparent;
      cursor:grab;
      -webkit-appearance:none;
      appearance:none;
      touch-action:none;
    }
    .hwPctRange:active{ cursor:grabbing; }

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

    #logModal .actions{ display:flex; gap:8px; justify-content:flex-end; margin-top:10px; flex-wrap:wrap; }
    #logModal .actions button{
      height:36px; padding:0 12px; border-radius:10px; border:1px solid #e5e7eb; background:#f8fafc; color:#0f172a; cursor:pointer;
      font-weight:900; white-space:nowrap;
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
            <div id="hwBox">
              <div class="hwHeader" aria-label="숙제 헤더">
                <div class="hwHeaderTop">
                  <div class="h">교재</div>
                  <div class="h">이번 숙제 / 진행률</div>
                  <div class="h h-del"></div>
                </div>
                <div class="hwHeaderBot">
                  <div class="h">코멘트</div>
                  <div class="h">다음 숙제</div>
                  <div class="h h-del"></div>
                </div>
              </div>
              <div id="hwBody" aria-label="숙제 목록"></div>
            </div>

            <div class="hw-actions">
              <button type="button" id="hwAddRow">+ 추가</button>
            </div>
          </div>

          <div class="actions">
            <button type="button" id="logCompleteBtn">숙제 검사 완료</button>
            <button type="button" id="logAssignBtn">숙제 배정 완료</button>
            <button type="button" id="logSave">저장</button>
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
 * 숙제 helpers
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
    book: String(r?.book ?? '').trim(),
    this: String(r?.this ?? '').trim(),
    pct: (r?.pct === '' || r?.pct == null) ? '' : String(r.pct).trim(),
    comment: String(r?.comment ?? '').trim(),
    next: String(r?.next ?? '').trim(),
    _deleted: !!(r?._deleted || r?._del || r?.deleted),
  }));
}

function normOldHwRows4(x) {
  if (!Array.isArray(x)) return [];
  return x.map(r => ({
    book: String(r?.name ?? '').trim(),
    this: String(r?.unit ?? '').trim(),
    pct: (r?.pct === '' || r?.pct == null) ? '' : String(r.pct).trim(),
    comment: String(r?.rem ?? '').trim(),
    next: '',
    _deleted: false,
  }));
}

function snap10(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n / 10) * 10));
}

function mergeHwRows({ todayRows, latestRows, bookCarryRows }) {
  const a = normHwRows(todayRows);
  const b = normHwRows(latestRows);
  const c = normHwRows(bookCarryRows);

  const n = Math.max(a.length, b.length, c.length, 1);
  const out = [];

  for (let i = 0; i < n; i++) {
    const t = a[i] || { book: '', this: '', pct: '', comment: '', next: '', _deleted: false };
    const l = b[i] || { book: '', this: '', pct: '', comment: '', next: '', _deleted: false };
    const bc = c[i] || { book: '', this: '', pct: '', comment: '', next: '', _deleted: false };

    const phThis = (l.next || '').trim() ? l.next : (l.this || '');

    const hasTodayRow = i < a.length;

    out.push({
      _deleted: !!t._deleted,
      book: (hasTodayRow ? (t.book || '') : (bc.book || '')),
      this: t.this || '',
      pct: t.pct || '',
      comment: t.comment || '',
      next: t.next || '',
      _ph: { this: phThis || '', pct: l.pct || '', comment: l.comment || '', next: l.next || '' }
    });
  }
  return out;
}

function updatePctBubble(wrapEl, value, { isPlaceholder = false } = {}) {
  if (!wrapEl) return;
  const bubble = wrapEl.querySelector('.pctBubble');
  if (!bubble) return;

  const v = snap10(value);
  bubble.textContent = `${v}%`;
  bubble.classList.toggle('is-ph', !!isPlaceholder);
  bubble.style.left = `${Math.max(0, Math.min(100, v))}%`;
}

function renderHwTable(mergedRows) {
  const host = $('hwBody');
  if (!host) return;

  const rows = Array.isArray(mergedRows) ? mergedRows : [];
  const n = Math.max(rows.length, 1);

  const hasPrevAny = rows.some(r => {
    const ph = r?._ph || {};
    return !!(
      (ph.this || '').trim() ||
      (ph.pct || '').toString().trim() ||
      (ph.comment || '').trim() ||
      (ph.next || '').trim()
    );
  });
  const EMPTY_PH_TEXT = '숙제 없음';

  const itemHtml = (i) => {
    const r = rows[i] || { book: '', this: '', pct: '', comment: '', next: '', _deleted: false, _ph: {} };
    const ph = r._ph || {};

    const bookVal = (r.book || '').trim();
    const thisVal = (r.this || '').trim();
    const cmtVal = (r.comment || '').trim();
    const nextVal = (r.next || '').trim();

    const phThis = hasPrevAny ? (ph.this || '') : EMPTY_PH_TEXT;
    const phCmt = hasPrevAny ? (ph.comment || '') : EMPTY_PH_TEXT;
    const phNext = hasPrevAny ? (ph.next || '') : EMPTY_PH_TEXT;

    const pctToday = (r.pct === '' || r.pct == null) ? '' : String(snap10(r.pct));
    const pctPh = (ph.pct === '' || ph.pct == null) ? '' : String(snap10(ph.pct));

    const displayPct = pctToday !== '' ? pctToday : (pctPh !== '' ? pctPh : '0');
    const emptyFlag = (pctToday === '') ? '1' : '0';

    const deleted = !!r._deleted;
    const delAttr = deleted ? '1' : '0';
    const hideStyle = deleted ? 'style="display:none"' : '';

    return `
      <div class="hwItem" data-idx="${i}" data-deleted="${delAttr}" ${hideStyle}>
        <div class="hwTop">
          <div class="hw-book">
            <input class="hwBook" type="text" value="${escapeAttr(bookVal)}" placeholder="">
          </div>

          <div class="hw-this">
            <div class="thisCell">
              <div class="thisInputWrap">
                <input class="hwThis" type="text" value="${escapeAttr(thisVal)}" placeholder="${escapeAttr(phThis)}">
              </div>

              <div class="pctWrap" data-empty="${emptyFlag}">
                <span class="pctBubble"></span>
                <input class="hwPctRange" type="range" min="0" max="100" step="10"
                       value="${escapeAttr(displayPct)}" aria-label="진행률 슬라이더">
              </div>
            </div>
          </div>

          <div class="hwDelCell">
            <button type="button" class="hw-del-btn" title="삭제">✕</button>
          </div>
        </div>

        <div class="hwBot">
          <div class="hw-cmt">
            <input class="hwComment" type="text" value="${escapeAttr(cmtVal)}" placeholder="${escapeAttr(phCmt)}">
          </div>

          <div class="hw-next">
            <input class="hwNext" type="text" value="${escapeAttr(nextVal)}" placeholder="${escapeAttr(phNext)}">
          </div>

          <div class="hwDelCell">
            <button type="button" class="hw-del-btn" title="삭제">✕</button>
          </div>
        </div>
      </div>`;
  };

  host.innerHTML = Array.from({ length: n }, (_, i) => itemHtml(i)).join('');

  host.querySelectorAll('.pctWrap').forEach(wrap => {
    const range = wrap.querySelector('.hwPctRange');
    if (!range) return;
    const isPh = (wrap.dataset.empty === '1');
    updatePctBubble(wrap, range.value, { isPlaceholder: isPh });
  });
}

function addHwRow(bookCarry = '') {
  const host = $('hwBody');
  if (!host) return;

  host.insertAdjacentHTML('beforeend', `
    <div class="hwItem" data-idx="" data-deleted="0">
      <div class="hwTop">
        <div class="hw-book">
          <input class="hwBook" type="text" value="${escapeAttr(bookCarry)}" placeholder="">
        </div>

        <div class="hw-this">
          <div class="thisCell">
            <div class="thisInputWrap">
              <input class="hwThis" type="text" value="" placeholder="">
            </div>

            <div class="pctWrap" data-empty="0">
              <span class="pctBubble"></span>
              <input class="hwPctRange" type="range" min="0" max="100" step="10" value="0" aria-label="진행률 슬라이더">
            </div>
          </div>
        </div>

        <div class="hwDelCell">
          <button type="button" class="hw-del-btn" title="삭제">✕</button>
        </div>
      </div>

      <div class="hwBot">
        <div class="hw-cmt">
          <input class="hwComment" type="text" value="" placeholder="">
        </div>

        <div class="hw-next">
          <input class="hwNext" type="text" value="" placeholder="">
        </div>

        <div class="hwDelCell">
          <button type="button" class="hw-del-btn" title="삭제">✕</button>
        </div>
      </div>
    </div>
  `);

  const lastWrap = host.querySelector('.hwItem:last-child .pctWrap');
  if (lastWrap) {
    const range = lastWrap.querySelector('.hwPctRange');
    updatePctBubble(lastWrap, range?.value ?? 0, { isPlaceholder: false });
  }
}

function collectHwTable() {
  const host = $('hwBody');
  if (!host) return [];
  const out = [];

  host.querySelectorAll('.hwItem').forEach(item => {
    const deleted = item.dataset.deleted === '1';

    const book = (item.querySelector('.hwBook')?.value || '').trim();
    const thisHw = (item.querySelector('.hwThis')?.value || '').trim();
    const comment = (item.querySelector('.hwComment')?.value || '').trim();
    const next = (item.querySelector('.hwNext')?.value || '').trim();

    const wrap = item.querySelector('.pctWrap');
    const range = item.querySelector('.hwPctRange');
    const raw = range ? snap10(range.value) : 0;

    const empty = (wrap?.dataset?.empty === '1');
    const pct = empty ? '' : String(raw);

    if (deleted) {
      out.push({ book: '', this: '', pct: '', comment: '', next: '', _deleted: true });
      return;
    }

    if (!book && !thisHw && !pct && !comment && !next) return;
    out.push({ book, this: thisHw, pct, comment, next, _deleted: false });
  });

  return out;
}

function hwRowToSummary(r) {
  if (r?._deleted) return '';
  const book = (r.book || '').trim();
  const thisHw = (r.this || '').trim();
  const pct = (r.pct === '' ? '' : `${String(r.pct).trim()}%`);
  const cmt = (r.comment || '').trim();
  const next = (r.next || '').trim();

  const parts = [];
  if (book) parts.push(`[${book}]`);
  if (thisHw) parts.push(thisHw);
  if (pct) parts.push(pct);
  if (cmt) parts.push(`(${cmt})`);
  if (next) parts.push(`→ ${next}`);
  return parts.join(' ');
}

function buildHwSummary(rows) {
  const lines = (rows || [])
    .map(hwRowToSummary)
    .map(s => s.trim())
    .filter(Boolean);
  return lines.join(' / ');
}

/* ─────────────────────────────────────────────
 * ✅ hwAssigned / hwChecked PATCH (부분 저장)
 * ────────────────────────────────────────────*/
async function markHwFlagsRemote(dateKey, sid, { assigned, checked }) {
  const date = dateKey || todayLocalKey();
  const ksid = String(sid);
  const t = nowHHMM();

  // ✅ flags만 patch
  const entry = {};
  if (assigned) {
    entry.hwAssigned = true;
    entry.hwAssignedAt = t;
  }
  if (checked) {
    entry.hwChecked = true;
    entry.hwCheckedAt = t;
    // 검사 완료면 배정도 같이 true로 맞춰버림(원래 요구사항)
    entry.hwAssigned = true;
    entry.hwAssignedAt = entry.hwAssignedAt || t;
  }

  await patchLogEntry(date, ksid, entry);

  // state.logs도 부분 반영(화면 갱신/내보내기 계산용)
  state.logs = state.logs || {};
  state.logs[date] = state.logs[date] || {};
  state.logs[date][ksid] = { ...(state.logs[date][ksid] || {}), ...entry };
}

export function initLogModal() {
  ensureModal();

  const logModal = $('logModal');
  const logTitle = $('logTitle');
  const logNotes = $('logNotes');
  const logSave = $('logSave');
  const logAssign = $('logAssignBtn');
  const logClose = $('logClose');
  const progEl = $('logProgress');
  const logComplete = $('logCompleteBtn');

  // ✅ 삭제(전역 위임 + 캡처) - remove 대신 tombstone 처리
  if (!window.__hwDelDelegatedBound) {
    window.__hwDelDelegatedBound = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button.hw-del-btn');
      if (!btn) return;
      if (!btn.closest('#logModal')) return;

      e.preventDefault();
      e.stopPropagation();

      const item = btn.closest('.hwItem');
      if (!item) return;

      item.dataset.deleted = '1';
      item.style.display = 'none';

      const book = item.querySelector('.hwBook'); if (book) book.value = '';
      const th = item.querySelector('.hwThis'); if (th) th.value = '';
      const cmt = item.querySelector('.hwComment'); if (cmt) cmt.value = '';
      const nx = item.querySelector('.hwNext'); if (nx) nx.value = '';
      const wrap = item.querySelector('.pctWrap');
      const range = item.querySelector('.hwPctRange');
      if (wrap) wrap.dataset.empty = '1';
      if (range) range.value = '0';
      if (wrap) updatePctBubble(wrap, 0, { isPlaceholder: true });

      const host = document.getElementById('hwBody');
      if (host) {
        const visible = Array.from(host.querySelectorAll('.hwItem'))
          .some(x => x.dataset.deleted !== '1' && x.style.display !== 'none');
        if (!visible) addHwRow('');
      }
    }, true);
  }

  document.getElementById('hwBody')?.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.classList.contains('hwPctRange')) return;
    const wrap = t.closest('.pctWrap');
    if (!wrap) return;
    wrap.dataset.empty = '0';
    updatePctBubble(wrap, t.value, { isPlaceholder: false });
  });

  document.getElementById('hwBody')?.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.classList.contains('hwPctRange')) return;
    const wrap = t.closest('.pctWrap');
    if (!wrap) return;
    const v = snap10(t.value);
    t.value = String(v);
    wrap.dataset.empty = '0';
    updatePctBubble(wrap, v, { isPlaceholder: false });
  });

  $('hwAddRow')?.addEventListener('click', () => {
    const lastBook = Array.from(document.querySelectorAll('#hwBody .hwBook'))
      .map(i => (i.value || '').trim())
      .filter(Boolean)
      .slice(-1)[0] || '';
    addHwRow(lastBook);
  });

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

    const dates = Array.from(new Set([
      ...Object.keys(state.progress || {}),
      ...Object.keys(state.logs || {}),
    ]))
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
      .sort();

    const progEntry = {};
    dates.forEach(d => {
      const day = (state.progress?.[d] || {})[editingLogSid] || {};
      Object.entries(day).forEach(([mid, st]) => { progEntry[String(mid)] = st; });
    });

    const logEntry = (state.logs[today] || {})[editingLogSid] || {};
    logNotes.value = logEntry.notes || '';

    logNotes.placeholder = '';
    if (!logEntry.notes) {
      for (let i = dates.length - 1; i >= 0; i--) {
        const d = dates[i];
        if (d >= today) continue;
        const prev = (state.logs[d] || {})[editingLogSid];
        if (prev?.notes) { logNotes.placeholder = prev.notes; break; }
      }
    }

    // 숙제 로드
    let todayRows = [];
    if (Array.isArray(logEntry.homeworkTable) && logEntry.homeworkTable.length) {
      const first = logEntry.homeworkTable[0] || {};
      if (Object.prototype.hasOwnProperty.call(first, 'book') || Object.prototype.hasOwnProperty.call(first, 'this')) {
        todayRows = normHwRows(logEntry.homeworkTable);
      } else {
        todayRows = normOldHwRows4(logEntry.homeworkTable);
      }
    } else if (typeof logEntry.homework === 'string' && logEntry.homework.trim()) {
      todayRows = [{ book: '', this: '', pct: '', comment: logEntry.homework.trim(), next: '', _deleted: false }];
    }

    let latestRows = [];
    let bookCarryRows = [];

    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      if (d >= today) continue;
      const prev = (state.logs[d] || {})[editingLogSid];
      if (!prev) continue;

      if (Array.isArray(prev.homeworkTable) && prev.homeworkTable.length) {
        let rows = [];
        const first = prev.homeworkTable[0] || {};
        if (Object.prototype.hasOwnProperty.call(first, 'book') || Object.prototype.hasOwnProperty.call(first, 'this')) {
          rows = normHwRows(prev.homeworkTable);
        } else {
          rows = normOldHwRows4(prev.homeworkTable);
        }

        if (latestRows.length === 0) latestRows = rows;

        if (bookCarryRows.length === 0 && rows.some(r => (r.book || '').trim())) {
          bookCarryRows = rows.map(r => ({ book: r.book, this: '', pct: '', comment: '', next: '', _deleted: false }));
        }

        if (latestRows.length && bookCarryRows.length) break;
      }

      if (typeof prev.homework === 'string' && prev.homework.trim()) {
        if (latestRows.length === 0) latestRows = [{ book: '', this: '', pct: '', comment: prev.homework.trim(), next: '', _deleted: false }];
        if (latestRows.length) break;
      }
    }

    const merged = mergeHwRows({ todayRows, latestRows, bookCarryRows });
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

  // ✅ 저장 공통 (progress는 기존대로 /api/progress에 저장)
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

    // 완료(=하원) 시 watch 자동 반영(기존 유지)
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

    // progress 저장(기존 유지)
    if (!state.progress) state.progress = {};
    state.progress[today] = state.progress[today] || {};
    state.progress[today][editingLogSid] = newProg;
    await postJSON('/api/progress', state.progress, doneFlag ? 'logLeave:progress' : 'logSave:progress');

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

    // 숙제 저장
    const hwRows = collectHwTable();
    const hwSummary = buildHwSummary(hwRows);

    // 기존 flags/leaveTime은 서버에 있는 걸 믿고, 여기서는 "현재 저장 내용"만 patch
    const entry = {
      notes: logNotes.value.trim(),
      topic: summary,
      homework: hwSummary,
      homeworkTable: hwRows,
      done: !!doneFlag,
      progress: newProg,
      updatedAt: nowISO(),
    };

    // 하원 기록은 doneFlag일 때만 갱신
    if (doneFlag) {
      entry.leaveTime = nowHHMM();
      entry.leaveAt = nowISO();
    }

    // ✅ logs는 PATCH로만 저장 (핵심)
    await patchLogEntry(today, String(editingLogSid), entry);

    // state.logs도 부분 반영
    state.logs = state.logs || {};
    state.logs[today] = state.logs[today] || {};
    state.logs[today][String(editingLogSid)] = {
      ...(state.logs[today][String(editingLogSid)] || {}),
      ...entry
    };
  }

  // ✅ 저장: 그냥 저장만
  logSave.addEventListener('click', async () => {
    try {
      await saveBase(false);
      toast('수업 기록 저장됨');
      close();
      document.dispatchEvent(new CustomEvent('admin:refresh'));
    } catch (err) {
      console.error(err);
      alert('저장 실패');
    }
  });

  // ✅ 숙제 배정 완료: 저장 + hwAssigned 체크
  logAssign?.addEventListener('click', async () => {
    try {
      await saveBase(false);
      const today = todayLocalKey();
      await markHwFlagsRemote(today, editingLogSid, { assigned: true, checked: false });
      toast(`숙제 배정 완료 (${nowHHMM()})`);
      close();
      document.dispatchEvent(new CustomEvent('admin:refresh'));
    } catch (err) {
      console.error(err);
      alert('숙제 배정 완료 저장 실패');
    }
  });

  // ✅ 숙제 검사 완료: 저장 + hwChecked 체크(+ hwAssigned도 같이 체크)
  logComplete.addEventListener('click', async () => {
    try {
      await saveBase(false);
      const today = todayLocalKey();
      await markHwFlagsRemote(today, editingLogSid, { assigned: true, checked: true });
      toast(`숙제 검사 완료 (${nowHHMM()})`);
      close();
      document.dispatchEvent(new CustomEvent('admin:refresh'));
    } catch (err) {
      console.error(err);
      alert('숙제 검사 완료 저장 실패');
    }
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
