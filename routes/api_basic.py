from __future__ import annotations

import datetime as dt
import random
import re
import time
import os
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
# ✅ 프로세스 간 파일 락 (멀티워커/동시 저장 방어)
#  - lock 파일을 O_EXCL로 만들고, 해제 시 삭제
# ─────────────────────────────────────────────
class _InterProcessFileLock:
    def __init__(self, lock_path: str, timeout_sec: float = 4.0, poll_sec: float = 0.05):
        self.lock_path = lock_path
        self.timeout_sec = timeout_sec
        self.poll_sec = poll_sec
        self._fd = None

    def acquire(self):
        deadline = time.time() + self.timeout_sec
        while True:
            try:
                # O_EXCL: 이미 있으면 실패 → 누가 잡고 있는 중
                fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
                self._fd = fd
                # 디버그용 정보
                os.write(fd, f"pid={os.getpid()} time={time.time()}".encode("utf-8"))
                return
            except FileExistsError:
                if time.time() > deadline:
                    raise TimeoutError(f"lock timeout: {self.lock_path}")
                time.sleep(self.poll_sec)

    def release(self):
        try:
            if self._fd is not None:
                try:
                    os.close(self._fd)
                except Exception:
                    pass
            self._fd = None
            try:
                os.remove(self.lock_path)
            except FileNotFoundError:
                pass
        except Exception:
            pass

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *_):
        self.release()


def _logs_lock():
    lp = str(getattr(LOGS_PATH, "__fspath__", lambda: str(LOGS_PATH))())
    return _InterProcessFileLock(lp + ".lock", timeout_sec=6.0, poll_sec=0.05)


