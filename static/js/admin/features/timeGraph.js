// /js/admin/features/timeGraph.js
// 캘린더 위 시간대별 예상 학생 수 그래프
// - 기준: 오늘 학생 명단(결석/완료/보강 반영)
// - 각 학생은 예정 등원시간 ~ +4시간까지 학원에 있다고 가정
// - ✅ 보강은 state.extra 대신 /api/extra-attend 최신을 기준으로 집계(누락 방지)

import { state } from '../core/state.js';
import { todayLocalKey } from '../core/utils.js';

const WCHR = '일월화수목금토';
const ARRIVE_PREFIX = 'arrive_time:';

// today.js 와 동일한 기본 시간 매핑
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

function injectStyles() {
  if (document.getElementById('timeGraphStyles')) return;
  const s = document.createElement('style');
  s.id = 'timeGraphStyles';
  s.textContent = `
  #timeGraphWrap,
  #timeGraphWrapForDate{
    padding:10px 12px;
    border-radius:10px;
    background:rgba(15,23,42,0.04);
    border:1px solid rgba(148,163,184,0.35);
    font-size:12px;
  }
  body.dark #timeGraphWrap,
  body.dark #timeGraphWrapForDate{
    background:rgba(15,23,42,0.75);
    border-color:rgba(148,163,184,0.5);
  }
  #timeGraphWrap .tg-title,
  #timeGraphWrapForDate .tg-title{
    font-size:13px;
    font-weight:600;
    margin-bottom:6px;
    display:flex;
    align-items:center;
    gap:6px;
  }
  #timeGraphWrap .tg-title small,
  #timeGraphWrapForDate .tg-title small{
    font-weight:400;
    opacity:.75;
  }
  #timeGraphWrap .tg-body,
  #timeGraphWrapForDate .tg-body{
    display:flex;
    flex-direction:column;
    gap:4px;
  }
  #timeGraphWrap .tg-row,
  #timeGraphWrapForDate .tg-row{
    display:grid;
    grid-template-columns:64px 1fr 40px;
    align-items:center;
    gap:6px;
  }
  #timeGraphWrap .tg-label,
  #timeGraphWrapForDate .tg-label{
    text-align:left;
    white-space:nowrap;
  }
  #timeGraphWrap .tg-bar-bg,
  #timeGraphWrapForDate .tg-bar-bg{
    position:relative;
    height:8px;
    border-radius:999px;
    background:rgba(148,163,184,0.25);
    overflow:hidden;
  }
  #timeGraphWrap .tg-bar-fill,
  #timeGraphWrapForDate .tg-bar-fill{
    position:absolute;
    inset:0;
    width:0;
    border-radius:999px;
    background:#0ea5e9;
    transition:width .18s ease-out;
  }
  body.dark #timeGraphWrap .tg-bar-bg,
  body.dark #timeGraphWrapForDate .tg-bar-bg{
    background:rgba(30,64,175,0.55);
  }
  body.dark #timeGraphWrap .tg-bar-fill,
  body.dark #timeGraphWrapForDate .tg-bar-fill{
    background:#38bdf8;
  }
  #timeGraphWrap .tg-count,
  #timeGraphWrapForDate .tg-count{
    text-align:right;
    font-variant-numeric:tabular-nums;
    opacity:.9;
  }
  `;
  document.head.appendChild(s);
}

/* localStorage: 예정 등원시간 override */
function loadArriveMap(dateKey) {
  try {
    const raw = localStorage.getItem(ARRIVE_PREFIX + dateKey);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function getArriveOverride(dateKey, sid) {
  const m = loadArriveMap(dateKey);
  return m[String(sid)] ?? '';
}

/* 공용 헬퍼들 (today.js 축약 버전) */
function dayValues(stu) {
  return Object.keys(stu).filter(k => /^day\d+$/.test(k) && stu[k])
    .sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10))
    .map(k => String(stu[k]));
}
function hasWeekday(stu, wchr) {
  return dayValues(stu).some(v => String(v).startsWith(wchr));
}

/* 예정 등원 시간 계산 */
function plannedTimeFor(dateStr, stu) {
  if (!stu) return '';
  const w = WCHR[new Date(dateStr).getDay()];

  // 1) localStorage override (오늘표에서 직접 수정한 시간)
  const ov = getArriveOverride(dateStr, stu.id);
  if (ov && ov.trim()) return ov.trim();

  // 2) 학생 요일/시간(dayN + visitTimeN)
  for (let i = 1; i <= 5; i++) {
    const dayVal = (stu[`day${i}`] || '').trim();
    if (!dayVal) continue;
    if (!dayVal.startsWith(w)) continue;
    const vt = (stu[`visitTime${i}`] || '').trim();
    if (vt) return vt;
  }

  // 3) 주말: 슬롯 기반 기본값
  if (w === '토' || w === '일') {
    const nums = dayValues(stu)
      .filter(v => String(v).startsWith(w))
      .map(v => {
        const m = String(v).match(/\d+/);
        return m ? parseInt(m[0], 10) : null;
      })
      .filter(n => Number.isInteger(n));
    const minSlot = nums.length ? Math.min(...nums) : null;
    if (minSlot != null) {
      const key = `${w}${minSlot}`;
      if (ARRIVE_TIME_MAP[key]) return ARRIVE_TIME_MAP[key];
    }
    // 슬롯 없으면 대충 14:00
    return '14:00';
  }

  // 4) 평일 기본값
  if (ARRIVE_TIME_MAP[w]) return ARRIVE_TIME_MAP[w];
  return '';
}

