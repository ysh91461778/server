import pathlib, os
BASE = pathlib.Path(__file__).parent
DB_URL = f"sqlite:///{BASE/'vacation.db'}"
FILES_DIR = BASE / "files"
FILES_DIR.mkdir(exist_ok=True)
ADMIN_PW = os.getenv("ADMIN_PW", "1234")   # 간단 인증용
