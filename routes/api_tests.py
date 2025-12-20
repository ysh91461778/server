from __future__ import annotations

from statistics import median
import datetime as dt
import re
import time
from typing import Tuple

from flask import Blueprint, jsonify, request

from core.paths import (
    LOGS_PATH, TESTS_PATH, STU_PATH,
    TESTS_CFG_PATH
)
from core.storage import load, save_atomic, nocache_resp, utc_now_isoz

bp_api_tests = Blueprint("api_tests", __name__)

TEST_LEVEL_RE = re.compile(r"""
  (?:\(|\[)?\s*
  (?:lv\.?|LV\.?|레벨)\s*\.?\s*([0-9]{1,2})
  \s*(?:\)|\])?
""", re.VERBOSE)

def _strip_prefix_for_display(name: str) -> str:
    s = str(name or "").strip()
    if " / " in s:
        s = s.split(" / ", 1)[1].strip()
    s = re.sub(r"\s+", " ", s)
    return s

def _parse_unit_and_test_level(name: str) -> tuple[str, int | None]:
    s = _strip_prefix_for_display(name)
    if not s:
        return "", None

    m = TEST_LEVEL_RE.search(s)
    lvl = None
    if m:
        try:
            lvl = int(m.group(1))
        except Exception:
            lvl = None
        s = (s[:m.start()] + s[m.end():]).strip()
        s = re.sub(r"\s+", " ", s)

    s = s.strip(" -_/|()[]")
    s = re.sub(r"\s+", " ", s).strip()
    return s, lvl

def _canon_test_name(name: str) -> str:
    s = str(name or "").strip()
    if not s:
        return ""
    if " / " in s:
        s = s.split(" / ", 1)[1].strip()
    s = re.sub(r"\s+", " ", s)
    return s

def _parse_answer_spec(text: str, problems: int) -> list[str]:
    s = str(text or "").strip()
    if not s:
        return [""] * problems

    if re.search(r"[\s,]", s):
        arr = [v.strip() for v in re.split(r"[\s,]+", s) if v.strip()]
    else:
        arr = [ch.strip() for ch in list(s) if ch.strip()]

    if len(arr) > problems:
        arr = arr[:problems]
    if len(arr) < problems:
        arr += [""] * (problems - len(arr))
    return arr

def _load_tests_cfg() -> dict:
    cfg = load(TESTS_CFG_PATH)
    return cfg if isinstance(cfg, dict) else {"categories": {}}

def _find_test_def_by_id(cfg: dict, test_id: str) -> dict | None:
    if not test_id:
        return None
    cats = cfg.get("categories") if isinstance(cfg, dict) else None
    if not isinstance(cats, dict):
        return None
    for cat in cats.values():
        tests = cat.get("tests") if isinstance(cat, dict) else None
        if not isinstance(tests, list):
            continue
        for t in tests:
            if not isinstance(t, dict):
                continue
            if str(t.get("id") or "").strip() == str(test_id).strip():
                return t
    return None

def _get_answer_key_for_round(test_def: dict, problems: int, round_no: int) -> list[str] | None:
    if not isinstance(test_def, dict):
        return None
    r = str(round_no if round_no in (1,2,3) else 1)

    ak = test_def.get("answerKeys")
    if isinstance(ak, dict):
        key = ak.get(r)
        if isinstance(key, list):
            key2 = [str(x).strip() for x in key]
            if len(key2) > problems: key2 = key2[:problems]
            if len(key2) < problems: key2 += [""] * (problems - len(key2))
            return key2

    legacy = test_def.get("answerKey", None)
    if legacy is None:
        legacy = test_def.get("answers", None)
    if legacy is None:
        return None

    if isinstance(legacy, list):
        key2 = [str(x).strip() for x in legacy]
        if len(key2) > problems: key2 = key2[:problems]
        if len(key2) < problems: key2 += [""] * (problems - len(key2))
        return key2

    return _parse_answer_spec(str(legacy), problems)

def _grade_answers(answers: list[str], key: list[str]) -> tuple[int, int, list[int], float]:
    total = len(key)
    wrong = []
    correct = 0
    for i in range(total):
        a = (answers[i] if i < len(answers) else "").strip()
        k = (key[i] if i < len(key) else "").strip()
        if not k:
            wrong.append(i+1)
            continue
        if a == k:
            correct += 1
        else:
            wrong.append(i+1)
    pct = round((correct / total) * 100.0, 2) if total > 0 else 0.0
    return correct, total, wrong, pct

