// /js/admin/features/today.js
// 오늘 학생표 렌더 + 드래그 순서 저장 + '완료' 제외 + '결석' 처리
// + 주말(토/일) 타임(1,2,3) 표시/정렬 + '보강' 라벨 제거
// + 오늘 명단 CSV 내보내기
// + 연강(주말 다중 슬롯) 지원: 토2·토3 / 일1·일2 등
// + ✅ 주말 '구분' 셀 직접 편집 → 저장 즉시 재정렬
// + ✅ 보강인 학생: 요일 라벨에 (보강) 표시 (예: 일2(보강), 수(보강))
// + ✅ 출석 체크 칼럼(체크박스)
// + ✅ 예정 등원 시간(주중/주말 공통) 표시 + 셀 직접 수정 가능(로컬 저장)

import { $, toast, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

const CT = { 'Content-Type': 'application/json' };
let _orderMap = null;        // { "YYYY-MM-DD": ["sid","sid",...] }
let WEEKEND_SLOTS = {};      // { "YYYY-MM-DD": { sid: 1|2|3 | [1,2,3] } }
const WCHR = '일월화수목금토';

/* ─────────────────────────────────────────────
 * 요일·슬롯별 "기본 예정 등원 시간" 매핑
 *   - 평일: 월~금 모두 18:00
 *   - 주말 슬롯형: 토1/일1 10:00, 토2/일2 14:00, 토3/일3 18:00
 *   (학생별 visitTime1~5가 있으면 그것이 1순위, 이 맵은 최종 폴백)
 * ────────────────────────────────────────────*/
const ARRIVE_TIME_MAP = {
  // 토요일
  '토1': '10:00',
  '토2': '14:00',
  '토3': '18:00',

  // 일요일
  '일1': '10:00',
  '일2': '14:00',
  '일3': '18:00',

  // 평일 공통
  '월': '18:00',
  '화': '18:00',
  '수': '18:00',
  '목': '18:00',
  '금': '18:00',
};

/* ─────────────────────────────────────────────
 * 출석 체크 (localStorage)
 * ────────────────────────────────────────────*/
const ATT_PREFIX = 'attend_check:';

function loadAttendMap(dateKey) {
  try {
    const raw = localStorage.getItem(ATT_PREFIX + dateKey);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveAttendMap(dateKey, map) {
  try { localStorage.setItem(ATT_PREFIX + dateKey, JSON.stringify(map || {})); } catch { }
}
function setAttended(dateKey, sid, checked) {
  const m = loadAttendMap(dateKey);
  if (checked) m[String(sid)] = 1;
  else delete m[String(sid)];
  saveAttendMap(dateKey, m);
}
function isAttended(dateKey, sid) {
  const m = loadAttendMap(dateKey);
  return !!m[String(sid)];
}

/* ─────────────────────────────────────────────
 * 예정 등원시간 override 저장 (localStorage)
 *  키: arrive_time:YYYY-MM-DD  ->  { sid: "HH:MM" | 기타 문자열 }
 * ────────────────────────────────────────────*/
const ARRIVE_PREFIX = 'arrive_time:';

function loadArriveMap(dateKey) {
  try {
    const raw = localStorage.getItem(ARRIVE_PREFIX + dateKey);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveArriveMap(dateKey, map) {
  try { localStorage.setItem(ARRIVE_PREFIX + dateKey, JSON.stringify(map || {})); } catch { }
}
function getArriveOverride(dateKey, sid) {
  const m = loadArriveMap(dateKey);
  return m[String(sid)] ?? '';
}
function setArriveOverride(dateKey, sid, value) {
  const m = loadArriveMap(dateKey);
  const k = String(sid);
  const v = (value || '').trim();
  if (v) m[k] = v;
  else delete m[k];
  saveArriveMap(dateKey, m);
}

// ──────────────────────────────────────────────────────────────
// weekend slots 로드(없으면 {})
// ──────────────────────────────────────────────────────────────
async function loadWeekendSlots() {
  try {
    WEEKEND_SLOTS = await fetch('/api/weekend-slots', { cache: 'no-store' }).then(r => r.json());
  } catch {
    WEEKEND_SLOTS = {};
  }
}

// ──────────────────────────────────────────────────────────────
// today_order 불러오기/적용/저장/삭제
// ──────────────────────────────────────────────────────────────
async function loadOrderMap() {
  if (_orderMap) return _orderMap;
  try { _orderMap = await fetch('/api/today_order', { cache: 'no-store' }).then(r => r.json()); }
  catch { _orderMap = {}; }
  return _orderMap;
}
function applySavedOrder(list, dateKey) {
  const saved = (_orderMap?.[dateKey] || []).map(String);
  if (!saved.length) return list;
  const byId = new Map(list.map(s => [String(s.id), s]));
  const used = new Set(); const ordered = [];
  for (const id of saved) { const it = byId.get(id); if (it) { ordered.push(it); used.add(id); } }
  for (const s of list) if (!used.has(String(s.id))) ordered.push(s);
  return ordered;
}
async function saveOrder(dateKey, newOrderIds) {
  let latest;
  try { latest = await fetch('/api/today_order', { cache: 'no-store' }).then(r => r.json()); }
  catch { latest = {}; }
  latest[dateKey] = newOrderIds.map(String);
  await fetch('/api/today_order', { method: 'POST', headers: CT, body: JSON.stringify(latest) });
  _orderMap = latest;
}
async function clearTodayOrder(dateKey) {
  try {
    const latest = await fetch('/api/today_order', { cache: 'no-store' }).then(r => r.json()).catch(() => ({}));
    if (latest && latest[dateKey]) {
      delete latest[dateKey];
      await fetch('/api/today_order', { method: 'POST', headers: CT, body: JSON.stringify(latest) });
      _orderMap = latest;
    }
  } catch { }
}

// ──────────────────────────────────────────────────────────────
// Sortable 부착
// ──────────────────────────────────────────────────────────────
function tbodyEl() { return document.querySelector('#todayWrap table tbody'); }
function attachSortable(dateKey) {
  const tb = tbodyEl(); if (!tb) return;
  if (tb._sortable) { try { tb._sortable.destroy(); } catch { } tb._sortable = null; }
  if (!window.Sortable) { console.warn('[today] SortableJS 미로드'); return; }
  tb._sortable = window.Sortable.create(tb, {
    animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost',
    onEnd: async () => {
      const newOrder = Array.from(tb.querySelectorAll('tr[data-sid]')).map(tr => String(tr.dataset.sid));
      try { await saveOrder(dateKey, newOrder); toast('순서 저장됨'); }
      catch (e) { console.error(e); alert('순서 저장 실패'); }
    }
  });
}
(function () { // iOS 드래그 보조
  if (document.getElementById('drag-handle-style')) return;
  const s = document.createElement('style'); s.id = 'drag-handle-style'; s.textContent = '.drag-handle{touch-action:none;}';
  document.head.appendChild(s);
})();

// ──────────────────────────────────────────────────────────────
// 헬퍼(요일/슬롯) — ‘보강’ 라벨 제거 & 주말 슬롯(연강 포함) 표시/정렬
// ──────────────────────────────────────────────────────────────
function dayValues(stu) {
  return Object.keys(stu).filter(k => /^day\d+$/.test(k) && stu[k])
    .sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10))
    .map(k => String(stu[k]));
}
function hasWeekday(stu, wchr) { return dayValues(stu).some(v => String(v).startsWith(wchr)); }
function yoilOf(dateStr) { return WCHR[new Date(dateStr).getDay()]; }

function getStudent(sid) {
  return (state.students || []).find(x => String(x.id) === String(sid));
}

// 해당 날짜에 이 학생이 보강(extra)로 올라온 건지 판별
function isExtra(dateStr, sid) {
  const arr = (state.extra?.[dateStr] || []).map(String);
  return arr.includes(String(sid));
}

// 내부: 해당 날짜/학생의 슬롯을 배열로 반환(연강 지원)
function getSlots(dateStr, sid) {
  const raw = WEEKEND_SLOTS?.[dateStr]?.[String(sid)];
  if (Array.isArray(raw)) {
    return raw.filter(n => Number.isInteger(n)).sort((a, b) => a - b);
  }
  if (Number.isInteger(raw)) return [raw];

  const w = yoilOf(dateStr);
  if (w !== '토' && w !== '일') return [];

  const stu = getStudent(sid);
  if (!stu) return [];

  const nums = dayValues(stu)
    .filter(v => String(v).startsWith(w))
    .map(v => {
      const m = String(v).match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    })
    .filter(n => Number.isInteger(n));

  if (nums.length) {
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  }
  return [];
}

// 표시용 라벨
function labelFor(dateStr, sid) {
  const w = yoilOf(dateStr);
  let base;
  if (w === '토' || w === '일') {
    const slots = getSlots(dateStr, sid);
    base = slots.length ? slots.map(n => `${w}${n}`).join('·') : w;
  } else {
    base = w;
  }
  return isExtra(dateStr, sid) ? `${base}(보강)` : base;
}

// 정렬키 (연강이면 최소 슬롯 사용)
function sortKeyFor(dateStr, sid) {
  const w = yoilOf(dateStr);
  if (w === '토' || w === '일') {
    const slots = getSlots(dateStr, sid);
    if (slots.length) return Math.min(...slots);
  }
  return 99;
}

/* ─────────────────────────────────────────────
 * 요일/슬롯 → "예정 등원 시간" 키 만들기
 * ────────────────────────────────────────────*/
function plannedKeyFor(dateStr, stu) {
  const w = yoilOf(dateStr);
  if (!stu) return w;

  // 주말: 슬롯정보 기준
  if (w === '토' || w === '일') {
    const slots = getSlots(dateStr, stu.id);
    const minSlot = slots.length ? Math.min(...slots) : null;
    if (minSlot != null) return `${w}${minSlot}`;
    return w;
  }

  // 평일: day1~5 중 해당 요일로 시작하는 것 (예: "수2", "수")
  const dvals = dayValues(stu).filter(v => String(v).startsWith(w));
  if (dvals.length) {
    const raw = dvals[0];
    const m = String(raw).match(/\d+/);
    const num = m ? m[0] : '';
    return num ? `${w}${num}` : w;
  }

  return w;
}

/* ─────────────────────────────────────────────
 * 전체학생 table에서 저장한 visitTime1~5 기준 시간 찾기
 *   - 오늘 요일과 매칭되는 day1~5를 먼저 찾고
 *   - 그 인덱스의 visitTimeN 이 있으면 그걸 사용
 * ────────────────────────────────────────────*/
function plannedTimeFromStudent(dateStr, stu) {
  if (!stu) return '';
  const w = yoilOf(dateStr); // '월' ~ '일'

  for (let i = 1; i <= 5; i++) {
    const dayVal = (stu[`day${i}`] || '').trim();
    if (!dayVal) continue;
    if (!dayVal.startsWith(w)) continue;

    const t = (stu[`visitTime${i}`] || '').trim();
    if (t) return t;
  }
  return '';
}

/* ─────────────────────────────────────────────
 * 기본 예정시간: (1) 학생 visitTimeN → (2) ARRIVE_TIME_MAP
 * ────────────────────────────────────────────*/
function plannedTimeBase(dateStr, sid) {
  const stu = getStudent(sid);
  if (!stu) return '';

  // 1순위: 학생별 요일/등원시간 (visitTime1~5)
  const fromStu = plannedTimeFromStudent(dateStr, stu);
  if (fromStu) return fromStu;

  // 2순위: 요일/슬롯 키 기반 기본값
  const key = plannedKeyFor(dateStr, stu); // 예: '수2', '토1'
  if (ARRIVE_TIME_MAP[key]) return ARRIVE_TIME_MAP[key];

  // 평일의 경우 '수2' 같은 키면 '수'로 폴백
  const ch = key ? key[0] : '';
  if (ch && ARRIVE_TIME_MAP[ch]) return ARRIVE_TIME_MAP[ch];

  return '';
}

// override → base 순으로 시간 선택
function plannedTimeFor(dateStr, sid) {
  const ov = getArriveOverride(dateStr, sid);
  if (ov && ov.trim()) return ov.trim();
  return plannedTimeBase(dateStr, sid);
}

// HH:MM → 총 분, 해석 불가면 +∞ (정렬 맨 뒤)
function minutesFromTimeStr(str) {
  if (!str) return Number.POSITIVE_INFINITY;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.POSITIVE_INFINITY;
  return hh * 60 + mm;
}
function plannedMinutesFor(dateStr, sid) {
  return minutesFromTimeStr(plannedTimeFor(dateStr, sid));
}

// ──────────────────────────────────────────────────────────────
// done && !archived 로그 모아서 학생별 최신 1건만
// ──────────────────────────────────────────────────────────────
function collectUnarchivedDoneLogsAllDates() {
  const logs = state.logs || {};
  const dates = Object.keys(logs).sort(); // ISO라 오름차순=시간순
  const latestBySid = new Map(); // sid -> { entry, date }

  for (const date of dates) {
    const dayMap = logs[date] || {};
    for (const sid of Object.keys(dayMap)) {
      const e = dayMap[sid] || {};
      const done = e.done === true || e.done === 'true';
      const archived = e.archived === true || e.archived === 'true';
      if (!done || archived) continue;
      latestBySid.set(String(sid), { entry: e, date });
    }
  }

  const out = [];
  for (const [sid, { entry, date }] of latestBySid.entries()) {
    out.push([sid, entry, date]);
  }
  out.sort((a, b) => a[2].localeCompare(b[2]));
  return out;
}

// ──────────────────────────────────────────────────────────────
// 구분 셀 편집 → weekend-slots 저장 → 오늘 순서 초기화 → 재렌더
// ──────────────────────────────────────────────────────────────
function parseSlotsFromText(txt) {
  const nums = (txt.match(/[1-3]/g) || []).map(n => parseInt(n, 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}
async function saveWeekendSlotsFromLabel(sid, labelText) {
  const today = todayLocalKey();
  const w = yoilOf(today);
  if (!(w === '토' || w === '일')) return;

  let weekend = {};
  try { weekend = await fetch('/api/weekend-slots', { cache: 'no-store' }).then(r => r.json()); } catch { }
  const perDay = weekend[today] || {};

  const slots = parseSlotsFromText(labelText);
  if (slots.length) {
    perDay[String(sid)] = slots;
  } else {
    delete perDay[String(sid)];
  }
  weekend[today] = perDay;

  await fetch('/api/weekend-slots', { method: 'POST', headers: CT, body: JSON.stringify({ [today]: perDay }) });

  await clearTodayOrder(today);

  await loadWeekendSlots();
  await loadOrderMap();
  loadTodayAndRender();
}

// ──────────────────────────────────────────────────────────────
function renderToday(list, dateKey) {
  const host = $('todayWrap'); const cnt = $('todayCount'); if (!host) return;

  const rows = list.map(s => {
    const curLabel = s.curriculum + (s.subCurriculum ? ' ' + s.subCurriculum : '');
    const label = labelFor(dateKey, s.id);
    const isWeekend = ['토', '일'].includes(yoilOf(dateKey));
    const checked = isAttended(dateKey, s.id);
    const attTime = plannedTimeFor(dateKey, s.id);   // 예정 등원시간(override 포함)
    const school = s.school ?? s.schoolName ?? s.highSchool ?? s.middleSchool ?? s.high ?? s.middle ?? s.schoolHigh ?? s.schoolMiddle ?? '';

    return `
      <tr data-sid="${s.id}" ${checked ? 'data-att="1"' : ''}>
        <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>

        <td>
          ${isWeekend
        ? `<span class="slotLabel" contenteditable="true" spellcheck="false" data-orig="${label || ''}"
                 style="display:inline-block;min-width:48px;padding:2px 6px;border-radius:6px;border:1px solid transparent"
               >${label || yoilOf(dateKey)}</span>`
        : label}
        </td>

        <!-- 예정 등원시간(직접 수정 가능) -->
        <td class="att-time" style="text-align:center; width:90px;">
          <span class="arriveLabel"
                contenteditable="true"
                spellcheck="false"
                data-orig="${attTime || ''}"
                style="display:inline-block;min-width:60px;padding:2px 6px;border-radius:6px;border:1px solid transparent">
            ${attTime || ''}
          </span>
        </td>

        <!-- 출석 체크 -->
        <td style="text-align:center; width:84px">
          <input type="checkbox" class="attendChk" data-id="${s.id}" ${checked ? 'checked' : ''} title="오늘 출석 체크" style="
      width:24px; height:24px;
    ">
        </td>

        <td>
          <a href="/student/${s.id}" target="_blank" class="stuName"
             data-sid="${s.id}"
             data-grade="${s.grade ?? s.gradeNum ?? ''}"
             data-high="${s.high ?? s.highSchool ?? s.schoolHigh ?? ''}"
             data-middle="${s.middle ?? s.midSchool ?? s.schoolMiddle ?? ''}"
             data-school="${s.school ?? s.schoolName ?? s.high ?? s.highSchool ?? s.middle ?? s.midSchool ?? ''}"
             data-b1="${s.subBook1 ?? s.workbook1 ?? s.book1 ?? s['부교재1'] ?? ''}"
             data-b2="${s.subBook2 ?? s.workbook2 ?? s.book2 ?? s['부교재2'] ?? ''}">
            ${s.name}
          </a>
        </td>

        <td>${school || ''}</td>

        <td>${curLabel}</td>

        <td><button class="btn-doc" data-doc-url="${s.docUrl || ''}" title="구글 독스 열기">📄</button></td>

        <td>
          <button class="editVid" title="영상 배정">🎬</button>
          <button class="editLog" title="수업 기록">📝</button>
          <button class="openTestProgress" title="테스트 진도">🧪</button>
          <button class="markAbsent" title="결석">❌</button>
        </td>
      </tr>`;
  }).join('');

  host.innerHTML = list.length ? `
    <table>
      <thead>
        <tr>
          <th style="width:24px"></th>
          <th>구분</th>
          <th style="width:90px">등원</th>
          <th style="width:84px">출석</th>
          <th>이름</th>
          <th>학교</th>
          <th>커리큘럼</th>
          <th>독스</th>
          <th>액션</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>` : '오늘 학생 없음';

  // 행 하이라이트(체크시)
  Array.from(host.querySelectorAll('tr[data-sid]')).forEach(tr => {
    if (tr.dataset.att === '1') {
      tr.style.background = 'rgba(16,185,129,0.09)'; // 초록 연한색
    }
  });

  // 편집 UX
  const tb = tbodyEl();
  if (tb) {
    // 구분(slotLabel) 편집
    tb.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.slotLabel'); if (!el) return;
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') {
        el.textContent = el.dataset.orig || '';
        el.blur();
      }
    });
    tb.addEventListener('focusin', (ev) => {
      const el = ev.target.closest('.slotLabel'); if (!el) return;
      el.style.borderColor = '#cbd5e1';
      el.style.background = 'rgba(148,163,184,.12)';
    });
    tb.addEventListener('focusout', (ev) => {
      const el = ev.target.closest('.slotLabel'); if (!el) return;
      el.style.borderColor = 'transparent';
      el.style.background = 'transparent';
      const tr = el.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const txt = (el.textContent || '').trim();
      el.dataset.orig = txt;
      // 저장 & 재정렬
      saveWeekendSlotsFromLabel(sid, txt);
    });

    // 예정 등원시간(arriveLabel) 편집
    tb.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.arriveLabel'); if (!el) return;
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') {
        el.textContent = el.dataset.orig || '';
        el.blur();
      }
    });
    tb.addEventListener('focusin', (ev) => {
      const el = ev.target.closest('.arriveLabel'); if (!el) return;
      el.style.borderColor = '#cbd5e1';
      el.style.background = 'rgba(148,163,184,.12)';
    });
    tb.addEventListener('focusout', (ev) => {
      const el = ev.target.closest('.arriveLabel'); if (!el) return;
      el.style.borderColor = 'transparent';
      el.style.background = 'transparent';
      const tr = el.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const txt = (el.textContent || '').trim();
      el.dataset.orig = txt;
      // 로컬 override 저장 + 재렌더(정렬 반영)
      setArriveOverride(dateKey, sid, txt);
      loadTodayAndRender();
    });

    // 출석 체크 토글 → localStorage 저장 + 하이라이트
    tb.addEventListener('change', (ev) => {
      const chk = ev.target.closest('.attendChk'); if (!chk) return;
      const tr = chk.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const today = todayLocalKey();
      const checked = chk.checked;

      setAttended(today, sid, checked);

      tr.dataset.att = checked ? '1' : '';
      tr.style.background = checked ? 'rgba(16,185,129,0.09)' : '';
    });
  }

  if (cnt) cnt.textContent = String(list.length);
  requestAnimationFrame(() => attachSortable(dateKey));
}

