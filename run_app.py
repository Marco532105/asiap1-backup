from flask import Flask, render_template
import os

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    # Lee HOST y PORT desde variables de entorno (si no están, usa 127.0.0.1:5000)
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '5000'))
    debug = os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True')

    print(f"Iniciando app en http://{host}:{port}  (debug={debug})")
    app.run(host=host, port=port, debug=debug)