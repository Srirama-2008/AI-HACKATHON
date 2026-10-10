import os

# Automatically bind to the PORT assigned by Render (or default to 10000 / 5000)
port = os.environ.get("PORT", "10000")
bind = f"0.0.0.0:{port}"

workers = 2
threads = 4
timeout = 120

# Stream logs to stdout/stderr so Render logs show all requests
accesslog = "-"
errorlog = "-"
