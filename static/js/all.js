// all.js - 요일 입력 자동 저장 기능 포함 + 요일별 통계 및 학생 리스트 확인
(() => {
  const CT = { 'Content-Type': 'application/json' };
  const allWrap = document.getElementById('allWrap');
  const progModal = document.getElementById('progModal');
  const progTitle = document.getElementById('progTitle');
  const progZone = document.getElementById('progZone');
  let students = [], videos = [], progressData = {}, editingSid = null;

  const toast = msg => {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = `
      position:fixed;bottom:20px;left:50%;
      transform:translateX(-50%);
      background:#333;color:#fff;
      padding:6px 12px;border-radius:4px;
      z-index:9999;`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  };

  function renderYoilStats() {
    const counts = {
      '월': 0, '화': 0, '수': 0, '목': 0, '금': 0,
      '토1': 0, '토2': 0, '토3': 0,
      '일1': 0, '일2': 0, '일3': 0
    };
    const mapping = {
      '월': [], '화': [], '수': [], '목': [], '금': [],
      '토1': [], '토2': [], '토3': [],
      '일1': [], '일2': [], '일3': []
    };

    for (const stu of students) {
      [stu.day1, stu.day2, stu.day3].forEach(day => {
        if (!day) return;
        if (counts[day] != null) {
          counts[day]++;
          mapping[day].push(stu.name);
        }
      });
    }

    const yoilRow = ['월', '화', '수', '목', '금', '토', '일'];
    const slotRow1 = ['', '', '', '', '', '토1', '일1'];
    const slotRow2 = ['', '', '', '', '', '토2', '일2'];
    const slotRow3 = ['월', '화', '수', '목', '금', '토3', '일3'];

    const sumRow = yoilRow.map(yoil => {
      if (yoil === '토') return counts['토1'] + counts['토2'] + counts['토3'];
      if (yoil === '일') return counts['일1'] + counts['일2'] + counts['일3'];
      return counts[yoil];
    });

    const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
    sumRow.push(totalCount);  // ✅ 오른쪽 아래칸에 총합 추가

    window.openYoilModal = (title, names) => {
      document.getElementById('yoilTitle').textContent = `${title} – ${names.length}명`;
      document.getElementById('yoilList').textContent = names.join('\n');
      document.getElementById('yoilModal').style.display = 'flex';
    };

    const cellHtml = key => {
      if (!key) return '<td style="border:1px solid black;padding:4px"></td>';
      const num = counts[key] || 0;
      const names = mapping[key] || [];
      return `<td 
              style="border:1px solid black;padding:4px;cursor:pointer" 
              data-yoil="${key}" 
              data-names='${JSON.stringify(names).replace(/'/g, '&#39;')}'
              class="yoil-cell"
            >${num}</td>`;
    };

    const html = `
  <table style="border-collapse:collapse;text-align:center;width:100%;max-width:480px;border:2px solid black;margin-bottom:1rem">
    <tr>${yoilRow.map(y => `<th style="border:1px solid black;padding:4px">${y}</th>`).join('')}<th>합계</th></tr>
    <tr>${slotRow1.map(k => cellHtml(k)).join('')}<td></td></tr>
    <tr>${slotRow2.map(k => cellHtml(k)).join('')}<td></td></tr>
    <tr>${slotRow3.map(k => cellHtml(k)).join('')}<td></td></tr>
    <tr>${sumRow.map(n => `<td style="border:1px solid black;padding:4px;font-weight:bold">${n}</td>`).join('')}</tr>
  </table>
  `;

    document.getElementById('yoilStats').innerHTML = html;
  }

  document.addEventListener('click', e => {
    if (e.target.classList.contains('yoil-cell')) {
      const title = e.target.dataset.yoil;
      let names = [];
      try {
        names = JSON.parse(e.target.dataset.names || '[]');
      } catch (err) {
        console.error('이름 파싱 오류', err);
      }
      openYoilModal(title, names);
    }
  });

  Promise.all([
    fetch('/api/students').then(r => r.json()),
    fetch('/api/videos').then(r => r.json()),
    fetch('/api/progress').then(r => r.json()).catch(() => ({}))
  ])
    .then(([stu, vid, prog]) => {
      students = stu;
      videos = vid;
      progressData = prog;
      renderTable();
      renderYoilStats();
    })
    .catch(err => {
      console.error(err);
      allWrap.textContent = '데이터 로드 중 오류가 발생했습니다.';
    });

  const renderTable = () => {
    students.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    allWrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>이름</th><th>레벨</th><th>커리큘럼</th><th>요일</th><th>진도</th>
          </tr>
        </thead>
        <tbody>
        ${students.map(s => `
          <tr data-id="${s.id}" data-curriculum="${s.curriculum}" data-subcurriculum="${s.subCurriculum || ''}">
            <td><a href="/student/${s.id}" target="_blank">${s.name}</a></td>
            <td><select class="levelSelect" data-id="${s.id}">
              <option value="상"${s.level === '상' ? ' selected' : ''}>상</option>
              <option value="중"${s.level === '중' ? ' selected' : ''}>중</option>
              <option value="하"${s.level === '하' ? ' selected' : ''}>하</option>
            </select></td>
            <td>${s.curriculum}${s.subCurriculum ? ' ' + s.subCurriculum : ''}</td>
            <td><div class="dayInput">
              <input class="dayInput" data-id="${s.id}" data-day="day1" value="${s.day1 || ''}" style="width:4rem;margin:0 2px">
              <input class="dayInput" data-id="${s.id}" data-day="day2" value="${s.day2 || ''}" style="width:4rem;margin:0 2px">
              <input class="dayInput" data-id="${s.id}" data-day="day3" value="${s.day3 || ''}" style="width:4rem;margin:0 2px">
            </div></td>
            <td><button class="showProg btn" data-id="${s.id}">진도</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  };

  document.body.addEventListener('change', e => {
    if (e.target.classList.contains('dayInput')) {
      const sid = e.target.dataset.id;
      const field = e.target.dataset.day;
      const value = e.target.value;
      const stu = students.find(s => s.id === sid);
      if (stu) stu[field] = value;

      fetch(`/api/update`, {
        method: 'POST', headers: CT,
        body: JSON.stringify({ id: sid, field, value })
      })
        .then(res => res.ok ? (toast('저장됨'), renderYoilStats()) : alert('저장 실패'));
    }
  });
})();
