// /js/admin/features/today.js
// 오늘 학생표 렌더 + 드래그 순서 저장 + '완료' 제외 + '결석' 처리
// + 주말(토/일) 타임(1,2,3) 표시/정렬 + '보강' 라벨 제거
// + 연강(주말 다중 슬롯) 지원: 토2·토3 / 일1·일2 등
// + ✅ 주말 '구분' 셀 직접 편집 → 저장 즉시 재정렬
// + ✅ 출석 체크 칼럼(체크박스)  -> ✅ 서버 연동(다른 기기 동기화)
// + ✅ 예정 등원/하원 시간 표시 + 셀 직접 수정 가능(✅ 서버 연동 + 로컬 백업(등원) / 로그연동(하원))
// + ✅ (추가) 출석 체크 ON → 등원 시간 현재시간(HH:MM) 자동 기록 + 재정렬
// + ✅ (추가) 연락 체크 칼럼(체크박스) -> ✅ 서버 연동(다른 기기 동기화)
// + ✅ (추가) 숙제 배정/검사 체크(수동 토글, 해제 가능) -> ✅ /api/logs 저장
// + ✅ (추가) 등원시간 서버 저장 머지 강화(“json 파일에 안 들어가는” 문제 완화)
// + ✅ (변경) 정렬 우선순위: 숙제검사 > 숙제배정 > 등원시간 > 가나다 (주말은 슬롯 우선 유지)
// + ✅ (핵심 FIX) 평일도 /api/weekend-slots(날짜별 슬롯) 반영 → 보강(수1/수2) 라벨/등원시간 정상
// + ✅ (핵심 FIX) logs 저장을 "전체 POST(/api/logs)" 대신 "/api/logs/patch"로 통일(유실/경합 완화)

