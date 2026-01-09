// /static/js/admin/features/hoverTooltip.js
import { state } from '../core/state.js';

export function initHoverTooltip() {
  let tipEl = null;
  let tipMode = 'hover';        // 'hover' | 'fixed'
  let tipVariant = 'default';   // 'default' | 'log'  (log 모달용 축약 버전)

  const WCHR = '일월화수목금토';
  const LOG_TIP_POS_KEY = 'admin:logTipPos'; // 로그 모달 툴팁 위치 저장 키
  let dragState = null; // { pointerId, startX, startY, startLeft, startTop }

  function loadLogTipPos() {
    try {
      const raw = localStorage.getItem(LOG_TIP_POS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (typeof obj?.left === 'number' && typeof obj?.top === 'number') return obj;
    } catch { }
    return null;
  }

  function saveLogTipPos(left, top) {
    try {
      localStorage.setItem(LOG_TIP_POS_KEY, JSON.stringify({ left, top }));
    } catch { }
  }

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'adminSchoolTip';
    tipEl.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      background: rgba(17,24,39,.98); color: #fff; border-radius: 14px;
      padding: 12px 14px; font-size: 13px; box-shadow: 0 10px 28px rgba(0,0,0,.4);
      z-index: 100000; pointer-events: none; display: none;
      max-width: min(1100px, 92vw);
      max-height: min(86vh, 900px);
      overflow-x: hidden;
      overflow-y: auto;
      line-height: 1.5;
      transform: translate(10px, 10px);
      box-sizing: border-box;
      cursor: default;
    `;

    // 드래그 시작
    tipEl.addEventListener('pointerdown', (ev) => {
      // 고정 모드에서만 드래그 허용 (로그 모달 고정 툴팁)
      if (tipMode !== 'fixed') return;
      if (ev.button !== 0) return; // 좌클릭만

      const rect = tipEl.getBoundingClientRect();
      dragState = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };

      try { tipEl.setPointerCapture(ev.pointerId); } catch { }
      tipEl.style.cursor = 'grabbing';
      ev.preventDefault();
    });

    document.addEventListener('pointermove', (ev) => {
      if (!dragState) return;
      if (ev.pointerId !== dragState.pointerId) return;
      if (!tipEl) return;

      const dx = ev.clientX - dragState.startX;
      const dy = ev.clientY - dragState.startY;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = tipEl.getBoundingClientRect();

      let left = dragState.startLeft + dx;
      let top = dragState.startTop + dy;

      const pad = 12;
      const maxLeft = vw - rect.width - pad;
      const maxTop = vh - rect.height - pad;

      left = Math.max(pad, Math.min(left, maxLeft));
      top = Math.max(pad, Math.min(top, maxTop));

      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${top}px`;
    });

    function endDrag(ev) {
      if (!dragState) return;
      if (ev.pointerId !== dragState.pointerId) return;
      if (!tipEl) { dragState = null; return; }

      try { tipEl.releasePointerCapture(dragState.pointerId); } catch { }

      const rect = tipEl.getBoundingClientRect();
      // 고정 툴팁 위치를 공통으로 저장 (로그 모달에서 재사용)
      saveLogTipPos(rect.left, rect.top);

      tipEl.style.cursor = tipMode === 'fixed' ? 'grab' : 'default';
      dragState = null;
    }

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    document.body.appendChild(tipEl);
    return tipEl;
  }

  const pill = (label, value, opts = {}) => `
    <div style="
      display:flex; flex-direction:column; gap:2px;
      background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.12);
      padding:6px 10px; border-radius:10px; min-width:92px;">
      <div style="font-size:11px; opacity:.85">${label}</div>
      <div style="
        font-weight:700; white-space:nowrap;
        ${opts.big ? 'font-size:15px;' : ''}
      ">
        ${value || '-'}
      </div>
    </div>`;

  const em = (label, value) => `
    <div style="display:flex; gap:6px;">
      <div style="min-width:54px; opacity:.8">${label}</div>
      <div style="font-weight:700; word-break:break-word">${value || '-'}</div>
    </div>`;

  // ───────────────────────────────────────────
  // 학사일정: 기말(final) 우선, 없으면 중간(midterm) 폴백
  // ───────────────────────────────────────────
  function pickExam(sc, prefer = 'final') {
    const get = (obj, k, altKeys = []) => {
      for (const key of [k, ...altKeys]) {
        if (obj[key] != null && String(obj[key]).trim()) return obj[key];
      }
      return '';
    };

    const packs = {
      final: {
        label: '기말',
        date: get(sc, 'final', ['finalDate', '기말', '기말기간']),
        math: get(sc, 'finalMath', ['기말수학', 'final_math', '수학기말', '수학 기말']),
        range: get(sc, 'finalRange', ['기말범위']),
        note: get(sc, 'finalNote', ['기말비고']),
      },
      midterm: {
        label: '중간',
        date: get(sc, 'midterm', ['midtermDate', '중간', '중간기간']),
        math: get(sc, 'midtermMath', ['중간수학', 'midterm_math', '수학중간', '수학 중간']),
        range: get(sc, 'midtermRange', ['중간범위']),
        note: get(sc, 'midtermNote', ['중간비고']),
      }
    };

    const primary = packs[prefer];
    const fallback = packs[prefer === 'final' ? 'midterm' : 'final'];
    const hasPrimary = [primary.date, primary.math, primary.range, primary.note]
      .some(v => v && String(v).trim());
    return hasPrimary ? primary : fallback;
  }

  // ───────────────────────────────────────────
  // 날짜 파싱 & 시험까지 남은 출석일 계산
  // ───────────────────────────────────────────
  function parseFirstMonthDay(str) {
    if (!str) return null;
    const m = String(str).match(/(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (!month || !day) return null;

    const today = new Date();
    const year = today.getFullYear();
    const d = new Date(year, month - 1, day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function extractAttendWeekdays(stu) {
    const set = new Set();
    Object.keys(stu || {}).forEach(k => {
      if (!/^day\d+$/.test(k)) return;
      const v = String(stu[k] || '').trim();
      if (!v) return;
      const ch = v[0];
      if ('월화수목금토일'.includes(ch)) set.add(ch);
    });
    return [...set];
  }

  // "시험 시작일" 직전까지 등원 요일만 카운트
  function calcRemainingSessions(sc, stu) {
    if (!sc || !stu) return null;

    // 툴팁에 쓰는 것과 동일한 학사일정 패키지
    const examPack = pickExam(sc, 'final');

    // 1순위: 기말 시작일(기간) → 예: "12/3(수)~12/9(화)"
    // 2순위: 수학시험일 → 예: "12/4(목)"
    let examDate = null;
    if (examPack.date) {
      examDate = parseFirstMonthDay(examPack.date);
    }
    if (!examDate && examPack.math) {
      examDate = parseFirstMonthDay(examPack.math);
    }
    if (!examDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 시험이 오늘이거나 이미 시작한 경우: 남은 등원 0회
    if (examDate <= today) return 0;

    // "시험 시작일" 전날까지만 포함
    const end = new Date(examDate);
    end.setDate(end.getDate() - 1);
    end.setHours(0, 0, 0, 0);

    const daysOfWeek = extractAttendWeekdays(stu);
    if (!daysOfWeek.length) return null;

    let count = 0;
    const cur = new Date(today);

    // 오늘 ~ (시험 시작 전날)까지, 등원 요일 카운트
    while (cur <= end) {
      const w = WCHR[cur.getDay()];
      if (daysOfWeek.includes(w)) count++;
      cur.setDate(cur.getDate() + 1);
      cur.setHours(0, 0, 0, 0);
    }

    return count;
  }



  // ───────────────────────────────────────────
  // 영상/테스트 표시 (옵션으로 영상/테스트 각각 on/off)
  // ───────────────────────────────────────────
  function renderProgressTables(stu, opts = {}) {
    const { includeVideo = true, includeTests = true } = opts;
    const today = new Date().toISOString().slice(0, 10);

    const allDates = Object.keys(state.progress || {}).filter(d => d <= today).sort();
    const mergedProg = {};
    const mergedTests = {};

    allDates.forEach(d => {
      const per = state.progress[d]?.[stu.id] || {};
      Object.entries(per).forEach(([k, v]) => {
        if (k === 'tests') return;
        mergedProg[k] = v;
      });
      if (per.tests && typeof per.tests === 'object') {
        Object.entries(per.tests).forEach(([tname, st]) => {
          mergedTests[tname] = st;
        });
      }
    });

    let progBlock = '';
    if (includeVideo) {
      const vids = (state.videos || [])
        .filter(v => v.curriculum === stu.curriculum && v.subCurriculum === stu.subCurriculum)
        .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));

      const colorFor = (st) =>
        st === 'done' ? '#10b981' :
          st === 'interrupted' ? '#f59e0b' :
            st === 'skip' ? '#6b7280' :
              '#1f2937';

      const progCells = vids.map(v => {
        const st = mergedProg[String(v.mid)] || 'none';
        const color = colorFor(st);
        return `
          <div title="${v.chapter}차시 (${st})"
               style="
                 width: 26px; height: 26px; margin: 2px;
                 background:${color}; border:1px solid #111; color:#fff;
                 font-size:11px; display:flex; align-items:center; justify-content:center;
                 border-radius:6px; flex: 0 0 auto;">
            ${v.chapter}
          </div>`;
      }).join('');

      progBlock = `
        <div style="margin-top:10px;font-weight:800;font-size:13px">영상 진도</div>
        <div style="
          display:flex; flex-wrap:wrap; gap:0;
          align-items:center; max-width:100%;
        ">
          ${progCells || '<div style="padding:6px 8px;color:#bbb">해당 차시 없음</div>'}
        </div>
      `;
    }

    let unitBlock = '';
    let finalBlock = '';
    let hellBlock = '';

    if (includeTests) {
      const logsDates = Object.keys(state.logs || {}).filter(d => d <= today).sort();
      const takenMap = {};
      logsDates.forEach(d => {
        const entry = state.logs[d]?.[stu.id];
        const tests = Array.isArray(entry?.tests) ? entry.tests : [];
        tests.forEach(t => {
          const nm = String(t.name || '').trim();
          if (nm) takenMap[nm] = true;
        });
      });

      const norm = (s) => {
        const raw = String(s || '').toLowerCase().replace(/\s+/g, '');
        const m = raw.match(/(final|파이널|hell|헬)\s*([0-9]+)/);
        if (m) return `${m[1].replace('파이널', 'final').replace('헬', 'hell')}${m[2]}`;
        return raw;
      };

      const doneSet = new Set([
        ...Object.entries(mergedTests).filter(([, st]) => st === 'done').map(([k]) => norm(k)),
        ...Object.keys(takenMap).map(norm),
      ]);

      const testChip = (name, label = name) => {
        const ok = doneSet.has(norm(name));
        const color = ok ? '#10b981' : '#1f2937';
        const tt = `${label} (${ok ? '완료' : '미응시'})`;
        return `
          <div title="${tt}"
               style="
                 padding:4px 8px; margin:3px; border:1px solid #111; background:${color};
                 color:#fff; font-size:11px; white-space:nowrap; border-radius:8px; flex:0 0 auto;">
            ${label}
          </div>`;
      };

      const UNIT_LIST = ['명제1', '명제2'].map(n => [n, n]);
      const FINAL_LIST = [1, 2, 3, 4].map(n => [`final${n}`, `파이널 ${n}`]);
      const HELL_LIST = [1, 2, 3, 4].map(n => [`hell${n}`, `헬 ${n}`]);

      const chipRow = (pairs) => `
        <div style="display:flex; flex-wrap:wrap; align-items:center; max-width:100%;">
          ${pairs.map(([k, label]) => testChip(k, label)).join('')}
        </div>`;

      unitBlock = `
        <div style="margin-top:10px;font-weight:800;font-size:13px">테스트(단원평가)</div>
        ${chipRow(UNIT_LIST)}
      `;
      finalBlock = `
        <div style="margin-top:8px;font-weight:800;font-size:13px">파이널</div>
        ${chipRow(FINAL_LIST)}
      `;
      hellBlock = `
        <div style="margin-top:8px;font-weight:800;font-size:13px">헬</div>
        ${chipRow(HELL_LIST)}
      `;
    }

    return progBlock + unitBlock + finalBlock + hellBlock;
  }

  // ───────────────────────────────────────────
  // 학생 찾기
  // ───────────────────────────────────────────
  function findStudent(sid, name) {
    const studs = state.students || [];
    if (sid != null) {
      const hit = studs.find(s => String(s.id) === String(sid));
      if (hit) return hit;
    }
    if (name) {
      const nm = String(name).trim();
      const hit2 = studs.find(s => (s.name || '').trim() === nm);
      if (hit2) return hit2;
    }
    return null;
  }

  // ───────────────────────────────────────────
  // 위치 계산
  // ───────────────────────────────────────────
  function placeTooltipAt(x, y) {
    if (!tipEl) return;

    const pad = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = tipEl.getBoundingClientRect();

    let left = x + 12;
    let top = y + 12;

    if (left + rect.width + pad > vw) {
      left = Math.max(pad, x - rect.width - 12);
    }
    if (top + rect.height + pad > vh) {
      top = Math.max(pad, y - rect.height - 12);
    }

    left = Math.min(Math.max(pad, left), vw - pad - rect.width);
    top = Math.min(Math.max(pad, top), vh - pad - rect.height);

    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  function placeTooltip(ev) {
    if (!ev) return;
    placeTooltipAt(ev.clientX, ev.clientY);
  }

  function placeForLogModal() {
    if (!tipEl) return;

    tipEl.style.maxWidth = 'min(1200px, 94vw)';

    // 저장된 위치 있으면 우선 사용
    const stored = loadLogTipPos();
    if (stored) {
      tipEl.style.left = `${stored.left}px`;
      tipEl.style.top = `${stored.top}px`;
      return;
    }

    const pad = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = tipEl.getBoundingClientRect();

    const card =
      document.querySelector('#logModal .log-card') ||
      document.querySelector('#logModal .modal-card') ||
      document.querySelector('#logModal');

    let left;
    let top;

    if (card) {
      const c = card.getBoundingClientRect();

      left = c.left - rect.width + 850;
      if (left < pad) left = pad;

      top = c.top + 150;
      if (top + rect.height + pad > vh) {
        top = Math.max(pad, vh - rect.height - pad);
      }
    } else {
      left = pad;
      top = vh * 0.15;
      if (top + rect.height + pad > vh) {
        top = Math.max(pad, vh - rect.height - pad);
      }
    }

    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  // ───────────────────────────────────────────
  // HTML 구성
  // ───────────────────────────────────────────
  function buildTipHtml(stu, opts = {}) {
    const { includeVideo = true, includeTests = true } = opts;

    const name = (stu.name || '').trim();
    const level = stu.level || '';
    const days = [stu.day1, stu.day2, stu.day3].filter(Boolean).join('·');
    const subBooks = [stu.subBook1, stu.subBook2].filter(Boolean).join(', ');

    const schoolName =
      stu.school ||
      stu.highSchool || stu.schoolHigh || stu.high || stu.highschool || stu.high_school || stu['고등학교'] ||
      stu.middleSchool || stu.schoolMiddle || stu.middle || stu.middleschool || stu.middle_school || stu['중학교'] || '';

    const sc = (state.schoolCal && schoolName) ? (state.schoolCal[schoolName] || {}) : {};
    const textbook =
      sc.textbook || sc.mathTextbook || sc.book || sc.mathBook || sc['교과서'] || sc['수학교과서'] || '';

    const exam = pickExam(sc, 'final');

    const badgeColor =
      level === '상' ? '#2563eb' :
        level === '중상' ? '#f59e0b' :
          level === '중' ? '#16a34a' :
            '#ef4444';

    const levelBadge = level
      ? `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;
                      background:${badgeColor}; color:#fff; font-size:12px; font-weight:700; vertical-align:middle;">
           ${level}
         </span>`
      : '';

    const mainBlock = `
      <div style="font-weight:900;font-size:17px; margin-bottom:6px">
        ${name}${levelBadge}
      </div>
      ${schoolName ? `<div style="font-size:14px; font-weight:600; margin-bottom:6px">${schoolName}</div>` : ''}
      <div style="font-size:13px; margin-bottom:4px">
        ${days ? `<span style="margin-right:8px">📅 ${days}</span>` : ''}
        ${subBooks ? `<span style="margin-right:8px">📘 ${subBooks}</span>` : ''}
        ${textbook ? `<span>📕 ${textbook}</span>` : ''}
      </div>
    `;

    const remain = calcRemainingSessions(sc, stu);
    const remainInline = (remain != null)
      ? `<div style="font-size:16px;font-weight:900;margin-left:10px;white-space:nowrap;">
           시험 전 출석 : ${remain}회
         </div>`
      : '';

    const examBlock = schoolName ? `
      <div style="margin-top:10px; font-size:12.5px; font-weight:800; opacity:.9">학사일정</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:6px; max-width:100%">
        ${pill(exam.label, exam.date || '-')}
        ${pill('수학시험일', exam.math || '-', { big: true })}
        ${remainInline}
      </div>
      <div style="margin-top:8px; display:block; font-size:12px; max-width:100%">
        <div style="border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px">
          <div style="font-weight:800; margin-bottom:4px">${exam.label} 범위/특이사항</div>
          ${em('범위', exam.range)} 
          ${em('비고', exam.note)}
        </div>
      </div>
    ` : '<div style="opacity:.8;margin-top:6px;font-size:12px">학교 정보 없음</div>';

    const progBlock = renderProgressTables(stu, { includeVideo, includeTests });

    return `${mainBlock}${examBlock}${progBlock}`;
  }

  // ───────────────────────────────────────────
  // 핵심: 특정 요소 기준으로 툴팁 표시
  // ───────────────────────────────────────────
  function showTooltipForElement(anchorEl, ev, opts = {}) {
    if (!(anchorEl instanceof Element)) return;

    const sid = anchorEl.dataset.sid;
    const name = (anchorEl.textContent || '').trim();
    const stu = findStudent(sid, name);
    if (!stu) return;

    const variant = opts.variant || 'default';
    tipVariant = variant;
    tipMode = opts.fixed ? 'fixed' : 'hover';

    let includeVideo = true;
    let includeTests = true;

    if (variant === 'log') {
      includeVideo = false;
      includeTests = true;
    }

    const el = ensureTip();
    el.innerHTML = buildTipHtml(stu, { includeVideo, includeTests });
    el.style.display = 'block';

    // 고정 모드(로그 모달 등)에서는 드래그 가능해야 하므로 pointer-events: auto
    if (tipMode === 'fixed') {
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'grab';
    } else {
      el.style.pointerEvents = 'none';
      el.style.cursor = 'default';
    }

    requestAnimationFrame(() => {
      if (tipMode === 'fixed') {
        placeForLogModal();
      } else {
        if (ev) placeTooltip(ev);
        else {
          const r = anchorEl.getBoundingClientRect();
          placeTooltipAt(r.right, r.top);
        }
      }
    });
  }

  // ───────────────────────────────────────────
  // 전역 헬퍼
  // ───────────────────────────────────────────
  window.showStudentTooltipForElement = function (anchorEl, opts) {
    try {
      showTooltipForElement(anchorEl, null, {
        fixed: !!(opts && opts.fixed),
        variant: opts?.variant || 'default'
      });
    } catch (e) { console.warn(e); }
  };

  window.showStudentTooltipForSid = function (sid, opts) {
    const el = document.querySelector(`a.stuName[data-sid="${sid}"]`);
    if (el) {
      try {
        showTooltipForElement(el, null, {
          fixed: !!(opts && opts.fixed),
          variant: opts?.variant || 'default'
        });
      } catch (e) { console.warn(e); }
    }
  };

  window.hideStudentTooltip = function () {
    if (!tipEl) return;
    tipEl.style.display = 'none';
    tipMode = 'hover';
    tipVariant = 'default';
    tipEl.style.pointerEvents = 'none';
    tipEl.style.cursor = 'default';
    dragState = null;
  };

  // ───────────────────────────────────────────
  // 기존 hover 모드
  // ───────────────────────────────────────────
  function onOver(ev) {
    if (!(ev.target instanceof Element)) return;
    const a = ev.target.closest('a.stuName');
    if (!a) return;
    if (tipMode === 'fixed') return;
    showTooltipForElement(a, ev, { fixed: false, variant: 'default' });
  }

  function onMove(ev) {
    if (!tipEl || tipEl.style.display === 'none') return;
    if (tipMode !== 'hover') return;
    placeTooltip(ev);
  }

  function onOut(ev) {
    if (!(ev.target instanceof Element)) return;
    if (tipMode !== 'hover') return;
    const from = ev.target.closest('a.stuName');
    const to = (ev.relatedTarget instanceof Element) ? ev.relatedTarget.closest('a.stuName') : null;
    if (from && !to && tipEl) tipEl.style.display = 'none';
  }

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerout', onOut);
}
