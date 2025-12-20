from __future__ import annotations

import time
from flask import Blueprint, jsonify, request

from core.paths import WATCH_PATH
from core.storage import load, save_atomic, nocache_resp

bp_api_watch = Blueprint("api_watch", __name__)

@bp_api_watch.route("/api/watch", methods=["GET", "POST"])
def api_watch():
    if request.method == "GET":
        return nocache_resp(load(WATCH_PATH))

    body = request.get_json(force=True) or {}
    date = str(body.get("date") or "").strip()
    sid  = str(body.get("sid")  or "").strip()
    mid  = str(body.get("mid")  or "").strip()
    if not date or not sid or not mid:
        return jsonify({"ok": False, "error": "missing date/sid/mid"}), 400

    try:
        last = max(0, int(float(body.get("last", 0))))
        dur  = max(0, int(float(body.get("dur", 0))))
        completed = bool(body.get("completed", False))
        updated_at = int(body.get("updatedAt") or int(time.time() * 1000))
    except Exception:
        return jsonify({"ok": False, "error": "invalid numeric fields"}), 400

    data = load(WATCH_PATH)
    if not isinstance(data, dict):
        data = {}

    by_date = data.setdefault(date, {})
    by_sid  = by_date.setdefault(sid, {})
    prev    = by_sid.get(mid, {})

    by_sid[mid] = {
        "last": last,
        "dur": dur,
        "completed": completed,
        "updatedAt": max(int(prev.get("updatedAt") or 0), updated_at)
    }

    save_atomic(WATCH_PATH, data)
    return jsonify({"ok": True})
