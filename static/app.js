// Main application logic for Calculo Costos Primarios

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('costos-form');
    
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const materiaPrima = document.getElementById('materia_prima').value;
        const manoObra = document.getElementById('mano_obra').value;
        const costosIndirectos = document.getElementById('costos_indirectos').value;
        
        const data = {
            materia_prima: parseFloat(materiaPrima) || 0,
            mano_obra: parseFloat(manoObra) || 0,
            costos_indirectos: parseFloat(costosIndirectos) || 0
        };
        
        fetch('/calcular', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                mostrarResultados(result);
            } else {
                mostrarError(result.error);
            }
        })
        .catch(error => {
            mostrarError('Error al procesar la solicitud: ' + (error.message || error.toString()));
        });
    });
});
