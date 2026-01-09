// /js/admin/features/calendar.js
// FullCalendar 월 뷰 + 날짜별 인원 카운트 뱃지 + 출결 모달(+주말 슬롯 선택/보강 병합 저장 - 멀티 슬롯 지원)
import { $ } from '../core/utils.js';
import { state } from '../core/state.js';
import { renderTimeGraphForDate } from './timeGraph.js';

export function initCalendar() {
  const calendarEl = $('calendar'); if (!calendarEl) return;

  const CT = { 'Content-Type': 'application/json' };
  const WCHR = '일월화수목금토';
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yoil = dateStr => WCHR[new Date(dateStr).getDay()];
  const isWeekend = dateStr => ['토', '일'].includes(yoil(dateStr));

  let countMap = {};
  // 보강/주말타임 맵 캐시
  let EXTRA = {};     // {"YYYY-MM-DD":[sid,...]}
  let WEEKEND = {};   // {"YYYY-MM-DD": {sid: 1|2|3 | [1,2,3]}}

  // 슬롯 버튼 클릭 핸들러 중복 방지 플래그
  let slotClickBound = false;

  // 유틸: 학생이 해당 요일 정규 등원하는지
  function hasWeekday(s, w) {
    return Object.keys(s).some(k => /^day\d+$/.test(k) && String(s[k]).startsWith(w));
  }

  // ✅ 정규 주말 슬롯 추출(학생 스키마에서 요일 숫자 파싱)
  function getRegularWeekendSlots(stu, dateStr) {
    const w = yoil(dateStr);
    if (w !== '토' && w !== '일') return [];
    const vals = Object.keys(stu)
      .filter(k => /^day\d+$/.test(k) && stu[k])
      .map(k => String(stu[k]))
      .filter(v => v.startsWith(w));
    const nums = vals.map(v => {
      const m = v.match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    }).filter(n => Number.isInteger(n));
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  }

  async function preloadExtraWeekend() {
    try { EXTRA = await fetch('/api/extra-attend', { cache: 'no-store' }).then(r => r.json()); } catch { EXTRA = {}; }
    try { WEEKEND = await fetch('/api/weekend-slots', { cache: 'no-store' }).then(r => r.json()); } catch { WEEKEND = {}; }
  }

  // 월 뷰 범위 내 날짜별 인원 카운트 계산(정규+보강 - 결석)
  async function fetchCountsForRange(start, end) {
    await preloadExtraWeekend();
    const days = []; const cur = new Date(start);
    while (cur < end) { days.push(ymd(cur)); cur.setDate(cur.getDate() + 1); }
    countMap = {};
    for (const dateStr of days) {
      const wchr = yoil(dateStr);
      const regularIds = state.students.filter(s => hasWeekday(s, wchr)).map(s => String(s.id));
      const extraIds = (EXTRA[dateStr] || []).map(String);
      const ids = new Set([...regularIds, ...extraIds]);
      (state.absentByDate[dateStr] || []).map(String).forEach(id => ids.delete(id));
      countMap[dateStr] = ids.size;
    }
  }

  function refreshCountBadges() {
    document.querySelectorAll('.fc-daygrid-day').forEach(cell => {
      const dateStr = cell.getAttribute('data-date'); if (!dateStr) return;
      let badge = cell.querySelector('.att-count-badge');
      if (!badge) {
        badge = document.createElement('div'); badge.className = 'att-count-badge';
        badge.style.cssText = 'position:absolute;right:4px;bottom:4px;font-size:11px;opacity:.85;pointer-events:none;';
        cell.style.position = 'relative'; cell.appendChild(badge);
      }
      badge.textContent = `${countMap[dateStr] || 0}명`;
    });
  }

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ko',
    dateClick: info => openAttendModal(info.dateStr),
    datesSet: range => { fetchCountsForRange(range.start, range.end).then(refreshCountBadges); }
  });
  calendar.render();

  // 외부에서 새로고침 필요할 때 호출
  window.recalcCalendarCounts = function () {
    return fetchCountsForRange(calendar.view.currentStart, calendar.view.currentEnd).then(refreshCountBadges);
  };

  // ───────────────── 출결 모달 ─────────────────
  function openAttendModal(dateStr) {
    const attendModal = $('attendModal'), titleEl = $('attendDateTitle'), listEl = $('attendList');
    if (!attendModal || !titleEl || !listEl) return;

    titleEl.textContent = `${dateStr} (${yoil(dateStr)})`;

    // 모달 안에 "그 날짜용 시간 그래프" 컨테이너 보장
    if (listEl.parentElement && !$('timeGraphWrapForDate')) {
      const g = document.createElement('div');
      g.id = 'timeGraphWrapForDate';
      g.style.margin = '8px 0 10px';
      listEl.parentElement.insertBefore(g, listEl);
    }

    Promise.all([
      fetch(`/api/attend?date=${dateStr}`, { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/extra-attend', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/weekend-slots', { cache: 'no-store' }).then(r => r.json()).catch(() => ({}))
    ]).then(([att, extraMap, weekendMap]) => {
      EXTRA = extraMap || {};
      WEEKEND = weekendMap || {};
      const extras = (EXTRA[dateStr] || []).map(String);
      const slotMap = WEEKEND[dateStr] || {};

      // 리스트: 주말이면 “정규+보강” 슬롯 합쳐서 표기(예: 일2·일3)
      listEl.innerHTML = att.map(s => {
        const sid = String(s.id);
        const isExtra = extras.includes(sid);

        let tail = '';
        if (isWeekend(dateStr)) {
          const regular = getRegularWeekendSlots(s, dateStr);               // 정규
          const raw = slotMap[sid];                                         // 보강
          const extraArr = Array.isArray(raw) ? raw.slice() : [Number.isInteger(raw) ? raw : undefined].filter(Boolean);
          const merged = Array.from(new Set([...regular, ...extraArr])).sort((a, b) => a - b);
          if (isExtra && merged.length) {
            const mark = merged.map(n => `${yoil(dateStr)}${n}`).join('·');
            tail = `<span style="color:#2563eb;margin-left:6px">[${mark}]</span>`;
          }
        }

        return `<li data-id="${s.id}" style="margin:4px 0;">
          ${s.name} (${s.curriculum}${s.subCurriculum ? ' ' + s.subCurriculum : ''}) ${tail}
        </li>`;
      }).join('');

      // 🔹 이 날짜의 attend 명단으로 시간대 그래프 그리기
      renderTimeGraphForDate(dateStr, att, 'timeGraphWrapForDate');

      attendModal.style.display = 'flex';
    }).catch(() => alert('출결 정보를 불러올 수 없습니다.'));
  }

  // 닫기
  $('attendClose')?.addEventListener('click', () => $('attendModal').style.display = 'none');
  document.body.addEventListener('click', (e) => { if (e.target.id === 'attendModal') $('attendModal').style.display = 'none'; });

  // ───────────── 보강/결석 선택 모달 ─────────────
  const selectionModal = $('selectionModal'),
    selectionListEl = $('selectionList'),
    selectionSaveBtn = $('selectionSave'),
    selectionClose = $('selectionClose');

  $('addExtraBtn')?.addEventListener('click', () => openSelectionUI('extra'));
  $('markAbsentBtn')?.addEventListener('click', () => openSelectionUI('absent'));

  function slotLegend() {
    return `
      <div style="display:flex;gap:6px;align-items:center;
           padding:6px 8px;margin-bottom:8px;border:1px dashed #3b82f6;border-radius:8px;font-size:12px">
        <b>주말 타임 선택</b>
        <span>1</span><span>2</span><span>3</span>
        <small style="opacity:.7">여러 개 클릭 가능(예: 1·3 → 연강)</small>
      </div>`;
  }

  function studentRow(s, dateStr, preChecked, curSlots) {
    const weekend = isWeekend(dateStr);
    const has = new Set((Array.isArray(curSlots) ? curSlots : [curSlots]).filter(n => Number.isInteger(n)));
    return `
      <li data-id="${s.id}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0">
        <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
          <input type="checkbox" class="chk-sid" ${preChecked ? 'checked' : ''}>
          <span>${s.name}</span>
          <small style="opacity:.65">${s.curriculum || ''}${s.subCurriculum ? ' · ' + s.subCurriculum : ''}</small>
        </label>
        ${weekend ? `
          <div class="slot-box" style="display:flex;gap:6px">
            ${[1, 2, 3].map(n => `
              <button type="button" class="slot-btn ${has.has(n) ? 'on' : ''}" data-slot="${n}"
                style="min-width:32px;height:28px;border:1px solid #64748b;border-radius:6px;
                       background:${has.has(n) ? '#3b82f6' : 'transparent'};color:${has.has(n) ? '#fff' : 'inherit'}">${n}</button>
            `).join('')}
          </div>` : ``}
      </li>`;
  }

  function openSelectionUI(mode) {
    const dateStr = $('attendDateTitle').textContent.split(' ')[0]; // "YYYY-MM-DD (요일)" → 날짜만
    Promise.all([
      fetch(`/api/attend?date=${dateStr}`, { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/extra-attend', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/weekend-slots', { cache: 'no-store' }).then(r => r.json()).catch(() => ({}))
    ]).then(([todayAtt, extraMap, weekendMap]) => {
      EXTRA = extraMap || {};
      WEEKEND = weekendMap || {};

      // 목록 소스: 결석 처리는 오늘 등원자만, 보강은 전체 학생
      const listSource = mode === 'absent' ? todayAtt : (state.students || []).slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));

      const pre = new Set((EXTRA[dateStr] || []).map(String));
      const perDateSlot = WEEKEND[dateStr] || {};
      const weekend = isWeekend(dateStr);

      selectionListEl.innerHTML =
        (mode === 'extra' && weekend ? slotLegend() : '') +
        listSource.map(s => {
          const sid = String(s.id);
          const checked = mode === 'extra' ? pre.has(sid) : false;
          // ⚠️ UI의 기본 선택 슬롯은 "보강 슬롯"만 반영(정규는 안내용으로만 쓰고 저장은 따로)
          const curSlots = weekend ? (perDateSlot[sid] ?? 1) : 0;
          return studentRow(s, dateStr, checked, curSlots);
        }).join('');

      // 행 클릭 시 배경 토글
      selectionListEl.querySelectorAll('li').forEach(li => {
        const lab = li.querySelector('label');
        if (lab) {
          lab.addEventListener('click', () => {
            li.classList.toggle('selected', li.querySelector('.chk-sid').checked);
            li.style.background = li.classList.contains('selected') ? 'rgba(59,130,246,0.15)' : '';
          });
          if (li.querySelector('.chk-sid')?.checked) {
            li.classList.add('selected');
            li.style.background = 'rgba(59,130,246,0.15)';
          }
        }
      });

      // 슬롯 버튼 클릭 핸들러: 한 번만 바인딩(중복 방지)
      if (!slotClickBound) {
        selectionListEl.addEventListener('click', onSlotClick);
        slotClickBound = true;
      }

      selectionModal.dataset.mode = mode;
      selectionModal.dataset.date = dateStr;
      selectionModal.style.display = 'flex';
    });
  }

  // 슬롯 버튼 클릭 핸들러 (이벤트 위임)
  function onSlotClick(e) {
    const btn = e.target.closest('.slot-btn');
    if (!btn) return;
    const li = btn.closest('li[data-id]');
    if (!li) return;

    btn.classList.toggle('on');
    const on = btn.classList.contains('on');
    btn.style.background = on ? '#3b82f6' : 'transparent';
    btn.style.color = on ? '#fff' : 'inherit';

    // 자동 체크
    const chk = li.querySelector('.chk-sid');
    if (chk && !chk.checked) {
      chk.checked = true;
      li.classList.add('selected');
      li.style.background = 'rgba(59,130,246,0.15)';
    }
  }

  // 저장(보강: 체크된 학생만 남기고, 주말 슬롯은 배열로 저장 가능)
  selectionSaveBtn?.addEventListener('click', async () => {
    const mode = selectionModal.dataset.mode, dateStr = selectionModal.dataset.date;
    const weekend = isWeekend(dateStr);

    const items = [...selectionListEl.querySelectorAll('li[data-id]')];
    const selectedIds = items.filter(li => li.querySelector('.chk-sid')?.checked)
      .map(li => String(li.dataset.id));

    // ── 결석 처리 ──
    if (mode === 'absent') {
      selectedIds.forEach(id => { state.absences[id] = dateStr; });
      const set = new Set([...(state.absentByDate[dateStr] || []), ...selectedIds]);
      state.absentByDate[dateStr] = [...set];
      try {
        await fetch('/api/absent', {
          method: 'POST', headers: CT,
          body: JSON.stringify({ by_date: state.absentByDate, by_student: state.absences })
        });
        alert('결석 처리 완료');
        selectionModal.style.display = 'none';
        window.recalcCalendarCounts && window.recalcCalendarCounts();
      } catch { alert('요청에 실패했습니다.'); }
      return;
    }

    // ── 보강 추가/해제 ──
    await preloadExtraWeekend(); // 최신화
    const nextSet = new Set(selectedIds);
    EXTRA[dateStr] = Array.from(nextSet); // 체크 해제된 학생은 제거

    // 주말 슬롯 저장 (여러 개 가능) — 저장은 "보강 슬롯"만
    if (weekend) {
      const perDate = WEEKEND[dateStr] || {};
      // 먼저, 선택되지 않은 학생의 보강 슬롯 제거
      for (const sid of Object.keys(perDate)) {
        if (!nextSet.has(String(sid))) delete perDate[sid];
      }
      // 선택된 학생의 보강 슬롯 갱신
      for (const li of items) {
        const sid = String(li.dataset.id);
        if (!nextSet.has(sid)) continue;
        const sel = [...li.querySelectorAll('.slot-btn.on')].map(b => parseInt(b.dataset.slot, 10)).sort((a, b) => a - b);
        // 1개면 숫자, 2개 이상이면 배열로 저장(정규와 합치는 건 표시/정렬 시에만 처리)
        perDate[sid] = sel.length <= 1 ? (sel[0] || 1) : sel;
      }
      WEEKEND[dateStr] = perDate;
    }

    try {
      // 보강 맵 전체 저장
      await fetch('/api/extra-attend', { method: 'POST', headers: CT, body: JSON.stringify(EXTRA) });
      // 주말 슬롯도 전체 맵 저장 (한 날짜만 보내지 말고 전체)
      if (weekend) {
        await fetch('/api/weekend-slots', { method: 'POST', headers: CT, body: JSON.stringify(WEEKEND) });
      }
      alert('보강 저장 완료');
      selectionModal.style.display = 'none';
      // 모달 상단 리스트/뱃지 갱신
      $('attendModal').style.display = 'none';
      openAttendModal(dateStr);
      window.recalcCalendarCounts && window.recalcCalendarCounts();
    } catch (e) {
      console.error(e);
      alert('요청에 실패했습니다.');
    }
  });

  selectionClose?.addEventListener('click', () => selectionModal.style.display = 'none');
}
