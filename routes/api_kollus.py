from __future__ import annotations

import time
import jwt
from flask import Blueprint, jsonify, request

bp_api_kollus = Blueprint("api_kollus", __name__)

# Kollus(내부망 전용)
KOLLUS_POLICY_KEY  = "서비스키"
KOLLUS_SERVICE_KEY = "시크릿키"
TOKEN_EXPIRE_SEC   = 36000

def kollus_signed_url(mid: str, client_ip: str) -> str:
    payload = {
        "service_key": KOLLUS_SERVICE_KEY,
        "expired_at": int(time.time()) + TOKEN_EXPIRE_SEC,
        "allow_ip": client_ip,
    }
    token = jwt.encode(payload, KOLLUS_POLICY_KEY, algorithm="HS256")
    return f"https://v.kr.kollus.com/{mid}?"

def get_real_client_ip() -> str:
    return (
        request.headers.get("CF-Connecting-IP")
        or (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        or request.remote_addr
        or ""
    )

def local_only(f):
    # 임시로 제한 안 거는 형태 유지(기존과 동일)
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        return f(*args, **kwargs)
    return wrapper

@bp_api_kollus.get("/api/get-url")
@local_only
def api_get_url():
    mid = request.args.get("mid", "")
    if not mid:
        return jsonify({"ok": False, "error": "missing mid"}), 400
    client_ip = get_real_client_ip()
    return kollus_signed_url(mid, client_ip)
