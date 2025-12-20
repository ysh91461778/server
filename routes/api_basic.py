from __future__ import annotations

import datetime as dt
import random
import re
from typing import List

from flask import Blueprint, abort, jsonify, request

from core.paths import (
    STU_PATH, VID_PATH, PRG_PATH, UPD_PATH, ASN_PATH, MAT_PATH, CAL_PATH,
    EXTRA_PATH, LOGS_PATH, CLINIC_PATH, TODAY_ORDER_PATH, WEEKEND_SLOTS_PATH
)
from core.storage import load, save_atomic, nocache_resp
from core.absent import load_absent, save_absent, DATE_RE

bp_api_basic = Blueprint("api_basic", __name__)


# ─────────────────────────────────────────────
# 공통 CRUD
# ─────────────────────────────────────────────
def crud(path):
    if request.method == "GET":
        return jsonify(load(path))
    obj = request.get_json(force=True)
    save_atomic(path, obj)
    return "", 204


# ─────────────────────────────────────────────
# updates 자동배정 보정 (핵심)
# ─────────────────────────────────────────────
def _chap_num(v: dict) -> float:
    c = v.get("chapter", 0)
    try:
        return float(c)
    except Exception:
        s = re.sub(r"[^0-9.]", "", str(c))
        return float(s) if s else 0.0


def _has_assigned(val) -> bool:
    if isinstance(val, list):
        return len(val) > 0
    if isinstance(val, dict):
        vids = val.get("videos")
        return isinstance(vids, list) and len(vids) > 0
    return False


def _build_latest_status_by_sid(progress: dict) -> dict:
    """
    progress: {date: {sid: {mid: state}}}
    return: {sid: {mid: state}} 최신 상태
    """
    out = {}
    if not isinstance(progress, dict):
        return out

    for d in sorted(progress.keys()):
        day = progress.get(d) or {}
        if not isinstance(day, dict):
            continue
        for sid, mids in day.items():
            if not isinstance(mids, dict):
                continue
            sm = out.setdefault(str(sid), {})
            for mid, st in mids.items():
                sm[str(mid)] = st
    return out


def _ensure_today_auto_assign(updates, students, videos, progress):
    today = dt.date.today().isoformat()

    if not isinstance(updates, dict):
        updates = {}
    updates.setdefault(today, {})
    if not isinstance(updates[today], dict):
        updates[today] = {}

    last_status = _build_latest_status_by_sid(progress)

    for stu in students or []:
        if not isinstance(stu, dict):
            continue

        sid = str(stu.get("id") or "")
        if not sid:
            continue

        # 이미 오늘 배정 있으면 절대 건드리지 않음
        cur = updates[today].get(sid)
        if _has_assigned(cur):
            continue

        cur_key = (stu.get("curriculum") or "").strip()
        sub_key = (stu.get("subCurriculum") or "").strip()

        cur_vids = [
            v for v in (videos or [])
            if isinstance(v, dict)
            and (v.get("curriculum") or "").strip() == cur_key
            and (v.get("subCurriculum") or "").strip() == sub_key
        ]
        cur_vids.sort(key=lambda v: (_chap_num(v), str(v.get("mid") or "")))

        blocked = {
            str(mid)
            for mid, st in (last_status.get(sid) or {}).items()
            if st in ("done", "skip")
        }

        max_assign = 3 if sub_key == "APEX" else 2
        picked = []

        for v in cur_vids:
            mid = str(v.get("mid") or "")
            if not mid or mid in blocked:
                continue
            picked.append(mid)
            if len(picked) >= max_assign:
                break

        if picked:
            updates[today][sid] = picked

    return updates


# ─────────────────────────────────────────────
# 기본 API
# ─────────────────────────────────────────────
@bp_api_basic.route("/api/students", methods=["GET", "POST"])
def api_students():
    return crud(STU_PATH)


@bp_api_basic.route("/api/videos", methods=["GET", "POST"])
def api_videos():
    return crud(VID_PATH)


@bp_api_basic.route("/api/progress", methods=["GET", "POST"])
def api_progress():
    return crud(PRG_PATH)


@bp_api_basic.route("/api/updates", methods=["GET", "POST"])
def api_updates():
    if request.method == "GET":
        updates = load(UPD_PATH)
        fixed = _ensure_today_auto_assign(
            updates,
            load(STU_PATH),
            load(VID_PATH),
            load(PRG_PATH)
        )
        if fixed != updates:
            save_atomic(UPD_PATH, fixed)
        return nocache_resp(fixed)

    save_atomic(UPD_PATH, request.get_json(force=True))
    return "", 204


@bp_api_basic.route("/api/mat-assign", methods=["GET", "POST"])
def api_mat_assign():
    return crud(ASN_PATH)


@bp_api_basic.route("/api/materials", methods=["GET", "POST"])
def api_materials():
    if request.method == "GET":
        return jsonify(load(MAT_PATH))
    save_atomic(MAT_PATH, request.get_json(force=True))
    return "", 204


@bp_api_basic.route("/api/school-calendar", methods=["GET", "POST"])
def api_school_calendar():
    if request.method == "GET":
        return jsonify(load(CAL_PATH))
    data = request.get_json(force=True) or {}
    save_atomic(CAL_PATH, data)
    return jsonify(data)


