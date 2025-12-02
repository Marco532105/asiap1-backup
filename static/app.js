// static/app.js
// V20 parcheado: modales, validación de encabezados, creación/edición en bloque,
// ocultar botón "Agregar línea", y PEGADO EN BLOQUE (capturado) desde Excel/Sheets.
// Incluye guard para permitir pegar dentro de modales/inputs.

// Configuración de anchos exactos
const WIDTHS = {
  fixed: [210, 110, 120], // col1, col2, col3 en px
  A: 110,
  B: 110
};

function getColWidthPx(col, idx) {
  if (idx < 3) return WIDTHS.fixed[idx] + 'px';
  if (col.type === 'A') return WIDTHS.A + 'px';
  if (col.type === 'B') return WIDTHS.B + 'px';
  return WIDTHS.A + 'px';
}

const FIXED_COUNT = 3;
const MAX_COLUMNS = 25;
const MAX_ROWS = 200;

// Estado en memoria (no persistente)
let fixedCols = [
  { id: 'c1', label: 'Descripcion', type: 'fixed' },
  { id: 'c2', label: 'Costo', type: 'fixed' },
  { id: 'c3', label: 'BR', type: 'fixed' }
];
let dynCols = []; // columnas dinámicas añadidas por el usuario
let rows = [];    // filas dinámicas

// contador de ids únicos para filas
let nextRowId = 1;

// ---- Helpers actualizados: parsear y formatear números en formato anglosajón (2 decimales max) ----

/**
 * Parsea una cadena numérica en muchos formatos locales aceptables y devuelve Number o NaN.
 */
function parseNumberString(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (s === '') return NaN;

  // eliminar NBSP y espacios
  s = s.replace(/\u00A0/g, '').replace(/\s+/g, '');

  // limpiar caracteres no numéricos excepto signos, puntos y comas y e/E
  s = s.replace(/[^0-9\-,.\u2212+eE]/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    // ambos presentes: el separador más a la derecha es el decimal
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.'); // coma decimal
    } else {
      s = s.replace(/,/g, ''); // punto decimal
    }
  } else if (lastComma !== -1) {
    const countComma = (s.match(/,/g) || []).length;
    if (countComma === 1) {
      s = s.replace(',', '.'); // una sola coma -> decimal
    } else {
      s = s.replace(/,/g, ''); // varias comas -> miles
    }
  } else {
    // sólo puntos o ninguno
    const countDot = (s.match(/\./g) || []).length;
    if (countDot > 1) {
      s = s.replace(/\./g, ''); // varios puntos -> miles
    }
    // si hay 0 o 1 punto: se deja tal cual (punto decimal)
  }

  // evitar solo signo
  if (/^[+-]?$/.test(s)) return NaN;

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Formatea un Number en notación anglosajona con separador de miles "," y "." decimal.
 * - Si es entero, no muestra decimales.
 * - Si tiene fracción, redondea a 2 decimales y recorta ceros finales (ej. 3.10 -> 3.1).
 */
function formatNumberAnglo(n) {
  if (!Number.isFinite(n)) return '';
  const isNeg = n < 0;
  const abs = Math.abs(n);

  // entero: formatear con separador de miles
  if (Number.isInteger(Math.round(abs * 100) / 100) && Math.abs(Math.round(abs * 100) / 100 - Math.trunc(abs)) < 1e-9 && Math.trunc(abs) === abs) {
    // si es entero puro
    const s = String(Math.trunc(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return isNeg ? '-' + s : s;
  }

  // tiene parte fraccional -> redondear a 2 decimales
  const rounded = Math.round((isNeg ? -n : n) * 100) / 100;
  // representarlo con 2 decimales y luego recortar ceros finales
  let fixed = Math.abs(rounded).toFixed(2); // siempre "X.YZ"
  fixed = fixed.replace(/(?:\.0+|(\.\d+?)0+)$/, '$1'); // quita ceros finales y .0
  // separar parte entera y fraccionaria
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const res = parts.length > 1 ? parts[0] + '.' + parts[1] : parts[0];
  return isNeg ? '-' + res : res;
}

/**
 * Normaliza y formatea un raw string:
 *  - numeric: Number (o NaN)
 *  - formatted: string para mostrar (anglo)
 *  - canonical: string con punto decimal y sin separadores de miles, con max 2 decimales
 */
function normalizeAndFormatValue(raw) {
  const trimmed = raw == null ? '' : String(raw).trim();
  const numeric = parseNumberString(trimmed);
  if (Number.isNaN(numeric)) {
    return { numeric: NaN, formatted: trimmed, canonical: trimmed };
  }

  // decidir canonical: entero sin decimales o número con hasta 2 decimales (sin ceros finales)
  let canonical;
  // detectar si, tras redondear a 2 decimales, el número queda entero
  const roundedTo2 = Math.round(numeric * 100) / 100;
  if (Number.isInteger(roundedTo2)) {
    canonical = String(Math.trunc(roundedTo2));
  } else {
    // usar toFixed(2) y recortar ceros finales
    let s = roundedTo2.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
    canonical = s;
  }

  const formatted = formatNumberAnglo(numeric);
  return { numeric: numeric, formatted: formatted, canonical: canonical };
}

// DOM refs (esperan elementos en el HTML)
const setupScreen = document.getElementById('setup-screen');
const tableScreen = document.getElementById('table-screen');
const loadExampleBtn = document.getElementById('load-example-btn');
const generateTableBtn = document.getElementById('generate-table-btn');
const addColABtn = document.getElementById('add-col-a');
const addColBBtn = document.getElementById('add-col-b');
const addRowBtn = document.getElementById('add-row');
const reconfigureBtn = document.getElementById('reconfigure-btn');
const table = document.getElementById('dynamic-table');
const wrapper = document.getElementById('table-wrapper');
const msgArea = document.getElementById('msg-area');

// ----------------- NUEVO BLOQUE: Guardar / Cargar estructuras desde la pantalla Resumen -----------------
//
// Persistencia mínima en localStorage bajo la clave 'asiap_saved_tables'.
// UI: textbox "Nombre empresa", botones "Guardar estructura" y "Cargar estructura" en la barra de controles.
// Modal de carga simple que lista entradas guardadas con botones Cargar / Eliminar.
//
// Este bloque está diseñado para integrarse con el resto del fichero sin depender de resultados.js.
// -----------------------------------------------------------------------------------------------

const STORAGE_KEY = 'asiap_saved_tables';

function getSavedTablesObject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn('getSavedTablesObject parse error', e);
    return {};
  }
}

function setSavedTablesObject(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    console.error('setSavedTablesObject error', e);
    return false;
  }
}

function saveCurrentStructureWithName(name, companyName) {
  if (!name || String(name).trim() === '') return { ok: false, message: 'Nombre vacío' };
  const obj = {
    meta: {
      name: String(name).trim(),
      companyName: companyName || '',
      saved_at: (new Date()).toISOString(),
      version: 'asiap-v1'
    },
    fixedCols: fixedCols ? JSON.parse(JSON.stringify(fixedCols)) : [],
    dynCols: dynCols ? JSON.parse(JSON.stringify(dynCols)) : [],
    rows: rows ? JSON.parse(JSON.stringify(rows)) : []
  };
  const saved = getSavedTablesObject();
  saved[String(name).trim()] = obj;
  const ok = setSavedTablesObject(saved);
  return ok ? { ok: true } : { ok: false, message: 'Error al escribir localStorage' };
}

function deleteSavedStructure(name) {
  const saved = getSavedTablesObject();
  if (saved && saved[name]) {
    delete saved[name];
    setSavedTablesObject(saved);
    return true;
  }
  return false;
}

function listSavedStructures() {
  const saved = getSavedTablesObject();
  const keys = Object.keys(saved || {}).sort((a,b) => {
    try {
      const da = new Date(saved[a].meta.saved_at).getTime();
      const db = new Date(saved[b].meta.saved_at).getTime();
      return db - da;
    } catch (e) { return a.localeCompare(b); }
  });
  return keys.map(k => ({ key: k, meta: saved[k].meta }));
}

function loadSavedStructureByName(name) {
  const saved = getSavedTablesObject();
  if (!saved || !saved[name]) return { ok: false, message: 'No encontrado' };
  try {
    const obj = saved[name];
    // replace model in memory
    fixedCols = obj.fixedCols ? JSON.parse(JSON.stringify(obj.fixedCols)) : [];
    dynCols = obj.dynCols ? JSON.parse(JSON.stringify(obj.dynCols)) : [];
    rows = obj.rows ? JSON.parse(JSON.stringify(obj.rows)) : [];
    // adjust nextRowId
    const maxId = (rows || []).reduce((m, r) => Math.max(m, r && r.id ? r.id : 0), 0);
    nextRowId = (maxId || 0) + 1;
    // re-render the dynamic table if available
    try { if (typeof renderTable === 'function') renderTable(); } catch (e) { console.warn('renderTable no disponible al cargar estructura', e); }
    return { ok: true, meta: obj.meta };
  } catch (e) {
    console.error('Error al cargar estructura', e);
    return { ok: false, message: e.message || 'Error desconocido' };
  }
}

function openLoadStructuresModal() {
  // build modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = 2500;

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '720px';
  modal.style.width = '90%';
  modal.style.padding = '12px';

  const h3 = document.createElement('h3');
  h3.textContent = 'Cargar estructura guardada';
  modal.appendChild(h3);

  const listDiv = document.createElement('div');
  listDiv.style.maxHeight = '50vh';
  listDiv.style.overflow = 'auto';
  listDiv.style.margin = '8px 0';
  modal.appendChild(listDiv);

  const structures = listSavedStructures();
  if (!structures || structures.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No hay estructuras guardadas en este navegador.';
    listDiv.appendChild(p);
  } else {
    structures.forEach(item => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '8px';
      row.style.borderBottom = '1px solid #eee';

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = item.meta && item.meta.name ? item.meta.name : item.key;
      title.style.fontWeight = '700';
      const meta = document.createElement('div');
      meta.style.fontSize = '12px';
      meta.style.color = '#666';
      meta.textContent = 'Empresa: ' + (item.meta && item.meta.companyName ? item.meta.companyName : '') + ' — Guardado: ' + (item.meta && item.meta.saved_at ? item.meta.saved_at : '');
      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';

      const btnLoad = document.createElement('button');
      btnLoad.textContent = 'Cargar';
      btnLoad.className = 'modal-save';
      btnLoad.addEventListener('click', () => {
        if (!confirm('¿Cargar la estructura "' + (item.meta && item.meta.name ? item.meta.name : item.key) + '" y reemplazar la actual?')) return;
        const r = loadSavedStructureByName(item.key);
        if (r.ok) {
          // update company textbox if exists
          const input = document.getElementById('input-company-name');
          if (input && r.meta && r.meta.companyName) input.value = r.meta.companyName;
          alert('Estructura cargada: ' + (item.meta && item.meta.name ? item.meta.name : item.key));
          try { document.body.removeChild(overlay); } catch(e){}
        } else {
          alert('No se pudo cargar: ' + (r.message || 'error'));
        }
      });
      actions.appendChild(btnLoad);

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Eliminar';
      btnDel.className = 'modal-cancel';
      btnDel.addEventListener('click', () => {
        if (!confirm('Eliminar la estructura guardada "' + (item.meta && item.meta.name ? item.meta.name : item.key) + '"?')) return;
        const ok = deleteSavedStructure(item.key);
        if (ok) {
          row.parentElement && row.parentElement.removeChild(row);
        } else {
          alert('No se pudo eliminar la estructura.');
        }
      });
      actions.appendChild(btnDel);

      row.appendChild(info);
      row.appendChild(actions);
      listDiv.appendChild(row);
    });
  }

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.gap = '8px';
  footer.style.marginTop = '10px';

  const btnClose = document.createElement('button');
  btnClose.textContent = 'Cerrar';
  btnClose.className = 'modal-cancel';
  btnClose.addEventListener('click', () => { try { document.body.removeChild(overlay); } catch(e){} });
  footer.appendChild(btnClose);

  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function openSaveStructurePrompt() {
  // prefer to use textbox value as suggested default meta.companyName
  const input = document.getElementById('input-company-name');
  const defaultCompany = (input && input.value) ? input.value.trim() : '';
  const defaultName = 'estructura-' + (defaultCompany ? defaultCompany.replace(/\s+/g,'-') + '-' : '') + new Date().toISOString().replace(/[:.]/g,'-');
  const name = prompt('Nombre para guardar la estructura (localStorage):', defaultName);
  if (!name) return;
  const res = saveCurrentStructureWithName(name, defaultCompany);
  if (res.ok) {
    // set textbox companyName if not already set
    if (input && defaultCompany) input.value = defaultCompany;
    // show brief success
    showErrorMessage(`Estructura guardada: ${name}`, 3000);
  } else {
    showErrorMessage('No se pudo guardar la estructura: ' + (res.message || 'error'), 4000);
  }
}

// End of new storage block
// -----------------------------------------------------------------------------------------------

if (loadExampleBtn) loadExampleBtn.addEventListener('click', () => {
  loadExample();
  showTableScreen();
  renderTable();
});
if (generateTableBtn) generateTableBtn.addEventListener('click', () => {
  dynCols = [];
  rows = createBaseRowsWithSubtitles([]);
  showTableScreen();
  renderTable();
});

// --- Botones crear columnas A/B ---
if (addColABtn) {
  addColABtn.innerHTML = '<span style="display:inline-block;width:20px;height:20px;border:1px solid #cfd8df;border-radius:4px;text-align:center;line-height:18px;margin-right:8px;font-weight:600">+</span> Departamentos produccion';
  addColABtn.title = 'Crear Departamentos produccion';
  addColABtn.addEventListener('click', () => showCreateColumnsModal('A'));
}
if (addColBBtn) {
  addColBBtn.innerHTML = '<span style="display:inline-block;width:20px;height:20px;border:1px solid #cfd8df;border-radius:4px;text-align:center;line-height:18px;margin-right:8px;font-weight:600">+</span> Departamento apoyo';
  addColBBtn.title = 'Crear Departamento apoyo';
  addColBBtn.addEventListener('click', () => showCreateColumnsModal('B'));
}