function minutesFromTimeStr(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/* ✅ 최신 보강 맵 로드 (state.extra 누락/스테일 방지) */
async function loadExtraAttendMap() {
  try {
    const m = await fetch('/api/extra-attend', { cache: 'no-store' }).then(r => r.json());
    return (m && typeof m === 'object') ? m : {};
  } catch {
    return {};
  }
}

/* 특정 날짜 기준 오늘 학생 명단 (완료는 제외X, 결석만 제외, 보강 포함) */
async function computeListForGraph(dateStr) {
  const wchr = WCHR[new Date(dateStr).getDay()];
  const studs = state.students || [];
  const absentByDate = state.absentByDate || {};

  // ✅ 보강은 서버 최신 기준
  const extraMap = await loadExtraAttendMap();

  // 정규 + 보강
  const regular = studs.filter(s => hasWeekday(s, wchr));
  const extraIds = (extraMap[dateStr] || []).map(String);
  const extraStudents = extraIds
    .map(id => studs.find(s => String(s.id) === id))
    .filter(Boolean);

  // 중복 제거
  const seen = new Set();
  let list = [...regular, ...extraStudents].filter(s => {
    const id = String(s.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // 결석만 제외
  const absentSet = new Set((absentByDate[dateStr] || []).map(String));
  list = list.filter(s => !absentSet.has(String(s.id)));

  // 완료인 학생은 제외하지 않는다!
  return list;
}

/* 각 학생: [start, end] = 예정 등원시간 ~ +4시간 */
function buildSpans(dateStr, list) {
  const spans = [];
  for (const stu of list) {
    const tStr = plannedTimeFor(dateStr, stu);
    const startMin = minutesFromTimeStr(tStr);
    if (startMin == null) continue;
    const endMin = startMin + 4 * 60;
    spans.push({ start: startMin, end: endMin });
  }
  return spans;
}

/* 1시간 단위 슬롯으로 집계 */
function buildSlots(dateStr, list) {
  const spans = buildSpans(dateStr, list);
  if (!spans.length) return [];

  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const sp of spans) {
    if (sp.start < minStart) minStart = sp.start;
    if (sp.end > maxEnd) maxEnd = sp.end;
  }

  const startHour = Math.floor(minStart / 60);
  const endHour = Math.ceil(maxEnd / 60);

  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    const slotStart = h * 60;
    const slotEnd = (h + 1) * 60;
    let cnt = 0;
    for (const sp of spans) {
      if (sp.start < slotEnd && sp.end > slotStart) cnt++;
    }
    slots.push({ hour: h, count: cnt });
  }
  return slots;
}

function formatHourRange(h) {
  const h1 = ((h % 24) + 24) % 24;
  const h2 = ((h + 1) % 24 + 24) % 24;
  return `${h1}시~${h2}시`;
}

/* 실제 DOM 렌더 공용 함수 */
function renderTimeGraphInto(dateStr, list, wrap, emptyLabel) {
  const slots = buildSlots(dateStr, list);

  if (!slots.length) {
    wrap.innerHTML = `
      <div class="tg-title">
        시간대별 예상 학생 수
        <small>${emptyLabel}</small>
      </div>
    `;
    return;
  }

  const maxCnt = Math.max(...slots.map(s => s.count)) || 1;
  const rowsHtml = slots.map(s => {
    const pct = Math.round((s.count / maxCnt) * 100);
    return `
      <div class="tg-row">
        <div class="tg-label">${formatHourRange(s.hour)}</div>
        <div class="tg-bar-bg">
          <div class="tg-bar-fill" style="width:${pct}%;"></div>
        </div>
        <div class="tg-count">${s.count}명</div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="tg-title">
      시간대별 예상 학생 수
      <small>예정 등원시간 기준 +4시간</small>
    </div>
    <div class="tg-body">
      ${rowsHtml}
    </div>
  `;
}

/* 오늘 기준(캘린더 위) 그래프 */
async function renderTimeGraph() {
  injectStyles();
  const wrap = document.getElementById('timeGraphWrap');
  if (!wrap) return;

  const today = todayLocalKey();
  const list = await computeListForGraph(today);
  renderTimeGraphInto(today, list, wrap, '(오늘 학생 없음)');
}

/* 외부에서 임의 날짜 + 학생 배열로 그릴 수 있는 함수 */
export function renderTimeGraphForDate(dateStr, students, wrapId = 'timeGraphWrapForDate') {
  injectStyles();
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const list = Array.isArray(students) ? students : [];
  renderTimeGraphInto(dateStr, list, wrap, '(학생 없음)');
}

export function initTimeGraph() {
  // 초기 렌더
  renderTimeGraph();

  // 오늘표 갱신(admin:refresh) 할 때마다 같이 다시 계산
  document.addEventListener('admin:refresh', () => {
    renderTimeGraph();
  });
}
  