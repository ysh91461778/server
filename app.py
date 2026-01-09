# app.py — Flask 2.x / Python 3.10+
from __future__ import annotations

import ipaddress

from flask import Flask, request, abort, render_template_string
from werkzeug.middleware.proxy_fix import ProxyFix

from routes.pages import bp_pages
from routes.api_basic import bp_api_basic
from routes.api_attend import bp_api_attend
from routes.api_announcements import bp_api_announcements
from routes.api_tests import bp_api_tests
from routes.api_watch import bp_api_watch
from routes.api_fs import bp_api_fs
from routes.api_kollus import bp_api_kollus
from routes.api_auth import bp_api_auth  # ✅ 이거 추가
from routes.api_todaymeta import bp_api_todaymeta

def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="")
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

    # ─────────────────────────────────────────────
    # ✅ 학생 사이트(/student) — 학원 와이파이(IP)만 허용
    #    학원 밖에서 접속 시 안내 페이지 표시
    # ─────────────────────────────────────────────
    ALLOWED = [ipaddress.ip_network("110.14.147.14/32"),ipaddress.ip_network("192.168.0.0/16")]

    def ip_allowed(ip_str: str) -> bool:
        try:
            ip = ipaddress.ip_address(ip_str)
            return any(ip in net for net in ALLOWED)
        except ValueError:
            return False

    @app.before_request
    def block_student_outside():
        if (request.path or "").startswith("/student"):
            if not ip_allowed(request.remote_addr or ""):
                abort(403)

    BLOCK_HTML = """
    <!doctype html>
    <html lang="ko">
    <head>
      <meta charset="utf-8">
      <title>접속 제한</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body{
          margin:0; height:100vh;
          display:flex; align-items:center; justify-content:center;
          background:#0f172a; color:#e5e7eb;
          font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial;
        }
        .card{
          background:#020617;
          border:1px solid #334155;
          border-radius:14px;
          padding:28px 26px;
          max-width:380px;
          text-align:center;
          box-shadow:0 20px 40px rgba(0,0,0,.45);
        }
        h1{ font-size:18px; margin:0 0 10px; }
        p{ font-size:14px; opacity:.85; margin:0; line-height:1.45; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>학원 와이파이만 시청 가능합니다</h1>
        <p>해당 콘텐츠는 학원 내부 네트워크에서만 이용할 수 있습니다.</p>
      </div>
    </body>
    </html>
    """

    @app.errorhandler(403)
    def forbidden(_):
        return render_template_string(BLOCK_HTML), 403

    # Blueprints
    app.register_blueprint(bp_pages)
    app.register_blueprint(bp_api_basic)
    app.register_blueprint(bp_api_attend)
    app.register_blueprint(bp_api_announcements)
    app.register_blueprint(bp_api_tests)
    app.register_blueprint(bp_api_watch)
    app.register_blueprint(bp_api_fs)
    app.register_blueprint(bp_api_kollus)
    app.register_blueprint(bp_api_auth)
    app.register_blueprint(bp_api_todaymeta)
    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8003, debug=True)