// --- START: fragment añadido: botón "Editar Tabla Resumen" (lazy-load editor) ---
(function(){
  // crear botón "Editar Tabla Resumen" y colocarlo en la barra de controles (si no existe)
  const existing = document.getElementById('edit-summary-btn');
  if (!existing) {
    const editBtn = document.createElement('button');
    editBtn.id = 'edit-summary-btn';
    editBtn.textContent = 'Editar Tabla Resumen';
    editBtn.className = 'se-control-btn';
    editBtn.title = 'Abrir editor por categorías (modal)';

    // Insertar en la primera zona de controles (intenta colocarlo junto a otros botones)
    const controlsArea = document.querySelector('.controls > div:first-child');
    if (controlsArea) controlsArea.insertBefore(editBtn, controlsArea.firstChild);
    else (document.querySelector('.controls') || document.body).appendChild(editBtn);

    editBtn.addEventListener('click', () => {
      // lazy-load the editor script if not yet loaded
      try {
        // Use existing global SummaryEditor if loaded
        if (window.SummaryEditor) {
          window.SummaryEditor.open({
            rows: JSON.parse(JSON.stringify(rows)),
            fixedCols: fixedCols.slice(),
            dynCols: dynCols.slice(),
            subtitles: SUBTITLES,
            onApply: function(newRows){
              // replace in-memory rows and re-render
              rows = newRows;
              renderTable();
            }
          });
          return;
        }
        // otherwise load static/summaryEditor.js and summaryEditor.css
        const s = document.createElement('script');
        s.src = '/static/summaryEditor.js';
        s.onload = () => {
          // try to load CSS too
          const cssId = 'summary-editor-css';
          if (!document.getElementById(cssId)) {
            const l = document.createElement('link');
            l.id = cssId;
            l.rel = 'stylesheet';
            l.href = '/static/summaryEditor.css';
            document.head.appendChild(l);
          }
          if (window.SummaryEditor && typeof window.SummaryEditor.open === 'function') {
            window.SummaryEditor.open({
              rows: JSON.parse(JSON.stringify(rows)),
              fixedCols: fixedCols.slice(),
              dynCols: dynCols.slice(),
              subtitles: SUBTITLES,
              onApply: function(newRows){
                rows = newRows;
                renderTable();
              }
            });
          } else {
            console.error('SummaryEditor cargado pero no expone .open()');
          }
        };
        document.body.appendChild(s);
      } catch (e) { console.error('Error al abrir editor:', e); }
    });
  }
})();
// --- END: fragment añadido ---

// --- START: fragment añadido: botón "Calcular" (llama a módulo externo resultados.js si está disponible) ---
// Insertamos únicamente el código mínimo necesario para añadir el botón "Calcular" en la misma línea
// donde está "Editar Tabla Resumen". El fragmento NO oculta ningún texto de ayuda.
(function(){
  // Avoid adding multiple times
  if (document.querySelector('button#calcular-btn')) return;

  function ensureResultadosAssets(onReady) {
    // If Results module already loaded, call immediately
    if (window.Resultados && typeof window.Resultados.show === 'function') {
      return onReady && onReady();
    }
    // Load CSS if not present
    const cssId = 'resultados-css';
    if (!document.getElementById(cssId)) {
      const l = document.createElement('link');
      l.id = cssId;
      l.rel = 'stylesheet';
      l.href = '/static/resultados.css';
      document.head.appendChild(l);
    }
    // Load JS
    const existingScript = Array.from(document.querySelectorAll('script')).find(s => (s.src || '').indexOf('/static/resultados.js') !== -1);
    if (existingScript) {
      // if script already added but not ready yet, wait a bit
      const checkReady = () => {
        if (window.Resultados && typeof window.Resultados.show === 'function') return onReady && onReady();
        setTimeout(checkReady, 80);
      };
      setTimeout(checkReady, 80);
      return;
    }
    const s = document.createElement('script');
    s.src = '/static/resultados.js';
    s.onload = () => { setTimeout(() => { onReady && onReady(); }, 30); };
    s.onerror = () => { console.error('No se pudo cargar /static/resultados.js'); onReady && onReady(); };
    document.body.appendChild(s);
  }

  function onCalcularClick() {
    if (window.Resultados && typeof window.Resultados.show === 'function') {
      try { window.Resultados.show(); return; } catch (e) { console.error(e); }
    }
    // lazy-load resultados module assets and then call
    ensureResultadosAssets(() => {
      if (window.Resultados && typeof window.Resultados.show === 'function') {
        try { window.Resultados.show(); } catch (e) { console.error(e); alert('Error al mostrar Resultados: ' + e.message); }
      } else {
        alert('Módulo Resultados no disponible. Asegúrate de incluir static/resultados.js.');
      }
    });
  }

  // Create button element
  const btn = document.createElement('button');
  btn.id = 'calcular-btn';
  btn.type = 'button';
  btn.className = 'se-control-btn calcular-btn';
  btn.textContent = 'Calcular';
  btn.title = 'Calcular y mostrar Resultados';
  btn.addEventListener('click', onCalcularClick);

  // Try to place the button: prefer next to edit-summary-btn; else at end of .controls
  let placed = false;
  const editBtn = document.getElementById('edit-summary-btn') || Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'Editar Tabla Resumen');
  if (editBtn && editBtn.parentNode) {
    editBtn.parentNode.insertBefore(btn, editBtn.nextSibling);
    placed = true;
  }

  if (!placed) {
    const headerArea = document.querySelector('.page-header, .header, .controls, .toolbar') || document.body;
    headerArea.insertBefore(btn, headerArea.firstChild);
  }
})();
  // --- END: fragment añadido ---

// Ocultar/desactivar el botón "Agregar línea" (lo dejamos para restaurar si quieres)
if (addRowBtn) {
  try {
    addRowBtn.style.display = 'none';
    addRowBtn.disabled = true;
  } catch (e) { /* ignore */ }
}

if (reconfigureBtn) reconfigureBtn.addEventListener('click', () => {
  if (!confirm('Volver a configuración inicial y perder los cambios actuales?')) return;
  dynCols = [];
  rows = [];
  showSetupScreen();
});

// Mostrar pantallas
function showSetupScreen() {
  if (!setupScreen || !tableScreen) return;
  setupScreen.classList.remove('hidden');
  tableScreen.classList.add('hidden');
}
function showTableScreen() {
  if (!setupScreen || !tableScreen) return;
  setupScreen.classList.add('hidden');
  tableScreen.classList.remove('hidden');
}

// --- SUBTITULOS: helper para crear las primeras 4 filas ---
const SUBTITLES = [
  'Costos asignados directamente',
  'Costos a repartir',
  'Departamentos apoyo',
  'Referencia costo unitario'
];

function makeSubtitleRow(id, text) {
  const vals = {};
  fixedCols.concat(dynCols).forEach(col => { vals[col.id] = ''; });
  vals['c1'] = text;
  return { id, isSubtitle: true, subtitleText: text, values: vals };
}

function createBaseRowsWithSubtitles(dataRows) {
  const out = [];
  for (let i = 0; i < SUBTITLES.length; i++) {
    out.push(makeSubtitleRow(i + 1, SUBTITLES[i]));
  }
  let nextId = out.length + 1;
  if (Array.isArray(dataRows)) {
    for (const dr of dataRows) {
      const r = Object.assign({}, dr);
      r.id = nextId++;
      r.isSubtitle = false;
      out.push(r);
    }
  }
  nextRowId = out.length + 1;
  return out;
}

