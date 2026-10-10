import os
import sys
import time
import re
import subprocess

# Load GEMINI_API_KEY from environment or local .env file
if not os.getenv("GEMINI_API_KEY") and os.path.exists(".env"):
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("GEMINI_API_KEY="):
                os.environ["GEMINI_API_KEY"] = line.split("=", 1)[1].strip()
                break

print("=" * 65)
print("🚀 Launching Business Data AI Explorer & Public Tunnel...")
print("=" * 65)

# Start Flask app
flask_proc = subprocess.Popen([sys.executable, "app.py"], env=os.environ)
time.sleep(2)

# Start Cloudflare tunnel
print("🌐 Generating public link (no shared Wi-Fi needed)...")
tunnel_proc = subprocess.Popen(
    ["cloudflared.exe", "tunnel", "--url", "http://127.0.0.1:5000"],
    stderr=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    encoding="utf-8",
    errors="replace"
)

public_url = None
start_time = time.time()
while time.time() - start_time < 30:
    line = tunnel_proc.stderr.readline()
    if not line:
        continue
    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
    if match:
        public_url = match.group(0)
        break

print("\n" + "=" * 65)
print("✅ YOUR APPLICATION IS LIVE!")
print(f"💻 Local URL:  http://localhost:5000")
if public_url:
    print(f"🌍 Public URL: {public_url}")
    print("\n👉 Share the Public URL with your friends on any network!")
print("=" * 65)
print("\nKeep this window open. Press Ctrl + C to stop.\n")

try:
    flask_proc.wait()
except KeyboardInterrupt:
    print("\nStopping...")
    flask_proc.terminate()
    tunnel_proc.terminate()
