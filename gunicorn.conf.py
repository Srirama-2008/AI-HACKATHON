import os

raw_port = os.environ.get("PORT", "10000").strip()
try:
    port = int(raw_port)
except Exception:
    port = 10000

bind = f"0.0.0.0:{port}"
workers = 1
threads = 2
timeout = 120
accesslog = "-"
errorlog = "-"
