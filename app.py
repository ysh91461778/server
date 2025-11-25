# app.py  — Flask 2.x / Python 3.10+


import jwt, time, urllib.parse
import json, uuid, datetime, pathlib, os
import random, re
from flask import Flask, request, jsonify, send_from_directory, abort, redirect

# ────────────── 경로 설정 ────────────── #
BASE       = pathlib.Path(__file__).parent
FILES_DIR  = BASE / "files"        ; FILES_DIR.mkdir(exist_ok=True)

def p(name, default):
    path = BASE / name
    if not path.exists():
        path.write_text(json.dumps(default, ensure_ascii=False, indent=2), "utf-8")
    return path

STU_PATH  = p("students.json", [])      # [{id,name,curriculum,day1,day2,day3,videoIndex}]
VID_PATH  = p("videos.json",  [])       # [{id,curriculum,chapter,title,url}]
PRG_PATH  = p("progress.json", {})      # {date:{sid:{vid_id:status}}}
MAT_PATH  = p("materials.json", {})     # {mat_id:{title,url}}
ASN_PATH  = p("mat_assign.json", {})    # {stu_id:[mat_id,...]}
UPD_PATH  = p("updates.json", {})       # {date:{sid:[vid_id,...]}}
TODAY_ORDER_PATH= p("today_order.json", [])

KOLLUS_POLICY_KEY   = "서비스키"
KOLLUS_SERVICE_KEY  = "시크릿키"      # Kollus Admin > 보안 설정에서 확인
TOKEN_EXPIRE_SEC    = 36000           

def kollus_signed_url(mid, client_ip):
    payload = {
        "service_key": KOLLUS_SERVICE_KEY,
        "expired_at" : int(time.time()) + TOKEN_EXPIRE_SEC,
        "allow_ip"   : client_ip            # IP 고정
    }
    token = jwt.encode(payload, KOLLUS_POLICY_KEY, algorithm="HS256")
    return f"https://v.kr.kollus.com/{mid}?jwt={urllib.parse.quote(token)}"

def load(path): return json.loads(path.read_text("utf-8"))
def save(path, obj): path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), "utf-8")

# ────────────── 앱 ────────────── #
app = Flask(__name__, static_folder="static", static_url_path="")

@app.before_request
def _log_ip():
    print('IP', request.remote_addr, request.path)


# -------- HTML -------- #
@app.route("/")
def root(): 
  return redirect("/admin")

@app.route("/admin")      
def admin():
   return app.send_static_file("admin.html")
@app.route("/students")
def allpg():
   return app.send_static_file("all.html")
@app.route("/student/<sid>")
def stu_pg(sid):
 return app.send_static_file("student.html")

# -------- 공통 CRUD 헬퍼 -------- #
def crud(path):
    if request.method == "GET":
        return jsonify(load(path))
    save(path, request.get_json(force=True))
    return "", 204

@app.route("/api/students", methods=["GET","POST"])
def api_stu():
    return crud(STU_PATH)

@app.route("/api/videos", methods=["GET", "POST"])
def api_vid():
    return crud(VID_PATH)

@app.route("/api/progress", methods=["GET", "POST"])
def api_prg():
    return crud(PRG_PATH)

@app.route("/api/updates", methods=["GET", "POST"])
def api_upd():
    return crud(UPD_PATH)

@app.route("/api/mat-assign", methods=["GET", "POST"])
def api_asn():
    return crud(ASN_PATH)

@app.route('/api/today_order', methods=['GET'])
def get_today_order():
    with open('today_order.json', 'r', encoding='utf-8') as f:
        return jsonify(json.load(f))

@app.route('/api/today_order', methods=['POST'])
def save_today_order():
    data = request.get_json()

    # 기존 데이터 불러오기
    try:
        with open('today_order.json', 'r', encoding='utf-8') as f:
            today_order = json.load(f)
    except FileNotFoundError:
        today_order = {}

    # 날짜별 순서 갱신
    today_order.update(data)

    with open('today_order.json', 'w', encoding='utf-8') as f:
        json.dump(today_order, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})

@app.route('/api/update', methods=['POST'])
def update_student_field():
    data = request.json
    sid = data.get('id')
    field = data.get('field')
    value = data.get('value')

    with open('students.json', encoding='utf-8') as f:
        students = json.load(f)

    found = False
    for s in students:
        if s['id'] == sid:
            s[field] = value
            found = True
            break

    if not found:
        return 'Student not found', 404

    with open('students.json', 'w', encoding='utf-8') as f:
        json.dump(students, f, ensure_ascii=False, indent=2)

    return 'OK'

