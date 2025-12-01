// Results handling logic for Calculo Costos Primarios

function formatCurrency(value) {
    return '$' + value.toFixed(2);
}

function mostrarResultados(data) {
    const resultadosDiv = document.getElementById('resultados');
    const errorDiv = document.getElementById('error-message');
    
    // Hide error message if visible
    errorDiv.classList.add('hidden');
    
    // Update result values
    document.getElementById('res-materia-prima').textContent = formatCurrency(data.materia_prima);
    document.getElementById('res-mano-obra').textContent = formatCurrency(data.mano_obra);
    document.getElementById('res-costos-indirectos').textContent = formatCurrency(data.costos_indirectos);
    document.getElementById('res-costo-total').textContent = formatCurrency(data.costo_total);
    
    // Show results section
    resultadosDiv.classList.remove('hidden');
}

function mostrarError(message) {
    const resultadosDiv = document.getElementById('resultados');
    const errorDiv = document.getElementById('error-message');
    
    // Hide results if visible
    resultadosDiv.classList.add('hidden');
    
    // Show error message
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}