import { $, toast, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

const CT = { 'Content-Type': 'application/json' };
let _orderMap = null;        // { "YYYY-MM-DD": ["sid","sid",...] }
let WEEKEND_SLOTS = {};      // { "YYYY-MM-DD": { sid: 1|2|3 | [1,2,3] } }
const WCHR = '일월화수목금토';

/* ─────────────────────────────────────────────
 * 요일·슬롯별 "기본 예정 등원 시간" 매핑
 * ────────────────────────────────────────────*/
const ARRIVE_TIME_MAP = {
  '토1': '13:00', '토2': '18:00',
  '일1': '13:00', '일2': '18:00',
  '월1': '18:00', '월2': '18:00',
  '화1': '18:00', '화2': '18:00',
  '수1': '18:00', '수2': '18:00',
  '목1': '18:00', '목2': '18:00',
  '금1': '18:00', '금2': '18:00',
};

/* ─────────────────────────────────────────────
 * ✅ 출석 체크 (서버 연동)
 *  - GET  /api/attendance?date=YYYY-MM-DD  -> { "sid": 1, ... }
 *  - POST /api/attendance  body: { "YYYY-MM-DD": { "sid": 1, ... } }
 * ────────────────────────────────────────────*/
const ATT_URL = '/api/attendance';
const ATT_PREFIX = 'attend_check:'; // 로컬 백업
const _attCache = new Map();        // dateKey -> { sid:1, ... }
const _attSaveTimers = new Map();   // dateKey -> timer id

function safeJSONParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function loadAttendMapLocal(dateKey) {
  const raw = localStorage.getItem(ATT_PREFIX + dateKey);
  return safeJSONParse(raw, {});
}
function saveAttendMapLocal(dateKey, map) {
  try { localStorage.setItem(ATT_PREFIX + dateKey, JSON.stringify(map || {})); } catch { }
}
async function fetchAttendDay(dateKey) {
  try {
    const qs = new URLSearchParams({ date: dateKey });
    const obj = await fetch(`${ATT_URL}?${qs.toString()}`, { cache: 'no-store' }).then(r => r.json());
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch { }
  return null;
}
async function ensureAttendLoaded(dateKey) {
  if (_attCache.has(dateKey)) return;
  const server = await fetchAttendDay(dateKey);
  if (server) {
    _attCache.set(dateKey, server);
    saveAttendMapLocal(dateKey, server);
  } else {
    const local = loadAttendMapLocal(dateKey);
    _attCache.set(dateKey, local);
  }
}
function loadAttendMap(dateKey) {
  if (_attCache.has(dateKey)) return _attCache.get(dateKey);
  return loadAttendMapLocal(dateKey);
}
function scheduleSaveAttendRemote(dateKey) {
  if (_attSaveTimers.has(dateKey)) clearTimeout(_attSaveTimers.get(dateKey));
  const t = setTimeout(async () => {
    _attSaveTimers.delete(dateKey);
    const map = loadAttendMap(dateKey) || {};
    try {
      await fetch(ATT_URL, { method: 'POST', headers: CT, body: JSON.stringify({ [dateKey]: map }) });
    } catch (e) {
      console.warn('[today] attendance save failed:', e);
    }
  }, 250);
  _attSaveTimers.set(dateKey, t);
}
function setAttended(dateKey, sid, checked) {
  const m = loadAttendMap(dateKey) || {};
  const k = String(sid);
  if (checked) m[k] = 1;
  else delete m[k];
  _attCache.set(dateKey, m);
  saveAttendMapLocal(dateKey, m);
  scheduleSaveAttendRemote(dateKey);
}
function isAttended(dateKey, sid) {
  const m = loadAttendMap(dateKey) || {};
  return !!m[String(sid)];
}

/* ─────────────────────────────────────────────
 * ✅ 연락 체크 (서버 연동)
 *  - GET  /api/contact?date=YYYY-MM-DD  -> { "sid": 1, ... }
 *  - POST /api/contact body: { "YYYY-MM-DD": { "sid": 1, ... } }
 * ────────────────────────────────────────────*/
const CONTACT_URL = '/api/contact';
const CONTACT_PREFIX = 'contact_check:'; // 로컬 백업
const _contactCache = new Map();         // dateKey -> { sid:1, ... }
const _contactSaveTimers = new Map();    // dateKey -> timer id

function loadContactMapLocal(dateKey) {
  const raw = localStorage.getItem(CONTACT_PREFIX + dateKey);
  return safeJSONParse(raw, {});
}
function saveContactMapLocal(dateKey, map) {
  try { localStorage.setItem(CONTACT_PREFIX + dateKey, JSON.stringify(map || {})); } catch { }
}
async function fetchContactDay(dateKey) {
  try {
    const qs = new URLSearchParams({ date: dateKey });
    const obj = await fetch(`${CONTACT_URL}?${qs.toString()}`, { cache: 'no-store' }).then(r => r.json());
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch { }
  return null;
}
async function ensureContactLoaded(dateKey) {
  if (_contactCache.has(dateKey)) return;
  const server = await fetchContactDay(dateKey);
  if (server) {
    _contactCache.set(dateKey, server);
    saveContactMapLocal(dateKey, server);
  } else {
    const local = loadContactMapLocal(dateKey);
    _contactCache.set(dateKey, local);
  }
}
function loadContactMap(dateKey) {
  if (_contactCache.has(dateKey)) return _contactCache.get(dateKey);
  return loadContactMapLocal(dateKey);
}
function scheduleSaveContactRemote(dateKey) {
  if (_contactSaveTimers.has(dateKey)) clearTimeout(_contactSaveTimers.get(dateKey));
  const t = setTimeout(async () => {
    _contactSaveTimers.delete(dateKey);
    const map = loadContactMap(dateKey) || {};
    try {
      await fetch(CONTACT_URL, { method: 'POST', headers: CT, body: JSON.stringify({ [dateKey]: map }) });
    } catch (e) {
      console.warn('[today] contact save failed:', e);
    }
  }, 250);
  _contactSaveTimers.set(dateKey, t);
}
function setContacted(dateKey, sid, checked) {
  const m = loadContactMap(dateKey) || {};
  const k = String(sid);
  if (checked) m[k] = 1;
  else delete m[k];
  _contactCache.set(dateKey, m);
  saveContactMapLocal(dateKey, m);
  scheduleSaveContactRemote(dateKey);
}
function isContacted(dateKey, sid) {
  const m = loadContactMap(dateKey) || {};
  return !!m[String(sid)];
}

/* ─────────────────────────────────────────────
 * ✅ 예정 등원시간 override (서버 연동 + 로컬 백업)
 * ────────────────────────────────────────────*/
const ARRIVE_URL = '/api/arrive-time';
const ARRIVE_PREFIX = 'arrive_time:';   // 로컬 백업
const _arriveCache = new Map();         // dateKey -> { sid:"HH:MM", ... }
const _arriveSaveTimers = new Map();    // dateKey -> timer id

function loadArriveMapLocal(dateKey) {
  const raw = localStorage.getItem(ARRIVE_PREFIX + dateKey);
  return safeJSONParse(raw, {});
}
function saveArriveMapLocal(dateKey, map) {
  try { localStorage.setItem(ARRIVE_PREFIX + dateKey, JSON.stringify(map || {})); } catch { }
}
function normalizeDayMap(obj, dateKey) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const keys = Object.keys(obj);
  const looksLikeSidMap = keys.every(k => /^\d+$/.test(String(k)));
  if (looksLikeSidMap) return obj;

  if (dateKey && obj[dateKey] && typeof obj[dateKey] === 'object' && !Array.isArray(obj[dateKey])) {
    return obj[dateKey];
  }
  return null;
}
async function fetchArriveDay(dateKey) {
  try {
    const qs = new URLSearchParams({ date: dateKey });
    const obj = await fetch(`${ARRIVE_URL}?${qs.toString()}`, { cache: 'no-store' }).then(r => r.json());
    const day = normalizeDayMap(obj, dateKey);
    if (day) return day;
  } catch { }
  return null;
}
async function fetchArriveAll() {
  try {
    const obj = await fetch(ARRIVE_URL, { cache: 'no-store' }).then(r => r.json());
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch { }
  return null;
}
async function ensureArriveLoaded(dateKey) {
  if (_arriveCache.has(dateKey)) return;

  const day = await fetchArriveDay(dateKey);
  if (day) {
    _arriveCache.set(dateKey, day);
    saveArriveMapLocal(dateKey, day);
    return;
  }

  const all = await fetchArriveAll();
  if (all && all[dateKey] && typeof all[dateKey] === 'object' && !Array.isArray(all[dateKey])) {
    const m = all[dateKey];
    _arriveCache.set(dateKey, m);
    saveArriveMapLocal(dateKey, m);
    return;
  }

  const local = loadArriveMapLocal(dateKey);
  _arriveCache.set(dateKey, local);
}
function loadArriveMap(dateKey) {
  if (_arriveCache.has(dateKey)) return _arriveCache.get(dateKey);
  return loadArriveMapLocal(dateKey);
}
function scheduleSaveArriveRemote(dateKey) {
  if (_arriveSaveTimers.has(dateKey)) clearTimeout(_arriveSaveTimers.get(dateKey));
  const t = setTimeout(async () => {
    _arriveSaveTimers.delete(dateKey);
    const map = loadArriveMap(dateKey) || {};

    try {
      const all = await fetchArriveAll();
      if (all && typeof all === 'object' && !Array.isArray(all)) {
        const looksLikeAll = Object.keys(all).some(k => /^\d{4}-\d{2}-\d{2}$/.test(String(k)));
        if (looksLikeAll) {
          all[dateKey] = map;
          await fetch(ARRIVE_URL, { method: 'POST', headers: CT, body: JSON.stringify(all) });
          return;
        }
      }
    } catch (e) {
      console.warn('[today] arrive-time merge save fallback:', e);
    }

    try {
      await fetch(ARRIVE_URL, { method: 'POST', headers: CT, body: JSON.stringify({ [dateKey]: map }) });
    } catch (e2) {
      console.warn('[today] arrive-time save failed:', e2);
    }
  }, 250);
  _arriveSaveTimers.set(dateKey, t);
}
function getArriveOverride(dateKey, sid) {
  const m = loadArriveMap(dateKey) || {};
  return m[String(sid)] ?? '';
}
function setArriveOverride(dateKey, sid, value) {
  const m = loadArriveMap(dateKey) || {};
  const k = String(sid);
  const v = (value || '').trim();
  if (v) m[k] = v;
  else delete m[k];

  _arriveCache.set(dateKey, m);
  saveArriveMapLocal(dateKey, m);
  scheduleSaveArriveRemote(dateKey);
}

/* ✅ 현재시간 HH:MM */
function nowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
function nowISO() { return new Date().toISOString(); }

/* ─────────────────────────────────────────────
 * ✅ logs.patch 헬퍼(유실 방지)
 * ────────────────────────────────────────────*/
async function patchLog(dateKey, sid, entry, clearKeys = null) {
  const body = {
    date: dateKey,
    sid: String(sid),
    entry: entry || {},
  };
  if (Array.isArray(clearKeys) && clearKeys.length) body.__clear = clearKeys;

  const res = await fetch('/api/logs/patch', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = '';
    try { msg = await res.text(); } catch { }
    throw new Error(`logs/patch failed: ${res.status} ${msg}`);
  }

  // 로컬 state 반영(즉시 UI 반영)
  state.logs = state.logs || {};
  state.logs[dateKey] = state.logs[dateKey] || {};
  const prev = state.logs[dateKey][String(sid)] || {};
  const next = { ...prev, ...(entry || {}) };
  if (Array.isArray(clearKeys)) {
    for (const k of clearKeys) delete next[String(k)];
  }
  state.logs[dateKey][String(sid)] = next;
}

/* ─────────────────────────────────────────────
 * ✅ 하원 시간(로그) 읽기/수정
 * ────────────────────────────────────────────*/
function getLeaveTime(dateKey, sid) {
  const e = state.logs?.[dateKey]?.[String(sid)];
  return (e?.leaveTime || e?.doneTime || '').trim();
}
async function setLeaveTimeRemote(dateKey, sid, value) {
  const v = (value || '').trim();
  if (!v) {
    // leaveTime 지우기
    await patchLog(dateKey, sid, {}, ['leaveTime', 'leaveAt', 'doneTime']);
    return;
  }
  await patchLog(dateKey, sid, {
    leaveTime: v,
    leaveAt: nowISO(),
  });
}

/* ─────────────────────────────────────────────
 * ✅ 숙제 배정/검사 체크 (logs에 저장, 해제 가능)
 * ────────────────────────────────────────────*/
function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}
function isHwAssigned(dateKey, sid) {
  const e = state.logs?.[dateKey]?.[String(sid)];
  return !!(e && truthy(e.hwAssigned));
}
function isHwChecked(dateKey, sid) {
  const e = state.logs?.[dateKey]?.[String(sid)];
  return !!(e && truthy(e.hwChecked));
}
async function setLogFlagRemote(dateKey, sid, field, checked) {
  await patchLog(dateKey, sid, { [field]: checked ? true : false });
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
(function () {
  if (document.getElementById('drag-handle-style')) return;
  const s = document.createElement('style');
  s.id = 'drag-handle-style';
  s.textContent = '.drag-handle{touch-action:none;}';
  document.head.appendChild(s);
})();

// ✅ 체크박스 UI (4개: att/contact/check/assign)  ← 순서만 바꿈(표시도 바뀜)
(function () {
  if (document.getElementById('today-check-style')) return;
  const s = document.createElement('style');
  s.id = 'today-check-style';
  s.textContent = `
    .chk4{display:inline-flex;align-items:center;gap:0}
    .chk4 .c{
      display:inline-flex;align-items:center;justify-content:center;
      width:30px;height:30px;margin:0;
      border-radius:10px;
      border:1px solid rgba(148,163,184,.55);
      background:rgba(248,250,252,.95);
      transition:transform .08s ease, filter .12s ease, background .12s ease, border-color .12s ease;
      user-select:none;
    }
    body.dark .chk4 .c{
      border-color:#334155;
      background:rgba(2,6,23,.55);
    }
    .chk4 .c:hover{filter:brightness(1.03)}
    .chk4 input{
      width:18px;height:18px;
      accent-color:#10b981;
      margin:0;
    }
    .chk4 .c + .c{margin-left:6px}
    .chk4 .c[data-kind="contact"] input{accent-color:#3b82f6;}
    .chk4 .c[data-kind="assign"] input{accent-color:#8b5cf6;}
    .chk4 .c[data-kind="check"] input{accent-color:#f59e0b;}

    .chk4 .c[data-on="1"]{background:rgba(16,185,129,.10);border-color:rgba(16,185,129,.45)}
    .chk4 .c[data-kind="contact"][data-on="1"]{background:rgba(59,130,246,.10);border-color:rgba(59,130,246,.45)}
    .chk4 .c[data-kind="assign"][data-on="1"]{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.55)}
    .chk4 .c[data-kind="check"][data-on="1"]{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.55)}

    .chk4 .c:active{transform:scale(.98)}
    .chk4 .c input:disabled{cursor:not-allowed;opacity:.95}
  `;
  document.head.appendChild(s);
})();

// ──────────────────────────────────────────────────────────────
// 헬퍼(요일/슬롯)
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

/* ✅ FIX: 평일도 date별 슬롯(/api/weekend-slots)을 먼저 반영 */
function getSlots(dateStr, sid) {
  const raw = WEEKEND_SLOTS?.[dateStr]?.[String(sid)];

  // 1) 날짜별 저장 슬롯이 있으면 (평일/주말 상관없이) 최우선
  if (Array.isArray(raw)) {
    return raw
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n))
      .sort((a, b) => a - b);
  }
  if (Number.isInteger(raw)) return [raw];

  const w = yoilOf(dateStr);
  const stu = getStudent(sid);
  if (!stu) return [];

  // 2) fallback: 학생 day값에서 추출(원래 요일에 있는 학생들)
  const nums = dayValues(stu)
    .filter(v => String(v).startsWith(w))
    .map(v => {
      const m = String(v).match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    })
    .filter(n => Number.isInteger(n) && (n === 1 || n === 2)); // 평일은 1/2만

  if (nums.length) return Array.from(new Set(nums)).sort((a, b) => a - b);
  return [];
}

function labelFor(dateStr, sid) {
  const w = yoilOf(dateStr);

  // ✅ FIX: 평일/주말 모두 date별 슬롯이 있으면 그걸로 표시 (보강 포함)
  const slots = getSlots(dateStr, sid);
  if (slots.length) return slots.map(n => `${w}${n}`).join('·');

  const stu = getStudent(sid);

  // 주말: 슬롯 없으면 요일만
  if (w === '토' || w === '일') return w;

  // 평일: 학생 day값 기반(예전 로직 유지)
  if (!stu) return w;

  const dvals = dayValues(stu).filter(v => String(v).startsWith(w)); // 예: ["월1","월2"]
  if (!dvals.length) return w;

  const nums = dvals
    .map(v => {
      const m = String(v).match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    })
    .filter(n => Number.isInteger(n))
    .filter(n => n === 1 || n === 2);

  if (!nums.length) return w;

  const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
  return uniq.map(n => `${w}${n}`).join('·');
}

function sortKeyFor(dateStr, sid) {
  const w = yoilOf(dateStr);
  if (w === '토' || w === '일') {
    const slots = getSlots(dateStr, sid);
    if (slots.length) return Math.min(...slots);
  }
  return 99;
}

function plannedKeyFor(dateStr, stu) {
  const w = yoilOf(dateStr);
  if (!stu) return w;

  // ✅ FIX: date별 슬롯이 있으면(평일/주말 모두) 그걸로 plannedKey를 만들기
  const slots = getSlots(dateStr, stu.id);
  if (slots.length) {
    const minSlot = Math.min(...slots);
    return `${w}${minSlot}`;
  }

  const dvals = dayValues(stu).filter(v => String(v).startsWith(w));
  if (dvals.length) {
    const raw = dvals[0];
    const m = String(raw).match(/\d+/);
    const num = m ? m[0] : '';
    return num ? `${w}${num}` : w;
  }
  return w;
}

function plannedTimeFromStudent(dateStr, stu) {
  if (!stu) return '';
  const w = yoilOf(dateStr);

  for (let i = 1; i <= 5; i++) {
    const dayVal = (stu[`day${i}`] || '').trim();
    if (!dayVal) continue;
    if (!dayVal.startsWith(w)) continue;

    const t = (stu[`visitTime${i}`] || '').trim();
    if (t) return t;
  }
  return '';
}

function plannedTimeBase(dateStr, sid) {
  const stu = getStudent(sid);
  if (!stu) return '';

  const fromStu = plannedTimeFromStudent(dateStr, stu);
  if (fromStu) return fromStu;

  const key = plannedKeyFor(dateStr, stu); // 예: "수1" or "수"
  if (ARRIVE_TIME_MAP[key]) return ARRIVE_TIME_MAP[key];

  // ✅ FIX: key가 '수'처럼 1글자면 기본 '수1'을 먼저 시도
  if (key && key.length === 1) {
    const k1 = `${key}1`;
    if (ARRIVE_TIME_MAP[k1]) return ARRIVE_TIME_MAP[k1];
  }

  const ch = key ? key[0] : '';
  if (ch && ARRIVE_TIME_MAP[ch]) return ARRIVE_TIME_MAP[ch];

  return '';
}

function plannedTimeFor(dateStr, sid) {
  const ov = getArriveOverride(dateStr, sid);
  if (ov && ov.trim()) return ov.trim();
  return plannedTimeBase(dateStr, sid);
}
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
  const dates = Object.keys(logs).sort();
  const latestBySid = new Map();

  for (const date of dates) {
    const dayMap = logs[date] || {};
    for (const sid of Object.keys(dayMap)) {
      const e = dayMap[sid] || {};
      const done = truthy(e.done);
      const archived = truthy(e.archived);
      if (!done || archived) continue;
      latestBySid.set(String(sid), { entry: e, date });
    }
  }

  const out = [];
  for (const [sid, { entry, date }] of latestBySid.entries()) out.push([sid, entry, date]);
  out.sort((a, b) => a[2].localeCompare(b[2]));
  return out;
}

