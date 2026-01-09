# routes/api_auth.py — 학생 로그인/자동로그인/아이디·비번 변경 + (계정ID -> 여러 SID 지원)
from __future__ import annotations

import os
import json
import time
import pathlib
from functools import wraps
from typing import Any, List, Optional

import jwt
from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

bp_api_auth = Blueprint("api_auth", __name__, url_prefix="/api/auth")

BASE = pathlib.Path(__file__).resolve().parents[1]  # project root (routes/..)
STU_PATH = BASE / "students.json"

# ✅ 계정 맵 (로그인ID -> pw_hash + sids[])
ACCT_PATH = BASE / "auth_accounts.json"

AUTH_SECRET = os.environ.get("AUTH_SECRET", "CHANGE_ME_AUTH_SECRET")
TOKEN_EXPIRE_SEC = 60 * 60 * 24 * 30  # 30일


def _load_json(path: pathlib.Path, default: Any):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def _save_json_atomic(path: pathlib.Path, obj: Any):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), "utf-8")
    os.replace(tmp, path)


def _json_or_form() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    if request.form:
        for k in request.form:
            data[k] = request.form.get(k)
    return data


def _students_list() -> List[dict]:
    arr = _load_json(STU_PATH, [])
    return arr if isinstance(arr, list) else []


def _find_student_by_sid(sid: str) -> Optional[dict]:
    sid = str(sid or "").strip()
    if not sid:
        return None
    for s in _students_list():
        if str(s.get("id", "")).strip() == sid:
            return s
    return None


def _student_exists(sid: str) -> bool:
    return _find_student_by_sid(sid) is not None


def _find_students_by_name(name: str) -> List[dict]:
    name = str(name or "").strip()
    if not name:
        return []
    out = []
    for s in _students_list():
        if str(s.get("name") or "").strip() == name:
            out.append(s)
    return out


def _load_acct_map() -> dict:
    """
    auth_accounts.json:
    {
      "전강우": {"pw_hash":"...", "sids":["전강우334","전강우282"]},
      ...
    }
    """
    m = _load_json(ACCT_PATH, {})
    return m if isinstance(m, dict) else {}


def _save_acct_map(m: dict) -> None:
    _save_json_atomic(ACCT_PATH, m)


def _normalize_id(x: str) -> str:
    return str(x or "").strip()


def _dedup_key_for_student(s: dict) -> str:
    # ✅ 같은 사람 묶기 기준: name + school + grade(있으면)
    name = str(s.get("name") or "").strip()
    school = str(s.get("school") or "").strip()
    grade = str(s.get("grade") or "").strip()
    return f"{name}||{school}||{grade}"


def _group_sids_for_same_person(base_sid: str) -> List[str]:
    """
    base_sid(예: 전강우334) 를 기준으로 같은 사람의 모든 SID를 찾는다.
    """
    base = _find_student_by_sid(base_sid)
    if not base:
        return []
    key = _dedup_key_for_student(base)
    out: List[str] = []
    for s in _students_list():
        if _dedup_key_for_student(s) == key:
            sid = str(s.get("id") or "").strip()
            if sid:
                out.append(sid)
    return sorted(set(out))


def _curris_payload_from_sids(sids: List[str]) -> List[dict]:
    """
    [{cur:"공수2", sid:"전강우334"}, ...]
    """
    out = []
    for sid in sids:
        st = _find_student_by_sid(sid)
        if not st:
            continue
        cur = str(st.get("curriculum") or "").strip()
        if not cur:
            continue
        out.append({"cur": cur, "sid": sid})
    out.sort(key=lambda x: (x.get("cur") or "", x.get("sid") or ""))
    return out


def _issue_token(sid: str, aid: str, sids: List[str]) -> str:
    now = int(time.time())
    payload = {
        "sid": sid,      # ✅ 현재 선택된 학생 SID
        "aid": aid,      # ✅ 계정 ID(로그인 아이디)
        "sids": sids,    # ✅ 접근 가능한 SID 목록
        "iat": now,
        "exp": now + TOKEN_EXPIRE_SEC,
    }
    return jwt.encode(payload, AUTH_SECRET, algorithm="HS256")


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
    except Exception:
        return None


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = ""
        if auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1].strip()
        if not token:
            return jsonify({"ok": False, "error": "missing token"}), 401

        payload = _decode_token(token)
        if not payload or not payload.get("sid"):
            return jsonify({"ok": False, "error": "bad token"}), 401

        request._sid = str(payload.get("sid") or "")
        request._aid = str(payload.get("aid") or "")
        request._sids = payload.get("sids") if isinstance(payload.get("sids"), list) else []

        return f(*args, **kwargs)
    return wrapper