// Ejemplo embebido (solo para demo)
function loadExample() {
  dynCols = [
    { id: 'd1', label: 'A-1', type: 'A' },
    { id: 'd2', label: 'A-2', type: 'A' },
    { id: 'd3', label: 'A-3', type: 'A' },
    { id: 'd4', label: 'B-1', type: 'B' },
    { id: 'd5', label: 'B-2', type: 'B' }
  ];

  const dataRows = [
    { values: { c1: '1', c2: 'Item X1', c3: 'x', d1: '10', d2: '12', d3: '8', d4: '5', d5: '3' } },
    { values: { c1: '2', c2: 'Item Y1', c3: 'y', d1: '7', d2: '9', d3: '6', d4: '0', d5: '1' } },
    { values: { c1: '3', c2: 'Item B1', c3: 'B', d1: '', d2: '', d3: '', d4: '2', d5: '4' } },
    { values: { c1: '4', c2: 'Item Z1', c3: 'z', d1: '3', d2: '4', d3: '1', d4: '0', d5: '0' } }
  ];

  rows = createBaseRowsWithSubtitles(dataRows);
}

// ----------------- VALIDACIÓN Y FORMATO DE ENCABEZADOS -----------------
function validateHeaderText(raw) {
  const MAX_WORDS = 2;
  const MAX_CHARS = 13;
  if (raw == null) return { valid: false, message: 'Texto vacío', parts: [] };
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length === 0) return { valid: false, message: 'Texto vacío', parts: [] };
  const tokens = s.split(' ');
  if (tokens.length > MAX_WORDS) {
    return {
      valid: false,
      message: 'Solo se permiten máximo 2 palabras en el encabezado.',
      parts: tokens.slice(0, MAX_WORDS)
    };
  }
  for (let t of tokens) {
    if (t.length > MAX_CHARS) {
      return {
        valid: false,
        message: `Cada palabra puede tener hasta ${MAX_CHARS} caracteres. "${t}" tiene ${t.length}.`,
        parts: tokens
      };
    }
  }
  return { valid: true, message: null, parts: tokens };
}

