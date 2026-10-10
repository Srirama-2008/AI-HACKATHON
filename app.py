import os
from pathlib import Path
import traceback
import requests
from flask import Flask, request, jsonify, send_from_directory

BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')

# Tried in order until one works.
MODELS = [m for m in [os.getenv('GEMINI_MODEL'), 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'] if m]
URL = 'https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent'


@app.route('/health')
def health():
    return 'OK', 200


@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/api/generate', methods=['POST'])
def generate():
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