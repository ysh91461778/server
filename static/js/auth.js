/* global fetch */
const $ = (id) => document.getElementById(id);

const LS_TOKEN = "studentToken";
const LS_SID = "studentSid";

function setMsg(text, type = "") {
  const el = $("msg");
  if (!el) return;
  el.className = "msg " + (type || "");
  el.textContent = text || "";
}

function setModalMsg(text, type = "") {
  const el = $("modalMsg");
  if (!el) return;
  el.className = "msg " + (type || "");
  el.textContent = text || "";
}

function setSpin(on) {
  const el = $("spin");
  if (!el) return;
  el.style.display = on ? "block" : "none";
}

function setLoggedInUI(on, sid = "") {
  const loginBox = $("loginBox");
  const loggedBox = $("loggedBox");

  if (loginBox) loginBox.style.display = on ? "none" : "block";
  if (loggedBox) loggedBox.style.display = on ? "block" : "none";

  const who = $("loggedWho");
  if (who) who.textContent = sid ? `${sid} 로그인됨` : "로그인됨";
}

function openModal() {
  const back = $("modalBack");
  if (!back) return;
  setModalMsg("", "");
  // 입력 초기화
  if ($("curPw")) $("curPw").value = "";
  if ($("newId")) $("newId").value = "";
  if ($("newPw")) $("newPw").value = "";
  back.style.display = "flex";
}

function closeModal() {
  const back = $("modalBack");
  if (!back) return;
  back.style.display = "none";
}

async function api(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;

  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function goStudentPage(sid) {
  if (!sid) return;
  location.href = `/student/${encodeURIComponent(sid)}`;
}

async function autoLogin() {
  const token = localStorage.getItem(LS_TOKEN);
  if (!token) return;

  setSpin(true);
  const r = await api("/api/auth/me", null, token);
  setSpin(false);

  if (r.ok && r.data?.ok && r.data?.sid) {
    localStorage.setItem(LS_SID, r.data.sid);
    setLoggedInUI(true, r.data.sid);
    setMsg("", "");
  } else {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_SID);
    setLoggedInUI(false);
  }
}

async function login() {
  const id = ($("sid")?.value || "").trim();
  const password = ($("pw")?.value || "").trim();

  if (!id || !password) {
    setMsg("아이디/비밀번호 입력해.", "err");
    return;
  }

  setSpin(true);
  const r = await api("/api/auth/login", { id, password });
  setSpin(false);

  if (r.ok && r.data?.ok && r.data?.token && r.data?.sid) {
    localStorage.setItem(LS_TOKEN, r.data.token);
    localStorage.setItem(LS_SID, r.data.sid);
    setLoggedInUI(true, r.data.sid);
    setMsg("로그인됨. 아래 버튼 누르면 학습 페이지로 이동.", "ok");
  } else {
    const msg =
      r.data?.error === "unknown id" ? "없는 아이디야." :
      r.data?.error === "bad password" ? "비밀번호 틀림." :
      "로그인 실패.";
    setMsg(msg, "err");
  }
}

function logout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_SID);
  setLoggedInUI(false);
  setMsg("로그아웃됨.", "ok");
}

async function saveChange() {
  // ✅ 서버에 구현되어 있어야 동작함
  const token = localStorage.getItem(LS_TOKEN);
  const sid = localStorage.getItem(LS_SID);
  if (!token || !sid) {
    setModalMsg("로그인 상태가 아님.", "err");
    return;
  }

  const curPw = ($("curPw")?.value || "").trim();
  const newId = ($("newId")?.value || "").trim();
  const newPw = ($("newPw")?.value || "").trim();

  if (!curPw) {
    setModalMsg("현재 비밀번호는 입력해야 함.", "err");
    return;
  }
  if (!newId && !newPw) {
    setModalMsg("바꿀 내용이 없음.", "err");
    return;
  }

  setSpin(true);
  const r = await api("/api/auth/change", { curPw, newId, newPw }, token);
  setSpin(false);

  if (r.ok && r.data?.ok) {
    // ✅ 아이디가 바뀐 경우 화면/저장값 갱신
    const nextSid = r.data?.sid || sid;
    localStorage.setItem(LS_SID, nextSid);
    setLoggedInUI(true, nextSid);

    // 토큰을 새로 주면 갱신
    if (r.data?.token) localStorage.setItem(LS_TOKEN, r.data.token);

    setModalMsg("변경 완료.", "ok");
    setMsg("아이디/비밀번호 변경됨.", "ok");
    setTimeout(closeModal, 300);
  } else {
    const msg =
      r.data?.error === "bad password" ? "현재 비밀번호가 틀림." :
      r.data?.error === "id taken" ? "이미 있는 아이디임." :
      r.data?.error ? `실패: ${r.data.error}` :
      "변경 실패.";
    setModalMsg(msg, "err");
  }
}

function initEvents() {
  $("loginBtn")?.addEventListener("click", login);
  $("pw")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  $("goBtn")?.addEventListener("click", () => {
    const sid = localStorage.getItem(LS_SID);
    if (!sid) {
      setMsg("로그인이 먼저다", "err");
      return;
    }
    goStudentPage(sid);
  });

  $("logoutBtn")?.addEventListener("click", logout);
  $("clearBtn")?.addEventListener("click", logout);

  // ✅ 모달 열기/닫기
  $("changeBtn")?.addEventListener("click", openModal);
  $("closeModalBtn")?.addEventListener("click", closeModal);

  // 바깥 클릭 닫기
  $("modalBack")?.addEventListener("click", (e) => {
    if (e.target === $("modalBack")) closeModal();
  });

  // ESC 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  $("saveChangeBtn")?.addEventListener("click", saveChange);
}

initEvents();
autoLogin();