@bp_api_basic.post("/api/add-student")
def api_add_student():
    students: List[dict] = load(STU_PATH)
    data = request.get_json(force=True) or {}
    raw_name = str(data.get("name", "user"))
    name_slug = re.sub(r"[^0-9A-Za-z가-힣]", "", raw_name)
    data["id"] = f"{name_slug}{random.randint(0, 999):03d}"
    students.append(data)
    save_atomic(STU_PATH, students)
    return jsonify({"id": data["id"]})


@bp_api_basic.post("/api/feedback")
def api_feedback():
    import json
    from core.paths import BASE
    data = request.get_json(force=True) or {}
    with open(BASE / "feedbacks.json", "a", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        f.write("\n")
    return "", 204


@bp_api_basic.route("/api/extra-attend", methods=["GET", "POST"])
def api_extra_attend():
    return crud(EXTRA_PATH)


@bp_api_basic.route("/api/weekend-slots", methods=["GET", "POST"])
def api_weekend_slots():
    if request.method == "GET":
        return jsonify(load(WEEKEND_SLOTS_PATH))
    body = request.get_json(force=True) or {}
    cur = load(WEEKEND_SLOTS_PATH)
    for date, mapping in (body.items() if isinstance(body, dict) else []):
        if not isinstance(mapping, dict):
            continue

        def norm(v):
            if isinstance(v, list):
                return [int(x) for x in v if str(x).isdigit()]
            if str(v).isdigit():
                return int(v)
            return v

        cur.setdefault(date, {}).update({str(k): norm(v) for k, v in mapping.items()})
    save_atomic(WEEKEND_SLOTS_PATH, cur)
    return "", 204


@bp_api_basic.route("/api/logs", methods=["GET", "POST"])
def api_logs():
    if request.method == "GET":
        return nocache_resp(load(LOGS_PATH))

    incoming = request.get_json(force=True) or {}
    current = load(LOGS_PATH) or {}

    for date, by_sid in incoming.items():
        if not isinstance(by_sid, dict):
            continue
        cur_day = current.setdefault(date, {})
        for sid, entry in by_sid.items():
            if not isinstance(entry, dict):
                continue
            cur_entry = cur_day.get(sid, {})
            merged = {**cur_entry, **entry}
            cur_day[sid] = merged

    save_atomic(LOGS_PATH, current)
    return "", 204


# 결석(통합)
@bp_api_basic.route("/api/absent", methods=["GET", "POST"])
def api_absent():
    if request.method == "GET":
        return jsonify(load_absent())

    payload = request.get_json(force=True) or {}
    cur = load_absent()
    cur.setdefault("by_date", {})
    cur.setdefault("by_student", {})

    if not isinstance(payload, dict):
        save_absent(cur)
        return "", 204

    changed = False

    # helper: 날짜별 sid 리스트 merge
    def merge_by_date(date_str: str, sids):
        nonlocal changed
        if not DATE_RE.match(date_str):
            return
        if not isinstance(sids, list):
            return
        base = set(map(str, cur["by_date"].get(date_str, [])))
        before = set(base)
        for x in sids:
            sx = str(x).strip()
            if sx:
                base.add(sx)
        if base != before:
            cur["by_date"][date_str] = sorted(base)
            changed = True

    # helper: 학생별 date set
    def set_by_student(sid, date_str: str):
        nonlocal changed
        sid = str(sid).strip()
        if not sid:
            return
        if not (isinstance(date_str, str) and DATE_RE.match(date_str)):
            return
        if cur["by_student"].get(sid) != date_str:
            cur["by_student"][sid] = date_str
            changed = True

    # 1) 표준 payload: {"by_date": {...}, "by_student": {...}}
    if isinstance(payload.get("by_date"), dict):
        for d, sids in payload["by_date"].items():
            merge_by_date(str(d), sids)

    if isinstance(payload.get("by_student"), dict):
        for sid, d in payload["by_student"].items():
            set_by_student(sid, d)

    # 2) 날짜 키 직접 payload: {"YYYY-MM-DD":[sid,...], ...}
    for k, v in payload.items():
        ks = str(k)
        if DATE_RE.match(ks) and isinstance(v, list):
            merge_by_date(ks, v)

    # 3) 학생->날짜 단일 매핑 payload: {"sid":"YYYY-MM-DD", ...}
    for k, v in payload.items():
        if isinstance(v, str) and DATE_RE.match(v):
            set_by_student(k, v)

    # ✅ 무조건 저장 (changed 없어도 일관성 유지)
    save_absent(cur)
    return "", 204



@bp_api_basic.delete("/api/students/<string:sid>")
def api_delete_student(sid: str):
    students: List[dict] = load(STU_PATH)
    for i, s in enumerate(students):
        if str(s.get("id")) == str(sid):
            del students[i]
            save_atomic(STU_PATH, students)
            return "", 204
    abort(404, description="학생을 찾을 수 없습니다.")


@bp_api_basic.post("/api/update")
def api_update_student_field():
    body = request.get_json(force=True) or {}
    sid = body.get("id")
    field = body.get("field")
    value = body.get("value")

    if not sid or not field:
        abort(400)

    students: List[dict] = load(STU_PATH)
    for s in students:
        if str(s.get("id")) == str(sid):
            s[field] = value
            save_atomic(STU_PATH, students)
            return "OK"
    abort(404)


@bp_api_basic.get("/api/ping")
def api_ping():
    return "ok"