@bp_api_tests.post('/api/submit-test')
def submit_test():
    data = request.get_json(force=True, silent=True) or {}
    sid   = str(data.get('sid', '')).strip()

    test_id = str(data.get('testId', '')).strip()
    name  = str(data.get('name', '')).strip()

    try:
        round_no = int(data.get("round", 1) or 1)
    except Exception:
        round_no = 1
    if round_no not in (1,2,3):
        round_no = 1

    score = str(data.get('score', '')).strip()
    wrong = data.get('wrong', [])
    memo  = str(data.get('memo', '')).strip()

    answers_text = data.get("answersText", None)

    if not sid or (not name and not test_id):
        return jsonify({'ok': False, 'error': 'sid and (name or testId) required'}), 400

    pct = None
    if answers_text is not None:
        cfg = _load_tests_cfg()
        tdef = _find_test_def_by_id(cfg, test_id) if test_id else None

        if tdef and not name:
            name = str(tdef.get("name") or "").strip()

        problems = None
        if isinstance(tdef, dict):
            try:
                problems = int(tdef.get("problems") or 0)
            except Exception:
                problems = None
        if not problems:
            return jsonify({"ok": False, "error": "cannot grade: missing test definition (testId)"}), 400

        key = _get_answer_key_for_round(tdef, problems, round_no)
        if not key:
            return jsonify({"ok": False, "error": "cannot grade: missing answer key"}), 400

        answers = _parse_answer_spec(str(answers_text), problems)
        correct, total, wrong_calc, pct = _grade_answers(answers, key)
        score = f"{correct}/{total}"
        wrong = wrong_calc

    if not name:
        return jsonify({'ok': False, 'error': 'name required'}), 400

    today = dt.date.today().isoformat()
    now_iso = utc_now_isoz()

    record = {
        'testId': test_id,
        'round': round_no,
        'name': name,
        'score': score,
        'wrong': wrong if isinstance(wrong, list) else [],
        'memo': memo,
        'pct': pct,
        'createdAt': now_iso
    }

    logs = load(LOGS_PATH)
    if not isinstance(logs, dict): logs = {}
    day = logs.setdefault(today, {})
    entry = day.get(sid, {})
    tests = entry.get('tests')
    if not isinstance(tests, list): tests = []
    tests.append(record)
    entry['tests'] = tests
    day[sid] = entry
    logs[today] = day
    save_atomic(LOGS_PATH, logs)

    tests_json = load(TESTS_PATH)
    if not isinstance(tests_json, dict): tests_json = {}
    per_day = tests_json.setdefault(today, {})
    arr = per_day.get(sid)
    if not isinstance(arr, list): arr = []
    arr.append(record)
    per_day[sid] = arr
    tests_json[today] = per_day
    save_atomic(TESTS_PATH, tests_json)

    return jsonify({'ok': True, 'score': score, 'wrong': record["wrong"], 'pct': pct})

@bp_api_tests.route("/api/tests", methods=["GET", "POST"])
def api_tests():
    if request.method == "GET":
        return nocache_resp(load(TESTS_PATH))
    incoming = request.get_json(force=True) or {}
    current = load(TESTS_PATH)
    if not isinstance(current, dict): current = {}
    for d, m in (incoming.items() if isinstance(incoming, dict) else []):
        cur_m = current.setdefault(d, {})
        for sid, arr in (m.items() if isinstance(m, dict) else []):
            old = cur_m.get(sid, [])
            if not isinstance(old, list): old = []
            if isinstance(arr, list):
                old += [x for x in arr if isinstance(x, dict)]
            cur_m[sid] = old
        current[d] = cur_m
    save_atomic(TESTS_PATH, current)
    return "", 204

@bp_api_tests.get("/api/tests-config")
def get_tests_config():
    return nocache_resp(load(TESTS_CFG_PATH))

@bp_api_tests.post("/api/tests-config")
def post_tests_config():
    payload = request.get_json(force=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "invalid payload"}), 400
    save_atomic(TESTS_CFG_PATH, payload)
    return jsonify({"ok": True})

