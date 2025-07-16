/* student.js – 단일 플레이어 + 재생 목록 + 자료 다운로드 + 설정 패널 */
(() => {
/* ───────────── 공통 util ───────────── */
const $  = id => document.getElementById(id);
const CT = { "Content-Type": "application/json" };
const sid = decodeURIComponent(location.pathname.split("/").pop());
let currentMid = null;

/* ───────────── 설정 패널 & 다크모드 ───────────── */
const setBtn     = $('setBtn');
const setPanel   = $('setPanel');
const darkTgl    = $('darkToggle');
const suggestBtn = $('suggestBtn');

/* ▸ 패널 열/닫기 */
setBtn?.addEventListener('click', e=>{
  e.stopPropagation();
  setPanel.classList.toggle('open');
});
document.addEventListener('click', e=>{
  if(!setPanel.contains(e.target) && !setBtn.contains(e.target)){
    setPanel.classList.remove('open');
  }
});

/* ▸ 다크-모드 기억 */
if(localStorage.theme === "dark"){
  document.body.classList.add("dark");
  darkTgl.checked = true;
}
darkTgl.onchange = () =>{
  document.body.classList.toggle("dark", darkTgl.checked);
  localStorage.theme = darkTgl.checked ? "dark" : "light";
};

/* ▸ 건의사항 */
suggestBtn.onclick = () =>
  window.open("https://forms.gle/q1B8kRXuzSTzM3Qx9", "_blank");

/* ───────────── 헤더 시계 ───────────── */
const clk = $('clock');
if(clk){
  const tick = ()=>{
    const d=new Date(), w="일월화수목금토"[d.getDay()];
    clk.textContent =
      `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.`+
      `${String(d.getDate()).padStart(2,"0")}(${w}) `+
      `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };
  tick(); setInterval(tick,60*1000);
}

/* ───────────── 데이터 로드 ───────────── */
Promise.all([
  fetch("/api/students").then(r=>r.json()),
  fetch("/api/videos").then(r=>r.json()),
  fetch("/api/updates").then(r=>r.json()).catch(()=>({})),
  fetch("/api/materials").then(r=>r.json()).catch(()=>({})),
  fetch("/api/mat-assign").then(r=>r.json()).catch(()=>({}))
]).then(init).catch(err=>alert("데이터 로드 실패\n"+err));

/* ───────────── main ───────────── */
function init([stuArr, vids, upd, mats, assigns]){
  const stu = stuArr.find(s=>s.id===sid);
  if(!stu){ alert("학생 정보가 없습니다"); return; }

  $('stuName').textContent = `${stu.name} (${stu.curriculum})`;

  /* ── 오늘 날짜 key ── */
  const today = new Date().toISOString().slice(0,10);
  const todayUpd = upd[today] ?? {};           // { sid : [id,id] }

  /* ── 영상 목록 결정 ── */
  const curKey = stu.curriculum.trim().toLowerCase();
  const subKey = (stu.subCurriculum || '').trim().toLowerCase();
 // (1) 오늘 관리자 지정 영상 ID 배열 (없으면 빈 배열)
  const chosenIds = (todayUpd[sid] || []).map(Number);

  // (2) 명시적으로 하나라도 지정된 경우에만 그 영상들을 myVids 에 담고,
  //     지정이 하나도 없으면 빈 배열로 유지
  const myVids = chosenIds.length
    ? vids.filter(v => chosenIds.includes(Number(v.id)))
    : [];
  /* ── 목록 그리기 ── */
  const listBox = $('vidList');
  const frame   = $('player');

  if (!myVids.length){
    listBox.innerHTML =
      "<li style='opacity:.65'>오늘 할당된 영상이 없습니다 문의 부탁</li>";
    frame.src = "";   // 재생 중지
  }else{
    listBox.innerHTML = myVids.map(v => {
      // 학생 레벨에 해당하는 서술형 번호
      const num = v.exNum && v.exNum[stu.level] || '';
      return `
        <li data-mid="${v.mid}" class="${v===myVids[0]?'active':''}">
          ${v.chapter}. ${v.title}
          ${ num ? `<span style="margin-left:.5rem;font-weight:500;color:var(--accent)">[서술형 ${num}번]</span>` : '' }
        </li>
      `;
    }).join("");
    play(myVids[0].mid);   // 첫 영상 자동
  }

  /* ▸ 목록 클릭 */
  listBox.onclick = e=>{
    const li = e.target.closest('li[data-mid]');
    if(!li) return;
    listBox.querySelectorAll('li').forEach(x=>x.classList.remove('active'));
    li.classList.add('active');
    play(li.dataset.mid);
  };

  /* ── 자료 다운로드 ── */
  const myMats = (assigns[sid]||[]).map(id=>mats[id]).filter(Boolean);
  $('matList').innerHTML = myMats.length
     ? myMats.sort((a,b)=>a.id-b.id)
             .map(f=>`<li><a href="${f.url}" download>${f.title}</a></li>`).join('')
     : '<li>오늘 자료 없음</li>';
}

/* ───────────── Kollus 플레이어 교체 ───────────── */
async function play(mid){
  currentMid = mid;
  const frame = $('player');
  frame.src = "";                       // 기존 정리
  try{
    const url = await fetch(`/api/get-url?mid=${mid}`).then(r=>r.text());
    frame.src = url;
  }catch(err){
    console.error(err);
    alert("영상을 불러오지 못했습니다.");
  }
}

})();  // IIFE end
