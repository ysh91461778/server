// /js/admin/features/videoModal.js
// 영상 배정 모달
// - 챕터 번호 기준 정렬
// - sid 키 정규화
// - 드래그 다중 선택 유지
// - ✅ updates 저장 포맷을 "배열"로 통일
// - ✅ A:Ble 자동배정 1개 / APEX 자동배정 2개

import { $, CT, toast, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

let editingSid = null;

function ensureModal() {
  if ($('#vidModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="vidModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);justify-content:center;align-items:center;z-index:9998">
      <div style="background:#fff;padding:1rem;border-radius:8px;max-height:80%;overflow:auto;width:360px">
        <h3 id="mTitle" style="margin-top:0"></h3>
        <div id="chkZone"></div>
        <div style="text-align:right;margin-top:.6rem">
          <button id="mSave">저장</button>
          <button id="mClose">닫기</button>
        </div>
      </div>
    </div>`);
}

/* ───────────── 챕터 정렬 ───────────── */
const chapNum = v => {
  const c = (v?.chapter ?? 0);
  const n = Number(c);
  return Number.isNaN(n)
    ? parseFloat(String(c).replace(/[^0-9.]/g, '')) || 0
    : n;
};
const byChapterAsc = (a, b) =>
  chapNum(a) - chapNum(b) ||
  String(a.title || '').localeCompare(String(b.title || ''), 'ko') ||
  String(a.mid).localeCompare(String(b.mid));

/* ───────────── updates 읽기/쓰기 ───────────── */

// ✅ 읽기는 배열 / {videos:[]} 둘 다 허용
function readAssignFor(updates, day, sid) {
  const dmap = updates?.[day] || {};
  const k1 = String(sid);
  const k2 = Number.isFinite(+sid) ? String(+sid) : null;
  const raw = dmap[k1] ?? (k2 != null ? dmap[k2] : undefined);

  if (Array.isArray(raw)) return raw.map(String);
  if (raw && Array.isArray(raw.videos)) return raw.videos.map(String);
  return [];
}

// ✅ 쓰기는 무조건 배열로만 저장
function writeAssignFor(updates, day, sid, arr) {
  const k = String(sid);
  updates[day] = updates[day] || {};
  const dmap = updates[day];

  // 숫자키 정리
  const numKey = Number.isFinite(+sid) ? String(+sid) : null;
  if (numKey && numKey !== k && dmap[numKey] !== undefined) {
    delete dmap[numKey];
  }

  dmap[k] = arr.map(String);
}

/* ───────────── 메인 ───────────── */
export function initVideoModal() {
  ensureModal();

  const vidModal = $('vidModal');
  const mTitle   = $('mTitle');
  const chkZone  = $('chkZone');

  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.editVid');
    if (!btn) return;

    editingSid = btn.closest('tr')?.dataset.sid;
    const stu = state.students.find(x => String(x.id) === String(editingSid));
    if (!stu) { alert('학생 정보를 찾을 수 없습니다.'); return; }

    mTitle.textContent = `${stu.name} – ${stu.curriculum} (${stu.subCurriculum || '전체'})`;

    const curKey = (stu.curriculum || '').trim().toLowerCase();
    const subKey = (stu.subCurriculum || '').trim().toLowerCase();

    // ① 과목+소과목 필터
    let curVids = (state.videos || [])
      .filter(v =>
        String(v.curriculum || '').trim().toLowerCase() === curKey &&
        String(v.subCurriculum || '').trim().toLowerCase() === subKey
      )
      .slice()
      .sort(byChapterAsc);

    // fallback: 소과목 안 맞으면 과목만
    if (!curVids.length) {
      curVids = (state.videos || [])
        .filter(v =>
          String(v.curriculum || '').trim().toLowerCase() === curKey
        )
        .slice()
        .sort(byChapterAsc);
    }

    const today = todayLocalKey();

    // 최신 updates 동기화 (서버 자동배정 반영)
    try {
      const fresh = await fetch('/api/updates', { cache: 'no-store' }).then(r => r.json());
      if (fresh && typeof fresh === 'object') state.updates = fresh;
    } catch {}

    let assigned = readAssignFor(state.updates, today, editingSid);

    // ② 기본 자동 추천 (비어 있을 때만)
    if (assigned.length === 0) {
      const lastStatus = {};
      const datesAsc = Object.keys(state.progress || {}).sort();
      for (const d of datesAsc) {
        const perSid = state.progress[d]?.[editingSid];
        if (!perSid) continue;
        for (const [mid, st] of Object.entries(perSid)) lastStatus[mid] = st;
      }

      const blocked = {};
      for (const [mid, st] of Object.entries(lastStatus)) {
        if (st === 'done' || st === 'skip') blocked[mid] = true;
      }

      // ✅ 자동배정 개수 규칙
      // - A:Ble: 1개
      // - APEX : 2개
      // - 그 외 : 2개
      const subRaw = (stu.subCurriculum || '').trim();
      const maxAssign =
        subRaw === 'A:Ble' ? 1 :
        subRaw === 'APEX'  ? 2 :
        2;

      const toAssign = [];
      for (const v of curVids) {
        if (!blocked[v.mid]) toAssign.push(String(v.mid));
        if (toAssign.length >= maxAssign) break;
      }

      assigned = toAssign;

      // ✅ 배열 포맷으로 저장
      writeAssignFor(state.updates, today, editingSid, assigned);
      fetch('/api/updates', {
        method: 'POST',
        headers: CT,
        body: JSON.stringify(state.updates)
      }).catch(() => {});
    }

    // ③ 체크박스 렌더
    chkZone.innerHTML = curVids.length
      ? curVids.map(v => `
        <label style="display:block;user-select:none;cursor:pointer">
          <input type="checkbox" value="${v.mid}"
            ${assigned.includes(String(v.mid)) ? 'checked' : ''}>
          ${v.chapter}. ${v.title}
        </label>
      `).join('')
      : `<div style="padding:6px 4px;color:#666;font-size:13px">
          해당 과목 영상이 없습니다.
        </div>`;

    vidModal.style.display = 'flex';
  });

  /* ───────────── 닫기 ───────────── */
  document.body.addEventListener('click', (e) => {
    if (e.target.id === 'mClose' || e.target.id === 'vidModal') {
      $('vidModal').style.display = 'none';
    }
  });

  /* ───────────── 드래그 다중 선택 ───────────── */
  let pointerDown = false;
  let dragActive = false;
  let dragCheckValue = null;
  let startCheckbox = null;
  let startChecked = false;
  let suppressClickOnce = false;

  function findCheckboxFromEventTarget(target) {
    const label = target.closest('label');
    if (!label) return null;
    return label.querySelector('input[type="checkbox"]');
  }

  chkZone.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const cb = findCheckboxFromEventTarget(e.target);
    if (!cb) return;

    pointerDown = true;
    dragActive = false;
    dragCheckValue = null;
    startCheckbox = cb;
    startChecked = cb.checked;
  });

  chkZone.addEventListener('mousemove', (e) => {
    if (!pointerDown) return;
    const cb = findCheckboxFromEventTarget(e.target);
    if (!cb) return;

    if (!dragActive) {
      dragActive = true;
      dragCheckValue = !startChecked;
      if (startCheckbox) startCheckbox.checked = dragCheckValue;
    }

    cb.checked = dragCheckValue;
    e.preventDefault();
  });

  chkZone.addEventListener('mouseover', (e) => {
    if (!pointerDown) return;
    const cb = findCheckboxFromEventTarget(e.target);
    if (!cb) return;

    if (!dragActive) {
      dragActive = true;
      dragCheckValue = !startChecked;
      if (startCheckbox) startCheckbox.checked = dragCheckValue;
    }

    cb.checked = dragCheckValue;
    e.preventDefault();
  });

  chkZone.addEventListener('click', (e) => {
    if (!suppressClickOnce) return;
    const cb = findCheckboxFromEventTarget(e.target);
    if (!cb) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickOnce = false;
  });

  document.addEventListener('mouseup', () => {
    if (!pointerDown) return;
    pointerDown = false;
    if (dragActive) suppressClickOnce = true;

    dragActive = false;
    dragCheckValue = null;
    startCheckbox = null;
  });

  /* ───────────── 저장 ───────────── */
  $('mSave').onclick = () => {
    const today = todayLocalKey();
    const selected = Array.from(
      document.querySelectorAll('#chkZone input[type="checkbox"]:checked')
    ).map(b => String(b.value));

    if (selected.length) {
      writeAssignFor(state.updates, today, editingSid, selected);
    } else {
      state.updates[today] = state.updates[today] || {};
      delete state.updates[today][String(editingSid)];
    }

    fetch('/api/updates', {
      method: 'POST',
      headers: CT,
      body: JSON.stringify(state.updates)
    })
      .then(() => fetch('/api/updates', { cache: 'no-store' }))
      .then(r => r.json())
      .then(u => {
        state.updates = u;
        toast('저장 완료');
        $('vidModal').style.display = 'none';
        document.dispatchEvent(new CustomEvent('admin:refresh'));
      })
      .catch(() => toast('저장 실패'));
  };
}
