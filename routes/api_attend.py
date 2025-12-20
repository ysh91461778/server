from __future__ import annotations

import datetime as dt
from typing import List

from flask import Blueprint, abort, jsonify, request

from core.paths import STU_PATH, EXTRA_PATH
from core.storage import load
from core.absent import load_absent

bp_api_attend = Blueprint("api_attend", __name__)

@bp_api_attend.get("/api/today")
def api_today():
    today = dt.date.today()
    wchr = "월화수목금토일"[today.weekday()]
    students_arr: List[dict] = load(STU_PATH)

    regular = [
        s for s in students_arr
        if any(((s.get(d, "") or "").startswith(wchr) for d in ("day1", "day2", "day3")))
    ]
    extra_ids = load(EXTRA_PATH).get(today.isoformat(), [])
    extra_students = [s for s in students_arr if str(s.get("id")) in map(str, extra_ids)]

    all_today = {str(s["id"]): s for s in (regular + extra_students)}

    abs_all = load_absent()
    absent_ids = set(map(str, abs_all.get("by_date", {}).get(today.isoformat(), [])))
    for sid in list(all_today.keys()):
        if sid in absent_ids:
            del all_today[sid]

    return jsonify(list(all_today.values()))

@bp_api_attend.get("/api/attend")
def api_attend():
    date_str_full = request.args.get("date", dt.date.today().isoformat())
    date_str = date_str_full.split("T")[0]
    try:
        target = dt.date.fromisoformat(date_str)
    except ValueError:
        abort(400, description="Invalid date format")

    wchr = "월화수목금토일"[target.weekday()]
    students_arr: List[dict] = load(STU_PATH)

    regular = [
        s for s in students_arr
        if any(((s.get(d, "") or "").startswith(wchr) for d in ("day1", "day2", "day3")))
    ]
    extra_ids = load(EXTRA_PATH).get(target.isoformat(), [])
    extra_students = [s for s in students_arr if str(s.get("id")) in map(str, extra_ids)]

    all_today = {str(s["id"]): s for s in (regular + extra_students)}

    abs_all = load_absent()
    absent_ids = set(map(str, abs_all.get("by_date", {}).get(target.isoformat(), [])))
    for sid in list(all_today.keys()):
        if sid in absent_ids:
            del all_today[sid]

    return jsonify(list(all_today.values()))
