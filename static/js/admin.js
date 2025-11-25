/* admin.js – 관리자 페이지 (오늘 학생 + 영상/자료 + 학생 / 자료 지정) */

/***** util *****/
const $ = id => document.getElementById(id);
const CT = { "Content-Type": "application/json" };
const toast = msg => {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;bottom:20px;left:50%;' +
    'transform:translateX(-50%);background:#333;color:#fff;' +
    'padding:6px 12px;border-radius:4px;font-size:13px;z-index:9999';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
};

/***** 다크모드 *****/
(() => {
  const b = $('darkToggle'); if (!b) return;
  if (localStorage.theme === 'dark') {
    document.body.classList.add('dark'); b.checked = true;
  }
  b.onchange = () => {
    document.body.classList.toggle('dark', b.checked);
    localStorage.theme = b.checked ? 'dark' : 'light';
  };
})();

/***** 전역 데이터 *****/
let students = [], videos = [], materials = {}, updates = {}, assigns = {}, extra = {}, logs = {}, absences = {}, todayList = [], progressData = {};

const CUR = ['공수1', '공수2', '미적분1', '미적분2', '대수', '기하', '확통'];
const SUB = {
  '공수1': ['A:Ble', 'APEX'],
  '공수2': ['A:Ble', 'APEX'],
  '미적분1': ['A:Ble', 'APEX'],
  '미적분2': ['A:Ble', 'APEX'],
  '대수': ['A:Ble', 'APEX'],
  '기하': ['A:Ble', 'APEX'],
  '확통': ['A:Ble', 'APEX']
};

/***** 초기 로드 *****/
Promise.all([
  fetch('/api/students').then(r => r.json()),
  fetch('/api/videos').then(r => r.json()),
  fetch('/api/materials').then(r => r.json()).catch(() => ({})),
  fetch('/api/updates').then(r => r.json()).catch(() => ({})),
  fetch('/api/mat-assign').then(r => r.json()).catch(() => ({})),
  fetch('/api/extra-attend').then(r => r.json()).catch(() => ({})),
  fetch('/api/logs').then(r => r.json()).catch(() => ({})),
  fetch('/api/absent').then(r => r.json()).catch(() => ({})),
  fetch('/api/progress').then(r => r.json()).catch(() => ({}))
]).then(([studentsData, videosData, materialsData, updatesData,
  assignsData, extraData, logsData, absencesData, progressJson]) => {
  students = studentsData;
  videos = videosData;
  materials = materialsData;
  updates = updatesData;
  assigns = assignsData;
  extra = extraData;
  logs = logsData;
  absences = absencesData;
  progressData = progressJson;
  init();
});

function init() {
  // ── 공통 커리큘럼 셀렉터 ──
  const opts = CUR.map(c => `<option value="${c}">${c}</option>`).join('');
  $('curSel').innerHTML = opts;
  $('vCur').innerHTML = opts;
  $('mCur').innerHTML = opts;

  // ── 학생용 세부과정 ──
  $('subCurSel').innerHTML = '<option value="">세부과정 선택</option>';
  $('curSel').addEventListener('change', e => {
    const subs = SUB[e.target.value] || [];
    $('subCurSel').innerHTML = ['<option value="">선택</option>']
      .concat(subs.map(s => `<option value="${s}">${s}</option>`))
      .join('');
  });

  // ── 영상용 세부과정 ──
  $('subVidSel').innerHTML = '<option value="">세부과정 선택</option>';
  $('vCur').addEventListener('change', e => {
    const subs = SUB[e.target.value] || [];
    $('subVidSel').innerHTML = ['<option value="">선택</option>']
      .concat(subs.map(s => `<option value="${s}">${s}</option>`))
      .join('');
  });

  $('levelSel').innerHTML = `
    <option value="">레벨 선택</option>
    <option value="상">상</option>
    <option value="중">중</option>
    <option value="하">하</option>
  `;

  const toggleVidBtn = $('toggleVid');
  const videoSection = $('videoSection');
  toggleVidBtn.addEventListener('click', () => {
    const isHidden = videoSection.style.display === 'none';
    videoSection.style.display = isHidden ? '' : 'none';
    toggleVidBtn.textContent = isHidden ? '접기' : '보기';
  });

  // ── 나머지 로직 ──
  drawVid();
  drawMat();
  loadToday();
}
/** ── 오늘 학생 & 영상 배정 ── */
const todayCountEl = document.getElementById('todayCount');
const todayWrap = document.getElementById('todayWrap');
const doneWrap = document.getElementById('doneWrap');

