// /js/tests.js — 테스트 관리(정의/정답 3회차) + 통계 대시보드 + 개인별 성적
/* global fetch */

const $ = (sel) => document.querySelector(sel);
const CT = { "Content-Type": "application/json" };

async function fetchJSONSafe(url, init = {}) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.text();
  if (!res.ok) throw new Error(`[tests] ${init.method || "GET"} ${url} -> ${res.status}\n${body.slice(0, 500)}`);
  try { return body.trim() ? JSON.parse(body) : {}; }
  catch (e) { throw new Error(`[tests] Bad JSON from ${url}: ${e?.message}\n${body.slice(0, 500)}`); }
}

let TEST_CFG = { categories: {} };
let TEST_STATS = null;

// stats 이름 -> curriculum 매핑(설정 기반)
let TEST_NAME_TO_CUR = {};
let CUR_SET = new Set();

function normalizeCfg(x) {
  const cfg = (x && typeof x === "object") ? x : {};
  if (!cfg.categories || typeof cfg.categories !== "object") cfg.categories = {};

  for (const [k, v] of Object.entries(cfg.categories)) {
    const cat = cfg.categories[k] = (v && typeof v === "object") ? v : {};
    cat.label = (typeof cat.label === "string" && cat.label.trim()) ? cat.label : k;
    if (!Array.isArray(cat.tests)) cat.tests = [];

    cat.tests = cat.tests.map(t => {
      if (!t || typeof t !== "object") return null;

      const id = String(t.id || "").trim() || `t_${k}_${Math.random().toString(36).slice(2, 9)}`;
      const name = String(t.name || "").trim() || id;
      const problems = Number.isFinite(+t.problems) ? Math.max(1, +t.problems) : 20;
      const curriculum = (t.curriculum || "").trim() || "공수1";

      // ✅ 새 스키마: answerKeys {"1":[], "2":[], "3":[]}
      // ✅ 구 스키마: answerKey / answers
      const answerKeys = (t.answerKeys && typeof t.answerKeys === "object") ? t.answerKeys : null;
      const answerKey = t.answerKey ?? t.answers ?? null;

      const out = { id, name, problems, curriculum };

      if (answerKeys) {
        out.answerKeys = {
          "1": Array.isArray(answerKeys["1"]) ? answerKeys["1"] : null,
          "2": Array.isArray(answerKeys["2"]) ? answerKeys["2"] : null,
          "3": Array.isArray(answerKeys["3"]) ? answerKeys["3"] : null,
        };
      } else if (answerKey != null) {
        out.answerKey = answerKey;
      }

      return out;
    }).filter(Boolean);
  }

  return cfg;
}

function rebuildNameToCurriculumMap() {
  TEST_NAME_TO_CUR = {};
  CUR_SET = new Set();
  for (const cat of Object.values(TEST_CFG.categories || {})) {
    for (const t of (cat.tests || [])) {
      const name = canonTestName(t.name);
      const cur = String(t.curriculum || "").trim() || "공수1";
      if (name) TEST_NAME_TO_CUR[name] = cur;
      CUR_SET.add(cur);
    }
  }
}

function resolveCategoryKeysByType(typeVal) {
  const hits = [];
  for (const [key, cat] of Object.entries(TEST_CFG.categories || {})) {
    const label = String(cat.label || "").trim();
    const k = String(key || "").trim().toUpperCase();
    const lv = label.toUpperCase();
    if (typeVal === "단원평가") {
      if (lv.includes("단원") || lv.includes("UNIT") || k === "UNIT") hits.push(key);
    } else if (typeVal === "FINAL") {
      if (lv.includes("FINAL") || k === "FINAL") hits.push(key);
    } else if (typeVal === "HELL") {
      if (lv.includes("HELL") || k === "HELL") hits.push(key);
    }
  }
  return hits;
}

function getCategoryKeyForType(typeVal) {
  const keys = resolveCategoryKeysByType(typeVal);
  if (keys.length) return keys[0];
  const map = { "단원평가": "UNIT", "FINAL": "FINAL", "HELL": "HELL" };
  const key = map[typeVal] || String(typeVal || "").toUpperCase();
  if (!TEST_CFG.categories[key]) TEST_CFG.categories[key] = { label: typeVal, tests: [] };
  return key;
}