def _parse_date(s: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s)
    except Exception:
        return None

def _iter_test_records(start: dt.date | None, end: dt.date | None):
    seen: set[Tuple[str, str, str]] = set()

    def _walk(container: dict):
        for date_str, by_sid in (container or {}).items():
            day = _parse_date(date_str)
            if start and (not day or day < start):
                continue
            if end and (not day or day > end):
                continue
            if not isinstance(by_sid, dict):
                continue

            for sid, val in by_sid.items():
                if isinstance(val, list):
                    arr = val
                elif isinstance(val, dict):
                    arr = val.get("tests", [])
                    if not isinstance(arr, list):
                        continue
                else:
                    continue

                for rec in arr:
                    if not isinstance(rec, dict):
                        continue
                    name = str(rec.get("name", "")).strip()
                    score = str(rec.get("score", "")).strip()
                    created_at = rec.get("createdAt") or ""
                    wrong = rec.get("wrong") if isinstance(rec.get("wrong"), list) else []
                    memo = str(rec.get("memo") or "").strip()
                    if not name or "/" not in score:
                        continue
                    try:
                        correct_s, total_s = score.split("/", 1)
                        correct = int(str(correct_s).strip())
                        total = int(str(total_s).strip())
                        if total <= 0:
                            continue
                    except Exception:
                        continue

                    key = (str(sid), name, str(created_at))
                    if key in seen:
                        continue
                    seen.add(key)
                    yield (str(sid), name, int(correct), int(total), wrong, str(created_at), memo, day)

    for item in _walk(load(LOGS_PATH)):
        yield item
    for item in _walk(load(TESTS_PATH)):
        yield item

@bp_api_tests.get("/api/tests-records")
def api_tests_records():
    test_q = str(request.args.get("test") or "").strip()
    if not test_q:
        return jsonify({"ok": False, "error": "missing test"}), 400

    recent = request.args.get("recent_days")
    band_q = str(request.args.get("band") or "").strip()

    end = dt.date.today()
    try:
        days = int(recent) if recent else 30
    except Exception:
        days = 30
    days = max(1, min(3650, days))
    start = end - dt.timedelta(days=days - 1)

    sid_to_name = {}
    sid_to_level = {}
    students = load(STU_PATH)
    if isinstance(students, list):
        for s in students:
            sid = str(s.get("id") or "").strip()
            if not sid:
                continue
            sid_to_name[sid] = str(s.get("name") or sid).strip()
            sid_to_level[sid] = str(s.get("level") or "").strip()

    def norm_band(lv: str) -> str:
        lv = str(lv or "").strip()
        if lv in ("상", "중상", "중", "하"):
            return lv
        return ""

    target = _canon_test_name(test_q)

    recs = []
    for sid, name, correct, total, wrong, created_at, memo, day in _iter_test_records(start, end):
        nm = _canon_test_name(name)
        if nm != target:
            continue

        pct = round((correct / total) * 100.0, 2)
        stu_name = sid_to_name.get(sid, sid)
        lv = norm_band(sid_to_level.get(sid, ""))

        if band_q and lv != band_q:
            continue

        recs.append({
            "sid": sid,
            "studentName": stu_name,
            "level": lv or "",
            "pct": pct,
            "correct": correct,
            "total": total,
            "createdAt": created_at,
            "memo": memo,
        })

    recs.sort(key=lambda r: r.get("createdAt", ""), reverse=True)

    return nocache_resp({
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "test": target,
        "total": len(recs),
        "records": recs,
    })