# ─────────────────────────────────────────────
# ✅ logs 안전 merge (날아감 방지)
# - PATCH가 기본
# - "빈 값"으로 기존 "유효 값" 덮는 거 금지
# - 대신 "__clear": ["notes", ...] 로 명시 삭제 지원
# ─────────────────────────────────────────────
def _is_empty_value(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    if isinstance(v, list) and len(v) == 0:
        return True
    if isinstance(v, dict) and len(v) == 0:
        return True
    return False


def _merge_entry_safe(cur: dict, inc: dict) -> dict:
    if not isinstance(cur, dict):
        cur = {}
    if not isinstance(inc, dict):
        return cur

    out = dict(cur)

    # ✅ 명시 삭제 키
    clear = inc.get("__clear")
    if isinstance(clear, list):
        for k in clear:
            kk = str(k).strip()
            if kk:
                out.pop(kk, None)

    for k, v in inc.items():
        if k == "__clear":
            continue

        # None은 "삭제"로 쓰지 말고 __clear로 처리(실수 방지)
        if v is None:
            continue

        # ✅ 스테일 전체 업로드/빈값 업로드가 기존값 덮는 거 방지
        if _is_empty_value(v) and not _is_empty_value(out.get(k)):
            continue

        out[k] = v

    return out


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


# ✅ 서버 날짜가 UTC로 돌아서 프론트(todayLocalKey)랑 하루 어긋나는 거 방지용
KST = dt.timezone(dt.timedelta(hours=9))


def _today_kst_iso() -> str:
    return dt.datetime.now(KST).date().isoformat()


def _ensure_today_auto_assign(updates, students, videos, progress):

    # ✅ 프론트(todayLocalKey)가 KST 기준이면 서버도 KST로 맞춰야 함
    today = _today_kst_iso()

    if not isinstance(updates, dict):
        updates = {}
    updates.setdefault(today, {})
    if not isinstance(updates[today], dict):
        updates[today] = {}

    # ✅ 현재 등록된 video mid 집합 (존재 검증)
    valid_mids = set()
    for v in (videos or []):
        if isinstance(v, dict):
            mid = str(v.get("mid") or "").strip()
            if mid:
                valid_mids.add(mid)

    last_status = _build_latest_status_by_sid(progress)

    def _normalize_assigned(val):
        """
        updates[today][sid] 에 들어있는 값 정규화:
          - list[str] 형태로 통일
          - dict(구형) 이면 videos 키 뽑기
        """
        if isinstance(val, list):
            arr = [str(x).strip() for x in val if str(x).strip()]
            return arr
        if isinstance(val, dict):
            vids = val.get("videos")
            if isinstance(vids, list):
                arr = [str(x).strip() for x in vids if str(x).strip()]
                return arr
        return []

    changed = False

    # ✅ 1) 이미 들어있는 오늘 배정부터 "유효 mid만" 남기기 (이게 재발 방지 핵심)
    for sid, cur in list(updates[today].items()):
        assigned = _normalize_assigned(cur)
        if not assigned:
            continue

        # 존재하는 mid만 남김
        cleaned = [mid for mid in assigned if mid in valid_mids]
        if cleaned != assigned:
            if cleaned:
                updates[today][sid] = cleaned
            else:
                # 다 날아가면 배정 자체 제거(아래 자동배정이 다시 채울 수 있음)
                updates[today].pop(sid, None)
            changed = True

    # ✅ 2) 이제 자동배정(배정 없을 때만)
    for stu in students or []:
        if not isinstance(stu, dict):
            continue

        sid = str(stu.get("id") or "").strip()
        if not sid:
            continue

        cur_key = (stu.get("curriculum") or "").strip()
        sub_key = (stu.get("subCurriculum") or "").strip()

        # 이미 오늘 배정 있으면 스킵
        cur = updates[today].get(sid)
        if _has_assigned(cur):
            continue

        # 현재 커리/서브커리의 영상만 모으기
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

        # 자동배정 개수
        sub_norm = sub_key.strip().lower()
        if sub_norm == "A:ble":
            max_assign = 1
        elif sub_norm == "APEX":
            max_assign = 2
        else:
            max_assign = 2

        picked = []
        for v in cur_vids:
            mid = str(v.get("mid") or "").strip()
            if not mid:
                continue
            # ✅ 등록된 mid만 (이중 안전)
            if mid not in valid_mids:
                continue
            if mid in blocked:
                continue
            picked.append(mid)
            if len(picked) >= max_assign:
                break

        if picked:
            print("[AUTOASSIGN] PICK sid =", sid, "picked =", picked, flush=True)
            updates[today][sid] = picked
            changed = True

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


# ─────────────────────────────────────────────
# ✅ LOGS (GET=전체 조회)
# ✅ POST /api/logs/patch = 부분 저장(권장)
# ✅ POST /api/logs        = 레거시(가능하면 안 쓰기)
# ─────────────────────────────────────────────
@bp_api_basic.route("/api/logs", methods=["GET", "POST"])
def api_logs():
    if request.method == "GET":
        return nocache_resp(load(LOGS_PATH))

    # 레거시 전체 업로드: 그래도 "안전 merge" + 락은 적용
    incoming = request.get_json(force=True) or {}
    with _logs_lock():
        current = load(LOGS_PATH) or {}

        if not isinstance(incoming, dict):
            incoming = {}

        for date, by_sid in incoming.items():
            if not isinstance(by_sid, dict):
                continue
            cur_day = current.setdefault(date, {})
            if not isinstance(cur_day, dict):
                current[date] = {}
                cur_day = current[date]

            for sid, entry in by_sid.items():
                if not isinstance(entry, dict):
                    continue
                cur_entry = cur_day.get(sid, {})
                cur_day[str(sid)] = _merge_entry_safe(cur_entry, entry)

        save_atomic(LOGS_PATH, current)

    return "", 204


@bp_api_basic.post("/api/logs/patch")
def api_logs_patch():
    """
    ✅ 부분 저장(완벽 버전)
    body:
      {
        "date": "YYYY-MM-DD",
        "sid": "전강우334",
        "entry": { ...부분필드... },
        "__clear": ["notes", ...]  # (옵션) 명시 삭제
      }
    - entry 안에 "__clear" 넣어도 되고, 최상단 "__clear"도 지원
    """
    body = request.get_json(force=True) or {}
    date = str(body.get("date") or "").strip()
    sid = str(body.get("sid") or "").strip()
    entry = body.get("entry") or {}

    top_clear = body.get("__clear")
    if isinstance(top_clear, list) and isinstance(entry, dict):
        entry = dict(entry)
        entry["__clear"] = top_clear

    if not date or not sid or not isinstance(entry, dict):
        return jsonify({"ok": False, "error": "bad payload"}), 400
    if not DATE_RE.match(date):
        return jsonify({"ok": False, "error": "bad date"}), 400

    with _logs_lock():
        current = load(LOGS_PATH) or {}
        day = current.setdefault(date, {})
        if not isinstance(day, dict):
            current[date] = {}
            day = current[date]

        cur_entry = day.get(sid, {})
        day[sid] = _merge_entry_safe(cur_entry, entry)
        save_atomic(LOGS_PATH, current)

    return jsonify({"ok": True})


# 결석(통합)


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
