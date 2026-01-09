# /api/api_attend.py
from __future__ import annotations

import datetime as dt
import json
from typing import Dict, List, Any

from flask import Blueprint, abort, jsonify, request

from core.paths import STU_PATH, EXTRA_PATH, ATTENDANCE_PATH
from core.storage import load
from core.absent import load_absent, save_absent

bp_api_attend = Blueprint("api_attend", __name__)


# ──────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────
def _date_key_from_query(default: dt.date | None = None) -> str:
    if default is None:
        default = dt.date.today()
    date_str_full = request.args.get("date", default.isoformat())
    date_str = (date_str_full or default.isoformat()).split("T")[0]
    try:
        dt.date.fromisoformat(date_str)
    except ValueError:
        abort(400, description="Invalid date format")
    return date_str


def _load_attendance_all() -> Dict[str, Dict[str, int]]:
    """
    attendance.json schema:
      {
        "YYYY-MM-DD": { "sid": 1, ... }
      }
    """
    try:
        data = load(ATTENDANCE_PATH)
        if isinstance(data, dict):
            out: Dict[str, Dict[str, int]] = {}
            for dk, mp in data.items():
                if isinstance(dk, str) and isinstance(mp, dict):
                    out[dk] = {str(sid): 1 for sid in mp.keys()}
            return out
    except Exception:
        pass
    return {}


def _save_attendance_all(data: Dict[str, Dict[str, int]]) -> None:
    try:
        ATTENDANCE_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            "utf-8"
        )
    except Exception as e:
        abort(500, description=f"Failed to save attendance: {e}")


# ──────────────────────────────────────────────
# 오늘 학생 / 특정 날짜 학생
# ──────────────────────────────────────────────
@bp_api_attend.get("/api/today")
def api_today():
    today = dt.date.today()
    wchr = "월화수목금토일"[today.weekday()]
    students_arr: List[dict] = load(STU_PATH)

    # 정규 수업
    regular = [
        s for s in students_arr
        if any(((s.get(d, "") or "").startswith(wchr) for d in ("day1", "day2", "day3")))
    ]

    # 보강
    extra_ids = load(EXTRA_PATH).get(today.isoformat(), [])
    extra_students = [
        s for s in students_arr
        if str(s.get("id")) in map(str, extra_ids)
    ]

    all_today = {str(s["id"]): s for s in (regular + extra_students)}

    # 결석 제거
    abs_all = load_absent()
    absent_ids = set(map(str, abs_all.get("by_date", {}).get(today.isoformat(), [])))
    for sid in list(all_today.keys()):
        if sid in absent_ids:
            del all_today[sid]

    return jsonify(list(all_today.values()))


@bp_api_attend.get("/api/attend")
def api_attend():
    date_str = _date_key_from_query()
    target = dt.date.fromisoformat(date_str)
    wchr = "월화수목금토일"[target.weekday()]

    students_arr: List[dict] = load(STU_PATH)

    regular = [
        s for s in students_arr
        if any(((s.get(d, "") or "").startswith(wchr) for d in ("day1", "day2", "day3")))
    ]

    extra_ids = load(EXTRA_PATH).get(target.isoformat(), [])
    extra_students = [
        s for s in students_arr
        if str(s.get("id")) in map(str, extra_ids)
    ]

    all_today = {str(s["id"]): s for s in (regular + extra_students)}

    abs_all = load_absent()
    absent_ids = set(map(str, abs_all.get("by_date", {}).get(target.isoformat(), [])))
    for sid in list(all_today.keys()):
        if sid in absent_ids:
            del all_today[sid]

    return jsonify(list(all_today.values()))


# ──────────────────────────────────────────────
# ✅ 결석(absent) — overwrite 전용 (핵심)
# ──────────────────────────────────────────────
@bp_api_attend.get("/api/absent")
def api_absent_get():
    """
    GET /api/absent
    -> { by_date: {...}, by_student: {...} }
    """
    return jsonify(load_absent())


@bp_api_attend.post("/api/absent")
def api_absent_post():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        abort(400, description="Invalid JSON body")

    save_absent(payload)
    return jsonify(load_absent())


# ──────────────────────────────────────────────
# 출석(attendance.json) — 기기간 공유
# ──────────────────────────────────────────────
@bp_api_attend.get("/api/attendance")
def api_attendance_get():
    """
    GET /api/attendance?date=YYYY-MM-DD
    -> { "sid": 1, ... }
    """
    date_key = _date_key_from_query()
    all_map = _load_attendance_all()
    return jsonify(all_map.get(date_key, {}))


@bp_api_attend.post("/api/attendance")
def api_attendance_post():
    """
    POST 지원:
      1) { "YYYY-MM-DD": { "sid": 1 } }
      2) { "date": "YYYY-MM-DD", "map": { "sid": 1 } }

    ❗ 해당 날짜만 overwrite
    """
    payload: Any = request.get_json(silent=True)
    if not isinstance(payload, dict):
        abort(400, description="Invalid JSON body")

    if "date" in payload and "map" in payload:
        date_key = str(payload.get("date") or "").split("T")[0]
        day_map = payload.get("map")
    else:
        if len(payload) != 1:
            abort(400, description="Body must contain exactly one date key")
        date_key = str(next(iter(payload.keys()))).split("T")[0]
        day_map = payload.get(date_key)

    try:
        dt.date.fromisoformat(date_key)
    except Exception:
        abort(400, description="Invalid date format")

    if not isinstance(day_map, dict):
        abort(400, description="Attendance map must be an object")

    normalized = {str(sid): 1 for sid in day_map.keys() if str(sid).strip()}

    all_map = _load_attendance_all()
    all_map[date_key] = normalized
    _save_attendance_all(all_map)

    return jsonify({"ok": True, "date": date_key, "count": len(normalized)})