function formatHeaderDisplay(th, parts) {
  if (!parts || parts.length === 0) {
    th.textContent = '';
    return;
  }
  if (parts.length === 1) {
    th.textContent = parts[0];
  } else {
    const combined = (parts[0] + parts[1]).length;
    if (combined <= 13) {
      th.textContent = parts[0] + ' ' + parts[1];
    } else {
      th.innerHTML = escapeHtml(parts[0]) + '<br>' + escapeHtml(parts[1]);
    }
  }
  th.title = parts.join(' ');
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let msgTimeout = null;
function showErrorMessage(msg, ms = 4000) {
  if (!msgArea) return;
  clearTimeout(msgTimeout);
  msgArea.innerHTML = `<span class="error">${escapeHtml(msg)}</span>`;
  if (ms > 0) {
    msgTimeout = setTimeout(() => { msgArea.innerHTML = ''; }, ms);
  }
}

// ----------------- RENDER -----------------
function renderTable() {
  if (!table) return;
  table.innerHTML = '';
  const allCols = fixedCols.concat(dynCols);

  // Colgroup
  const colgroup = document.createElement('colgroup');
  allCols.forEach((col, idx) => {
    const colEl = document.createElement('col');
    colEl.style.width = getColWidthPx(col, idx);
    colgroup.appendChild(colEl);
  });
  table.appendChild(colgroup);

  // THEAD
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  allCols.forEach((col, idx) => {
    const th = document.createElement('th');
    const v = validateHeaderText(col.label || '');
    if (v.valid) {
      formatHeaderDisplay(th, v.parts);
    } else {
      th.textContent = col.label || '';
    }

    if (col.type === 'A') th.classList.add('col-type-A');
    if (col.type === 'B') th.classList.add('col-type-B');

    th.title = col.label || '';
    th.dataset.prevLabel = col.label || '';

    if (idx >= FIXED_COUNT) {
      th.addEventListener('dblclick', () => {
        th.contentEditable = 'true';
        th.focus();
        selectElementText(th);
      });
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          th.blur();
        }
      });
      th.addEventListener('blur', () => {
        if (th.contentEditable === 'true') {
          th.contentEditable = 'false';
          const newRaw = th.textContent.trim();
          const vres = validateHeaderText(newRaw);
          if (!vres.valid) {
            showErrorMessage(vres.message);
            th.classList.add('th-error');
            setTimeout(() => th.classList.remove('th-error'), 1200);
            const prev = th.dataset.prevLabel || '';
            th.textContent = prev;
            th.title = prev;
            return;
          }
          if (idx < FIXED_COUNT) {
            fixedCols[idx].label = newRaw;
          } else {
            dynCols[idx - FIXED_COUNT].label = newRaw;
          }
          formatHeaderDisplay(th, vres.parts);
        }
      });
    } else {
      th.setAttribute('aria-disabled', 'true');
    }

    if (idx < FIXED_COUNT) {
      th.classList.add('fixed-col');
      th.dataset.colIndex = idx;
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  // TBODY
  const tbody = document.createElement('tbody');
  let subtitleCounter = -1;

  rows.forEach((row, rIdx) => {
    const tr = document.createElement('tr');

    if (row.isSubtitle) {
      subtitleCounter++;
      tr.classList.add('subtitle-row');
      fixedCols.concat(dynCols).forEach((col, cIdx) => {
        const td = document.createElement('td');
        td.dataset.row = rIdx;
        td.dataset.colId = col.id;

        if (cIdx === 0) {
          const container = document.createElement('div');
          container.style.display = 'flex';
          container.style.alignItems = 'center';
          container.style.justifyContent = 'center';
          container.style.gap = '8px';

          const txt = document.createElement('strong');
          txt.innerHTML = escapeHtml(row.subtitleText);
          container.appendChild(txt);

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'subtitle-add-btn';
          btn.title = 'Agregar fila debajo';
          btn.innerText = '+';
          const subIndex = subtitleCounter;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (subIndex === 0 || subIndex === 1 || subIndex === 2 || subIndex === 3) {
              showInsertModalForSubtitle(subIndex);
            } else {
              addRowUnderSubtitle(subIndex);
            }
          });
          container.appendChild(btn);

          td.appendChild(container);
          td.style.textAlign = 'center';
        } else {
          td.textContent = '';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      return;
    }

    fixedCols.concat(dynCols).forEach((col, cIdx) => {
      const td = document.createElement('td');
      const rawVal = row.values[col.id] || '';
      // formatear si es un número; si no, mostrar tal cual
      const nf = normalizeAndFormatValue(rawVal);
      td.textContent = nf.formatted;
      // conservar el valor canonical para un acceso futuro si lo deseas (no obligatorio)
      td.dataset.valueCanonical = nf.canonical;
      td.dataset.row = rIdx;
      td.dataset.colId = col.id;

      // --- START: FIX para pegar (recordar celda destino) ---
      td.tabIndex = 0; // hacer focusable la celda

      // Use pointerdown (fired earlier than click) to reliably remember the intended target
      td.addEventListener('pointerdown', (ev) => {
        try {
          window._lastFocusedTd = td;
          // Guardar coordenada de inicio: fila y columna absoluta dentro de allCols
          window._lastFocusedCoords = { row: rIdx, colIndex: cIdx };
          // Intentar enfocar para que activeElement apunte aquí
          td.focus();
        } catch (e) {
          try { window._lastFocusedTd = td; } catch (e2) {}
        }
      });

      // Compatibilidad: también recordar en click y dblclick (no reemplaza listeners existentes)
      td.addEventListener('click', () => {
        try { window._lastFocusedTd = td; td.focus(); } catch (e) { window._lastFocusedTd = td; }
      });

      td.addEventListener('dblclick', () => {
        // actualizar referencia antes de entrar en modo edición
        window._lastFocusedTd = td;
        td.contentEditable = 'true';
        td.focus();
        selectElementText(td);
      });
      // --- END: FIX para pegar (recordar celda destino) ---

      td.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          td.blur();
        }
      });
      td.addEventListener('blur', () => {
        if (td.contentEditable === 'true') {
          td.contentEditable = 'false';
          const userRaw = td.textContent;
          const rI = parseInt(td.dataset.row, 10);
          const cid = td.dataset.colId;
          // normalizar/validar
          const nf2 = normalizeAndFormatValue(userRaw);
          // si no es número lo dejamos tal cual (se muestra el texto tal cual); si es número guardamos canonical
          if (Number.isNaN(nf2.numeric)) {
            // dejar el texto como lo escribió el usuario
            if (rows[rI]) rows[rI].values[cid] = userRaw;
            // mostrar exactamente lo que escribió el usuario
            td.textContent = userRaw;
          } else {
            // guardar canonical (p.ej. "1234.5" o "1200")
            if (rows[rI]) rows[rI].values[cid] = nf2.canonical;
            // mostrar formato anglosajón
            td.textContent = nf2.formatted;
            td.dataset.valueCanonical = nf2.canonical;
          }
        }
      });

      if (cIdx < FIXED_COUNT) {
        td.classList.add('fixed-col');
        td.dataset.colIndex = cIdx;
      }

      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  // Calcular left para columnas fijas
  const fixedWidths = WIDTHS.fixed;
  document.querySelectorAll('.fixed-col').forEach(el => {
    const idx = parseInt(el.dataset.colIndex, 10);
    if (!Number.isNaN(idx)) {
      let left = 0;
      for (let i = 0; i < idx; i++) left += fixedWidths[i];
      el.style.left = left + 'px';
    }
  });

  // Ajustar ancho mínimo de la tabla
  const totalWidth = fixedCols.concat(dynCols).reduce((acc, col, idx) => {
    const wpx = getColWidthPx(col, idx);
    return acc + parseInt(wpx, 10);
  }, 0);
  table.style.minWidth = totalWidth + 'px';

  // ---- Aplicar centrado específico (desde fila 2 y columna 2 en adelante) ----
  // Llamada a la función que añade la clase .centered-cell a las TDs objetivo.
  // Colócala aquí (al final de renderTable) para que se reaplique tras cada render.
  applyCentering();

} // <- fin de renderTable()


// Utilidades
function selectElementText(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ----------------- PEGADO EN BLOQUE (capturado) con guard para modales/input -----------------
(function enableBlockPasteCaptureWithGuard() {
  const pasteTarget = wrapper || table || document;
  if (!pasteTarget) return;

  // parse HTML copied table into matrix
  function parseHtmlTable(html) {
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const trs = tmp.querySelectorAll('tr');
      const out = [];
      trs.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th,td')).map(td => td.innerText.trim());
        out.push(cells);
      });
      return out;
    } catch (e) {
      return [];
    }
  }

  // parse plain text (tabs/; ,) into matrix
  function parseTextTable(text) {
    const rawRows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (rawRows.length && rawRows[rawRows.length - 1].trim() === '') rawRows.pop();
    return rawRows.map(r => {
      if (r.indexOf('\t') !== -1) return r.split('\t').map(cell => cell);
      if (r.indexOf(';') !== -1) return r.split(';').map(cell => cell);
      return r.split(',').map(cell => cell);
    });
  }



  // --- Reemplazar la función pasteHandler existente por esta versión parcheada ---
const pasteHandler = (ev) => {
  // Normalizar target
  let target = ev.target || ev.srcElement;
  if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;

  // Si el paste viene desde un INPUT/TEXTAREA o desde dentro de un modal -> permitir comportamiento nativo
  let el = target;
  while (el && el !== document.body) {
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      return; // dejar que el control nativo maneje el paste
    }
    // Si el paste se hace dentro de una ventana modal, permitir (textarea del modal)
    if (el.classList && el.classList.contains('modal')) {
      return;
    }
    el = el.parentElement;
  }

  // localizar la celda TD actualmente enfocada (si el usuario hizo dblclick)
  let focusedTd = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const anchor = sel.anchorNode;
    if (anchor) {
      let node = (anchor.nodeType === Node.ELEMENT_NODE) ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node.tagName && node.tagName.toLowerCase() === 'td') { focusedTd = node; break; }
        node = node.parentElement;
      }
    }
  }

  // fallback por activeElement (por si el usuario hizo focus directo)
  if (!focusedTd && document.activeElement) {
    let node = document.activeElement;
    while (node && node !== document.body) {
      if (node.tagName && node.tagName.toLowerCase() === 'td') { focusedTd = node; break; }
      node = node.parentElement;
    }
  }

  // --- NEW FALLBACK: usar la última celda clicada / coordenadas si existe ---
  if (!focusedTd && window._lastFocusedCoords) {
    // Preferimos coords guardadas (más fiables para determinar fila/columna de inicio)
    const coords = window._lastFocusedCoords;
    const allCols = fixedCols.concat(dynCols);
    if (Number.isFinite(coords.colIndex) && coords.colIndex >= 0 && coords.colIndex < allCols.length) {
      const colId = allCols[coords.colIndex].id;
      const possible = document.querySelector(`#dynamic-table tbody td[data-row="${coords.row}"][data-col-id="${colId}"]`);
      if (possible) focusedTd = possible;
    }
  }
  if (!focusedTd && window._lastFocusedTd) {
    focusedTd = window._lastFocusedTd;
  }
  // --- END: NEW FALLBACK ---

  // si no hay td enfocado -> fallback a la primera celda de datos
  if (!focusedTd) {
    const firstDataTd = document.querySelector('#dynamic-table tbody tr:not(.subtitle-row) td');
    if (firstDataTd) focusedTd = firstDataTd;
  }

  // si no hay destino claro, no interferimos
  if (!focusedTd) return;

  // PREVENIR comportamiento por defecto para evitar que el navegador pegue TODO en la única celda
  ev.preventDefault();

  // obtener texto/html del clipboard
  let text = '';
  let html = '';
  if (ev.clipboardData && ev.clipboardData.getData) {
    text = ev.clipboardData.getData('text/plain') || '';
    html = ev.clipboardData.getData('text/html') || '';
  } else if (window.clipboardData && window.clipboardData.getData) {
    text = window.clipboardData.getData('Text') || '';
  }

  // parsear tabla desde texto o HTML
  let tableData = [];
  if (text && text.trim().length > 0) {
    const rawRows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (rawRows.length && rawRows[rawRows.length - 1].trim() === '') rawRows.pop();
    tableData = rawRows.map(r => {
      if (r.indexOf('\t') !== -1) return r.split('\t').map(cell => cell);
      if (r.indexOf(';') !== -1) return r.split(';').map(cell => cell);
      return r.split(',').map(cell => cell);
    });
  } else if (html && html.length > 0) {
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const trs = tmp.querySelectorAll('tr');
      const out = [];
      trs.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th,td')).map(td => td.innerText.trim());
        out.push(cells);
      });
      tableData = out;
    } catch (e) {
      tableData = [];
    }
  }

  if (!tableData || tableData.length === 0) return;

  // localizar posición de inicio en rows[] y en columnas (allCols)
  const allCols = fixedCols.concat(dynCols);
  const startRowDomIndex = parseInt(focusedTd.dataset.row, 10);
  let startRowIndex = Number.isNaN(startRowDomIndex) ? 0 : startRowDomIndex;
  // si apunta a subtitle, moverse al siguiente renglón útil
  if (rows[startRowIndex] && rows[startRowIndex].isSubtitle) {
    let r = startRowIndex + 1;
    while (r < rows.length && rows[r] && rows[r].isSubtitle) r++;
    if (r < rows.length) startRowIndex = r;
    else startRowIndex = rows.length;
  }

  const startColId = focusedTd.dataset.colId;
  let startColIndex = allCols.findIndex(c => c.id === startColId);
  // Si no encontramos startColIndex por id, usar las coords guardadas si existen
  if (startColIndex === -1 && window._lastFocusedCoords && Number.isFinite(window._lastFocusedCoords.colIndex)) {
    startColIndex = window._lastFocusedCoords.colIndex;
  }
  if (startColIndex === -1) startColIndex = 0;

  // PRE-CHECK filas
  const neededRows = startRowIndex + tableData.length;
  if (neededRows > MAX_ROWS) {
    if (!confirm(`El pegado requiere crear ${neededRows - rows.length} filas y excede el límite ${MAX_ROWS}. ¿Deseas continuar y truncar al máximo permitido?`)) {
      return;
    }
  }

  function ensureRowsUpTo(index) {
    while (rows.length <= index && rows.length < MAX_ROWS) {
      const vals = {};
      fixedCols.concat(dynCols).forEach(col => { vals[col.id] = ''; });
      rows.push({ id: nextRowId++, category: '', values: vals });
    }
  }

  // Aplicar valores (distribuir)
  for (let r = 0; r < tableData.length; r++) {
    let destRowIdx = startRowIndex + r;
    ensureRowsUpTo(destRowIdx);
    if (destRowIdx >= rows.length) break;

    // si destino es un subtitle, buscar siguiente fila util
    if (rows[destRowIdx] && rows[destRowIdx].isSubtitle) {
      let rr = destRowIdx + 1;
      while (rr < rows.length && rows[rr] && rows[rr].isSubtitle) rr++;
      if (rr >= rows.length) ensureRowsUpTo(rr);
      destRowIdx = rr;
    }

    const cols = tableData[r];
    for (let c = 0; c < cols.length; c++) {
      const destColIndex = startColIndex + c;
      if (destColIndex >= allCols.length) {
        if (c === 0) showErrorMessage('El bloque pegado tiene más columnas que la tabla actual. Se truncarán las columnas extra.');
        break;
      }
      const destColId = allCols[destColIndex].id;
      const rawVal = cols[c];
      if (!rows[destRowIdx]) continue;
      if (!rows[destRowIdx].values) rows[destRowIdx].values = {};
      // normalizar/formatar antes de guardar
      const nf = normalizeAndFormatValue(rawVal);
      rows[destRowIdx].values[destColId] = nf.canonical;
    }
  }

  // re-renderizar y mantener foco en la primera celda del bloque pegado
  renderTable();
  setTimeout(() => {
    const rowElems = Array.from(document.querySelectorAll('#dynamic-table tbody tr'));
    if (rowElems[startRowIndex]) {
      const targetRowEl = rowElems[startRowIndex];
      const cellIndexToFocus = startColIndex;
      const td = targetRowEl.querySelectorAll('td')[cellIndexToFocus];
      if (td) { td.focus(); selectElementText(td); }
    }
  }, 120);
};

  // registrar con capture:true para interceptar antes que los inputs/contentEditable
  document.addEventListener('paste', pasteHandler, true);
})();

