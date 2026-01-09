from __future__ import annotations

import datetime as dt
import json
import os
import time
import uuid
from typing import Any

from flask import jsonify, make_response


def utc_now_isoz() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def load(path) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return {} if str(path).endswith(".json") else None


def save_atomic(path, obj: Any) -> None:
    """
    원자적 쓰기(임시파일 → 교체).
    Windows에서 WinError 32(다른 프로세스가 파일 사용 중) 뜨는 케이스가 있어:
    - tmp 파일명을 고유하게 만들고
    - os.replace를 짧게 몇 번 재시도
    """
    tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), "utf-8")

    last_err = None
    for _ in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError as e:
            last_err = e
            time.sleep(0.03)  # 30ms
        except OSError as e:
            last_err = e
            time.sleep(0.03)

    # 실패 시 tmp 정리 시도
    try:
        if tmp.exists():
            tmp.unlink()
    except Exception:
        pass

    if last_err:
        raise last_err


def nocache_resp(payload):
    resp = make_response(jsonify(payload))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp
