# routes/api_auth.py — 학생 로그인/자동로그인/아이디·비번 변경
from __future__ import annotations

import os
import json
import time
import pathlib
from functools import wraps
from typing import Any

import jwt
from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

bp_api_auth = Blueprint("api_auth", __name__, url_prefix="/api/auth")

BASE = pathlib.Path(__file__).resolve().parents[1]  # project root (routes/..)
STU_PATH = BASE / "students.json"
AUTH_PATH = BASE / "auth_students.json"

# 네 프로젝트에 맞게 환경변수로 빼도 됨
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
    # 혹시 form으로 와도 처리
    if request.form:
        for k in request.form:
            data[k] = request.form.get(k)
    return data

def _students_list() -> list[dict]:
    arr = _load_json(STU_PATH, [])
    return arr if isinstance(arr, list) else []

def _student_exists(sid: str) -> bool:
    sid = str(sid or "").strip()
    if not sid:
        return False
    for s in _students_list():
        if str(s.get("id", "")).strip() == sid:
            return True
    return False

def _load_auth_map() -> dict:
    # {sid: {"pw_hash": "..."}}
    m = _load_json(AUTH_PATH, {})
    return m if isinstance(m, dict) else {}

def _save_auth_map(m: dict) -> None:
    _save_json_atomic(AUTH_PATH, m)

def _issue_token(sid: str) -> str:
    now = int(time.time())
    payload = {"sid": sid, "iat": now, "exp": now + TOKEN_EXPIRE_SEC}
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
        request._sid = str(payload["sid"])
        return f(*args, **kwargs)
    return wrapper

def _ensure_default_pw(sid: str):
    """
    auth_students.json에 sid가 없으면 '1234'를 기본으로 세팅.
    """
    m = _load_auth_map()
    if sid not in m:
        m[sid] = {"pw_hash": generate_password_hash("1234")}
        _save_auth_map(m)

def _replace_sid_in_json_file(path: pathlib.Path, old: str, new: str):
    obj = _load_json(path, None)
    if obj is None:
        return

    def walk(x):
        if isinstance(x, dict):
            out = {}
            for k, v in x.items():
                nk = (new if str(k) == old else k)
                out[nk] = walk(v)
            return out
        if isinstance(x, list):
            out = []
            for v in x:
                if isinstance(v, str) and v == old:
                    out.append(new)
                else:
                    out.append(walk(v))
            return out
        if isinstance(x, str) and x == old:
            return new
        return x

    new_obj = walk(obj)
    _save_json_atomic(path, new_obj)

def _change_student_id_everywhere(old: str, new: str):
    # students.json은 리스트 안 id 교체
    students = _students_list()
    for s in students:
        if str(s.get("id", "")).strip() == old:
            s["id"] = new
    _save_json_atomic(STU_PATH, students)

    # 나머지 파일들은 sid가 dict key로 많이 들어감 -> 통째 치환
    candidates = [
        BASE / "progress.json",
        BASE / "logs.json",
        BASE / "tests.json",
        BASE / "mat_assign.json",
        BASE / "extra_attend.json",
        BASE / "absent.json",
        BASE / "clinic.json",
        BASE / "announce_status.json",
        BASE / "weekend_slots.json",
        BASE / "watch.json",
        BASE / "today_order.json",
    ]
    for p in candidates:
        if p.exists():
            _replace_sid_in_json_file(p, old, new)

    # auth_students.json sid key도 변경
    authm = _load_auth_map()
    if old in authm and new not in authm:
        authm[new] = authm.pop(old)
        _save_auth_map(authm)

@bp_api_auth.post("/login")
def login():
    data = _json_or_form()
    sid = str(data.get("id") or data.get("sid") or "").strip()
    pw = str(data.get("password") or data.get("pw") or "").strip()

    if not sid or not pw:
        return jsonify({"ok": False, "error": "missing id/password"}), 400

    if not _student_exists(sid):
        return jsonify({"ok": False, "error": "unknown id"}), 401

    _ensure_default_pw(sid)
    authm = _load_auth_map()
    pw_hash = (authm.get(sid) or {}).get("pw_hash", "")

    if not pw_hash or not check_password_hash(pw_hash, pw):
        return jsonify({"ok": False, "error": "bad password"}), 401

    token = _issue_token(sid)
    return jsonify({"ok": True, "sid": sid, "token": token})

@bp_api_auth.get("/me")
@require_auth
def me():
    sid = getattr(request, "_sid", "")
    # sid가 학생목록에서 삭제됐으면 토큰 무효 취급
    if not _student_exists(sid):
        return jsonify({"ok": False, "error": "unknown id"}), 401
    return jsonify({"ok": True, "sid": sid})

@bp_api_auth.post("/change")
@require_auth
def change():
    sid = getattr(request, "_sid", "")
    data = _json_or_form()

    cur_pw = str(data.get("curPw") or data.get("cur_pw") or "").strip()
    new_id = str(data.get("newId") or data.get("new_id") or "").strip()
    new_pw = str(data.get("newPw") or data.get("new_pw") or "").strip()

    if not cur_pw:
        return jsonify({"ok": False, "error": "missing curPw"}), 400

    _ensure_default_pw(sid)
    authm = _load_auth_map()
    cur_hash = (authm.get(sid) or {}).get("pw_hash", "")
    if not cur_hash or not check_password_hash(cur_hash, cur_pw):
        return jsonify({"ok": False, "error": "bad password"}), 401

    # 아이디 변경
    if new_id:
        if new_id == sid:
            new_id = ""
        else:
            if _student_exists(new_id):
                return jsonify({"ok": False, "error": "id taken"}), 409
            # 전 파일 sid 치환
            _change_student_id_everywhere(sid, new_id)
            sid = new_id  # 이후 토큰/응답은 새 sid 기준

    # 비번 변경
    if new_pw:
        authm = _load_auth_map()
        authm.setdefault(sid, {})
        authm[sid]["pw_hash"] = generate_password_hash(new_pw)
        _save_auth_map(authm)

    # 변경 후 새 토큰 발급(아이디가 바뀌었을 수도 있으니)
    token = _issue_token(sid)
    return jsonify({"ok": True, "sid": sid, "token": token})