// ──────────────────────────────────────────────────────────────
// 구분 셀 편집 → weekend-slots 저장 → 오늘 순서 초기화 → 재렌더
// ──────────────────────────────────────────────────────────────
function parseSlotsFromText(txt) {
  const nums = (txt.match(/[1-2]/g) || []).map(n => parseInt(n, 10));
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
  if (slots.length) perDay[String(sid)] = slots;
  else delete perDay[String(sid)];

  await fetch('/api/weekend-slots', { method: 'POST', headers: CT, body: JSON.stringify({ [today]: perDay }) });

  await clearTodayOrder(today);

  await loadWeekendSlots();
  await loadOrderMap();
  loadTodayAndRender();
}

// ──────────────────────────────────────────────
function renderToday(list, dateKey) {
  const host = $('todayWrap'); const cnt = $('todayCount'); if (!host) return;

  const rows = list.map(s => {
    const curLabel = s.curriculum + (s.subCurriculum ? ' ' + s.subCurriculum : '');
    const label = labelFor(dateKey, s.id);
    const isWeekend = ['토', '일'].includes(yoilOf(dateKey));

    const attended = isAttended(dateKey, s.id);
    const contacted = isContacted(dateKey, s.id);
    const hwAssigned = isHwAssigned(dateKey, s.id);
    const hwChecked = isHwChecked(dateKey, s.id);

    const arriveTime = plannedTimeFor(dateKey, s.id);
    const leaveTime = getLeaveTime(dateKey, s.id);

    const school = s.school ?? s.schoolName ?? s.highSchool ?? s.middleSchool ?? s.high ?? s.middle ?? s.schoolHigh ?? s.schoolMiddle ?? '';

    return `
      <tr data-sid="${s.id}" ${attended ? 'data-att="1"' : ''} ${contacted ? 'data-contact="1"' : ''} ${hwAssigned ? 'data-hwassign="1"' : ''} ${hwChecked ? 'data-hw="1"' : ''}>
        <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>

        <td>
          ${isWeekend
        ? `<span class="slotLabel" contenteditable="true" spellcheck="false" data-orig="${label || ''}"
                 style="display:inline-block;min-width:48px;padding:2px 6px;border-radius:6px;border:1px solid transparent"
               >${label || yoilOf(dateKey)}</span>`
        : (label || yoilOf(dateKey))}
        </td>

        <td class="att-time" style="text-align:center; width:84px;">
          <span class="arriveLabel"
                contenteditable="true"
                spellcheck="false"
                data-orig="${arriveTime || ''}"
                style="display:inline-block;min-width:56px;padding:2px 6px;border-radius:6px;border:1px solid transparent">
            ${arriveTime || ''}
          </span>
        </td>

        <td class="leave-time" style="text-align:center; width:84px;">
          <span class="leaveLabel"
                contenteditable="true"
                spellcheck="false"
                data-orig="${leaveTime || ''}"
                style="display:inline-block;min-width:56px;padding:2px 6px;border-radius:6px;border:1px solid transparent">
            ${leaveTime || ''}
          </span>
        </td>

        <td style="text-align:center; width:206px">
          <div class="chk4" aria-label="체크 4종">
            <label class="c" data-kind="att" data-on="${attended ? '1' : '0'}" title="출석">
              <input type="checkbox" class="attendChk" data-id="${s.id}" ${attended ? 'checked' : ''}>
            </label>
            <label class="c" data-kind="contact" data-on="${contacted ? '1' : '0'}" title="연락">
              <input type="checkbox" class="contactChk" data-id="${s.id}" ${contacted ? 'checked' : ''}>
            </label>

            <!-- ✅ 순서 교체: 검사 -> 배정 -->
            <label class="c" data-kind="check" data-on="${hwChecked ? '1' : '0'}" title="숙제 검사 완료">
              <input type="checkbox" class="hwCheckChk" data-id="${s.id}" ${hwChecked ? 'checked' : ''}>
            </label>
            <label class="c" data-kind="assign" data-on="${hwAssigned ? '1' : '0'}" title="숙제 배정">
              <input type="checkbox" class="hwAssignChk" data-id="${s.id}" ${hwAssigned ? 'checked' : ''}>
            </label>
          </div>
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
          <button class="markLeave" title="하원">🏁</button>
        </td>
      </tr>`;
  }).join('');

  host.innerHTML = list.length ? `
    <table>
      <thead>
        <tr>
          <th style="width:24px"></th>
          <th>구분</th>
          <th style="width:84px">등원</th>
          <th style="width:84px">하원</th>
          <th style="width:206px">출석/연락/검사/배정</th>
          <th>이름</th>
          <th>학교</th>
          <th>커리큘럼</th>
          <th>독스</th>
          <th>액션</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>` : '오늘 학생 없음';

  Array.from(host.querySelectorAll('tr[data-sid]')).forEach(tr => {
    if (tr.dataset.att === '1') tr.style.background = 'rgba(16,185,129,0.09)';
  });

  Array.from(host.querySelectorAll('.chk4 .c')).forEach(pill => {
    const input = pill.querySelector('input');
    if (!input) return;
    pill.dataset.on = input.checked ? '1' : '0';
  });

  const tb = tbodyEl();
  if (tb && !tb._todayWired) {
    tb._todayWired = true;

    // ── 구분(주말) 편집
    tb.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.slotLabel'); if (!el) return;
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') { el.textContent = el.dataset.orig || ''; el.blur(); }
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

      const cleaned = txt.replace(/\(보강\)/g, '').trim();
      el.textContent = cleaned;
      el.dataset.orig = cleaned;

      saveWeekendSlotsFromLabel(sid, cleaned);
    });

    // ── 등원시간 편집
    tb.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.arriveLabel'); if (!el) return;
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') { el.textContent = el.dataset.orig || ''; el.blur(); }
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

      const today = todayLocalKey();
      setArriveOverride(today, sid, txt);
      loadTodayAndRender();
    });

    // ── 하원시간 편집 (✅ patch)
    tb.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.leaveLabel'); if (!el) return;
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') { el.textContent = el.dataset.orig || ''; el.blur(); }
    });
    tb.addEventListener('focusin', (ev) => {
      const el = ev.target.closest('.leaveLabel'); if (!el) return;
      el.style.borderColor = '#cbd5e1';
      el.style.background = 'rgba(148,163,184,.12)';
    });
    tb.addEventListener('focusout', async (ev) => {
      const el = ev.target.closest('.leaveLabel'); if (!el) return;
      el.style.borderColor = 'transparent';
      el.style.background = 'transparent';
      const tr = el.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const txt = (el.textContent || '').trim();
      el.dataset.orig = txt;

      const today = todayLocalKey();
      try { await setLeaveTimeRemote(today, sid, txt); }
      catch (e) { console.error(e); alert('하원시간 저장 실패'); }
      loadTodayAndRender();
    });

    // ── 출석 체크
    tb.addEventListener('change', (ev) => {
      const chk = ev.target.closest('.attendChk'); if (!chk) return;
      const tr = chk.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const today = todayLocalKey();
      const checked = chk.checked;

      setAttended(today, sid, checked);

      if (checked) {
        const t = nowHHMM();
        setArriveOverride(today, sid, t);
        const el = tr.querySelector('.arriveLabel');
        if (el) { el.textContent = t; el.dataset.orig = t; }
      }

      tr.dataset.att = checked ? '1' : '';
      tr.style.background = checked ? 'rgba(16,185,129,0.09)' : '';
      const pill = chk.closest('.c'); if (pill) pill.dataset.on = checked ? '1' : '0';

      loadTodayAndRender();
    });

    // ── 연락 체크
    tb.addEventListener('change', (ev) => {
      const chk = ev.target.closest('.contactChk'); if (!chk) return;
      const tr = chk.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const today = todayLocalKey();
      const checked = chk.checked;

      setContacted(today, sid, checked);
      tr.dataset.contact = checked ? '1' : '';
      const pill = chk.closest('.c'); if (pill) pill.dataset.on = checked ? '1' : '0';

      loadTodayAndRender();
    });

    // ── 숙제 배정 체크
    tb.addEventListener('change', async (ev) => {
      const chk = ev.target.closest('.hwAssignChk'); if (!chk) return;
      const tr = chk.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const today = todayLocalKey();
      const checked = chk.checked;

      try { await setLogFlagRemote(today, sid, 'hwAssigned', checked); }
      catch (e) { console.error(e); alert('숙제 배정 저장 실패'); }

      const pill = chk.closest('.c'); if (pill) pill.dataset.on = checked ? '1' : '0';
      loadTodayAndRender();
    });

    // ── 숙제 검사 체크
    tb.addEventListener('change', async (ev) => {
      const chk = ev.target.closest('.hwCheckChk'); if (!chk) return;
      const tr = chk.closest('tr[data-sid]'); if (!tr) return;
      const sid = tr.dataset.sid;
      const today = todayLocalKey();
      const checked = chk.checked;

      try { await setLogFlagRemote(today, sid, 'hwChecked', checked); }
      catch (e) { console.error(e); alert('숙제 검사 저장 실패'); }

      const pill = chk.closest('.c'); if (pill) pill.dataset.on = checked ? '1' : '0';
      loadTodayAndRender();
    });
  }

  if (cnt) cnt.textContent = String(list.length);
  requestAnimationFrame(() => attachSortable(dateKey));
}