@app.route('/api/today-order', methods=['POST'])
def update_today_order():
    if request.method == 'GET':
        # 저장된 순서 반환
        order = json.loads(TODAY_ORDER_PATH.read_text("utf-8"))
        return jsonify({ 'order': order })
    # POST: 새로운 순서를 파일에 저장
    data = request.get_json(force=True)
    new_order = data.get('order', [])
    TODAY_ORDER_PATH.write_text(
        json.dumps(new_order, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    return jsonify({ 'status': 'ok', 'order': new_order }), 200


# -------- 오늘 등원 학생 -------- #
@app.route("/api/today")
def api_today():
    today = datetime.date.today()
    wchr  = "일월화수목금토"[today.weekday()]

    students = load(STU_PATH)

    # ① 정규 요일 매칭
    regular = [
        s for s in students
        if any((s.get(d,"").startswith(wchr) for d in ("day1","day2","day3")))
    ]

    # ② 보강(추가) 목록
    extra = load(EXTRA_PATH).get(today.isoformat(), [])
    extra_students = [s for s in students if s["id"] in extra]

    # ③ 합집합 + 중복 제거
    all_today = { s["id"]:s for s in regular + extra_students }
    return jsonify(list(all_today.values()))

# -------- 빠른 학생 추가 -------- #
@app.route("/api/add-student", methods=["POST"])
def add_student():
    stu = load(STU_PATH)
    data = request.get_json()
    # 이제: 이름 기반 슬러그 + 랜덤 3자리 숫자
    # 1) 이름에서 슬러그(한글·영문·숫자만) 생성
    raw_name = data.get("name", "user")
    name_slug = re.sub(r'[^0-9A-Za-z가-힣]', '', raw_name)
    # 2) 000 부터 999 사이 랜덤 3자리
    rand_num = f"{random.randint(0, 999):03d}"
    data["id"] = f"{name_slug}{rand_num}"
    stu.append(data); save(STU_PATH, stu)
    return jsonify({"id": data["id"]})

# -------- 자료 업로드 & 목록 -------- #
@app.route("/api/materials", methods=["GET","POST"])
def api_materials():
    if request.method == "GET":
        return jsonify(load(MAT_PATH))
    save(MAT_PATH, request.get_json(force=True))
    return "", 204

@app.route('/api/feedback', methods=['POST'])
def feedback():
    data = request.json  # { name: '학생이름', text: '내용' }
    with open('feedbacks.json', 'a', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
        f.write('\n')
    return '', 204

@app.route("/api/material-upload", methods=["POST"])
def mat_upload():
    f   = request.files["file"]
    cur = request.form.get("curriculum", "etc").strip()

    mats = load(MAT_PATH)

    # ▶ 번호만 모아서 max 계산
    num_keys = [int(k) for k in mats.keys() if k.isdigit()]
    mat_id   = str(max(num_keys, default=0) + 1)

    orig_name = f.filename
    save_name = f"{uuid.uuid4()}_{orig_name}"
    f.save(FILES_DIR / save_name)

    mats[mat_id] = {
        "title": orig_name,
        "url":   f"/files/{save_name}",
        "curriculum": cur
    }
    save(MAT_PATH, mats)
    return jsonify(mats)

# -------- 한 영상 진도 PATCH (학생 페이지 버튼용) -------- #
@app.route("/api/progress-once", methods=["POST"])
def prog_once():
    data = request.get_json()
    date = datetime.date.today().isoformat()
    prg  = load(PRG_PATH)
    prg.setdefault(date, {}).setdefault(data["student_id"], {})[str(data["video_id"])] = data["status"]
    save(PRG_PATH, prg)
    return "", 204

from functools import wraps
from flask import abort, request

ALLOWED_SUBNET = "192.168.0."          # 사내/학원 IP 대역

def local_only(f):
    @wraps(f)
    def wrapper(*args, **kw):
        if not request.remote_addr.startswith(ALLOWED_SUBNET):
            abort(403)
        return f(*args, **kw)
    return wrapper


@app.route("/files/<path:fname>")
def files(fname):
    # 1) 내부 IP만 허용
    if not request.remote_addr.startswith("192.168.0."):
        abort(403)

    p = FILES_DIR / fname
    if not p.exists():
        abort(404)

    resp = send_from_directory(FILES_DIR, fname)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"]        = "no-cache"
    resp.headers["Expires"]       = "0"
    return resp

@app.route("/api/get-url")
@local_only                            # 내부망만 호출 가능
def get_url():
    mid = request.args["mid"]         # 예: ?mid=YL2HFb9s
    return kollus_signed_url(mid, request.remote_addr)

# ── ping 엔드포인트 ──
@app.route("/api/ping")
@local_only
def api_ping():
    return "ok"


# ── 글로벌 before_request ──
@app.before_request
def _log_ip():
    print('IP', request.remote_addr, request.path)

# ───── 파일 경로 추가 ─────
EXTRA_PATH = p("extra_attend.json", {})   # { "YYYY-MM-DD": [sid, …] }
LOGS_PATH  = p("logs.json", {})    # { "YYYY-MM-DD": { studentId: { topic, homework, notes } } }
ABS_PATH   = p("absent.json", {})          # { sid: recoveryDate|null }

# ───── CRUD 엔드포인트 (옵션) ─────
@app.route("/api/extra-attend", methods=["GET", "POST"])
def api_extra():
    return crud(EXTRA_PATH)
@app.route("/api/logs", methods=["GET","POST"])
def api_logs():
    return crud(LOGS_PATH)
@app.route("/api/absent", methods=["GET","POST"])
def api_absent():
    return crud(ABS_PATH)
# ────────────── 실행 ────────────── #
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8003, debug=True)