// ───────────── 정답 파싱 ─────────────
function parseAnswerSpec(text, problems) {
  if (!text && text !== 0) return null;
  if (Array.isArray(text)) return text;

  const s = String(text).trim();
  if (!s) return null;

  let arr;
  if (/[\s,]/.test(s)) arr = s.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
  else arr = s.split("").map(v => v.trim());

  if (!arr.length) return null;

  if (problems && problems > 0) {
    if (arr.length > problems) arr = arr.slice(0, problems);
    if (arr.length < problems) arr = arr.concat(new Array(problems - arr.length).fill(""));
  }

  return arr;
}

function parseAnswerSpec3(text, problems) {
  const raw = String(text ?? "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n").slice(0, 3);

  // 1줄만 있으면 1~3회차 동일로 저장
  if (lines.length <= 1) {
    const a = parseAnswerSpec(lines[0] || "", problems) || new Array(problems).fill("");
    return { "1": a, "2": [...a], "3": [...a] };
  }

  const a1 = parseAnswerSpec(lines[0] || "", problems) || new Array(problems).fill("");
  const a2 = parseAnswerSpec(lines[1] || "", problems) || [...a1];
  const a3 = parseAnswerSpec(lines[2] || "", problems) || [...a1];

  return { "1": a1, "2": a2, "3": a3 };
}

function answerKeysToText(test) {
  const p = Number(test?.problems || 0) || 0;

  // 새 스키마
  if (test?.answerKeys && typeof test.answerKeys === "object") {
    const a1 = Array.isArray(test.answerKeys["1"]) ? test.answerKeys["1"] : new Array(p).fill("");
    const a2 = Array.isArray(test.answerKeys["2"]) ? test.answerKeys["2"] : a1;
    const a3 = Array.isArray(test.answerKeys["3"]) ? test.answerKeys["3"] : a1;
    return [
      (a1 || []).join(" "),
      (a2 || []).join(" "),
      (a3 || []).join(" "),
    ].join("\n").trimEnd();
  }

  // 구 스키마
  if (test?.answerKey != null) {
    const arr = Array.isArray(test.answerKey) ? test.answerKey : (parseAnswerSpec(test.answerKey, 0) || []);
    return arr.join(" ");
  }

  return "";
}

function canonTestName(name) {
  let s = String(name || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");
  return s;
}

const state = {
  type: "단원평가",
  curriculum: "공수1",
  selectedId: null,

  selectedStatTestName: null,
  selectedBand: "",
};

// ───────────── XSS escape ─────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

// ───────────── 편집 커리 셀렉트(동적 주입) ─────────────
function ensureEditCurriculumUI() {
  if ($("#cfgEditCur")) return;

  const probEl = $("#cfgProblems");
  if (!probEl) return;

  const row = document.createElement("div");
  row.className = "field-row";
  row.style.marginTop = "6px";
  row.innerHTML = `
    <label for="cfgEditCur">시험 커리</label>
    <select id="cfgEditCur">
      <option value="공수1">공수1</option>
      <option value="공수2">공수2</option>
      <option value="대수">대수</option>
      <option value="미적1">미적1</option>
      <option value="미적2">미적2</option>
      <option value="확통">확통</option>
      <option value="기하">기하</option>
    </select>
    <div class="helper">이 시험이 속한 커리를 바꿀 수 있습니다.</div>
  `;

  const probRow = probEl.closest(".field-row");
  if (probRow && probRow.parentElement) probRow.insertAdjacentElement("afterend", row);
  else probEl.insertAdjacentElement("afterend", row);

  $("#cfgEditCur")?.addEventListener("change", () => {
    const val = $("#cfgEditCur").value;
    const catKey = getCategoryKeyForType(state.type);
    const cat = TEST_CFG.categories[catKey];
    if (!cat) return;
    const t = (cat.tests || []).find(x => x.id === state.selectedId);
    if (!t) return;
    t.curriculum = val;
    renderTestList();
  });
}

// ───────────── 왼쪽(시험 목록) ─────────────
function getTestsForCurrentSelection() {
  const catKey = getCategoryKeyForType(state.type);
  const cat = TEST_CFG.categories[catKey];
  if (!cat) return [];
  const all = (cat.tests || []);
  return all.filter(t => String(t.curriculum || "").trim() === state.curriculum);
}

function buildStatsBadgeForTest(test) {
  if (!TEST_STATS || !TEST_STATS.by_test) return "";
  const key = canonTestName(test.name);
  const entry = TEST_STATS.by_test[key];
  if (!entry || !entry.count) return "";
  const avg = entry.avg_pct?.toFixed ? entry.avg_pct.toFixed(1) : entry.avg_pct;
  return `<span class="small">· ${escapeHtml(avg)}% / ${escapeHtml(entry.count)}명</span>`;
}

function renderTestList() {
  const listEl = $("#testList");
  if (!listEl) return;

  const tests = getTestsForCurrentSelection();
  if (!tests.length) {
    listEl.innerHTML = `<div style="font-size:12px; opacity:.7; padding:4px;">아직 등록된 시험이 없습니다. [새 시험] 버튼을 눌러 추가하세요.</div>`;
    return;
  }

  listEl.innerHTML = tests.map(t => {
    const statsBadge = buildStatsBadgeForTest(t);
    const active = (t.id === state.selectedId) ? "active" : "";
    return `<button type="button" data-id="${escapeAttr(t.id)}" class="${active}">
      ${escapeHtml(t.name)}
      <span class="small">(${escapeHtml(t.problems)}문항)</span>
      ${statsBadge}
    </button>`;
  }).join("");

  listEl.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedId = btn.getAttribute("data-id");
      renderTestList();
      fillEditorFromSelection();
    });
  });
}

