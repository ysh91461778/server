// /js/school-cal.js — 표 직접 편집 + 중간/기말 보기 전환 + 가변 너비(특이사항 최대)
(() => {
  const CT = { 'Content-Type': 'application/json' };

  const table    = document.getElementById('calTable');
  const theadTr  = document.getElementById('theadRow');
  const tbody    = table.querySelector('tbody');
  const addBtn   = document.getElementById('addRow');
  const saveBtn  = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const seg      = document.getElementById('viewSeg');   // 중간/기말 버튼 컨테이너

  // { [학교명]: { textbook, semesterStart, midterm, midtermMath, midtermRange, midtermNote, final, finalMath, finalRange, finalNote } }
  let calMap = {};
  let viewMode = 'mid'; // 'mid' | 'final'

  // ── 작은 유틸: debounce ──
  function debounce(fn, delay = 800) {
    let t;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  // ── 기본 스타일 ──
  (function injectStyle() {
    const css = `
      #calTable{ table-layout:fixed; width:100%; }
      #calTable th, #calTable td{ padding:8px; }
      #calTable input[type="text"]{ width:100%; height:34px; box-sizing:border-box; padding:0 8px; }
      .btn-del{ width:28px; height:28px; border-radius:6px; cursor:pointer; }
    `;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  })();

  // ── colgroup: 요청한 비율에 맞춰 고정폭 + 특이사항은 나머지 전부 ──
  function applyColgroup() {
    // 순서: [#, 학교, 교과서, 개학, (날짜, 수학시험일, 범위, 특이사항), 삭제]
    // 너비 지정:
    //  - 학교명: 98px(70%), 교과서: 70px(50%)
    //  - (중간/기말)날짜: 10.8rem(120%), 수학 시험일: 7.2rem(80%), 범위: 4rem(40%)
    //  - 특이사항: 남는 폭 전부(= width 미지정)
    const COLS_FIXED = [
      '40px',  // #
      '98px',  // 학교명 (↓ 70%)
      '100px',  // 교과서 (↓ 50%)
      '9rem',  // 개학(날짜)
      '10.8rem', // (중간/기말) 날짜 (↑ 120%)
      '7.2rem',  // 수학 시험일 (↓ 80%)
      '9rem',    // (중간/기말) 범위 (↓ 40%)
      '',        // (중간/기말) 특이사항 = 남는폭 모두
      '56px'     // 삭제
    ];

    const old = table.querySelector('colgroup');
    if (old) old.remove();
    const cg = document.createElement('colgroup');
    cg.innerHTML = COLS_FIXED.map(w => w ? `<col style="width:${w}">` : `<col>`).join('');
    table.insertBefore(cg, table.firstElementChild);
  }

  // ── thead ──
  function renderHead() {
    const cols = [
      ['#', '40px'],
      ['학교명', '98px'],
      ['교과서', '70px'],
      ['개학(날짜)', '9rem'],
      ...(viewMode === 'mid'
        ? [['중간(날짜)','10.8rem'], ['수학 시험일','7.2rem'], ['중간(범위)','4rem'], ['중간(특이사항)','']]
        : [['기말(날짜)','10.8rem'], ['수학 시험일','7.2rem'], ['기말(범위)','4rem'], ['기말(특이사항)','']]),
      ['삭제','56px']
    ];
    theadTr.innerHTML = cols.map(([t,w]) => `<th style="${w?`width:${w}`:''}">${t}</th>`).join('');
    applyColgroup();
  }

  const esc = (s)=> String(s ?? '').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const renumber = ()=> { [...tbody.rows].forEach((tr,i)=>tr.cells[0].textContent=String(i+1)); };

  // ── tbody ──
  function renderBody() {
    const rows = Object.entries(calMap).sort(([a],[b]) => a.localeCompare(b,'ko'));
    tbody.innerHTML = rows.map(([school, s], i) => {
      const midDate   = s.midterm      || '';
      const midMath   = s.midtermMath  || '';
      const midRange  = s.midtermRange || '';
      const midNote   = s.midtermNote  || '';
      const finDate   = s.final        || '';
      const finMath   = s.finalMath    || '';
      const finRange  = s.finalRange   || '';
      const finNote   = s.finalNote    || '';
      return `
        <tr>
          <td style="text-align:center">${i+1}</td>
          <td><input type="text" class="inp-school"   value="${esc(school)}"               placeholder="학교명"></td>
          <td><input type="text" class="inp-textbook" value="${esc(s.textbook||'')}"      placeholder="예) YBM/미래엔/비상"></td>
          <td><input type="text" class="inp-sem"      value="${esc(s.semesterStart||'')}" placeholder="예) 8/12(화)"></td>
          ${
            viewMode === 'mid'
            ? `
              <td><input type="text" class="inp-mid-date"  value="${esc(midDate)}"  placeholder="예) 9/29~10/2"></td>
              <td><input type="text" class="inp-mid-math"  value="${esc(midMath)}"  placeholder="예) 10/3(목)"></td>
              <td><input type="text" class="inp-mid-range" value="${esc(midRange)}" placeholder="예) 7~10, 총4"></td>
              <td><input type="text" class="inp-mid-note"  value="${esc(midNote)}"  placeholder="예) 과목/출제범위/방식/시간"></td>
            `
            : `
              <td><input type="text" class="inp-fin-date"  value="${esc(finDate)}"  placeholder="예) 12/8~12/12"></td>
              <td><input type="text" class="inp-fin-math"  value="${esc(finMath)}"  placeholder="예) 12/10(화)"></td>
              <td><input type="text" class="inp-fin-range" value="${esc(finRange)}" placeholder="예) 6~9, 총4"></td>
              <td><input type="text" class="inp-fin-note"  value="${esc(finNote)}"  placeholder="예) 과목/출제범위/방식/시간"></td>
            `
          }
          <td style="text-align:center"><button type="button" class="btn-del" title="삭제">🗑</button></td>
        </tr>`;
    }).join('') || rowBlank();
  }

  function rowBlank() {
    return `
      <tr>
        <td style="text-align:center">1</td>
        <td><input type="text" class="inp-school"   placeholder="학교명"></td>
        <td><input type="text" class="inp-textbook" placeholder="예) YBM/미래엔/비상"></td>
        <td><input type="text" class="inp-sem"      placeholder="예) 8/12(화)"></td>
        ${
          viewMode === 'mid'
          ? `
            <td><input type="text" class="inp-mid-date"  placeholder="예) 9/29~10/2"></td>
            <td><input type="text" class="inp-mid-math"  placeholder="예) 10/3(목)"></td>
            <td><input type="text" class="inp-mid-range" placeholder="예) 7~10, 총4"></td>
            <td><input type="text" class="inp-mid-note"  placeholder="예) 과목/출제범위/방식/시간"></td>
          `
          : `
            <td><input type="text" class="inp-fin-date"  placeholder="예) 12/8~12/12"></td>
            <td><input type="text" class="inp-fin-math"  placeholder="예) 12/10(화)"></td>
            <td><input type="text" class="inp-fin-range" placeholder="예) 6~9, 총4"></td>
            <td><input type="text" class="inp-fin-note"  placeholder="예) 과목/출제범위/방식/시간"></td>
          `
        }
        <td style="text-align:center"><button type="button" class="btn-del" title="삭제">🗑</button></td>
      </tr>`;
  }

  function render() { renderHead(); renderBody(); }

  // ── 현재 화면값 → calMap ──
  function syncFromView() {
    const next = {};
    [...tbody.rows].forEach(tr => {
      const name = tr.querySelector('.inp-school')?.value.trim();
      if (!name) return;
      const base = calMap[name] ? { ...calMap[name] } : {};
      base.textbook      = tr.querySelector('.inp-textbook')?.value.trim() || '';
      base.semesterStart = tr.querySelector('.inp-sem')?.value.trim() || '';

      if (viewMode === 'mid') {
        base.midterm      = tr.querySelector('.inp-mid-date')?.value.trim()  || '';
        base.midtermMath  = tr.querySelector('.inp-mid-math')?.value.trim()  || '';
        base.midtermRange = tr.querySelector('.inp-mid-range')?.value.trim() || '';
        base.midtermNote  = tr.querySelector('.inp-mid-note')?.value.trim()  || '';
      } else {
        base.final      = tr.querySelector('.inp-fin-date')?.value.trim()  || '';
        base.finalMath  = tr.querySelector('.inp-fin-math')?.value.trim()  || '';
        base.finalRange = tr.querySelector('.inp-fin-range')?.value.trim() || '';
        base.finalNote  = tr.querySelector('.inp-fin-note')?.value.trim()  || '';
      }
      next[name] = base;
    });
    calMap = next;
  }

  // ── 저장 공통 함수(수동/자동 공용) ──
  async function saveCalendar(mode = 'manual') {
    syncFromView();

    if (statusEl) {
      statusEl.textContent = mode === 'auto' ? '자동 저장 중...' : '저장 중...';
    }

    try {
      const res = await fetch('/api/school-calendar', {
        method: 'POST',
        headers: CT,
        body: JSON.stringify(calMap)
      });
      if (!res.ok) throw new Error(res.status);

      if (statusEl) {
        statusEl.textContent = mode === 'auto' ? '자동 저장됨' : '저장됨';
        setTimeout(() => {
          if (statusEl.textContent.includes('저장')) statusEl.textContent = '';
        }, 1500);
      }
    } catch (e) {
      console.error('saveCalendar failed', e);
      if (statusEl) {
        statusEl.textContent = mode === 'auto'
          ? '자동 저장 실패'
          : '저장 실패';
      }
      if (mode !== 'auto') {
        alert('저장 실패: ' + e.message);
      }
    }
  }

  const autoSave = debounce(() => saveCalendar('auto'));

  // ── 이벤트 ──
  seg.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-mode]'); if(!btn) return;
    const mode = btn.dataset.mode;
    if (viewMode === mode) return;
    // 뷰 전환 전에 현재 모드 값 반영 + 자동 저장
    syncFromView();
    viewMode = mode;
    seg.querySelectorAll('button').forEach(b=>b.classList.toggle('active', b===btn));
    render();
    autoSave();
  });

  addBtn.addEventListener('click', () => {
    tbody.insertAdjacentHTML('beforeend', rowBlank());
    renumber();
    autoSave();
  });

  saveBtn.addEventListener('click', () => { saveCalendar('manual'); });

  // 삭제 버튼
  tbody.addEventListener('click', (e)=>{
    const btn = e.target.closest('.btn-del'); if(!btn) return;
    const tr = btn.closest('tr');
    const name = tr.querySelector('.inp-school')?.value.trim();
    tr.remove(); renumber();
    if (name && calMap[name]) delete calMap[name];
    autoSave();
  });

  // 입력 변화 → 자동 저장(debounce)
  tbody.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (e.target.type !== 'text') return;
    autoSave();
  });

  // 엔터 이동
  tbody.addEventListener('keydown', (e)=>{
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = [...tbody.querySelectorAll('input[type="text"]')];
    const idx = inputs.indexOf(e.target);
    (e.shiftKey ? inputs[idx-1] : inputs[idx+1])?.focus();
  });

  // ── 초기 로드 ──
  (async function init(){
    try{
      const j = await fetch('/api/school-calendar', {cache:'no-store'}).then(r=>r.json());
      calMap = (j && typeof j==='object') ? j : {};
    }catch{ calMap = {}; }
    render();   // 기본 'mid'
  })();
})();