def _ensure_account(aid: str, *, base_sid_for_link: Optional[str] = None) -> None:
    """
    auth_accounts.json에 aid가 없으면 만든다.
    - base_sid_for_link 가 있으면 그 SID 기준으로 같은 사람의 sids를 묶어 생성
    - 기본 비번은 1234
    """
    aid = _normalize_id(aid)
    if not aid:
        return

    m = _load_acct_map()
    if aid in m:
        if not isinstance(m[aid].get("sids"), list):
            m[aid]["sids"] = []
            _save_acct_map(m)
        return

    sids: List[str] = []
    if base_sid_for_link:
        sids = _group_sids_for_same_person(base_sid_for_link)

    m[aid] = {
        "pw_hash": generate_password_hash("1234"),
        "sids": sids,
    }
    _save_acct_map(m)


def _find_account_by_sid(m: dict, sid: str) -> Optional[str]:
    sid = str(sid or "").strip()
    if not sid:
        return None
    for aid, ent in (m or {}).items():
        sids = ent.get("sids")
        if isinstance(sids, list) and sid in sids:
            return aid
    return None


def _prune_duplicate_accounts(m: dict, keep_aid: str, sids: List[str]) -> None:
    """
    같은 sids를 가진 중복 계정(레거시 잔재 포함)을 삭제한다.
    keep_aid만 남김.
    """
    keep_aid = str(keep_aid or "").strip()
    keep_set = set(str(x).strip() for x in (sids or []) if str(x).strip())

    dead = []
    for aid, ent in (m or {}).items():
        if aid == keep_aid:
            continue
        their = ent.get("sids")
        if not isinstance(their, list):
            continue
        their_set = set(str(x).strip() for x in their if str(x).strip())
        if their_set and their_set == keep_set:
            dead.append(aid)

    for aid in dead:
        m.pop(aid, None)


@bp_api_auth.post("/login")
def login():
    """
    ✅ '무조건 통과' 모드:
    - ambiguous name(409) 절대 내보내지 않음
    - 이름으로 들어오면: 같은 이름이 여러 그룹이어도 그냥 "첫 그룹"으로 묶어서 계정 생성/로그인
    - base_sid가 이미 다른 계정에 묶여있어도: 그 계정으로 로그인 시도(비번 검사) 후 통과
    """
    data = _json_or_form()
    login_id = _normalize_id(data.get("id") or data.get("sid") or "")
    pw = _normalize_id(data.get("password") or data.get("pw") or "")

    if not login_id or not pw:
        return jsonify({"ok": False, "error": "missing id/password"}), 400

    m = _load_acct_map()

    # 1) ✅ 계정ID로 로그인
    if login_id in m:
        pw_hash = (m.get(login_id) or {}).get("pw_hash", "")
        if not pw_hash or not check_password_hash(pw_hash, pw):
            return jsonify({"ok": False, "error": "bad password"}), 401

        sids = (m.get(login_id) or {}).get("sids") or []
        if not isinstance(sids, list):
            sids = []

        sids = [sid for sid in sids if _student_exists(sid)]
        if not sids:
            return jsonify({"ok": False, "error": "no linked sids"}), 409

        sid = sids[0]
        token = _issue_token(sid=sid, aid=login_id, sids=sids)
        return jsonify({
            "ok": True,
            "sid": sid,
            "aid": login_id,
            "token": token,
            "curris": _curris_payload_from_sids(sids),
        })

    # 2) ✅ "이름"으로 첫 로그인 지원 (무조건 통과)
    same = _find_students_by_name(login_id)
    if not same:
        return jsonify({"ok": False, "error": "unknown id"}), 401

    # ✅ 예전: groups >=2면 ambiguous name(409)
    # ✅ 지금: 그룹이 여러 개여도 그냥 "첫 그룹"을 선택해서 통과
    groups = {}
    for s in same:
        k = _dedup_key_for_student(s)
        groups.setdefault(k, []).append(s)

    # 결정: key 정렬 후 첫 그룹 (재현 가능)
    keys = sorted(list(groups.keys()))
    only_group = groups[keys[0]] if keys else same

    base_sid = str((only_group[0] or {}).get("id") or "").strip()
    if not base_sid or not _student_exists(base_sid):
        return jsonify({"ok": False, "error": "unknown id"}), 401

    # ✅ base_sid가 이미 다른 계정에 묶여있으면: 그 계정으로 로그인 시도(무조건 통과에 가장 가까움)
    already = _find_account_by_sid(m, base_sid)
    if already and already in m:
        pw_hash = (m.get(already) or {}).get("pw_hash", "")
        if not pw_hash or not check_password_hash(pw_hash, pw):
            # 그래도 비번은 틀리면 막아야 함(진짜 보안선)
            return jsonify({"ok": False, "error": "bad password"}), 401

        sids = (m.get(already) or {}).get("sids") or []
        if not isinstance(sids, list):
            sids = []
        sids = [sid for sid in sids if _student_exists(sid)]
        if not sids:
            # 혹시라도 비면 dedup으로 다시 구성
            sids = _group_sids_for_same_person(base_sid)

        sid = base_sid if base_sid in sids else (sids[0] if sids else base_sid)
        token = _issue_token(sid=sid, aid=already, sids=sids)
        return jsonify({
            "ok": True,
            "sid": sid,
            "aid": already,
            "token": token,
            "curris": _curris_payload_from_sids(sids),
        })

    # ✅ 계정ID는 "입력한 이름" 그대로 생성
    _ensure_account(login_id, base_sid_for_link=base_sid)
    m = _load_acct_map()

    pw_hash = (m.get(login_id) or {}).get("pw_hash", "")
    if not pw_hash or not check_password_hash(pw_hash, pw):
        return jsonify({"ok": False, "error": "bad password"}), 401

    sids = (m.get(login_id) or {}).get("sids") or []
    if not isinstance(sids, list):
        sids = []
    sids = [sid for sid in sids if _student_exists(sid)]
    if not sids:
        # 혹시라도 비면 dedup으로 다시 구성
        sids = _group_sids_for_same_person(base_sid)

    sid = base_sid if base_sid in sids else (sids[0] if sids else base_sid)

    _prune_duplicate_accounts(m, keep_aid=login_id, sids=sids)
    _save_acct_map(m)

    token = _issue_token(sid=sid, aid=login_id, sids=sids)
    return jsonify({
        "ok": True,
        "sid": sid,
        "aid": login_id,
        "token": token,
        "curris": _curris_payload_from_sids(sids),
    })


