(() => {
  const CT = { 'Content-Type': 'application/json' };
  let progEditingSid = null;

  Promise.all([
    fetch('/api/students').then(r => r.json()),
    fetch('/api/videos').then(r => r.json()),
    fetch('/api/progress').then(r => r.json()).catch(() => ({}))
  ])
  .then(([students, videos, progressData]) => {
    // 1) 가나다 순 정렬
    students.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    // 2) 테이블 그리기 (진도 버튼 컬럼 추가)
    const html = `
      <table>
        <thead>
          <tr>
            <th>이름</th>
            <th>레벨</th>
            <th>커리큘럼</th>
            <th>요일</th>
            <th>진도</th>
          </tr>
        </thead>
        <tbody>
          ${students.map(s => `
            <tr data-id="${s.id}">
              <td><a href="/student/${s.id}" target="_blank">${s.name}</a></td>
              <td>
                <select class="levelSelect" data-id="${s.id}">
                  <option value="상" ${s.level==='상'?'selected':''}>상</option>
                  <option value="중" ${s.level==='중'?'selected':''}>중</option>
                  <option value="하" ${s.level==='하'?'selected':''}>하</option>
                </select>
              </td>
              <td>${s.curriculum}${s.subCurriculum?' '+s.subCurriculum:''}</td>
              <td>${[s.day1,s.day2,s.day3].filter(Boolean).join(' / ')}</td>
              <td><button class="showProg btn" data-id="${s.id}">진도</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('allWrap').innerHTML = html;
  })
  .then(() => {
    // 3) 레벨 변경 핸들러
    document.getElementById('allWrap').addEventListener('change', e => {
      if (!e.target.classList.contains('levelSelect')) return;
      const sid = e.target.dataset.id;
      const newLevel = e.target.value;
      fetch('/api/students')
        .then(r => r.json())
        .then(arr => {
          const stu = arr.find(x => x.id === sid);
          if (stu) stu.level = newLevel;
          return fetch('/api/students', {
            method:'POST', headers:CT, body:JSON.stringify(arr)
          });
        })
        .then(() => alert('레벨이 업데이트되었습니다.'))
        .catch(() => alert('레벨 저장 중 오류가 발생했습니다.'));
    });

    // 4) 진도 보기/편집 모달
    document.body.addEventListener('click', e => {
      // 열기
      if (e.target.classList.contains('showProg')) {
        progEditingSid = e.target.dataset.id;
        const name = document.querySelector(`tr[data-id="${progEditingSid}"] a`).textContent;
        document.getElementById('progTitle').textContent = `${name} – 진도`;

        const zone = document.getElementById('progZone');
        zone.innerHTML = '';
        const today = new Date().toISOString().slice(0,10);

        fetch('/api/progress')
          .then(r => r.json())
          .then(pd => {
            const todayProg = (pd[today]||{})[progEditingSid] || {};
            // 커리큘럼에 해당하는 영상만 필터
            fetch('/api/videos')
              .then(r=>r.json())
              .then(vs => {
                const text = document.querySelector(`tr[data-id="${progEditingSid}"] td:nth-child(3)`).textContent.trim();
                const [cur, ...rest] = text.split(' ');
                const sub = rest.join(' ');
                vs
                 .filter(v =>
                   v.curriculum.trim() === cur &&
                   ((v.subCurriculum||'').trim() === sub)
                  )
                  .sort((a,b)=>a.chapter-b.chapter)
                  .forEach(v => {
                    const cell = document.createElement('div');
                    cell.className = 'progress-cell';
                    cell.textContent = `${v.chapter}차시`;
                    cell.dataset.mid = v.mid;
                    cell.dataset.state = todayProg[v.mid] || 'none';
                    cell.addEventListener('click', () => {
                      const nxt = { none:'done', done:'interrupted', interrupted:'none' }[cell.dataset.state];
                      cell.dataset.state = nxt;
                    });
                    cell.addEventListener('contextmenu', ev => {
                      ev.preventDefault();
                      cell.dataset.state = 'skip';
                    });
                    zone.appendChild(cell);
                  });
                document.getElementById('progModal').style.display = 'flex';
              });
          });
      }
      // 닫기
      if (e.target.id === 'progClose' || e.target.id === 'progModal') {
        document.getElementById('progModal').style.display = 'none';
      }
    });

    // 5) 저장 버튼
    document.getElementById('progSave').addEventListener('click', () => {
      fetch('/api/progress').then(r=>r.json()).then(allProg => {
        const today = new Date().toISOString().slice(0,10);
        allProg[today] = allProg[today] || {};
        const entry = {};
        document.querySelectorAll('#progZone .progress-cell').forEach(cell => {
          const st = cell.dataset.state;
          if (st && st !== 'none') {
            entry[cell.dataset.mid] = st;
          }
        });
        allProg[today][progEditingSid] = entry;
        return fetch('/api/progress', {
          method:'POST', headers:CT, body:JSON.stringify(allProg)
        });
      })
      .then(() => {
        alert('진도 저장됨');
        document.getElementById('progModal').style.display = 'none';
      })
      .catch(() => alert('저장 실패'));
    });
  });
})();
