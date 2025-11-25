/* student.js – 단일 플레이어 + 재생 목록 + 자료 다운로드 + 설정 패널 + 건의사항 제출 */
(() => {
  /* ───────────── 공통 util ───────────── */
  const $ = id => document.getElementById(id);
  const CT = { "Content-Type": "application/json" };
  const sid = decodeURIComponent(location.pathname.split("/").pop());
  let currentMid = null;

  /* ───────────── 설정 패널 & 다크모드 ───────────── */
  const setBtn = $('setBtn');
  const setPanel = $('setPanel');
  const darkTgl = $('darkToggle');
  const suggestBtn = $('suggestBtn');

  /* ▸ 패널 열/닫기 */
  setBtn?.addEventListener('click', e => {
    e.stopPropagation();
    setPanel.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!setPanel.contains(e.target) && !setBtn.contains(e.target)) {
      setPanel.classList.remove('open');
    }
  });

  /* ▸ 다크-모드 기억 */
  if (localStorage.theme === "dark") {
    document.body.classList.add("dark");
    darkTgl.checked = true;
  }
  darkTgl.onchange = () => {
    document.body.classList.toggle("dark", darkTgl.checked);
    localStorage.theme = darkTgl.checked ? "dark" : "light";
  };

  /* ───────────── 헤더 시계 ───────────── */
  const clk = $('clock');
  if (clk) {
    const tick = () => {
      const d = new Date(), w = "일월화수목금토"[d.getDay()];
      clk.textContent =
        `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.` +
        `${String(d.getDate()).padStart(2, "0")}("${w}") ` +
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    tick(); setInterval(tick, 60 * 1000);
  }

  /* ───────────── 데이터 로드 ───────────── */
  Promise.all([
    fetch("/api/students").then(r => r.json()),
    fetch("/api/videos").then(r => r.json()),
    fetch("/api/updates").then(r => r.json()).catch(() => ({})),
    fetch("/api/materials").then(r => r.json()).catch(() => ({})),
    fetch("/api/mat-assign").then(r => r.json()).catch(() => ({}))
  ]).then(init).catch(err => alert("데이터 로드 실패\n" + err));

  /* ───────────── main ───────────── */
  function init([stuArr, vids, upd, mats, assigns]) {
    const stu = stuArr.find(s => s.id === sid);
    if (!stu) { alert("학생 정보가 없습니다"); return; }

    $('stuName').textContent = `${stu.name} (${stu.curriculum})`;

    /* ── 오늘 날짜 key ── */
    const today = new Date().toISOString().slice(0, 10);
    const todayUpd = upd[today] ?? {};           // { sid : [id,id] }

    /* ── 영상 목록 결정 ── */
    const curKey = stu.curriculum.trim().toLowerCase();
    const subKey = (stu.subCurriculum || '').trim().toLowerCase();
    const raw = todayUpd[sid];
    const chosenIds = Array.isArray(raw)
      ? raw.map(Number)
      : Array.isArray(raw?.videos)
        ? raw.videos.map(Number)
        : [];

    const myVids = chosenIds.length
      ? vids.filter(v => chosenIds.includes(Number(v.id)))
      : [];

    const listBox = $('vidList');
    const frame = $('player');

    if (!myVids.length) { 
      listBox.innerHTML =
        "<li style='opacity:.65'>오늘 할당된 영상이 없습니다 문의 부탁</li>";
      frame.src = "";
    } else {
      listBox.innerHTML = myVids.map(v => {
        const num = v.exNum && v.exNum[stu.level] || '';
        return `
        <li data-mid="${v.mid}" class="${v === myVids[0] ? 'active' : ''}">
          ${v.chapter}. ${v.title}
          ${num ? `<span style="margin-left:.5rem;font-weight:500;color:var(--accent)">[서술형 ${num}번]</span>` : ''}
        </li>
      `;
      }).join("");
      play(myVids[0].mid);
    }

    listBox.onclick = e => {
      const li = e.target.closest('li[data-mid]');
      if (!li) return;
      listBox.querySelectorAll('li').forEach(x => x.classList.remove('active'));
      li.classList.add('active');
      play(li.dataset.mid);
    };

    const myMats = Object.values(mats).filter(m => m.curriculum === stu.curriculum);
    $('matList').innerHTML = myMats.length
      ? myMats.sort((a, b) => a.id - b.id)
        .map(f => `<li><a href="${f.url}" download>${f.title}</a></li>`).join('')
      : '<li>오늘 자료 없음</li>';

    /* ───────────── 건의사항 제출 ───────────── */
    document.querySelector('#submitFeedback').addEventListener('click', () => {
      const text = document.querySelector('#feedbackBox').value.trim();
      if (!text) return alert('내용을 입력해주세요!');

      const name = stu?.name || '익명';

      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, text })
      }).then(() => {
        alert('소중한 의견 감사합니다!');
        document.querySelector('#feedbackBox').value = '';
      }).catch(() => {
        alert('전송에 실패했습니다. 나중에 다시 시도해주세요.');
      });
    });
  }
  const unreadNoticeCount = 1;  // 예시로 1개

  // 뱃지 표시
  const badge = document.getElementById('badge');
  if (unreadNoticeCount > 0) {
    badge.textContent = unreadNoticeCount;
    badge.style.display = 'inline';
  }

  // 설정 버튼 눌렀을 때 뱃지 사라지게
  document.getElementById('setBtn').addEventListener('click', () => {
    badge.style.display = 'none';
  });
  /* ───────────── Kollus 플레이어 교체 ───────────── */
  async function play(mid) {
    currentMid = mid;
    const frame = $('player');
    frame.src = "";
    try {
      const url = await fetch(`/api/get-url?mid=${mid}`).then(r => r.text());
      frame.src = url;
    } catch (err) {
      console.error(err);
      alert("영상을 불러오지 못했습니다.");
    }
  }

})();
