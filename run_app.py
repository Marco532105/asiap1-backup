import os

from flask import Flask, render_template, request, jsonify

app = Flask(__name__)


@app.route('/')
def index():
    """Render the main page with the cost calculation form."""
    return render_template('index.html')


@app.route('/calcular', methods=['POST'])
def calcular():
    """Calculate primary costs based on form inputs."""
    try:
        data = request.get_json()
        
        materia_prima = float(data.get('materia_prima', 0))
        mano_obra = float(data.get('mano_obra', 0))
        costos_indirectos = float(data.get('costos_indirectos', 0))
        
        costo_total = materia_prima + mano_obra + costos_indirectos
        
        return jsonify({
            'success': True,
            'materia_prima': materia_prima,
            'mano_obra': mano_obra,
            'costos_indirectos': costos_indirectos,
            'costo_total': costo_total
        })
    except (ValueError, TypeError) as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug_mode)