function fillEditorFromSelection() {
  ensureEditCurriculumUI();

  const nameEl = $("#cfgName");
  const probEl = $("#cfgProblems");
  const ansEl = $("#cfgAnswers");
  const editCurEl = $("#cfgEditCur");

  const catKey = getCategoryKeyForType(state.type);
  const tests = (TEST_CFG.categories[catKey]?.tests || []);

  let sel = tests.find(t => t.id === state.selectedId);
  if (!sel) sel = tests[0];

  if (!sel) {
    if (nameEl) nameEl.value = "";
    if (probEl) probEl.value = "";
    if (ansEl) ansEl.value = "";
    if (editCurEl) editCurEl.value = "공수1";
    return;
  }

  state.selectedId = sel.id;
  if (nameEl) nameEl.value = sel.name || "";
  if (probEl) probEl.value = sel.problems || "";

  if (ansEl) ansEl.value = answerKeysToText(sel);

  if (editCurEl) {
    const c = String(sel.curriculum || "").trim() || "공수1";
    editCurEl.value = c;
  }
}

// ───────────── 통계 툴바/필터 ─────────────
function findTypeForTestName(name) {
  const n = String(name || "").trim();
  for (const [key, cat] of Object.entries(TEST_CFG.categories || {})) {
    const label = String(cat.label || "").trim();
    const typeGuess = label || key;
    for (const t of (cat.tests || [])) {
      if (String(t.name).trim() === n) return typeGuess;
    }
  }
  return null;
}