@bp_api_tests.get("/api/tests-stats")
def api_tests_stats():
    start_q = request.args.get("start")
    end_q   = request.args.get("end")
    recent  = request.args.get("recent_days")
    include_wrong = request.args.get("include_wrong", "0") in ("1", "true", "True")

    end = _parse_date(end_q) or dt.date.today()
    if recent:
        try:
            days = int(recent)
            start = end - dt.timedelta(days=days - 1)
        except Exception:
            start = _parse_date(start_q)
    else:
        start = _parse_date(start_q)

    if not start:
        start = end - dt.timedelta(days=29)

    def level_band(level: str) -> str:
        lv = str(level or "").strip()
        if lv in ("상", "중상", "중", "하"):
            return lv
        return "하"

    sid_band: dict[str, str] = {}
    students = load(STU_PATH)
    if isinstance(students, list):
        for s in students:
            sid = str(s.get("id") or "").strip()
            if not sid:
                continue
            sid_band[sid] = level_band(s.get("level", ""))

    def bucket(pct: float) -> str:
        if pct < 50: return "0-49"
        if pct < 60: return "50-59"
        if pct < 70: return "60-69"
        if pct < 80: return "70-79"
        if pct < 90: return "80-89"
        return "90-100"

    def make_agg() -> dict:
        return {
            "count": 0,
            "correct_list": [],
            "total_list": [],
            "pct_list": [],
            "pct_hist": {k: 0 for k in ["0-49","50-59","60-69","70-79","80-89","90-100"]},
        }

    agg: dict[str, dict] = {}
    wrong_freq: dict[str, dict[int, int]] = {}

    for sid, name, correct, total, wrong, created_at, memo, day in _iter_test_records(start, end):
        key_name = _canon_test_name(name)
        if not key_name:
            continue

        a = agg.setdefault(key_name, make_agg())
        a["count"] += 1
        a["correct_list"].append(correct)
        a["total_list"].append(total)

        pct = (correct / total) * 100.0
        a["pct_list"].append(pct)
        a["pct_hist"][bucket(pct)] += 1

        band = sid_band.get(str(sid))
        if band:
            bands_raw = a.setdefault("_bands_raw", {})
            ba = bands_raw.setdefault(band, make_agg())
            ba["count"] += 1
            ba["correct_list"].append(correct)
            ba["total_list"].append(total)
            ba["pct_list"].append(pct)
            ba["pct_hist"][bucket(pct)] += 1

        if include_wrong and isinstance(wrong, list):
            wf = wrong_freq.setdefault(key_name, {})
            for n in wrong:
                try:
                    k = int(n)
                except Exception:
                    continue
                wf[k] = wf.get(k, 0) + 1

    out: dict[str, dict] = {}
    for test_name, a in agg.items():
        pct_list = a["pct_list"]
        if not pct_list:
            continue

        pct_sorted = sorted(pct_list)
        p90_idx = max(0, int(len(pct_sorted) * 0.9) - 1)

        base = {
            "count": a["count"],
            "avg_pct": round(sum(pct_list) / len(pct_list), 2),
            "median_pct": round(median(pct_list), 2),
            "p90_pct": round(pct_sorted[p90_idx], 2),
            "min_pct": round(min(pct_list), 2),
            "max_pct": round(max(pct_list), 2),
            "avg_correct": round(sum(a["correct_list"]) / len(a["correct_list"]), 2),
            "avg_total": round(sum(a["total_list"]) / len(a["total_list"]), 2),
            "pct_hist": a["pct_hist"],
        }

        bands_out: dict[str, dict] = {}
        bands_raw = a.get("_bands_raw", {})
        for band_name in ("상", "중상", "중", "하"):
            ba = bands_raw.get(band_name)
            if not ba or not ba["pct_list"]:
                continue
            bp = ba["pct_list"]
            bp_sorted = sorted(bp)
            bp90_idx = max(0, int(len(bp_sorted) * 0.9) - 1)
            bands_out[band_name] = {
                "count": ba["count"],
                "avg_pct": round(sum(bp) / len(bp), 2),
                "median_pct": round(median(bp), 2),
                "p90_pct": round(bp_sorted[bp90_idx], 2),
                "min_pct": round(min(bp), 2),
                "max_pct": round(max(bp), 2),
                "avg_correct": round(sum(ba["correct_list"]) / len(ba["correct_list"]), 2),
                "avg_total": round(sum(ba["total_list"]) / len(ba["total_list"]), 2),
                "pct_hist": ba["pct_hist"],
            }

        if bands_out:
            base["bands"] = bands_out

        if include_wrong:
            wf = wrong_freq.get(test_name, {})
            base["wrong_freq"] = {str(k): wf[k] for k in sorted(wf.keys())}

        out[test_name] = base

    return nocache_resp({
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "updatedAt": utc_now_isoz(),
        "by_test": out
    })