function loadToday() {
  const wchr = '일월화수목금토'[new Date().getDay()];
  const todayDate = new Date().toISOString().slice(0, 10);

  // ── 0) 예약 복귀 처리
  if (!extra[todayDate]) extra[todayDate] = [];

  for (const [sid, rec] of Object.entries(absences)) {
    if (rec === todayDate && !extra[todayDate].includes(sid)) {
      extra[todayDate].push(sid);
      // ✅ 삭제하지 않고 유지시킴 (사라지지 않게)
    }
  }

  fetch('/api/extra-attend', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(extra)
  });
  fetch('/api/absent', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(absences)
  });

  // ── 1) 오늘 이미 완료된 학생 ID 목록
  const today = new Date().toISOString().slice(0, 10);
  const doneEntries = Object.entries(logs[today] || {})
    .filter(([_, e]) => e.done === true && !e.archived);

  const doneIds = doneEntries.map(([sid]) => sid);

  // ── 2) 정규 등원 학생
  const regular = students.filter(s =>
    [s.day1, s.day2, s.day3].some(d => d?.startsWith(wchr))
  );

  // ── 3) 보강(추가) 학생
  const extraIds = extra[todayDate] || [];
  const extraStudents = extraIds
    .map(id => students.find(s => s.id === id))
    .filter(Boolean);

  // ── 4) 합집합 + 중복 제거
  const merged = [...regular, ...extraStudents];
  const seen = new Set();
  let todayList = merged.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // ── 5) 완료했거나 결석 표시된 학생 제외
  todayList = todayList.filter(s => {
    const absenceDate = absences[s.id];
    const isAbsentToday = absenceDate === todayDate;
    return !doneIds.includes(s.id) && !isAbsentToday;  // ✅ 이렇게 고쳐야 함!
  });

  // ── 6) 슬롯 번호 헬퍼 + 정렬
  const getSlotStr = s => {
    for (const key of ['day1', 'day2', 'day3', 'day4']) {
      const v = s[key] || '';
      if (v.startsWith(wchr)) return v;
    }
    return '';
  };
  const getSlotNum = s => parseInt(getSlotStr(s).slice(1), 10) || 0;
  todayList.sort((a, b) => {
    const na = getSlotNum(a), nb = getSlotNum(b);
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name, 'ko');
  });

  const sidToDone = {};
  for (const [d, pdata] of Object.entries(progressData)) {
    for (const [sid, vids] of Object.entries(pdata)) {
      sidToDone[sid] = sidToDone[sid] || {};
      Object.assign(sidToDone[sid], vids);
    }
  }

  for (const stu of todayList) {
    const sid = stu.id;
    const done = sidToDone[sid] || {};
    const curKey = stu.curriculum?.trim().toLowerCase();
    const subKey = stu.subCurriculum?.trim().toLowerCase();

    const myVids = videos.filter(v =>
      v.curriculum?.trim().toLowerCase() === curKey &&
      v.subCurriculum?.trim().toLowerCase() === subKey
    );

    const sortedVids = myVids.sort((a, b) => a.chapter - b.chapter);
    let startIdx = 0;

    for (let i = 0; i < sortedVids.length; i++) {
      const vid = sortedVids[i];
      const st = done[vid.mid];
      if (!st || st === 'skip') {
        startIdx = i;
        break;
      }
      if (st === 'interrupted') {
        startIdx = i;
        break;
      }
    }

    const unassigned = sortedVids.slice(startIdx, startIdx + 2);

    updates[todayDate] = updates[todayDate] || {};
    updates[todayDate][sid] = updates[todayDate][sid] || {};
    updates[todayDate][sid].videos = unassigned.map(v => v.mid);
  }

  fetch('/api/today_order')
    .then(r => r.json())
    .then(orderData => {
      const saved = orderData[todayDate] || [];
      if (saved.length) {
        const byId = Object.fromEntries(todayList.map(s => [s.id, s]));
        todayList = saved
          .map(id => byId[id])
          .filter(Boolean)
          .concat(todayList.filter(s => !saved.includes(s.id)));
      }

      // ❌ loadToday() 다시 호출하지 말고 바로 renderTodayList 호출
      renderTodayList(todayList, doneEntries, wchr, todayDate);
    });

  // ── 7) 오늘 학생 렌더링
  const rows = todayList.map(s => {
    const slot = getSlotStr(s) || '보강';
    return `
      <tr data-sid="${s.id}">
        <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>
        <td>${slot}</td>
        <td><a href="/student/${s.id}" target="_blank">${s.name}</a></td>
        <td>${s.curriculum}${s.subCurriculum ? ' ' + s.subCurriculum : ''}</td>
        <td>
          <button class="btn-doc"
                  data-doc-url="${s.docUrl}"
                  title="구글 독스 열기">📄</button>
        </td>
        <td>
          <button class="editVid" title="영상 배정">🎬</button>
          <button class="editLog" title="수업 기록">📝</button>
          <button class="markAbsent" title="결석">❌</button>
        </td>
      </tr>`;
  }).join('');

  $('todayWrap').innerHTML = todayList.length
    ? `<table>
         <thead>
           <tr>
             <th style="width:24px"></th>
             <th>구분</th>
             <th>이름</th>
             <th>커리큘럼</th>
             <th>독스</th>
             <th>액션</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>`
    : '오늘 학생 없음';

  document.getElementById('todayCount').textContent = todayList.length;

  // ── 8) 오늘 완료된 수업 기록 렌더링 (첫 번째 표와 동일 컬럼) ──
  // 표 헤더
  let doneHtml;
  if (doneEntries.length) {
    const doneRows = doneEntries.map(([sid, entry]) => {
      const s = students.find(st => st.id === sid);
      const slot = ['day1', 'day2', 'day3']
        .map(k => s[k] || '')
        .find(v => v.startsWith(wchr)) || '보강';
      return `
        <tr data-sid="${s.id}">
          <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>
          <td>${slot}</td>
          <td><a href="/student/${s.id}" target="_blank">${s.name}</a></td>
          <td>${s.curriculum}${s.subCurriculum ? ' ' + s.subCurriculum : ''}</td>
          <td>
            <button class="btn-doc"
                    data-doc-url="${s.docUrl || ''}"
                    title="구글 독스 열기">📄</button>
          </td>
          <td>
            <button class="editVid" title="영상 배정">🎬</button>
            <button class="editLog" title="수업 기록">📝</button>
            <button class="markAbsent" title="결석">❌</button>
          </td>
        </tr>`;
    }).join('');

    doneHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:24px"></th>
            <th>구분</th>
            <th>이름</th>
            <th>커리큘럼</th>
            <th>독스</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          ${doneRows}
        </tbody>
      </table>`;
  } else {
    doneHtml = '오늘 완료된 기록 없음';
  }

  doneWrap.innerHTML = doneHtml;

  // ── 9) Drag & Drop 초기화 (오늘 학생) ──
  const tbody1 = document.querySelector('#todayWrap table tbody');
  if (tbody1) {
    if (tbody1._sortable) tbody1._sortable.destroy();
    tbody1._sortable = Sortable.create(tbody1, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      onEnd(evt) {
        const newOrder = Array.from(tbody1.children).map(tr => tr.dataset.sid);
        fetch('/api/today_order', {
          method: 'POST',
          headers: CT,
          body: JSON.stringify({ [todayDate]: newOrder })
        });
      }
    });
  }

  // ── 10) 보강 필요 학생 렌더링 ──
  const absRows = Object.keys(absences).map(sid => {
    const s = students.find(x => x.id === sid);
    if (!s) return ''; // 잘못된 ID는 건너뛴다

    return `
    <tr data-sid="${sid}">
     <td>${s.name}</td>
     <td>${s.curriculum}</td>
     <td>
       <input type="date" class="recoveryDate" data-id="${sid}" value="${absences[sid] || ''}" placeholder="YYYY-MM-DD">
        <button class="cancelAbs">취소</button>
     </td>
    </tr>
    `;
  }).join('');
  $('absentWrap').innerHTML = absRows
    ? `<table>
         <tr><th>이름</th><th>과정</th><th>보강 일자</th></tr>
         ${absRows}
       </table>`
    : '보강 필요 학생 없음';
}

// ── 11) 결석/취소/보강일자 지정 이벤트 처리
document.body.addEventListener('click', e => {
  if (e.target.classList.contains('markAbsent')) {
    const sid = e.target.closest('tr').dataset.sid;
    const todayDate = new Date().toISOString().slice(0, 10);
    absences[sid] = todayDate;  // ✅ 오늘 날짜로 정확히 저장
    fetch('/api/absent', { method: 'POST', headers: CT, body: JSON.stringify(absences) })
      .then(loadToday);
  }
  if (e.target.classList.contains('cancelAbs')) {
    const sid = e.target.closest('tr').dataset.sid;
    delete absences[sid];
    fetch('/api/absent', { method: 'POST', headers: CT, body: JSON.stringify(absences) })
      .then(loadToday);
  }
});

function renderTodayList(todayList, doneEntries, wchr, todayDate) {
  // ── 7) 오늘 학생 렌더링
  const rows = todayList.map(s => {
    const slot = ['day1', 'day2', 'day3', 'day4']
      .map(k => s[k] || '')
      .find(v => v.startsWith(wchr)) || '보강';

    return `
      <tr data-sid="${s.id}">
        <td class="drag-handle" style="cursor:grab;width:24px;text-align:center">☰</td>
        <td>${slot}</td>
        <td><a href="/student/${s.id}" target="_blank">${s.name}</a></td>
        <td>${s.curriculum}${s.subCurriculum ? ' ' + s.subCurriculum : ''}</td>
        <td>
          <button class="btn-doc" data-doc-url="${s.docUrl}" title="구글 독스 열기">📄</button>
        </td>
        <td>
          <button class="editVid" title="영상 배정">🎬</button>
          <button class="editLog" title="수업 기록">📝</button>
          <button class="markAbsent" title="결석">❌</button>
        </td>
      </tr>`;
  }).join('');

  $('todayWrap').innerHTML = todayList.length
    ? `<table>
         <thead>
           <tr>
             <th style="width:24px"></th>
             <th>구분</th>
             <th>이름</th>
             <th>커리큘럼</th>
             <th>독스</th>
             <th>액션</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>`
    : '오늘 학생 없음';

  document.getElementById('todayCount').textContent = todayList.length;

  // 완료된 학생 렌더링 (기존 doneWrap 코드 그대로)
  // ... 기존 코드 복붙

  // Drag & Drop 저장
  const tbody1 = document.querySelector('#todayWrap table tbody');
  if (tbody1) {
    if (tbody1._sortable) tbody1._sortable.destroy();
    tbody1._sortable = Sortable.create(tbody1, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      onEnd(evt) {
        const newOrder = Array.from(tbody1.children).map(tr => tr.dataset.sid);
        fetch('/api/today_order', {
          method: 'POST',
          headers: CT,
          body: JSON.stringify({ [todayDate]: newOrder })
        });
      }
    });
  }
}

function saveExtra() {
  fetch('/api/extra', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ absences, extra })
  });
}

// ── 12) 보강일자 입력 처리
document.body.addEventListener('change', e => {
  if (e.target.classList.contains('recoveryDate')) {
    const sid = e.target.dataset.id;
    const date = e.target.value;

    absences[sid] = date;

    // ✅ 날짜별로 extra 추가
    if (!extra[date]) extra[date] = [];
    if (!extra[date].includes(sid)) {
      extra[date].push(sid);
    }

    saveExtra();
  }
});


if (!$('#extraModal')) {
  document.body.insertAdjacentHTML('beforeend', `
  <div id="extraModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);
       justify-content:center;align-items:center;z-index:9999">
    <div style="background:#fff;padding:1rem;border-radius:8px;max-height:80%;overflow:auto;width:260px">
      <h3 style="margin-top:0">오늘 보강 학생</h3>
      <div id="exZone"></div>
      <div style="text-align:right;margin-top:.6rem">
        <button type="button" id="exSave">저장</button>
        <button type="button" id="doneBtn" class="btn">완료</button>
        <button type="button" id="exClose">닫기</button>
      </div>
    </div>
  </div>`);
}


if (!$('#logModal')) {
  document.body.insertAdjacentHTML('beforeend', `
  <div id="logModal" style="display:none;position:fixed;inset:0;
       background:rgba(0,0,0,.45);justify-content:center;align-items:center;z-index:9999">
    <div style="background:#fff;padding:1rem;border-radius:8px;
         max-height:80%;overflow:auto;width:320px">
      <h3 id="logTitle" style="margin-top:0">수업 기록</h3>

      <label>노트<br><textarea id="logNotes" rows="4" style="width:100%" placeholder=""></textarea></label>
      <label>주제<br><input id="logTopic" type="text"></label>

      <!-- ① 진도 체크박스 그리드용 컨테이너 -->
      <label>진도</label>
      <div id="logProgress" class="progress-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(60px,1fr));gap:.5rem;"></div>

      <label>숙제<br><input id="logHw" type="text" style="width:100%"></label>
      <div style="text-align:right;margin-top:.6rem">
        <button type="button" id="logSave">저장</button>
        <button type="button" id="doneBtn">완료</button>
        <button type="button" id="logClose">닫기</button>
      </div>
    </div>
  </div>`);
}

// ── 수업 기록 모달 제어 핸들러 ──
const logModal = $('logModal'),
  logTitle = $('logTitle'),
  logNotes = $('logNotes'),
  logHw = $('logHw'),
  logSave = $('logSave'),
  doneBtn = $('doneBtn'),
  logClose = $('logClose');
let editingLogSid = null;

document.body.addEventListener('click', e => {
  // — “수업 기록” 버튼 누르면 열기
  if (e.target.classList.contains('editLog')) {
    editingLogSid = e.target.closest('tr').dataset.sid;
    const stu = students.find(x => x.id === editingLogSid);
    logTitle.textContent = `${stu.name} – ${stu.curriculum}`;

    const today = new Date().toISOString().slice(0, 10);
    // progressData 에서 오늘까지의 가장 최신 날짜 찾아서 로드
    const dates = Object.keys(progressData)
      .filter(d => d <= today)
      .sort();
    // 2) 누적합용 빈 객체 생성
    const progEntry = {};
    // 3) 각 날짜의 해당 학생 진도를 덮어써서 누적
    dates.forEach(d => {
      const dayProg = (progressData[d] || {})[editingLogSid] || {};
      Object.entries(dayProg).forEach(([mid, state]) => {
        progEntry[mid] = state;
      });
    });

    // logs.json 에서 노트·숙제
    const logEntry = (logs[today] || {})[editingLogSid] || {};
    logNotes.value = logEntry.notes || '';
    logNotes.placeholder = ''; // 기본값

    // 최근 날짜 중 가장 최근 노트 찾기
    for (let i = dates.length - 1; i >= 0; i--) {
      const entry = (logs[dates[i]] || {})[editingLogSid];
      if (entry?.notes) {
        logNotes.placeholder = entry.notes;
        break;
      }
    }
    logHw.value = logEntry.homework || '';

    // 진도 그리드 생성
    const progEl = $('logProgress');
    progEl.innerHTML = '';
    videos
      .filter(v =>
        v.curriculum === stu.curriculum &&
        v.subCurriculum === stu.subCurriculum
      )
      .sort((a, b) => a.chapter - b.chapter)
      .forEach(v => {
        const cell = document.createElement('div');
        cell.className = 'progress-cell';
        cell.textContent = `${v.chapter}차시`;
        cell.dataset.mid = v.mid;
        cell.dataset.state = progEntry[v.mid] || 'none';

        cell.addEventListener('click', () => {
          const s = cell.dataset.state;
          cell.dataset.state =
            s === 'none' ? 'done' :
              s === 'done' ? 'interrupted' :
                'none';
        });
        cell.addEventListener('contextmenu', ev => {
          ev.preventDefault();
          cell.dataset.state = 'skip';
        });
        progEl.append(cell);
      });

    logModal.style.display = 'flex';
    return;
  }

  // — 닫기
  if (e.target === logClose || e.target === logModal) {
    logModal.style.display = 'none';
    return;
  }
});

// — “저장” 버튼 눌렀을 때 (임시저장)
logSave.addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);

  // 1) progressData 반영
  progressData[today] = progressData[today] || {};
  const newProg = {};
  document.querySelectorAll('#logProgress .progress-cell').forEach(cell => {
    if (cell.dataset.state !== 'none') {
      newProg[cell.dataset.mid] = cell.dataset.state;
    }
  });
  progressData[today][editingLogSid] = newProg;

  // 2) summary 생성 (바뀐 부분만)
  const oldProg = (logs[today]?.[editingLogSid]?.progress) || {};
  const summary = [];
  Object.entries(newProg).forEach(([mid, state]) => {
    if (oldProg[mid] !== state) {
      const chap = videos.find(v => v.mid === mid).chapter;
      summary.push(
        state === 'done' ? `${chap}차시` :
          state === 'interrupted' ? `${chap}차시(중단)` :
            state === 'skip' ? `${chap}차시(건너뜀)` :
              ''
      );
    }
  });

  // 3) progress.json 저장
  fetch('/api/progress', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(progressData)
  })
    // 4) logs.json 에 JSON 형식으로 저장 (done=false)
    .then(() => {
      logs[today] = logs[today] || {};
      logs[today][editingLogSid] = {
        notes: logNotes.value.trim(),
        topic: summary.join(', '),
        homework: logHw.value.trim(),
        done: false,
        progress: newProg
      };
      return fetch('/api/logs', {
        method: 'POST',
        headers: CT,
        body: JSON.stringify(logs)
      });
    })
    .then(() => {
      toast('수업 기록 저장됨');
      logModal.style.display = 'none';
      loadToday();
    })
    .catch(() => toast('저장 중 오류가 발생했습니다'));
});

// — “완료” 버튼 눌렀을 때 (저장+완료)
doneBtn.addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);

  // 1) progressData 업데이트
  progressData[today] = progressData[today] || {};
  const newProg = {};
  document.querySelectorAll('#logProgress .progress-cell').forEach(cell => {
    if (cell.dataset.state !== 'none') {
      newProg[cell.dataset.mid] = cell.dataset.state;
    }
  });
  progressData[today][editingLogSid] = newProg;

  // 2) progress.json 저장
  fetch('/api/progress', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(progressData)
  })

    // 3) summary 생성: 오늘 새로 추가된 진도만 필터링
    .then(() => {
      const oldDates = Object.keys(progressData)
        .filter(d => d < today);
      const oldTotal = {};

      oldDates.forEach(d => {
        const pd = progressData[d]?.[editingLogSid] || {};
        Object.entries(pd).forEach(([mid, state]) => {
          oldTotal[mid] = state;
        });
      });

      const summary = [];
      Object.entries(newProg).forEach(([mid, state]) => {
        if (oldTotal[mid] !== state) {
          const vid = videos.find(v => v.mid === mid);
          if (!vid) return;
          summary.push(
            state === 'done' ? `${vid.chapter}차시` :
              state === 'interrupted' ? `${vid.chapter}차시(중단)` :
                state === 'skip' ? `${vid.chapter}차시(건너뜀)` :
                  ''
          );
        }
      });

      // 4) logs.json 저장 (done=true)
      logs[today] = logs[today] || {};
      logs[today][editingLogSid] = {
        notes: logNotes.value.trim(),
        topic: summary.join(', '),
        homework: logHw.value.trim(),
        done: true,
        progress: newProg
      };
      return fetch('/api/logs', {
        method: 'POST',
        headers: CT,
        body: JSON.stringify(logs)
      });
    })
    .then(() => {
      toast('완료 처리됨');
      logModal.style.display = 'none';
      loadToday();
    })
    .catch(() => toast('완료 중 오류가 발생했습니다'));
});


/* 열기 */

// ── 보강 추가 모달 & 이벤트 ──
; (function () {
  const extraBtn = document.getElementById('extraBtn');
  const exModal = document.getElementById('extraModal');
  const exZone = document.getElementById('exZone');
  const exSaveBtn = document.getElementById('exSave');
  const exCloseBtn = document.getElementById('exClose');

  // 요소 하나라도 없으면 동작 안 함
  if (!extraBtn || !exModal || !exZone || !exSaveBtn || !exCloseBtn) return;

  // ▶ 열기
  extraBtn.addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    const checked = extra[today] || [];

    const sorted = students.slice().sort((a, b) =>
      a.name.localeCompare(b.name, 'ko')
    );

    exZone.innerHTML = students.map(s => `
      <label style="display:block">
        <input type="checkbox" value="${s.id}"
          ${checked.includes(s.id) ? 'checked' : ''}>
        ${s.name}
      </label>
    `).join('');
    exModal.style.display = 'flex';
  });

  // ▶ 닫기 (모달 배경 또는 × 버튼)
  document.body.addEventListener('click', e => {
    if (e.target.id === 'extraModal' || e.target.id === 'exClose') {
      exModal.style.display = 'none';
    }
  });

  // ▶ 저장
  exSaveBtn.addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    extra[today] = Array.from(
      exZone.querySelectorAll('input:checked')
    ).map(cb => cb.value);

    fetch('/api/extra-attend', {
      method: 'POST',
      headers: CT,
      body: JSON.stringify(extra)
    }).then(() => {
      toast('보강 저장');
      exModal.style.display = 'none';
      loadToday();
    });
  });
})();


/* ───── 영상 배정 모달 ───── */
if (!$('vidModal')) {
  document.body.insertAdjacentHTML('beforeend', `
  <div id="vidModal" style="display:none;position:fixed;inset:0;
       background:rgba(0,0,0,.45);justify-content:center;align-items:center;z-index:9998">
    <div style="background:#fff;padding:1rem;border-radius:8px;
         max-height:80%;overflow:auto;width:360px">
      <h3 id="mTitle" style="margin-top:0"></h3>
      <div id="chkZone"></div>
      <div style="text-align:right;margin-top:.6rem">
        <button id="mSave">저장</button>
        <button id="mClose">닫기</button>
      </div>
    </div>
  </div>`);
}
const vidModal = $('vidModal'), chkZone = $('chkZone'), mTitle = $('mTitle');
let editingSid = null;

document.body.addEventListener('click', e => {
  /* 🎬 아이콘 */
  if (e.target.classList.contains('editVid')) {
    editingSid = e.target.closest('tr').dataset.sid;
    const stu = students.find(s => s.id === editingSid);
    openModal(stu); return;
  }
  /* 모달 배경 or 닫기 */
  if (e.target.id === 'vidModal' || e.target.id === 'mClose')
    vidModal.style.display = 'none';
});

function openModal(stu) {
  // 1) 헤더: 학생 이름 + 커리큘럼 + 세부과정
  mTitle.textContent = `${stu.name} – ${stu.curriculum} (${stu.subCurriculum || '전체'})`;

  // 2) 키 맞추기 (소문자, 공백 트림)
  const curKey = (stu.curriculum || '').trim().toLowerCase();
  const subKey = (stu.subCurriculum || '').trim().toLowerCase();

  // 3) 필터: 커리큘럼 일치 + 세부과정 일치
  const curVids = videos.filter(v => {
    return (
      (v.curriculum || '').trim().toLowerCase() === curKey &&
      (v.subCurriculum || '').trim().toLowerCase() === subKey
    );
  });

  // 4) 오늘 지정된 영상 체크 상태 가져오기
  const today = new Date().toISOString().slice(0, 10);
  const raw = (updates[today] || {})[stu.id];
  const assigned = Array.isArray(raw) ? raw : [];
  if (assigned.length === 0) {
    const doneMids = {};

    for (const [date, pd] of Object.entries(progressData)) {
      const stuProg = pd?.[stu.id];
      if (stuProg) {
        Object.entries(stuProg).forEach(([mid, state]) => {
          if (state === 'done') doneMids[mid] = true;
        });
      }
    }

    const sortedVids = curVids.slice().sort((a, b) => a.chapter - b.chapter);
    const toAssign = [];

    for (const v of sortedVids) {
      if (!doneMids[v.mid]) {
        toAssign.push(v.id);  // id는 checkbox value
      }
      if (toAssign.length >= 2) break;
    }

    assigned.push(...toAssign);
    if (!updates[today]) updates[today] = {};
    updates[today][stu.id] = assigned;

    fetch('/api/updates', {
      method: 'POST',
      headers: CT,
      body: JSON.stringify(updates)
    });
  }

  // 5) 체크박스 리스트 렌더링
  chkZone.innerHTML = curVids.map(v => `
    <label style="display:block">
      <input type="checkbox" value="${v.id}"
        ${assigned.includes(v.id) ? 'checked' : ''}>
      ${v.chapter}. ${v.title}
    </label>
  `).join('');

  // 6) 모달 열기
  vidModal.style.display = 'flex';
}

$('mSave').onclick = () => {
  const today = new Date().toISOString().slice(0, 10);
  updates[today] = updates[today] || {};

  /*1️⃣ 체크된 영상 id 배열 */
  const selected = Array.from(
    chkZone.querySelectorAll('input[type="checkbox"]:checked')
  ).map(box => +box.value);

  if (selected.length) {
    // ‣ 하나 이상 선택 → 그대로 저장
    updates[today][editingSid] = selected;
  } else {
    // ‣ 전부 해제 → 학생-key 제거
    delete updates[today][editingSid];
    //   해당 날짜에 더 이상 학생이 없으면 날짜-key 도 제거
    if (Object.keys(updates[today]).length === 0) delete updates[today];
  }

  fetch('/api/updates', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(updates)
  })
    .then(() => fetch('/api/updates'))
    .then(r => r.json())
    .then(u => {
      updates = u;
      toast('저장 완료');
      vidModal.style.display = 'none';
      loadToday();
    });
};

/***** ───── 학생 추가 ───── */
$('addStu').onclick = () => {
  const data = {
    name: $('stuName').value.trim(),
    curriculum: $('curSel').value,
    subCurriculum: $('subCurSel').value,
    day1: $('d1').value.trim(),
    day2: $('d2').value.trim(),
    day3: $('d3').value.trim(),
    level: $('levelSel').value
  };
  if (!data.name) return alert('이름을 입력하세요');
  if (!data.subCurriculum) return alert('세부과정을 선택하세요');
  if (!data.level) return alert('레벨을 선택하세요');

  fetch('/api/add-student', { method: 'POST', headers: CT, body: JSON.stringify(data) })
    .then(r => r.json())
    .then(j => {
      prompt('학생 페이지 URL', location.origin + '/student/' + j.id);
      location.reload();
    });
};

/***** ───── 영상 관리 테이블 ───── */
function drawVid() {
  // ❶ 3단계 정렬: curriculum → subCurriculum → chapter
  videos.sort((a, b) => {
    // 1) 커리큘럼 비교
    const cmpCurr = a.curriculum.localeCompare(b.curriculum, 'ko');
    if (cmpCurr !== 0) return cmpCurr;

    // 2) 세부과정 비교
    const cmpSub = (a.subCurriculum || '').localeCompare(b.subCurriculum || '', 'ko');
    if (cmpSub !== 0) return cmpSub;

    // 3) 챕터 비교
    return a.chapter - b.chapter;
  });

  // ❷ 나머지 테이블 렌더링 (이전과 동일)
  vidTable.innerHTML = `
    <tr>
      <th style="width:40px">ID</th>
      <th style="width:70px">커리큘럼</th>
      <th style="width:100px">세부과정</th>
      <th style="width:40px">챕</th>
      <th>제목</th>
      <th style="min-width:260px">URL</th>
      <th style="width:40px">Del</th>
    </tr>
    ${videos.map((v, i) => `
      <tr data-i="${i}">
        <td>${v.id ?? i}</td>
        <td>${v.curriculum}</td>
        <td>${v.subCurriculum || ''}</td>
        <td contenteditable>${v.chapter}</td>
        <td contenteditable>${v.title}</td>
        <td contenteditable>${v.url}</td>
        <td><button class="delV">×</button></td>
      </tr>
    `).join('')}
  `;
}

; (function () {
  const addVidBtn = document.getElementById('addVid');
  if (!addVidBtn) return;

  addVidBtn.addEventListener('click', () => {
    // 1) 필수 요소 가져오기
    const vCurEl = document.getElementById('vCur');
    const subVidEl = document.getElementById('subVidSel');
    const exHighEl = document.getElementById('exNumHigh');
    const exMidEl = document.getElementById('exNumMid');
    const exLowEl = document.getElementById('exNumLow');
    const vChapEl = document.getElementById('vChap');
    const vTitleEl = document.getElementById('vTitle');
    const vUrlEl = document.getElementById('vUrl');

    // 유효성 검사
    if (!vCurEl.value) return alert('커리큘럼을 선택하세요.');
    if (!subVidEl.value) return alert('세부과정을 선택하세요.');
    if (!vTitleEl.value.trim()) return alert('제목을 입력하세요.');
    const midMatch = vUrlEl.value.trim().match(/kollus\.com\/([^?]+)/);
    if (!midMatch) return alert('유효한 Kollus URL이 아닙니다.');

    // 값 파싱
    const curriculum = vCurEl.value;
    const subCurriculum = subVidEl.value;
    const chapter = parseInt(vChapEl.value, 10) || 1;
    const title = vTitleEl.value.trim();
    const fullUrl = vUrlEl.value.trim();
    const mid = midMatch[1];

    // 새 영상 객체 생성 (exNum 프로퍼티만 포함)
    const newVid = {
      id: videos.length ? Math.max(...videos.map(v => v.id || 0)) + 1 : 1,
      mid,
      curriculum,
      subCurriculum,
      chapter,
      title,
      url: fullUrl,
      exNum: {}
    };
    if (exHighEl.value) newVid.exNum['상'] = parseInt(exHighEl.value, 10);
    if (exMidEl.value) newVid.exNum['중'] = parseInt(exMidEl.value, 10);
    if (exLowEl.value) newVid.exNum['하'] = parseInt(exLowEl.value, 10);

    if (Object.keys(newVid.exNum).length === 0) {
      delete newVid.exNum;
    }

    // 배열에 추가 + 테이블 갱신
    videos.push(newVid);
    drawVid();
  });
})();


/* 영상 삭제 */
vidTable.onclick = e => {
  if (e.target.classList.contains('delV')) {
    videos.splice(+e.target.closest('tr').dataset.i, 1);
    drawVid();
  }
};

/* 영상 저장 */
saveVid.onclick = () => {
  // 테이블에서 편집된 것도 반영
  [...document.querySelectorAll('#vidTable tr[data-i]')].forEach(tr => {
    const i = +tr.dataset.i;
    videos[i].chapter = +tr.children[3].innerText.trim() || 1;
    videos[i].title = tr.children[4].innerText.trim();
    videos[i].url = tr.children[5].innerText.trim();
    // **세부과정도 contenteditable을 넣으셨다면** 다음 줄처럼 반영
    // videos[i].subCurriculum = tr.children[2].innerText.trim();
  });

  fetch('/api/videos', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(videos)
  })
    .then(() => toast('영상 저장 완료'));
};

/***** ───── 자료 업로드 / 목록 ───── */
function loadMat() {
  fetch('/api/materials')
    .then(r => r.json())
    .then(m => { materials = m; drawMat(); })
    .catch(() => materials = {});
}

function drawMat() {
  const rows = Object.entries(materials).map(([mid, f]) => `
   <tr data-mid="${mid}">
      <td>${f.curriculum}</td>
      <td><a href="${f.url}" target="_blank">${f.title}</a></td>
      <td><button class="delMat">🗑</button></td>
    </tr>`
  );

  matTable.innerHTML =
    '<tr><th>커리큘럼</th><th>파일</th><th>Del</th></tr>' + rows.join('');
}

matTable.addEventListener('click', e => {
  if (!e.target.classList.contains('delMat')) return;

  const mid = e.target.closest('tr').dataset.mid;
  if (!confirm('이 자료를 삭제할까요?')) return;
  delete materials[mid];

  fetch('/api/materials', {                  // 2) 저장
    method: 'POST', headers: CT,
    body: JSON.stringify(materials)
  })
    .then(drawMat);
});

/* 파일 업로드 */
upMat.onclick = () => {
  const file = mFile.files[0];
  if (!file) return alert('파일을 선택하세요');

  const fd = new FormData();
  fd.append('file', file);
  fd.append('curriculum', mCur.value);

  fetch('/api/material-upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(m => {
      materials = m;      // ① 전역 변수 교체
      drawMat();          // ② 즉시 표 다시 그리기
      mFile.value = '';   // ③ input 비우기
      toast('업로드 완료');
    })
    .catch(() => toast('업로드 실패'));
};

/* ───── 자료 → 학생 지정 모달 ───── */
if (!$('#stuModal')) {
  document.body.insertAdjacentHTML('beforeend', `
  <div id="stuModal" style="display:none;position:fixed;inset:0;
       background:rgba(0,0,0,.45);justify-content:center;align-items:center;z-index:9999">
    <div style="background:#fff;padding:1rem;border-radius:8px;
         max-height:80%;overflow:auto;width:280px">
      <h3 id="sTitle" style="margin-top:0"></h3>
      <div id="sZone"></div>
      <div style="text-align:right;margin-top:.6rem">
        <button id="sSave">저장</button>
        <button id="sClose">닫기</button>
      </div>
    </div>
  </div>`);
}

const stuModal = $('stuModal'), sZone = $('sZone'), sTitle = $('sTitle');
let editingMid = null;

/* 자료 테이블에서 👥 버튼 클릭 */
matTable.addEventListener('click', e => {
  if (!e.target.classList.contains('asBtn')) return;
  editingMid = e.target.closest('tr').dataset.id;
  openStuModal(editingMid);
});

function openStuModal(mid) {
  sTitle.textContent = `자료 ID ${mid} – 학생 지정`;
  const checked = Object.entries(assigns)
    .filter(([, arr]) => arr.includes(+mid))
    .map(([sid]) => sid);

  sZone.innerHTML = students.map(s => `
    <label style="display:block">
      <input type="checkbox" value="${s.id}" ${checked.includes(s.id) ? 'checked' : ''}>
      ${s.name}
    </label>`).join('');

  stuModal.style.display = 'flex';
}

/* 모달 바깥 클릭 또는 닫기 */
document.body.addEventListener('click', e => {
  if (e.target.id === 'stuModal' || e.target.id === 'sClose')
    stuModal.style.display = 'none';
});

/* 지정 저장 */
$('sSave').onclick = () => {
  /* 1) 선택 학생 배열 */
  const sel = [...sZone.querySelectorAll('input:checked')].map(c => c.value);

  /* 2) 모든 학생 배열에서 mid 제거 */
  Object.values(assigns).forEach(arr => {
    const idx = arr.indexOf(+editingMid);
    if (idx > -1) arr.splice(idx, 1);
  });

  /* 3) 선택 학생에게 mid 추가 */
  sel.forEach(sid => {
    assigns[sid] = assigns[sid] || [];
    if (!assigns[sid].includes(+editingMid)) assigns[sid].push(+editingMid);
  });

  fetch('/api/mat-assign', { method: 'POST', headers: CT, body: JSON.stringify(assigns) })
    .then(() => { toast('지정 완료'); stuModal.style.display = 'none'; });
};

document.getElementById('exportLogs').addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);
  const headerDt = new Date();
  const headerDate = `${headerDt.getMonth() + 1}/${headerDt.getDate()}`;

  let text = '';

  // logs[today] 에 저장된 순서대로 순회
  Object.entries(logs[today] || {}).forEach(([sid, logEntry]) => {
    const stu = students.find(s => s.id === sid);
    if (!stu) return; // 학생 정보 없으면 건너뛰기

    const name = stu.name;
    const curLabel = stu.curriculum + (stu.subCurriculum ? ' ' + stu.subCurriculum : '');
    const notes = (logEntry.notes || '').replace(/\r?\n/g, ' ');
    const prog = logEntry.topic || '';  // 오늘 변경된 챕터 요약
    const hw = logEntry.homework || '';

    text += `(${headerDate}) ${name}\n`;
    text += `특이사항 : ${notes}\n\n`;
    text += `진도 (${curLabel}) : ${prog}\n\n`;
    text += `숙제 : ${hw}\n\n\n`;
  });

  if (!text) {
    toast('오늘 변경된 진도 기록이 없습니다.');
    return;
  }

  // 다운로드
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `수업기록_${today}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  toast('수업 기록 내보내기 완료');
});