// 완료 리스트(레이아웃 동일)
function renderDone(doneEntries) {
  const wrap = $('doneWrap'); if (!wrap) return;

  if (!doneEntries.length) {
    wrap.innerHTML = '오늘 완료된 기록 없음';
    return;
  }

  const rows = doneEntries.map(([sid, entry, date]) => {
    const s = (state.students || []).find(x => String(x.id) === String(sid));
    if (!s) return '';
    const curLabel = s.curriculum + (s.subCurriculum ? ' ' + s.subCurriculum : '');
    const docUrl = s.docUrl || '';
    const label = labelFor(date, sid); // 연강 + (보강)
    const school = s.school ?? s.schoolName ?? s.highSchool ?? s.middleSchool ?? s.high ?? s.middle ?? s.schoolHigh ?? s.schoolMiddle ?? '';

    return `
      <tr data-sid="${sid}" data-date="${date}">
        <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>
        <td>${label}</td>
        <td>
          <a href="/student/${s.id}" target="_blank" class="stuName"
             data-sid="${s.id}"
             data-grade="${s.grade ?? s.gradeNum ?? ''}"
             data-high="${s.high ?? s.highSchool ?? s.schoolHigh ?? ''}"
             data-middle="${s.middle ?? s.midSchool ?? s.schoolMiddle ?? ''}"
             data-school="${s.school ?? s.schoolName ?? s.high ?? s.highSchool ?? s.middle ?? s.midSchool ?? ''}"
             data-b1="${s.subBook1 ?? s.workbook1 ?? s.book1 ?? s['부교재1'] ?? ''}"
             data-b2="${s.subBook2 ?? s.workbook2 ?? s.book2 ?? s['부교재2'] ?? ''}">
            ${s.name}
            <span style="font-size:12px;opacity:.7;margin-left:6px">${date}</span>
          </a>
        </td>
        <td>${school || ''}</td>
        <td>${curLabel}</td>
        <td><button class="btn-doc" data-doc-url="${docUrl}" title="구글 독스 열기">📄</button></td>
        <td>
          <button class="editVid" title="영상 배정">🎬</button>
          <button class="editLog" title="수업 기록">📝</button>
          <button class="markAbsent" title="결석">❌</button>
          <button class="undoDone" title="완료 되돌리기" style="margin-left:6px">↩</button>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="width:24px"></th>
          <th>구분</th>
          <th>이름</th>
          <th>학교</th>
          <th>커리큘럼</th>
          <th>독스</th>
          <th>액션</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ──────────────────────────────────────────────────────────────
// 오늘자 명단 계산(렌더/CSV 공통 사용)
// ──────────────────────────────────────────────────────────────
function computeTodayList() {
  const today = todayLocalKey();
  const wchr = WCHR[new Date(today).getDay()];
  const studs = state.students || [];
  const absentByDate = state.absentByDate || {};
  const extra = state.extra || {};

  // 정규 + 보강
  const regular = studs.filter(s => hasWeekday(s, wchr));
  const extraIds = (extra[today] || []).map(String);
  const extraStudents = extraIds.map(id => studs.find(s => String(s.id) === id)).filter(Boolean);

  // 중복 제거
  const seen = new Set();
  let list = [...regular, ...extraStudents].filter(s => {
    const id = String(s.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // 결석 제외
  const absentSet = new Set((absentByDate[today] || []).map(String));
  list = list.filter(s => !absentSet.has(String(s.id)));

  // 오늘 done:true 인 학생 제외
  const logsToday = state.logs?.[today] || {};
  list = list.filter(s => logsToday[s.id]?.done !== true);

  const isWeekend = ['토', '일'].includes(wchr);

  // 정렬: 주말 → 구분(토1/2/3) > 등원시간 > 출석(미출석 우선) > 이름
  //       평일 → 등원시간 > 출석(미출석 우선) > 이름
  list.sort((a, b) => {
    const ka = sortKeyFor(today, a.id);
    const kb = sortKeyFor(today, b.id);
    const ta = plannedMinutesFor(today, a.id);
    const tb = plannedMinutesFor(today, b.id);
    const attA = isAttended(today, a.id) ? 1 : 0;
    const attB = isAttended(today, b.id) ? 1 : 0;

    if (isWeekend) {
      if (ka !== kb) return ka - kb;
      if (ta !== tb) return ta - tb;
      if (attA !== attB) return attA - attB; // 0(미출석)이 위로
      return String(a.name).localeCompare(String(b.name), 'ko');
    } else {
      if (ta !== tb) return ta - tb;
      if (attA !== attB) return attA - attB;
      return String(a.name).localeCompare(String(b.name), 'ko');
    }
  });

  return { today, list };
}

// ──────────────────────────────────────────────────────────────
// 공개: 오늘 계산 + 렌더 (완료/결석 반영)
// ──────────────────────────────────────────────────────────────
export async function loadTodayAndRender() {
  await loadWeekendSlots();

  const doneEntries = collectUnarchivedDoneLogsAllDates();

  const { today, list: raw } = computeTodayList();
  await loadOrderMap();
  const list = applySavedOrder(raw, today);

  renderToday(list, today);
  renderDone(doneEntries);
}

// ──────────────────────────────────────────────────────────────
// 이벤트: 새로고침 트리거
// ──────────────────────────────────────────────────────────────
document.addEventListener('admin:refresh', loadTodayAndRender);

// 독스 버튼
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-doc'); if (!btn) return;
  const url = btn.dataset.docUrl; if (url) window.open(url, '_blank');
});

// ──────────────────────────────────────────────────────────────
// 이벤트: 결석 처리 (오늘에 한해)
// ──────────────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.markAbsent'); if (!btn) return;
  const tr = btn.closest('tr[data-sid]'); if (!tr) return;
  const sid = String(tr.dataset.sid);
  const today = todayLocalKey();

  // 출석 체크도 자동 해제
  setAttended(today, sid, false);

  // state.absences(by_student), state.absentByDate(by_date) 갱신
  const byStudent = state.absences || {}; // { sid: 'YYYY-MM-DD' }
  const byDate = state.absentByDate || {}; // { date: [sid,...] }
  byStudent[sid] = today;
  const set = new Set([...(byDate[today] || []).map(String), sid]);
  byDate[today] = Array.from(set);

  // 오늘 보강(extra)에 있으면 제거
  const extra = state.extra || {};
  if (Array.isArray(extra[today])) {
    extra[today] = extra[today].map(String).filter(x => x !== sid);
    try { await fetch('/api/extra-attend', { method: 'POST', headers: CT, body: JSON.stringify(extra) }); }
    catch { }
  }

  // 서버 저장(통합 스키마)
  try {
    await fetch('/api/absent', {
      method: 'POST', headers: CT,
      body: JSON.stringify({ by_date: byDate, by_student: byStudent })
    });
    // 로컬 상태 반영
    state.absences = byStudent;
    state.absentByDate = byDate;
    state.extra = extra;
    toast('결석 처리됨');
    loadTodayAndRender();
    if (typeof window.recalcCalendarCounts === 'function') window.recalcCalendarCounts();
  } catch (e2) {
    console.error(e2); alert('결석 저장 실패');
  }
});

// ──────────────────────────────────────────────────────────────
// 완료 리스트 액션: 되돌리기/정리
// ──────────────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const undoBtn = e.target.closest('.undoDone');
  const clearBtn = e.target.closest('.clearDone');
  if (!undoBtn && !clearBtn) return;

  const tr = e.target.closest('tr[data-sid][data-date]');
  if (!tr) return;
  const sid = String(tr.dataset.sid);
  const date = tr.dataset.date;
  const logs = state.logs || {};
  logs[date] = logs[date] || {};
  const entry = logs[date][sid] || {};

  if (undoBtn) {
    entry.done = false;
    delete entry.archived;
  } else {
    entry.archived = true;
  }
  logs[date][sid] = entry;

  try {
    await fetch('/api/logs', { method: 'POST', headers: CT, body: JSON.stringify(logs) });
    state.logs = logs;
    toast(undoBtn ? '완료 취소됨' : '기록 정리됨');
    loadTodayAndRender();
  } catch (err) {
    console.error(err); alert('로그 저장 실패');
  }
});

// ──────────────────────────────────────────────────────────────
/** 오늘 명단 CSV 내보내기 */
/// 출석 칼럼은 내보내기에는 포함하지 않음
// ──────────────────────────────────────────────────────────────
function exportTodayAsCSV() {
  const { today, list } = computeTodayList();

  const headers = [
    '순번', '구분', '등원', '이름', '커리큘럼', '레벨', '요일1', '요일2', '요일3', '학교', '부교재1', '부교재2'
  ];
  const esc = (v) => {
    const s = (v == null ? '' : String(v));
    return (/[",\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = list.map((s, i) => {
    const label = labelFor(today, s.id); // 연강 + (보강) 그대로
    const curLabel = s.curriculum + (s.subCurriculum ? ' ' + s.subCurriculum : '');
    const days = ['day1', 'day2', 'day3'].map(k => s[k] || '');
    const school = s.school ?? s.schoolName ?? s.highSchool ?? s.middleSchool ?? '';
    const attTime = plannedTimeFor(today, s.id);
    return [
      i + 1,
      label,
      attTime || '',
      s.name || '',
      curLabel,
      s.level || '',
      days[0], days[1], days[2],
      school,
      s.subBook1 ?? s.workbook1 ?? s.book1 ?? '',
      s.subBook2 ?? s.workbook2 ?? s.book2 ?? ''
    ].map(esc).join(',');
  });

  const csv = '\ufeff' + [headers.join(','), ...rows].join('\n'); // BOM 포함
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `오늘_학생명단_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// 버튼 바인딩
document.getElementById('exportTodayCsv')?.addEventListener('click', exportTodayAsCSV);