// 완료 리스트(레이아웃 동일) + ✅ 등원/하원 표시 & 편집 가능
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
    const label = labelFor(date, sid);
    const school = s.school ?? s.schoolName ?? s.highSchool ?? s.middleSchool ?? s.high ?? s.middle ?? s.schoolHigh ?? s.schoolMiddle ?? '';

    const arriveTime = plannedTimeFor(date, sid);
    const leaveTime = getLeaveTime(date, sid);

    return `
      <tr data-sid="${sid}" data-date="${date}">
        <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>
        <td>${label}</td>

        <td style="text-align:center; width:84px;">
          <span class="arriveLabel"
                contenteditable="true"
                spellcheck="false"
                data-orig="${arriveTime || ''}"
                style="display:inline-block;min-width:56px;padding:2px 6px;border-radius:6px;border:1px solid transparent">
            ${arriveTime || ''}
          </span>
        </td>

        <td style="text-align:center; width:84px;">
          <span class="leaveLabel"
                contenteditable="true"
                spellcheck="false"
                data-orig="${leaveTime || ''}"
                style="display:inline-block;min-width:56px;padding:2px 6px;border-radius:6px;border:1px solid transparent">
            ${leaveTime || ''}
          </span>
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
          <button class="markLeave" title="하원">🏁</button>
          <button class="undoDone" title="완료 되돌리기" style="margin-left:6px">↩</button>
          <button class="clearDone" title="기록 정리" style="margin-left:6px">🧹</button>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="width:24px"></th>
          <th>구분</th>
          <th style="width:84px">등원</th>
          <th style="width:84px">하원</th>
          <th>이름</th>
          <th>학교</th>
          <th>커리큘럼</th>
          <th>독스</th>
          <th>액션</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  const tb = wrap.querySelector('tbody');
  if (!tb) return;

  // 등원 편집
  tb.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('.arriveLabel'); if (!el) return;
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    if (ev.key === 'Escape') { el.textContent = el.dataset.orig || ''; el.blur(); }
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

    const tr = el.closest('tr[data-sid][data-date]'); if (!tr) return;
    const sid = tr.dataset.sid;
    const date = tr.dataset.date;

    const txt = (el.textContent || '').trim();
    el.dataset.orig = txt;

    setArriveOverride(date, sid, txt);
    loadTodayAndRender();
  });

  // 하원 편집 (✅ patch)
  tb.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('.leaveLabel'); if (!el) return;
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    if (ev.key === 'Escape') { el.textContent = el.dataset.orig || ''; el.blur(); }
  });
  tb.addEventListener('focusin', (ev) => {
    const el = ev.target.closest('.leaveLabel'); if (!el) return;
    el.style.borderColor = '#cbd5e1';
    el.style.background = 'rgba(148,163,184,.12)';
  });
  tb.addEventListener('focusout', async (ev) => {
    const el = ev.target.closest('.leaveLabel'); if (!el) return;
    el.style.borderColor = 'transparent';
    el.style.background = 'transparent';

    const tr = el.closest('tr[data-sid][data-date]'); if (!tr) return;
    const sid = tr.dataset.sid;
    const date = tr.dataset.date;

    const txt = (el.textContent || '').trim();
    el.dataset.orig = txt;

    try {
      await setLeaveTimeRemote(date, sid, txt);
    } catch (e) {
      console.error(e);
      alert('하원시간 저장 실패');
    }
    loadTodayAndRender();
  });
}

// ──────────────────────────────────────────────────────────────
// 오늘자 명단 계산(렌더 공통 사용)
// ──────────────────────────────────────────────────────────────
function computeTodayList() {
  const today = todayLocalKey();
  const wchr = WCHR[new Date(today).getDay()];
  const studs = state.students || [];
  const absentByDate = state.absentByDate || {};
  const extra = state.extra || {};

  const regular = studs.filter(s => hasWeekday(s, wchr));
  const extraIds = (extra[today] || []).map(String);
  const extraStudents = extraIds.map(id => studs.find(s => String(s.id) === id)).filter(Boolean);

  const seen = new Set();
  let list = [...regular, ...extraStudents].filter(s => {
    const id = String(s.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const absentSet = new Set((absentByDate[today] || []).map(String));
  list = list.filter(s => !absentSet.has(String(s.id)));

  const logsToday = state.logs?.[today] || {};
  list = list.filter(s => logsToday[s.id]?.done !== true && logsToday[s.id]?.done !== 'true');

  const isWeekend = ['토', '일'].includes(wchr);

  // ✅ 정렬: (주말이면 슬롯 우선) 숙제검사(안됨 먼저) > 숙제배정(안됨 먼저) > 등원시간 > 가나다
  list.sort((a, b) => {
    const hwcA = isHwChecked(today, a.id) ? 1 : 0;
    const hwcB = isHwChecked(today, b.id) ? 1 : 0;
    const hwaA = isHwAssigned(today, a.id) ? 1 : 0;
    const hwaB = isHwAssigned(today, b.id) ? 1 : 0;

    const ta = plannedMinutesFor(today, a.id);
    const tb = plannedMinutesFor(today, b.id);

    const ka = sortKeyFor(today, a.id);
    const kb = sortKeyFor(today, b.id);

    if (isWeekend) {
      if (ka !== kb) return ka - kb;
    }

    if (hwcA !== hwcB) return hwcA - hwcB; // 0 먼저 (미검사 위)
    if (hwaA !== hwaB) return hwaA - hwaB; // 0 먼저 (미배정 위)
    if (ta !== tb) return ta - tb;

    return String(a.name).localeCompare(String(b.name), 'ko');
  });

  return { today, list };
}

// ──────────────────────────────────────────────────────────────
// 공개: 오늘 계산 + 렌더 (완료/결석 반영)
// ──────────────────────────────────────────────────────────────
export async function loadTodayAndRender() {
  const today = todayLocalKey();

  await loadWeekendSlots();

  // ✅ 서버 동기화 먼저
  await ensureAttendLoaded(today);
  await ensureContactLoaded(today);
  await ensureArriveLoaded(today);

  const doneEntries = collectUnarchivedDoneLogsAllDates();

  const { list: raw } = computeTodayList();
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

  setAttended(today, sid, false);
  setContacted(today, sid, false);

  const byStudent = state.absences || {};
  const byDate = state.absentByDate || {};
  byStudent[sid] = today;

  const set = new Set([...(byDate[today] || []).map(String), sid]);
  byDate[today] = Array.from(set);

  try {
    await fetch('/api/absent', {
      method: 'POST',
      headers: CT,
      body: JSON.stringify({ by_date: byDate, by_student: byStudent })
    });

    state.absences = byStudent;
    state.absentByDate = byDate;

    toast('결석 처리됨');
    loadTodayAndRender();

    if (typeof window.recalcCalendarCounts === 'function') {
      window.recalcCalendarCounts();
    }
  } catch (e2) {
    console.error(e2);
    alert('결석 저장 실패');
  }
});

// ──────────────────────────────────────────────────────────────
// 이벤트: 하원 처리 (오늘에 한해) - ✅ patch로 done 처리(유실 방지)
// ──────────────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.markLeave'); if (!btn) return;
  const tr = btn.closest('tr[data-sid]'); if (!tr) return;

  const sid = String(tr.dataset.sid);
  const today = todayLocalKey();

  try {
    await patchLog(today, sid, {
      done: true,
      leaveTime: nowHHMM(),
      leaveAt: nowISO(),
    });
    toast(`하원 처리됨 (${getLeaveTime(today, sid) || nowHHMM()})`);
    loadTodayAndRender();
  } catch (err) {
    console.error(err);
    alert('하원 저장 실패');
  }
});

// ──────────────────────────────────────────────
// 완료 리스트 액션: 되돌리기/정리 (✅ patch)
// ──────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const undoBtn = e.target.closest('.undoDone');
  const clearBtn = e.target.closest('.clearDone');
  if (!undoBtn && !clearBtn) return;

  const tr = e.target.closest('tr[data-sid][data-date]');
  if (!tr) return;
  const sid = String(tr.dataset.sid);
  const date = tr.dataset.date;

  try {
    if (undoBtn) {
      // done=false + archived 삭제
      await patchLog(date, sid, { done: false }, ['archived']);
      toast('완료 취소됨');
    } else {
      await patchLog(date, sid, { archived: true });
      toast('기록 정리됨');
    }
    loadTodayAndRender();
  } catch (err) {
    console.error(err);
    alert('로그 저장 실패');
  }
});