// 학생별 문서 버튼
document.body.addEventListener('click', e => {
  if (e.target.classList.contains('btn-doc')) {
    const url = e.target.dataset.docUrl;
    if (url) window.open(url, '_blank');
  }
});

document.body.addEventListener('click', e => {
  // 수정(undo)
  if (e.target.classList.contains('undoDone')) {
    const sid = e.target.closest('tr').dataset.sid;
    const todayDate = new Date().toISOString().slice(0, 10);
    logs[todayDate][sid].done = false;
    delete logs[todayDate][sid].archived;  // undo 할 땐 archived 제거
    fetch('/api/logs', {
      method: 'POST',
      headers: CT,
      body: JSON.stringify(logs)
    })
      .then(loadToday);
  }

  // 기록 완료(clear)
  if (e.target.classList.contains('clearDone')) {
    const sid = e.target.closest('tr').dataset.sid;
    const todayDate = new Date().toISOString().slice(0, 10);
    logs[todayDate][sid].archived = true;  // 플래그만 켬
    fetch('/api/logs', {
      method: 'POST',
      headers: CT,
      body: JSON.stringify(logs)
    })
      .then(loadToday);
  }
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  // logs 전체 순회하며 archived = true 처리
  for (const date in logs) {
    for (const sid in logs[date]) {
      const entry = logs[date][sid];
      if (entry.done && !entry.archived) {
        entry.archived = true;
      }
    }
  }

  fetch('/api/logs', {
    method: 'POST',
    headers: CT,
    body: JSON.stringify(logs)
  }).then(() => {
    toast('모든 완료된 기록이 정리되었습니다');
    loadToday();
  });
});

// 자유의 몸 리스트 다시 불러오기 로직은 loadToday 또는 별도 render 함수에서 ↓ 이런 식으로 구성돼야 함:
function getUnarchivedDoneLogs() {
  const result = [];

  for (const date in logs) {
    for (const sid in logs[date]) {
      const entry = logs[date][sid];
      if (entry.done && !entry.archived) {
        result.push({ date, sid, ...entry });
      }
    }
  }

  return result;
}

/***** ───── 최초 자료 목록 로드 ───── */
loadMat();


