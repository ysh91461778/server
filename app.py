# app.py — Flask 2.x / Python 3.10+
from __future__ import annotations

from flask import Flask
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


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="")
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

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

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8003, debug=True)
