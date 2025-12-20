// /js/admin/features/exportLogs.js
// 수업 기록 텍스트 내보내기
// - 오늘 이전 누적 진도와 비교해 '오늘 바뀐 것'만 출력
// - ✅ '건너뜀(skip)'은 내보내기에서 제외
// - ✅ 진도 항목은 '챕터 숫자' 기준으로 정렬해서 출력
// - 테스트/특이사항/숙제도 함께 포함
// - ✅ 숙제: homeworkTable(신형) 우선, 없으면 homework(구형 문자열)

import { $, toast, todayLocalKey } from '../core/utils.js';
import { state } from '../core/state.js';

function hwRowToSummary(r) {
  const name = String(r?.name || '').trim();
  const unit = String(r?.unit || '').trim();
  const pctRaw = (r?.pct === '' || r?.pct == null) ? '' : String(r.pct).trim();
  const rem  = String(r?.rem || '').trim();

  const parts = [];
  if (name) parts.push(name);
  if (unit) parts.push(unit);
  if (pctRaw !== '') parts.push(`${pctRaw}%`);
  if (rem) parts.push(rem);
  return parts.join(' ');
}
function buildHwSummary(rows) {
  const lines = (rows || [])
    .map(hwRowToSummary)
    .map(s => s.trim())
    .filter(Boolean);
  return lines.join(' / ');
}

export function initExport() {
  const btn = $('exportLogs');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const today = todayLocalKey();

    // 비디오 인덱스 (mid -> video)
    const videoMap = new Map((state.videos || []).map(v => [String(v.mid), v || {}]));
    const chapterNum = (v) => {
      const c = v?.chapter ?? 0;
      const n = Number(c);
      if (!Number.isNaN(n)) return n;
      const parsed = parseFloat(String(c).replace(/[^0-9.]/g, ''));
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    // 1) 오늘 이전 누적 진도 맵: prior[sid][mid] = state
    const prior = {};
    Object.keys(state.progress || {})
      .filter(d => d < today)
      .sort()
      .forEach(d => {
        const day = state.progress[d] || {};
        Object.entries(day).forEach(([sid, prog]) => {
          const tgt = (prior[sid] ||= {});
          Object.entries(prog || {}).forEach(([mid, st]) => { tgt[mid] = st; });
        });
      });

    // 2) 오늘 로그/진도
    const logsToday = state.logs?.[today] || {};
    const progToday = state.progress?.[today] || {};

    // 3) 라벨러 (mid, st -> “n차시(중단)”)
    const labelFor = (mid, st) => {
      const v = videoMap.get(String(mid));
      if (!v) return null;
      const base = `${v.chapter}차시`;
      if (st === 'done')        return base;
      if (st === 'interrupted') return `${base}(중단)`;
      return null; // skip은 여기 오기 전에 제거됨
    };

    // 4) 텍스트 생성
    const now = new Date();
    const headerDate = `${now.getMonth() + 1}/${now.getDate()}`;
    let out = '';

    // 출력은 이름순 정렬
    const entries = Object.entries(logsToday).sort(([aSid],[bSid]) => {
      const a = (state.students || []).find(s => String(s.id) === String(aSid));
      const b = (state.students || []).find(s => String(s.id) === String(bSid));
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
    });

    entries.forEach(([sid, logEntry]) => {
      const todayProg = progToday[sid] || {};
      const before    = prior[sid] || {};

      // 변화만 뽑되, skip은 제외하고, 챕터 숫자 기준 정렬
      const diffObjs = Object.entries(todayProg)
        .filter(([mid, st]) => before[mid] !== st && st !== 'none' && st !== 'skip')
        .map(([mid, st]) => {
          const v = videoMap.get(String(mid)) || {};
          return { mid, st, chap: chapterNum(v), v };
        })
        .sort((a, b) => a.chap - b.chap);

      const diffs = diffObjs
        .map(o => labelFor(o.mid, o.st))
        .filter(Boolean);

      const notes = String(logEntry.notes || '').replace(/\r?\n/g, ' ').trim();

      // ✅ 숙제: 신형 우선
      let hw = '';
      if (Array.isArray(logEntry.homeworkTable) && logEntry.homeworkTable.length) {
        hw = buildHwSummary(logEntry.homeworkTable);
      } else {
        hw = String(logEntry.homework || '').replace(/\r?\n/g, ' ').trim();
      }

      // 테스트 성적(있으면)
      const tests = Array.isArray(logEntry.tests) ? logEntry.tests : [];
      const testLines = tests.map(t => {
        const nm = t.name || '';
        const sc = t.score || '';
        const wrong = Array.isArray(t.wrong) ? t.wrong.join(', ') : '';
        const memo = (t.memo || '').trim();
        const wrongPart = wrong ? ` (오답: ${wrong})` : '';
        const memoPart  = memo  ? ` – ${memo}` : '';
        return `${nm} ${sc}${wrongPart}${memoPart}`;
      });

      // 학생 정보
      const stu = (state.students || []).find(s => String(s.id) === String(sid));
      if (!stu) return;

      // 아무 변화도 없고(진도/테스트) 노트/숙제도 비었으면 스킵
      const hasTests = testLines.length > 0;
      if (diffs.length === 0 && !notes && !hw && !hasTests) return;

      const curLabel = stu.curriculum + (stu.subCurriculum ? ` ${stu.subCurriculum}` : '');

      out += `(${headerDate}) ${stu.name}\n`;
      out += `특이사항 : ${notes || ''}\n\n`;
      if (hasTests) {
        out += `테스트 : ${testLines.join(' / ')}\n\n`;
      }
      out += `진도 (${curLabel}) : ${diffs.join(', ')}\n\n`;
      out += `숙제 : ${hw || ''}\n\n\n`;
    });

    if (!out.trim()) {
      toast('오늘 변경된 기록이 없습니다.');
      return;
    }

    // 5) 다운로드
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `수업기록_${today}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    toast('수업 기록 내보내기 완료');
  });
}
