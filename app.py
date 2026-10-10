import os
from pathlib import Path
import sqlite3
import traceback
import requests
from flask import Flask, request, jsonify, send_from_directory, session
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "users.db"

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
app.secret_key = os.getenv('SECRET_KEY', 'ai-hackathon-super-secret-key-2026')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Initialize SQLite database
def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()

init_db()

# Tried in order until one works.
MODELS = [m for m in [os.getenv('GEMINI_MODEL'), 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'] if m]
URL = 'https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent'


@app.route('/health')
def health():
    return 'OK', 200


@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


# ==================== Auth Endpoints ====================
@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    user = session.get('user')
    if user:
        return jsonify({'authenticated': True, 'username': user})
    return jsonify({'authenticated': False})


@app.route('/api/auth/signup', methods=['POST'])
def signup():
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({'error': 'Username and password are required.'}), 400
    if len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters long.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters long.'}), 400

    hashed = generate_password_hash(password)
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, hashed))
            conn.commit()
        session['user'] = username
        return jsonify({'success': True, 'username': username})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Username is already registered. Please log in.'}), 409
    except Exception as e:
        return jsonify({'error': f'Failed to create account: {e}'}), 500


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({'error': 'Username and password are required.'}), 400

    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute('SELECT password_hash FROM users WHERE username = ?', (username,))
            row = cursor.fetchone()
        if not row or not check_password_hash(row[0], password):
            return jsonify({'error': 'Invalid username or password.'}), 401
        session['user'] = username
        return jsonify({'success': True, 'username': username})
    except Exception as e:
        return jsonify({'error': f'Login failed: {e}'}), 500


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({'success': True})


# ==================== Protected AI Generation ====================
@app.route('/api/generate', methods=['POST'])
def generate():
    if not session.get('user'):
        return jsonify({'error': 'Authentication required. Please log in.'}), 401

    prompt = (request.get_json(silent=True) or {}).get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': 'Empty question.'}), 400
    key = os.getenv('GEMINI_API_KEY', '').strip()
    if not key and os.path.exists('.env'):
        try:
            with open('.env', 'r', encoding='utf-8') as f:
                for line in f:
                    if line.startswith('GEMINI_API_KEY='):
                        key = line.split('=', 1)[1].strip()
                        break
        except Exception:
            pass
    if not key:
        return jsonify({'error': 'GEMINI_API_KEY is not set.'}), 500

    body = {'contents': [{'role': 'user', 'parts': [{'text': prompt}]}]}
    last = 'Unknown error'
    for model in MODELS:
        try:
            r = requests.post(URL.format(model), json=body, timeout=60,
                              headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
            if r.status_code == 200:
                parts = r.json()['candidates'][0]['content']['parts']
                return jsonify({'response': ''.join(p.get('text', '') for p in parts), 'model': model})
            last = f'Gemini {r.status_code} ({model}): {r.text[:250]}'
            print(last)
            if r.status_code not in (404, 429, 503):
                break
        except Exception as e:
            traceback.print_exc()
            last = f'Network error: {e}'
    return jsonify({'error': last}), 502


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)