// ----------------- CREAR MÚLTIPLES COLUMNAS (modal) -----------------
function showCreateColumnsModal(type) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  const title = document.createElement('h3');
  title.textContent = (type === 'A') ? 'Departamentos produccion' : 'Departamento apoyo';
  modal.appendChild(title);

  const input = document.createElement('textarea');
  input.className = 'modal-input';
  input.placeholder = 'Escribe nombres separados por coma o salto de línea...';
  modal.appendChild(input);

  const note = document.createElement('div');
  note.style.fontSize = '12px';
  note.style.color = '#555';
  note.style.margin = '6px 0 8px 0';
  note.textContent = 'Se crearán/editarán columnas en el mismo orden que escribas. No se ordenarán alfabéticamente. Regla: máximo 2 palabras, máximo 13 caracteres por palabra.';
  modal.appendChild(note);

  const errorBox = document.createElement('div');
  errorBox.style.fontSize = '13px';
  errorBox.style.color = '#b00020';
  errorBox.style.margin = '6px 0 10px 0';
  errorBox.style.display = 'none';
  modal.appendChild(errorBox);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'modal-cancel';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'modal-save';
  save.textContent = 'Crear columnas';
  save.disabled = true;

  save.addEventListener('click', () => {
    const raw = input.value || '';
    const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length === 0) {
      showErrorMessage('No se detectaron nombres válidos.');
      return;
    }
    const invalids = [];
    for (const p of parts) {
      const v = validateHeaderText(p);
      if (!v.valid) invalids.push({ name: p, message: v.message });
    }
    if (invalids.length > 0) {
      renderInvalidList(invalids, errorBox);
      showErrorMessage('Corrige los nombres inválidos antes de crear/editar las columnas.');
      return;
    }

    const existingInfo = [];
    dynCols.forEach((c, idx) => {
      if (c.type === type) existingInfo.push({ id: c.id, idx, label: c.label });
    });

    for (let i = 0; i < parts.length; i++) {
      if (i < existingInfo.length) {
        const colGlobalIndex = existingInfo[i].idx;
        dynCols[colGlobalIndex].label = parts[i];
      } else {
        addColumnWithLabel(parts[i], type);
      }
    }

    if (parts.length < existingInfo.length) {
      const toRemove = existingInfo.slice(parts.length).map(x => x.id);
      if (confirm(`Has eliminado líneas respecto de las columnas existentes. ¿Deseas eliminar las ${toRemove.length} columnas sobrantes?`)) {
        for (const remId of toRemove) {
          const curIdx = dynCols.findIndex(c => c.id === remId);
          if (curIdx !== -1) {
            const colId = dynCols[curIdx].id;
            dynCols.splice(curIdx, 1);
            rows.forEach(r => { if (r.values) delete r.values[colId]; });
          }
        }
      }
    }

    document.body.removeChild(overlay);
    renderTable();
  });

  btns.appendChild(cancel);
  btns.appendChild(save);
  modal.appendChild(btns);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const existingLabels = dynCols.filter(c => c.type === type).map(c => c.label || '').join('\n');
  input.value = existingLabels;

  function validateInputAndToggle() {
    const raw = input.value || '';
    const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length === 0) {
      errorBox.style.display = 'none';
      save.disabled = true;
      return;
    }
    const invalids = [];
    for (const p of parts) {
      const v = validateHeaderText(p);
      if (!v.valid) invalids.push({ name: p, message: v.message });
    }
    if (invalids.length > 0) {
      renderInvalidList(invalids, errorBox);
      save.disabled = true;
    } else {
      errorBox.style.display = 'none';
      save.disabled = false;
    }
  }

  input.addEventListener('input', validateInputAndToggle);
  setTimeout(() => { validateInputAndToggle(); input.focus(); }, 50);
}

