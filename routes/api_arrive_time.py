from __future__ import annotations

import datetime as dt
import json
from typing import Dict, Any

from flask import Blueprint, abort, jsonify, request

from core.paths import ARRIVE_TIME_PATH
from core.storage import load

bp_api_arrive_time = Blueprint("api_arrive_time", __name__)

def _norm_date(date_str_full: str) -> str:
    s = (date_str_full or "").strip()
    if not s:
        return dt.date.today().isoformat()
    # 'YYYY-MM-DDTHH:MM...' 같은 형태도 들어오니까 날짜만
    s = s.split("T")[0]
    try:
        d = dt.date.fromisoformat(s)
    except ValueError:
        abort(400, description="Invalid date format")
    return d.isoformat()

def _is_time_like(v: str) -> bool:
    # "HH:MM" 형태면 좋고, 그 외 문자열도 일단 허용(너가 직접 편집 가능하게 해놨으니)
    # 너무 긴 쓰레기만 컷
    if v is None:
        return False
    s = str(v).strip()
    return len(s) <= 20  # 넉넉히

def _save_json(path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), "utf-8")

@bp_api_arrive_time.get("/api/arrive-time")
def api_arrive_time_get():
    """
    - GET /api/arrive-time?date=YYYY-MM-DD  -> { "sid": "HH:MM", ... }
    - GET /api/arrive-time                  -> 전체 맵(디버그용)
    """
    date_q = request.args.get("date", "")
    all_map: Dict[str, Dict[str, str]] = load(ARRIVE_TIME_PATH) or {}

    if not date_q:
        # 전체 반환(필요 없으면 지워도 됨)
        if not isinstance(all_map, dict):
            all_map = {}
        return jsonify(all_map)

    date_key = _norm_date(date_q)
    day_map = all_map.get(date_key, {})
    if not isinstance(day_map, dict):
        day_map = {}
    return jsonify(day_map)

@bp_api_arrive_time.post("/api/arrive-time")
def api_arrive_time_post():
    """
    - POST /api/arrive-time
      body: { "YYYY-MM-DD": { "sid": "HH:MM", ... } }
      -> 해당 날짜만 "부분 저장(merge)" 해준다.
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not payload:
        abort(400, description="Invalid JSON body")

    all_map: Dict[str, Dict[str, str]] = load(ARRIVE_TIME_PATH) or {}
    if not isinstance(all_map, dict):
        all_map = {}

    # 여러 날짜가 와도 처리(프론트는 보통 1개만 보냄)
    for date_key_raw, day_patch in payload.items():
        date_key = _norm_date(str(date_key_raw))
        if not isinstance(day_patch, dict):
            abort(400, description="Invalid day map")

        cur = all_map.get(date_key, {})
        if not isinstance(cur, dict):
            cur = {}

        # patch merge
        for sid_raw, time_raw in day_patch.items():
            sid = str(sid_raw)
            # 프론트가 삭제는 "키 자체 제거"해서 보내니까,
            # 여기서는 받은 키만 갱신한다.
            if time_raw is None:
                # None은 삭제로 취급하고 싶으면 이 줄 유지
                cur.pop(sid, None)
                continue

            v = str(time_raw).strip()
            if not v:
                # 빈문자도 삭제로 취급
                cur.pop(sid, None)
                continue

            if not _is_time_like(v):
                abort(400, description="Invalid time value")
            cur[sid] = v

        all_map[date_key] = cur

    _save_json(ARRIVE_TIME_PATH, all_map)
    return jsonify({"ok": True})