@bp_api_auth.get("/me")
@require_auth
def me():
    sid = getattr(request, "_sid", "")
    aid = getattr(request, "_aid", "")
    sids = getattr(request, "_sids", [])

    if not _student_exists(sid):
        return jsonify({"ok": False, "error": "unknown sid"}), 401

    if not isinstance(sids, list) or not sids:
        sids = [sid]

    sids = [x for x in sids if _student_exists(x)]
    if sid not in sids:
        sids = [sid] + sids

    return jsonify({
        "ok": True,
        "sid": sid,
        "aid": aid or sid,
        "curris": _curris_payload_from_sids(sids),
    })


@bp_api_auth.post("/switch")
@require_auth
def switch():
    """
    ✅ 계정 토큰으로, 다른 SID(다른 커리)로 토큰을 바꿔준다.
    body: { "sid": "전강우282" }
    """
    data = _json_or_form()
    target = _normalize_id(data.get("sid") or data.get("targetSid") or "")
    if not target:
        return jsonify({"ok": False, "error": "missing sid"}), 400

    cur_sid = getattr(request, "_sid", "")
    aid = getattr(request, "_aid", "") or cur_sid
    sids = getattr(request, "_sids", []) or [cur_sid]

    if target not in sids:
        return jsonify({"ok": False, "error": "forbidden sid"}), 403
    if not _student_exists(target):
        return jsonify({"ok": False, "error": "unknown sid"}), 404

    token = _issue_token(sid=target, aid=aid, sids=sids)
    return jsonify({"ok": True, "sid": target, "aid": aid, "token": token})


@bp_api_auth.post("/change")
@require_auth
def change():
    """
    ✅ newId는 "계정 로그인ID 변경"으로 동작.
    - 학생 데이터(students.json, progress/logs/...)는 건드리지 않는다.
    - ✅ 같은 sids 가진 중복 계정은 자동 삭제(prune)
    """
    sid = getattr(request, "_sid", "")
    aid = getattr(request, "_aid", "") or sid
    sids = getattr(request, "_sids", []) or [sid]

    data = _json_or_form()

    cur_pw = _normalize_id(data.get("curPw") or data.get("cur_pw") or "")
    new_id = _normalize_id(data.get("newId") or data.get("new_id") or "")
    new_pw = _normalize_id(data.get("newPw") or data.get("new_pw") or "")

    if not cur_pw:
        return jsonify({"ok": False, "error": "missing curPw"}), 400

    m = _load_acct_map()
    if aid not in m:
        # 보통은 없어야 함. 그래도 복구
        _ensure_account(aid, base_sid_for_link=sid)
        m = _load_acct_map()

    cur_hash = (m.get(aid) or {}).get("pw_hash", "")
    if not cur_hash or not check_password_hash(cur_hash, cur_pw):
        return jsonify({"ok": False, "error": "bad password"}), 401

    # 계정 아이디 변경
    if new_id and new_id != aid:
        if new_id in m:
            return jsonify({"ok": False, "error": "id taken"}), 409
        m[new_id] = m.pop(aid)
        aid = new_id

    # 비번 변경
    if new_pw:
        m.setdefault(aid, {})
        m[aid]["pw_hash"] = generate_password_hash(new_pw)

    # sids 보정
    if not isinstance(m.get(aid, {}).get("sids"), list) or not m[aid]["sids"]:
        m[aid]["sids"] = [x for x in sids if _student_exists(x)]
        if sid not in m[aid]["sids"]:
            m[aid]["sids"].insert(0, sid)

    _prune_duplicate_accounts(m, keep_aid=aid, sids=m[aid]["sids"])
    _save_acct_map(m)

    token = _issue_token(sid=sid, aid=aid, sids=m[aid]["sids"])
    return jsonify({"ok": True, "sid": sid, "aid": aid, "token": token})