function addColumnWithLabel(label, type) {
  const totalCols = fixedCols.length + dynCols.length;
  if (totalCols >= MAX_COLUMNS) {
    showErrorMessage(`No se pueden añadir más columnas (límite ${MAX_COLUMNS}).`);
    return;
  }
  let idxCounter = 1;
  while (dynCols.find(c => c.id === 'd' + idxCounter)) idxCounter++;
  const id = 'd' + idxCounter;
  const newCol = { id, label: label, type };

  if (type === 'A') {
    const firstBIndex = dynCols.findIndex(c => c.type === 'B');
    if (firstBIndex === -1) {
      dynCols.push(newCol);
    } else {
      dynCols.splice(firstBIndex, 0, newCol);
    }
  } else {
    dynCols.push(newCol);
  }

  rows.forEach(r => {
    if (!r.values) r.values = {};
    r.values[id] = '';
  });
}

// ----------------- INSERCIÓN MÚLTIPLE (modal) -----------------
function showInsertModalForSubtitle(subtitleIndex) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  const title = document.createElement('h3');
  title.textContent = SUBTITLES[subtitleIndex];
  modal.appendChild(title);

  const input = document.createElement('textarea');
  input.className = 'modal-input';
  input.placeholder = 'Escribe nombres separados por coma o salto de línea...';
  modal.appendChild(input);

  const hint = document.createElement('div');
  hint.style.fontSize = '12px';
  hint.style.color = '#555';
  hint.style.margin = '6px 0 8px 0';
  hint.textContent = 'Edite los nombres existentes (uno por línea). Agregar nuevas líneas crea nuevas filas; eliminar líneas puede eliminar filas existentes (se pedirá confirmación).';
  modal.appendChild(hint);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'modal-cancel';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'modal-save';
  save.textContent = 'Guardar y aplicar';
  save.addEventListener('click', () => {
    const raw = input.value || '';
    const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
    const subtitlePositions = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].isSubtitle) subtitlePositions.push(i);
    }
    const pos = subtitlePositions[subtitleIndex];
    const insertAt = (typeof pos === 'number' && pos !== undefined) ? pos + 1 : rows.length;
    const nextPos = (subtitleIndex + 1 < subtitlePositions.length) ? subtitlePositions[subtitleIndex + 1] : rows.length;
    const existingCount = Math.max(0, nextPos - insertAt);

    for (let i = 0; i < parts.length; i++) {
      if (i < existingCount) {
        const targetIdx = insertAt + i;
        if (rows[targetIdx]) rows[targetIdx].values['c1'] = parts[i];
      } else {
        const vals = {};
        fixedCols.concat(dynCols).forEach(col => vals[col.id] = '');
        vals['c1'] = parts[i];
        const isDepartmentsSupport = (SUBTITLES[subtitleIndex] === 'Departamentos apoyo');
        if (subtitleIndex === 0) {
          vals['c3'] = 'Directa';
        } else if (isDepartmentsSupport) {
          vals['c2'] = 'A calcular';
        }
        const newRow = { id: nextRowId++, isSubtitle: false, values: vals };
        rows.splice(insertAt + i, 0, newRow);
      }
    }

    if (parts.length < existingCount) {
      const toRemoveCount = existingCount - parts.length;
      if (confirm(`Has eliminado ${toRemoveCount} nombres respecto a las filas existentes en este bloque. ¿Deseas eliminar las ${toRemoveCount} filas sobrantes?`)) {
        rows.splice(insertAt + parts.length, toRemoveCount);
      }
    }

    if ([0,1,3].includes(subtitleIndex)) {
      sortBlockUnderSubtitle(subtitleIndex);
    }

    document.body.removeChild(overlay);
    renderTable();
  });

  btns.appendChild(cancel);
  btns.appendChild(save);
  modal.appendChild(btns);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const subtitlePositions = [];
  for (let i = 0; i < rows.length; i++) if (rows[i].isSubtitle) subtitlePositions.push(i);
  const pos = subtitlePositions[subtitleIndex];
  const start = (typeof pos === 'number' && pos !== undefined) ? pos + 1 : rows.length;
  const end = (subtitleIndex + 1 < subtitlePositions.length) ? subtitlePositions[subtitleIndex + 1] : rows.length;
  const names = [];
  for (let i = start; i < end; i++) {
    if (rows[i] && !rows[i].isSubtitle) {
      names.push(rows[i].values['c1'] || '');
    }
  }
  input.value = names.join('\n');

  setTimeout(() => input.focus(), 50);
}

// ----------------- HELPER: ordenar bloque bajo subtítulo -----------------
function sortBlockUnderSubtitle(subtitleIndex) {
  const subtitlePositions = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].isSubtitle) subtitlePositions.push(i);
  }
  const startPos = subtitlePositions[subtitleIndex];
  if (typeof startPos !== 'number' || startPos === undefined) return;
  const nextPos = (subtitleIndex + 1 < subtitlePositions.length) ? subtitlePositions[subtitleIndex + 1] : rows.length;
  const block = rows.slice(startPos + 1, nextPos);
  if (block.length === 0) return;
  const sorted = block.slice().sort((a, b) => {
    const va = String((a.values && a.values['c1']) || '').trim().toLowerCase();
    const vb = String((b.values && b.values['c1']) || '').trim().toLowerCase();
    return va.localeCompare(vb, undefined, { sensitivity: 'base' });
  });
  rows.splice(startPos + 1, block.length, ...sorted);
}

// ----------------- insertar múltiples filas (helper) -----------------
function addMultipleRowsUnderSubtitle(subtitleIndex, names) {
  const subtitlePositions = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].isSubtitle) subtitlePositions.push(i);
  }
  const pos = subtitlePositions[subtitleIndex];
  const insertAt = (typeof pos === 'number' && pos !== undefined) ? pos + 1 : rows.length;

  const newRows = [];
  for (let i = 0; i < names.length; i++) {
    const vals = {};
    fixedCols.concat(dynCols).forEach(col => vals[col.id] = '');
    vals['c1'] = names[i];
    const isDepartmentsSupport = (SUBTITLES[subtitleIndex] === 'Departamentos apoyo');
    if (subtitleIndex === 0) {
      vals['c3'] = 'Directa';
    } else if (isDepartmentsSupport) {
      vals['c2'] = 'A calcular';
    }
    const newRow = { id: nextRowId++, isSubtitle: false, values: vals };
    newRows.push(newRow);
  }

  rows.splice(insertAt, 0, ...newRows);

  if ([0, 1, 3].includes(subtitleIndex)) {
    sortBlockUnderSubtitle(subtitleIndex);
  }

  renderTable();

  setTimeout(() => {
    const subtitlePositions2 = [];
    for (let i = 0; i < rows.length; i++) if (rows[i].isSubtitle) subtitlePositions2.push(i);
    const startPos = (typeof subtitlePositions2[subtitleIndex] === 'number') ? subtitlePositions2[subtitleIndex] : null;
    const domIndexToFocus = (startPos !== null) ? startPos + 1 : null;

    const rowElems = Array.from(document.querySelectorAll('#dynamic-table tbody tr'));
    if (domIndexToFocus !== null && rowElems[domIndexToFocus]) {
      const firstTd = rowElems[domIndexToFocus].querySelector('td');
      if (firstTd) { firstTd.focus(); selectElementText(firstTd); }
    }
  }, 120);
}