function renderStatsTable() {
  const tbody = $("#statsTable tbody");
  const thead = $("#statsTable thead");
  if (!tbody || !thead) return;

  // ✅ 중앙값 제거
  thead.innerHTML = `
    <tr>
      <th style="text-align:left;">시험명</th>
      <th>응시</th>
      <th>평균</th>
      <th>최소</th>
      <th>최대</th>
    </tr>
  `;

  const stats = TEST_STATS?.by_test || {};
  const ordered = [];

  // config 순서대로
  for (const cat of Object.values(TEST_CFG.categories || {})) {
    for (const t of (cat.tests || [])) {
      const name = canonTestName(t.name);
      if (!name) continue;
      ordered.push({ name, v: stats[name] || null });
    }
  }

  // stats에만 있는 것(옛 데이터)
  const inCfgSet = new Set(ordered.map(x => x.name));
  for (const [name, v] of Object.entries(stats)) {
    if (inCfgSet.has(name)) continue;
    ordered.push({ name, v });
  }

  if (!ordered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:.7; padding:8px;">집계된 시험 데이터가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = ordered.map(it => {
    const v = it.v || {};
    const count = v.count || 0;
    const avg = (typeof v.avg_pct === "number") ? v.avg_pct.toFixed(1) : "";
    const min = (typeof v.min_pct === "number") ? v.min_pct.toFixed(1) : "";
    const max = (typeof v.max_pct === "number") ? v.max_pct.toFixed(1) : "";
    return `
      <tr data-test="${escapeAttr(it.name)}" style="cursor:pointer;">
        <td style="text-align:left;">${escapeHtml(it.name)}</td>
        <td>${escapeHtml(count)}</td>
        <td>${escapeHtml(avg)}</td>
        <td>${escapeHtml(min)}</td>
        <td>${escapeHtml(max)}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("tr[data-test]").forEach(tr => {
    tr.addEventListener("click", async () => {
      const testName = tr.getAttribute("data-test") || "";
      state.selectedStatTestName = testName;
      await loadAndRenderPersonalScores();
    });
  });
}

function renderStatsSummary() {
  const box = $("#statsSummary");
  if (!box) return;

  const data = (TEST_STATS && TEST_STATS.by_test) ? TEST_STATS.by_test : {};
  const buckets = { UNIT: [], FINAL: [], HELL: [] };

  for (const [name, v] of Object.entries(data)) {
    const typeGuess = findTypeForTestName(name) || "";
    const up = typeGuess.toUpperCase();
    const avg = typeof v.avg_pct === "number" ? v.avg_pct : null;
    if (avg == null) continue;
    if (up.includes("UNIT") || up.includes("단원")) buckets.UNIT.push(avg);
    else if (up.includes("FINAL")) buckets.FINAL.push(avg);
    else if (up.includes("HELL")) buckets.HELL.push(avg);
  }

  function avg(arr) {
    if (!arr.length) return null;
    return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
  }

  const unitAvg = avg(buckets.UNIT);
  const finalAvg = avg(buckets.FINAL);
  const hellAvg = avg(buckets.HELL);

  const parts = [];
  if (unitAvg != null) parts.push(`<div>단원평가 평균: ${escapeHtml(unitAvg)}%</div>`);
  if (finalAvg != null) parts.push(`<div>APEX FINAL 평균: ${escapeHtml(finalAvg)}%</div>`);
  if (hellAvg != null) parts.push(`<div>APEX HELL 평균: ${escapeHtml(hellAvg)}%</div>`);

  box.innerHTML = parts.length ? parts.join("") : `<div>아직 통계 데이터가 부족합니다.</div>`;
}

// ───────────── 개인별 성적 패널 ─────────────
function ensurePersonalPanel() {
  let panel = $("#personalPanel");
  if (panel) return panel;

  const statsTable = $("#statsTable");
  if (!statsTable) return null;

  panel = document.createElement("div");
  panel.id = "personalPanel";
  panel.style.marginTop = "12px";
  panel.innerHTML = `
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0 6px;">
      <div style="font-weight:800;">개인별 성적</div>
      <div id="personalTitle" style="font-size:12px; opacity:.75;"></div>
      <div style="margin-left:auto; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
        <span style="font-size:12px; opacity:.75;">레벨</span>
        <select id="personalBand" style="font-size:12px; padding:4px 8px;">
          <option value="">전체</option>
          <option value="상">상</option>
          <option value="중상">중상</option>
          <option value="중">중</option>
          <option value="하">하</option>
        </select>
      </div>
    </div>

    <div style="border:1px solid rgba(255,255,255,.12); border-radius:10px; overflow:hidden;">
      <table class="stats-table" id="personalTable" style="margin:0;">
        <thead>
          <tr>
            <th style="text-align:left;">이름</th>
            <th style="text-align:left;">레벨</th>
            <th>점수(%)</th>
            <th>정답/문항</th>
            <th style="text-align:left;">제출시각</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <div id="personalHint" style="font-size:12px; opacity:.75; margin-top:6px;"></div>
  `;

  statsTable.insertAdjacentElement("afterend", panel);

  $("#personalBand")?.addEventListener("change", async (e) => {
    state.selectedBand = e.target.value || "";
    await loadAndRenderPersonalScores();
  });

  return panel;
}

function renderPersonalEmpty(msg) {
  ensurePersonalPanel();
  const tbody = $("#personalTable tbody");
  const titleEl = $("#personalTitle");
  const hintEl = $("#personalHint");
  if (titleEl) titleEl.textContent = msg || "";
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:.7; padding:8px;">시험을 선택하세요.</td></tr>`;
  if (hintEl) hintEl.textContent = "";
}

async function loadAndRenderPersonalScores() {
  ensurePersonalPanel();

  const tbody = $("#personalTable tbody");
  const titleEl = $("#personalTitle");
  const hintEl = $("#personalHint");
  if (!tbody || !titleEl || !hintEl) return;

  const test = String(state.selectedStatTestName || "").trim();
  if (!test) {
    renderPersonalEmpty("통계 표에서 시험명을 클릭하면 개인 성적이 나옵니다.");
    return;
  }

  const recent = Number($("#statRecent")?.value || "30") || 30;
  const band = String($("#personalBand")?.value || state.selectedBand || "").trim();
  state.selectedBand = band;

  const cur = TEST_NAME_TO_CUR[test] || "-";
  titleEl.textContent = `— ${test} · ${cur}${band ? ` (${band})` : ""}`;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:.7; padding:8px;">불러오는 중...</td></tr>`;
  hintEl.textContent = "";

  try {
    const q = new URLSearchParams();
    q.set("recent_days", String(recent));
    q.set("test", test);
    if (band) q.set("band", band);

    const data = await fetchJSONSafe(`/api/tests-records?${q.toString()}`);
    const recs = Array.isArray(data.records) ? data.records : [];

    if (!recs.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:.7; padding:8px;">개인 성적 데이터가 없습니다.</td></tr>`;
      hintEl.textContent = `최근 ${recent}일`;
      return;
    }

    tbody.innerHTML = recs.map(r => {
      const nm = escapeHtml(r.studentName || r.sid || "");
      const lv = escapeHtml(r.level || "");
      const pct = (typeof r.pct === "number") ? r.pct.toFixed(1) : escapeHtml(String(r.pct || ""));
      const ct = `${r.correct ?? ""}/${r.total ?? ""}`;
      const when = escapeHtml(String(r.createdAt || ""));
      return `
        <tr>
          <td style="text-align:left;">${nm}</td>
          <td style="text-align:left;">${lv || "-"}</td>
          <td style="text-align:right;">${pct}</td>
          <td style="text-align:right;">${escapeHtml(ct)}</td>
          <td style="text-align:left; font-size:11px; opacity:.85;">${when}</td>
        </tr>
      `;
    }).join("");

    hintEl.textContent = `총 ${recs.length}건 · 최근 ${recent}일`;
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:.7; padding:8px;">로드 실패</td></tr>`;
    hintEl.textContent = String(e?.message || e).slice(0, 180);
  }
}

// ───────────── 로드/리렌더 ─────────────
async function loadConfigAndStats() {
  try { TEST_CFG = normalizeCfg(await fetchJSONSafe("/api/tests-config")); }
  catch { TEST_CFG = { categories: {} }; }

  rebuildNameToCurriculumMap();
  ensureEditCurriculumUI();

  try {
    const recent = Number($("#statRecent")?.value || "30") || 30;
    TEST_STATS = await fetchJSONSafe(`/api/tests-stats?recent_days=${recent}&include_wrong=0`);
  } catch {
    TEST_STATS = null;
  }

  renderTestList();
  fillEditorFromSelection();
  renderStatsTable();
  renderStatsSummary();

  ensurePersonalPanel();
  if (state.selectedStatTestName) await loadAndRenderPersonalScores();
  else renderPersonalEmpty("통계 표에서 시험명을 클릭하면 개인 성적이 나옵니다.");
}

// ───────────── 이벤트 ─────────────
function bindUI() {
  const typeSel = $("#cfgType");
  const curSel = $("#cfgCur");
  const newBtn = $("#btnNewTest");
  const saveBtn = $("#btnSaveTest");
  const delBtn = $("#btnDeleteTest");
  const reloadBtn = $("#btnReloadStats");
  const recentSel = $("#statRecent");

  typeSel?.addEventListener("change", () => {
    state.type = typeSel.value;
    state.selectedId = null;
    renderTestList();
    fillEditorFromSelection();
  });

  curSel?.addEventListener("change", () => {
    state.curriculum = curSel.value;
    state.selectedId = null;
    renderTestList();
    fillEditorFromSelection();
  });

  newBtn?.addEventListener("click", () => {
    const catKey = getCategoryKeyForType(state.type);
    const cat = TEST_CFG.categories[catKey];
    if (!cat) return;

    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const cur = state.curriculum || "공수1";
    const baseName = `${state.type} ${cur} ${cat.tests.length + 1}회`;

    const test = {
      id,
      name: baseName,
      problems: 20,
      curriculum: cur,
      // ✅ 기본: 3회차 동일 빈키
      answerKeys: { "1": [], "2": [], "3": [] }
    };
    cat.tests.push(test);

    state.selectedId = id;
    renderTestList();
    fillEditorFromSelection();
  });

  saveBtn?.addEventListener("click", async () => {
    const catKey = getCategoryKeyForType(state.type);
    const cat = TEST_CFG.categories[catKey];
    if (!cat) return;

    const nameEl = $("#cfgName");
    const probEl = $("#cfgProblems");
    const ansEl = $("#cfgAnswers");
    const editCurEl = $("#cfgEditCur");

    const name = nameEl?.value?.trim() || "";
    const problems = Math.max(1, Number(probEl?.value) || 0);
    const answersText = ansEl?.value || "";
    const editCur = String(editCurEl?.value || "").trim();

    if (!name) { alert("시험명을 입력해주세요."); return; }

    let test = (cat.tests || []).find(t => t.id === state.selectedId);

    const cur = editCur || (state.curriculum || "공수1");

    if (!test) {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      test = { id, name, problems, curriculum: cur, answerKeys: { "1": [], "2": [], "3": [] } };
      cat.tests.push(test);
      state.selectedId = id;
    }

    test.name = name;
    test.problems = problems;
    test.curriculum = cur;

    // ✅ 3줄 파싱해서 answerKeys로 저장
    test.answerKeys = parseAnswerSpec3(answersText, problems);

    // 구 스키마 호환용(서버/다른 화면이 answerKey만 보는 경우 대비)
    test.answerKey = test.answerKeys["1"];

    try {
      const res = await fetch("/api/tests-config", { method: "POST", headers: CT, body: JSON.stringify(TEST_CFG) });
      if (!res.ok) throw new Error(String(res.status));
      alert("저장 완료");
      await loadConfigAndStats();
    } catch (e) {
      console.error(e);
      alert("저장에 실패했습니다.");
    }
  });

  delBtn?.addEventListener("click", async () => {
    if (!state.selectedId) { alert("삭제할 시험을 선택해주세요."); return; }
    if (!confirm("정말 이 시험 정의를 삭제할까요? (학생들의 기출 기록은 그대로 남습니다)")) return;

    const catKey = getCategoryKeyForType(state.type);
    const cat = TEST_CFG.categories[catKey];
    if (!cat) return;

    cat.tests = (cat.tests || []).filter(t => t.id !== state.selectedId);
    state.selectedId = null;

    try {
      const res = await fetch("/api/tests-config", { method: "POST", headers: CT, body: JSON.stringify(TEST_CFG) });
      if (!res.ok) throw new Error(String(res.status));
      alert("삭제 완료");
      await loadConfigAndStats();
    } catch (e) {
      console.error(e);
      alert("삭제에 실패했습니다.");
    }
  });

  reloadBtn?.addEventListener("click", () => loadConfigAndStats());
  recentSel?.addEventListener("change", () => loadConfigAndStats());
}

// ───────────── init ─────────────
window.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadConfigAndStats().catch(err => {
    console.error(err);
    alert("테스트 설정/통계 로드에 실패했습니다.");
  });
});
  