// ----------------- insertar UNA fila -----------------
function addRowUnderSubtitle(subtitleIndex) {
  const subtitlePositions = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].isSubtitle) subtitlePositions.push(i);
  }
  const pos = subtitlePositions[subtitleIndex];
  const insertAt = (typeof pos === 'number' && pos !== undefined) ? pos + 1 : rows.length;

  const vals = {};
  fixedCols.concat(dynCols).forEach(col => vals[col.id] = '');
  const isDepartmentsSupport = (SUBTITLES[subtitleIndex] === 'Departamentos apoyo');
  if (subtitleIndex === 0) {
    vals['c3'] = 'Directa';
  } else if (isDepartmentsSupport) {
    vals['c2'] = 'A calcular';
  }

  const newRow = { id: nextRowId++, isSubtitle: false, values: vals };
  rows.splice(insertAt, 0, newRow);

  if ([0, 1, 3].includes(subtitleIndex)) {
    sortBlockUnderSubtitle(subtitleIndex);
  }

  renderTable();

  setTimeout(() => {
    const subtitlePositions2 = [];
    for (let i = 0; i < rows.length; i++) if (rows[i].isSubtitle) subtitlePositions2.push(i);
    const startPos = (typeof subtitlePositions2[subtitleIndex] === 'number') ? subtitlePositions2[subtitleIndex] : null;
    const domIndexToFocus = (startPos !== null) ? startPos + 1 : null;

    const rowElems = Array.from(document.querySelectorAll('#dynamic-table tbody tr'));
    if (domIndexToFocus !== null && rowElems[domIndexToFocus]) {
      const firstTd = rowElems[domIndexToFocus].querySelector('td');
      if (firstTd) { firstTd.focus(); selectElementText(firstTd); }
    }
  }, 120);
}

function addColumn(type) {
  const totalCols = fixedCols.length + dynCols.length;
  if (totalCols >= MAX_COLUMNS) {
    showErrorMessage(`No se pueden añadir más columnas (límite ${MAX_COLUMNS}).`);
    return;
  }
  const newIndex = dynCols.length + 1;
  const id = 'd' + newIndex;
  const label = `${type}-${dynCols.filter(c => c.type === type).length + 1}`;
  const newCol = { id, label, type };

  if (type === 'A') {
    const firstBIndex = dynCols.findIndex(c => c.type === 'B');
    if (firstBIndex === -1) {
      dynCols.push(newCol);
    } else {
      dynCols.splice(firstBIndex, 0, newCol);
    }
  } else {
    dynCols.push(newCol);
  }

  rows.forEach(r => {
    if (!r.values) r.values = {};
    r.values[id] = '';
  });

  renderTable();
  setTimeout(() => { if (wrapper) wrapper.scrollLeft = wrapper.scrollWidth; }, 50);
}

function bulkAddColumns(count, baseName, type) {
  for (let i = 0; i < count; i++) {
    const labelIndex = dynCols.filter(c => c.type === type).length + 1;
    const id = 'd' + (dynCols.length + 1);
    const label = `${baseName}-${labelIndex}`;
    const newCol = { id, label, type };
    if (type === 'A') {
      const firstBIndex = dynCols.findIndex(c => c.type === 'B');
      if (firstBIndex === -1) {
        dynCols.push(newCol);
      } else {
        dynCols.splice(firstBIndex, 0, newCol);
      }
    } else {
      dynCols.push(newCol);
    }
    rows.forEach(r => {
      if (!r.values) r.values = {};
      r.values[id] = '';
    });
  }
}

function addRow() {
  if (rows.length >= MAX_ROWS) {
    showErrorMessage(`No se pueden añadir más filas (límite ${MAX_ROWS}).`);
    return;
  }
  const id = nextRowId++;
  const values = {};
  fixedCols.concat(dynCols).forEach(col => {
    if (col.id === 'c1') values[col.id] = String(id);
    else values[col.id] = '';
  });
  rows.push({ id, category: '', values });
  renderTable();
  setTimeout(() => { if (wrapper) wrapper.scrollTop = wrapper.scrollHeight; }, 50);
}

// ----------------- Función applyCentering (scope global en este fichero) -----------------
function applyCentering() {
  if (!table) return;
  // eliminar clases previas para evitar acumulación si la tabla cambia
  const prev = table.querySelectorAll('td.centered-cell');
  prev.forEach(td => td.classList.remove('centered-cell'));

  // seleccionar filas del tbody
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const trElems = Array.from(tbody.querySelectorAll('tr'));

  trElems.forEach(tr => {
    // intentar leer el índice de fila desde el primer td (dataset.row)
    const firstTd = tr.querySelector('td');
    if (!firstTd) return;
    const rowIndex = parseInt(firstTd.dataset.row, 10);
    if (Number.isNaN(rowIndex)) return;

    // saltar filas de subtítulo (rows[rowIndex].isSubtitle === true)
    if (rows[rowIndex] && rows[rowIndex].isSubtitle) return;

    // empezar desde la segunda fila (índice >= 1)
    if (rowIndex < 1) return;

    const tds = Array.from(tr.querySelectorAll('td'));
    // recorrer celdas desde la segunda columna (índice 1)
    for (let ci = 1; ci < tds.length; ci++) {
      tds[ci].classList.add('centered-cell');
    }
  });
}

// Inicial: mostrar setup
showSetupScreen();

// ----------------- INSERCIÓN DE CONTROLES DE GUARDADO/CARGA EN LA BARRA (si existe) ---------------
(function insertSaveLoadControlsIntoUI(){
  const controlsArea = document.querySelector('.controls > div:first-child');
  if (!controlsArea) return;

  // Avoid adding twice
  if (document.getElementById('input-company-name')) return;

  // Container to group inputs
  const wrapperDiv = document.createElement('div');
  wrapperDiv.className = 'save-load-controls';
  wrapperDiv.style.display = 'flex';
  wrapperDiv.style.alignItems = 'center';
  wrapperDiv.style.gap = '8px';
  wrapperDiv.style.marginRight = '8px';

  // Company name input
  const inputCompany = document.createElement('input');
  inputCompany.type = 'text';
  inputCompany.id = 'input-company-name';
  inputCompany.placeholder = 'Nombre empresa (opcional)';
  inputCompany.style.padding = '6px 8px';
  inputCompany.style.border = '1px solid #ccc';
  inputCompany.style.borderRadius = '4px';
  inputCompany.style.minWidth = '220px';
  wrapperDiv.appendChild(inputCompany);

  // Save button
  const btnSaveStr = document.createElement('button');
  btnSaveStr.type = 'button';
  btnSaveStr.id = 'btn-save-structure';
  btnSaveStr.textContent = 'Guardar estructura';
  btnSaveStr.title = 'Guardar la estructura actual en este navegador';
  btnSaveStr.addEventListener('click', () => {
    openSaveStructurePrompt();
  });
  wrapperDiv.appendChild(btnSaveStr);

  // Load button
  const btnLoadStr = document.createElement('button');
  btnLoadStr.type = 'button';
  btnLoadStr.id = 'btn-load-structure';
  btnLoadStr.textContent = 'Cargar estructura';
  btnLoadStr.title = 'Cargar una estructura guardada';
  btnLoadStr.addEventListener('click', () => {
    openLoadStructuresModal();
  });
  wrapperDiv.appendChild(btnLoadStr);

  // Insert at beginning of controls area
  controlsArea.insertBefore(wrapperDiv, controlsArea.firstChild);
})();