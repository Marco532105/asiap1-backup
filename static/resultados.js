// static/resultados.js — Resultados (read-only snapshot + sync header styles)
// Proyecto: asiap — as simple as possible
// Prioridades:
//  - reproducir visualmente la Tabla Resumen exactamente (colores, anchos, formato de header)
//  - vista read-only (sin edición)
//  - construir desde modelo (window.fixedCols/dynCols/rows) o fallback a clon DOM
//  - export CSV, ocultar/restaurar tabla original
//
// ADICIONES/REAJUSTES:
//  - inserta fila "Costos primarios" antes de "Departamentos apoyo" (no muta el modelo).
//  - en filas de "Costos a repartir" reemplaza drivers por importes prorrateados en la vista Resultados.
//  - elimina el botón/placeholder "+" en la fila "Costos primarios" (ahora no editable).
//  - no renderiza los subtítulos "Costos asignados directamente" y "Costos a repartir" en la vista Resultados.
//  - mantiene fallback DOM si el modelo no está expuesto en window.
//  - añade fila final "TPA" en ambos caminos (model y fallback DOM), subtítulo centrado y con tamaño de fuente ajustado.
//  - añade fila "DA/DP" justo debajo de "Departamentos apoyo" y fila "Costos finales por departamento" justo debajo de "Referencia costo unitario".
//  - evita duplicados de subtítulos (DA/DP, Costos finales, TPA).
//

(function () {
  if (window.__resultadosModuleLoaded) return;
  window.__resultadosModuleLoaded = true;

  // ---- util ----
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  // ---- remove legacy containers ----
  function removeLegacyResultadosContainers() {
    ['#results-container','#resultados-container','.results-container','.resultados-container'].forEach(sel=>{
      qa(sel).forEach(el=>{ try{ el.parentElement && el.parentElement.removeChild(el); }catch(e){} });
    });
  }

  // ---- sanitize clone but keep visual parity (buttons -> spans inert) ----
  function cleanClonedTable(clone) {
    // remove ids and scripts
    qa('[id]', clone).forEach(el => el.removeAttribute('id'));
    qa('script', clone).forEach(s => s.remove());
    qa('[contenteditable]', clone).forEach(el => el.removeAttribute('contenteditable'));
    qa('[tabindex]', clone).forEach(el => el.removeAttribute('tabindex'));
    qa('[data-validation-highlight]', clone).forEach(el => el.removeAttribute('data-validation-highlight'));

    // replace form controls with inert spans (preserve visible value)
    qa('input, select, textarea', clone).forEach(el => {
      try {
        const span = document.createElement('span');
        span.className = 'resultados-control-placeholder';
        if (el.tagName.toLowerCase() === 'select') {
          const opt = el.options && el.options[el.selectedIndex];
          span.textContent = (opt && opt.text) ? opt.text : (el.value || '');
        } else {
          span.textContent = el.value || el.textContent || '';
        }
        el.parentElement && el.parentElement.replaceChild(span, el);
      } catch (e) {}
    });

    // convert buttons to inert spans to preserve look
    qa('button', clone).forEach(btn => {
      try {
        const span = document.createElement('span');
        const cls = Array.from(btn.classList || []);
        cls.push('btn-placeholder');
        span.className = cls.join(' ');
        span.innerHTML = btn.innerHTML;
        if (btn.title) span.title = btn.title;
        btn.parentElement && btn.parentElement.replaceChild(span, btn);
      } catch (e) {}
    });

    return clone;
  }

  // ---- centering rule applied to a given table instance ----
  function applyCenteringToTable(table) {
    if (!table) return;
    // remove previous markers
    qa('td.centered-cell', table).forEach(td => td.classList.remove('centered-cell'));
    const tbody = q('tbody', table);
    if (!tbody) return;
    qa('tr', tbody).forEach(tr => {
      if (tr.classList.contains('subtitle-row')) return;
      const tds = qa('td', tr);
      for (let i = 1; i < tds.length; i++) tds[i].classList.add('centered-cell');
    });
  }

  // ---------------- ADICIÓN: Funciones para calcular Costos primarios y prorrateo --------------
  function parseNumeric(raw) {
    if (raw == null || raw === '') return NaN;
    try {
      if (window.AsiapCalc && typeof window.AsiapCalc.parseNumberString === 'function') {
        const n = window.AsiapCalc.parseNumberString(String(raw));
        if (Number.isFinite(n)) return n;
      }
    } catch (e) {}
    const s = String(raw).replace(/\u00A0/g,'').replace(/\s+/g,'').replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // map rows -> current section label (string) for model rows
  function mapRowSections(modelRows) {
    const map = new Array(modelRows.length).fill('');
    let current = '';
    for (let i = 0; i < modelRows.length; i++) {
      const r = modelRows[i];
      if (!r) { map[i] = current; continue; }
      if (r.isSubtitle) {
        current = (r.subtitleText || '').trim().toLowerCase();
        map[i] = current;
      } else {
        map[i] = current;
      }
    }
    return map;
  }

  // Compute totals and prorrateos from model; returns totals + apoyoPos.
  function computePrimaryTotalsFromModel(fixedCols, dynCols, rows, subtitles) {
    const totals = {};
    dynCols.forEach(c => { totals[c.id] = 0; });

    if (!Array.isArray(rows) || rows.length === 0) return { totals, found: false, apoyoPos: -1 };

    // locate subtitle positions
    const subtitlePositions = [];
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].isSubtitle) subtitlePositions.push(i);

    // find 'Departamentos apoyo'
    let apoyoSubtitlePos = -1;
    for (let si = 0; si < subtitlePositions.length; si++) {
      const pos = subtitlePositions[si];
      const label = (rows[pos] && rows[pos].subtitleText) ? String(rows[pos].subtitleText).trim().toLowerCase() : '';
      const subFromParam = (Array.isArray(subtitles) && subtitles[si]) ? String(subtitles[si]).trim().toLowerCase() : null;
      if (label === 'departamentos apoyo' || (subFromParam === 'departamentos apoyo') || label.indexOf('departamentos apoyo') !== -1) {
        apoyoSubtitlePos = pos;
        break;
      }
    }
    if (apoyoSubtitlePos === -1) return { totals, found: false, apoyoPos: -1 };

    // iterate rows up to apoyoSubtitlePos to compute totals and prorrateo for "Costos a repartir"
    let currentSection = '';
    for (let r = 0; r < apoyoSubtitlePos; r++) {
      const row = rows[r];
      if (!row) continue;
      if (row.isSubtitle) {
        currentSection = (row.subtitleText || '').trim().toLowerCase();
        continue;
      }

      // treat "costos asignados directamente" as direct amounts
      if (currentSection.indexOf('costos asignados') !== -1 || currentSection === '') {
        for (const c of dynCols) {
          const raw = (row.values && row.values[c.id] != null) ? row.values[c.id] : '';
          const n = parseNumeric(raw);
          if (Number.isFinite(n)) totals[c.id] += n;
        }
        continue;
      }

      // treat "costos a repartir": distribute costo across dynCols according to drivers
      if (currentSection.indexOf('costos a repartir') !== -1 || currentSection.indexOf('a repartir') !== -1) {
        // find costo column id
        const allCols = (fixedCols || []).concat(dynCols || []);
        let costoCol = allCols.find(col => col && col.label && String(col.label).trim().toLowerCase() === 'costo');
        if (!costoCol) costoCol = (fixedCols && fixedCols[1]) ? fixedCols[1] : null;
        const costoId = costoCol ? costoCol.id : null;
        const costoRaw = costoId ? ((row.values && row.values[costoId] != null) ? row.values[costoId] : '') : '';
        const costoTotal = parseNumeric(costoRaw);
        if (!Number.isFinite(costoTotal)) continue;
        // compute drivers and sum
        const drivers = dynCols.map(c => ({ id: c.id, val: parseNumeric((row.values && row.values[c.id] != null) ? row.values[c.id] : '') }));
        const sumDrv = drivers.reduce((s,x)=> s + (Number.isFinite(x.val)?x.val:0), 0);
        if (sumDrv <= 0) {
          console.warn('Resultados: fila "Costos a repartir" sin drivers válidos; omitiendo distribución para esa fila.', row);
          continue;
        }
        for (const d of drivers) {
          if (!Number.isFinite(d.val)) continue;
          totals[d.id] += costoTotal * (d.val / sumDrv);
        }
        continue;
      }

      // default fallback: sum dynCols
      for (const c of dynCols) {
        const raw = (row.values && row.values[c.id] != null) ? row.values[c.id] : '';
        const n = parseNumeric(raw);
        if (Number.isFinite(n)) totals[c.id] += n;
      }
    }

    return { totals, found: true, apoyoPos: apoyoSubtitlePos };
  }

  // Fallback DOM computation including prorrateo
  function computePrimaryTotalsFromDOM() {
    const table = document.getElementById('dynamic-table');
    if (!table) {
      console.warn('Resultados: fallback DOM no encontró #dynamic-table');
      return { totals: {}, found: false, apoyoPos: -1, dynFromDOM: [] };
    }
    const ths = table.querySelectorAll('thead th');
    const headers = Array.from(ths).map(th => (th.textContent || '').trim());
    const rowEls = Array.from(table.querySelectorAll('tbody tr'));

    // find apoyo index
    let apoyoDomIndex = -1;
    for (let i = 0; i < rowEls.length; i++) {
      const tr = rowEls[i];
      if (tr.classList.contains('subtitle-row')) {
        const firstTd = tr.querySelector('td');
        const strong = firstTd && firstTd.querySelector('strong');
        const txt = strong ? (strong.textContent||'').trim().toLowerCase() : (firstTd ? (firstTd.textContent||'').trim().toLowerCase() : '');
        if (txt === 'departamentos apoyo' || txt.indexOf('departamentos apoyo') !== -1 || txt.indexOf('departamentos de apoyo') !== -1) {
          apoyoDomIndex = i;
          break;
        }
      }
    }
    if (apoyoDomIndex === -1) {
      console.warn('Resultados: no se encontró subtítulo "Departamentos apoyo" en DOM');
      return { totals: {}, found: false, apoyoPos: -1, dynFromDOM: [] };
    }

    const FIXED = 3;
    const totalCols = Math.max(ths.length, rowEls[0] ? rowEls[0].querySelectorAll('td').length : FIXED);
    const dynIndices = [];
    for (let ci = FIXED; ci < totalCols; ci++) dynIndices.push(ci);
    const dynKeys = dynIndices.map(ci => ({ idx: ci, key: headers[ci] || ('col' + ci) }));
    const totals = {};
    dynKeys.forEach(dk => totals[dk.key] = 0);

    let currentSection = '';
    for (let r = 0; r < apoyoDomIndex; r++) {
      const tr = rowEls[r];
      if (!tr) continue;
      if (tr.classList.contains('subtitle-row')) {
        const firstTd = tr.querySelector('td');
        const strong = firstTd && firstTd.querySelector('strong');
        currentSection = strong ? (strong.textContent||'').trim().toLowerCase() : (firstTd ? (firstTd.textContent||'').trim().toLowerCase() : '');
        continue;
      }
      const tds = tr.querySelectorAll('td');
      if (currentSection.indexOf('costos asignados') !== -1 || currentSection === '') {
        dynKeys.forEach(dk => {
          const td = tds[dk.idx];
          if (!td) return;
          const n = parseNumberFromString((td.textContent||'').trim());
          if (Number.isFinite(n)) totals[dk.key] += n;
        });
      } else if (currentSection.indexOf('costos a repartir') !== -1 || currentSection.indexOf('a repartir') !== -1) {
        const costoTd = tds[1] || null;
        const costoVal = costoTd ? parseNumberFromString((costoTd.textContent||'').trim()) : NaN;
        if (!Number.isFinite(costoVal)) continue;
        const drivers = dynKeys.map(dk => {
          const td = tds[dk.idx];
          const val = td ? parseNumberFromString((td.textContent||'').trim()) : NaN;
          return { key: dk.key, val: Number.isFinite(val)?val:0 };
        });
        const sumDrv = drivers.reduce((s,x)=> s + (Number.isFinite(x.val)?x.val:0), 0);
        if (sumDrv <= 0) { console.warn('Resultados DOM: fila "Costos a repartir" sin drivers válidos; omitiendo distribución para esa fila.'); continue; }
        for (const d of drivers) {
          totals[d.key] += costoVal * (d.val / sumDrv);
        }
      } else {
        dynKeys.forEach(dk => {
          const td = tds[dk.idx];
          if (!td) return;
          const n = parseNumberFromString((td.textContent||'').trim());
          if (Number.isFinite(n)) totals[dk.key] += n;
        });
      }
    }

    return { totals, found: true, apoyoPos: apoyoDomIndex, dynFromDOM: dynKeys };
  }

  function parseNumberFromString(s) {
    if (s == null) return NaN;
    try {
      if (window.AsiapCalc && typeof window.AsiapCalc.parseNumberString === 'function') {
        return window.AsiapCalc.parseNumberString(String(s));
      }
    } catch (e) {}
    const cleaned = String(s).replace(/\u00A0/g,'').replace(/\s+/g,'').replace(/,/g,'').replace(/[^\d\.\-]/g,'');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  // ---------------- FIN ADICIÓN -------------------------------------------------

  // ---- container creation ----
  function ensureResultadosContainer() {
    removeLegacyResultadosContainers();
    let container = document.getElementById('resultados-container');
    if (container) return container;

    container = document.createElement('section');
    container.id = 'resultados-container';
    container.className = 'resultados-container';
    container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'resultados-header';
    const h = document.createElement('h3');
    h.textContent = 'Resultados';
    header.appendChild(h);

    const actions = document.createElement('div');
    actions.className = 'resultados-actions';

    const btnExport = document.createElement('button');
    btnExport.type = 'button';
    btnExport.className = 'btn btn-export-resultados';
    btnExport.textContent = 'Exportar CSV';
    btnExport.addEventListener('click', exportResultadosCSV);
    actions.appendChild(btnExport);

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn btn-close-resultados';
    btnClose.textContent = 'Cerrar';
    btnClose.addEventListener('click', ()=>{ container.style.display='none'; restoreDynamicTable(); });
    actions.appendChild(btnClose);

    header.appendChild(actions);
    container.appendChild(header);

    const content = document.createElement('div');
    content.className = 'resultados-content';
    container.appendChild(content);

    const mainTable = document.querySelector('#dynamic-table');
    if (mainTable && mainTable.parentElement) mainTable.parentElement.insertBefore(container, mainTable.nextSibling);
    else (document.querySelector('main')||document.body).insertBefore(container, (document.querySelector('main')||document.body).firstChild);

    return container;
  }

  // ---- export CSV ----
  function exportResultadosCSV() {
    const container = ensureResultadosContainer();
    const table = container.querySelector('.resultados-content table');
    if (!table) { alert('No hay resultados para exportar'); return; }
    const rows = Array.from(table.querySelectorAll('tr'));
    const csv = rows.map(tr =>{
      const cells = Array.from(tr.querySelectorAll('th,td'));
      return cells.map(td => `"${(td.textContent||'').replace(/"/g,'""').trim()}"`).join(',');
    }).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'resultados.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // Helper: create a subtitle-row TR with the provided text (first column) and optional fontSize
  function createSubtitleTR(text, allCols, fontSize) {
    const tr = document.createElement('tr');
    tr.classList.add('subtitle-row');
    const colsToUse = (allCols && allCols.length>0) ? allCols : Array.from(document.querySelectorAll('#dynamic-table thead th')).map((th,i)=>({ id:'col_'+i, label:(th.textContent||'').trim() }));
    colsToUse.forEach((col, cIdx) => {
      const td = document.createElement('td');
      if (cIdx === 0) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.gap = '8px';
        const strong = document.createElement('strong');
        strong.textContent = text;
        if (fontSize) strong.style.fontSize = fontSize;
        container.appendChild(strong);
        td.appendChild(container);
        td.style.textAlign = 'center';
      } else {
        td.textContent = '';
      }
      tr.appendChild(td);
    });
    return tr;
  }

  // Helper: check whether a subtitle with exact text exists anywhere in the tbody
  function subtitleExistsInTbody(tbody, text) {
    if (!tbody || !text) return false;
    const subs = Array.from(tbody.querySelectorAll('tr.subtitle-row'));
    const needle = (text || '').trim().toLowerCase();
    for (const r of subs) {
      const firstTd = r.querySelector('td');
      const strong = firstTd && firstTd.querySelector('strong');
      const txt = strong ? (strong.textContent||'').trim().toLowerCase() : (firstTd ? (firstTd.textContent||'').trim().toLowerCase() : '');
      if (txt === needle) return true;
    }
    return false;
  }

  // Helper: insert a subtitle row AFTER the first subtitle in tbody whose first-cell strong contains matchText (case-insensitive)
  // This function is idempotent: will not insert if identical subtitle already exists immediately after or anywhere in tbody.
  function insertSubtitleAfterInTbody(tbody, matchText, newText, allCols, fontSize) {
    try {
      if (!tbody || !matchText || !newText) return false;
      // avoid global duplicates
      if (subtitleExistsInTbody(tbody, newText)) return false;

      const rows = Array.from(tbody.querySelectorAll('tr'));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.classList || !r.classList.contains('subtitle-row')) continue;
        const firstTd = r.querySelector('td');
        const strong = firstTd && firstTd.querySelector('strong');
        const txt = strong ? (strong.textContent||'').trim().toLowerCase() : (firstTd ? (firstTd.textContent||'').trim().toLowerCase() : '');
        if (txt.indexOf(matchText.toLowerCase()) !== -1) {
          // if next sibling is already the wanted subtitle, do nothing
          const next = r.nextElementSibling;
          if (next && next.classList && next.classList.contains('subtitle-row')) {
            const nStrong = next.querySelector('td strong');
            const nTxt = nStrong ? (nStrong.textContent||'').trim().toLowerCase() : '';
            if (nTxt === (newText||'').trim().toLowerCase()) return false;
          }
          const newTr = createSubtitleTR(newText, allCols, fontSize);
          if (r.nextSibling) tbody.insertBefore(newTr, r.nextSibling);
          else tbody.appendChild(newTr);
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // Helper: insert TPA row (subtítulo) at end of tbody. Keeps styling consistent with subtitle-row.
  // Idempotent: will not insert if tr.tpa-row already exists.
  function insertTPARowIntoTable(table, allCols) {
    try {
      if (!table) return;
      // avoid duplicates (global)
      const existing = table.querySelector('tr.tpa-row') || document.querySelector('#resultados-container .resultados-content table tr.tpa-row');
      if (existing) return;
      const colsToUseFinal = (allCols && allCols.length>0) ? allCols : Array.from(document.querySelectorAll('#dynamic-table thead th')).map((th,i)=>({ id:'col_'+i, label:(th.textContent||'').trim() }));
      const trTPA = document.createElement('tr');
      trTPA.classList.add('tpa-row','subtitle-row');
      colsToUseFinal.forEach((col, cIdx) => {
        const td = document.createElement('td');
        if (cIdx === 0) {
          const container = document.createElement('div');
          container.style.display = 'flex';
          container.style.alignItems = 'center';
          container.style.justifyContent = 'center';
          container.style.gap = '8px';
          const strong = document.createElement('strong');
          strong.textContent = 'TPA';
          // font set to 1em (adjustable)
          strong.style.fontSize = '1em';
          container.appendChild(strong);
          td.appendChild(container);
          td.style.textAlign = 'center';
        } else {
          td.textContent = '';
        }
        trTPA.appendChild(td);
      });
      const tb = table.querySelector('tbody') || table;
      if (tb) tb.appendChild(trTPA);
    } catch (e) {
      console.warn('Resultados: no se pudo insertar fila TPA', e);
    }
  }

  // ---- build from model (preferred) ----
  function buildTableFromModel() {
    if (!window.fixedCols && !window.dynCols && !window.rows) {
      console.debug('Resultados: buildTableFromModel detectó ausencia de modelo completo; procederá con fallback DOM para totales.');
    }
    const fixed = window.fixedCols || [];
    const dyn = window.dynCols || [];
    const modelRows = window.rows || [];
    const allCols = fixed.concat(dyn);

    // map row -> section for modelRows
    const rowSections = mapRowSections(modelRows);

    const table = document.createElement('table');
    table.className = 'resultados-table summary-clone';
    table.style.tableLayout = 'fixed';

    // ADICIÓN: calcular totales primarios (sin mutar el modelo). Esta función hace fallback a DOM si no hay modelo.
    const primaryTotalsInfo = (window.fixedCols && window.dynCols && window.rows)
      ? computePrimaryTotalsFromModel(fixed, dyn, modelRows, window.SUBTITLES || null)
      : computePrimaryTotalsFromDOM();

    // colgroup using getColWidthPx if available
    const colgroup = document.createElement('colgroup');
    allCols.forEach((col, idx) => {
      const c = document.createElement('col');
      try { c.style.width = (typeof window.getColWidthPx === 'function') ? getColWidthPx(col, idx) : (idx < (typeof FIXED_COUNT!=='undefined'?FIXED_COUNT:3) ? '110px':'110px'); } catch(e){ c.style.width = '110px'; }
      colgroup.appendChild(c);
    });
    table.appendChild(colgroup);

    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    if (allCols.length === 0) {
      const domThs = document.querySelectorAll('#dynamic-table thead th');
      if (domThs && domThs.length) {
        domThs.forEach(thDom => {
          const th = document.createElement('th');
          th.textContent = (thDom.textContent || '').trim();
          headRow.appendChild(th);
        });
      }
    } else {
      allCols.forEach((col, idx) => {
        const th = document.createElement('th');
        const rawLabel = col.label || '';
        if (typeof window.validateHeaderText === 'function') {
          const v = validateHeaderText(rawLabel);
          if (v.valid) {
            if (typeof window.formatHeaderDisplay === 'function') formatHeaderDisplay(th, v.parts);
            else th.textContent = v.parts.join(' ');
          } else th.textContent = rawLabel;
        } else th.textContent = rawLabel;

        if (col.type === 'A') th.classList.add('col-type-A');
        if (col.type === 'B') th.classList.add('col-type-B');
        if (idx < (typeof FIXED_COUNT!=='undefined'?FIXED_COUNT:3)) { th.classList.add('fixed-col'); th.dataset.colIndex = idx; }
        th.title = rawLabel;
        headRow.appendChild(th);
      });
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');

    if (modelRows && modelRows.length > 0) {
      for (let rIdx=0; rIdx<modelRows.length; rIdx++) {
        const row = modelRows[rIdx];

        // insert totals row before apoyo subtitle
        if (primaryTotalsInfo.found && rIdx === primaryTotalsInfo.apoyoPos) {
          // Build totals row styled as subtitle-row to match appearance
          const trTot = document.createElement('tr');
          trTot.classList.add('primary-totals-row', 'subtitle-row');

          const colsToUse = (allCols.length>0) ? allCols : Array.from(document.querySelectorAll('#dynamic-table thead th')).map((th, i) => ({ id: 'col_' + i, label: (th.textContent||'').trim() }));

          colsToUse.forEach((col, cIdx) => {
            const td = document.createElement('td');
            td.dataset.colId = col.id;
            td.dataset.row = 'primary_totals';
            if (cIdx === 0) {
              // same structure as subtitle first cell but WITHOUT the '+' button
              const container = document.createElement('div');
              container.style.display = 'flex';
              container.style.alignItems = 'center';
              container.style.justifyContent = 'center';
              container.style.gap = '8px';
              const strong = document.createElement('strong');
              strong.textContent = 'Costos primarios';
              container.appendChild(strong);
              // NO plus button inserted here
              td.appendChild(container);
              td.style.textAlign = 'center';
            } else {
              const key = col.id || col.label;
              const val = primaryTotalsInfo.totals[key] !== undefined ? primaryTotalsInfo.totals[key] : primaryTotalsInfo.totals[col.label || col.id];
              if (typeof val === 'number' && Number.isFinite(val)) {
                const strong = document.createElement('strong');
                try {
                  if (window.AsiapCalc && typeof window.AsiapCalc.formatNumberAnglo === 'function') strong.textContent = window.AsiapCalc.formatNumberAnglo(val);
                  else strong.textContent = (Math.round((val + Number.EPSILON) * 100) / 100).toLocaleString('en-US');
                } catch(e){ strong.textContent = String(val); }
                td.appendChild(strong);
              } else {
                td.textContent = '';
              }
              td.style.textAlign = 'center';
            }
            trTot.appendChild(td);
          });

          tbody.appendChild(trTot);
        }

        // Skip rendering certain subtitle rows in the Results view:
        if (row.isSubtitle) {
          const subtitleLabel = (row.subtitleText || '').trim().toLowerCase();

          // Do NOT render the 'Departamentos apoyo' subtitle line — user requested only that line be removed previously.
          if (subtitleLabel === 'departamentos apoyo' || subtitleLabel.indexOf('departamentos apoyo') !== -1) {
            // skip adding this subtitle row to the Resultados table
            continue;
          }

          // Do NOT render "Referencia costo unitario" — remove that subtitle line as requested.
          if (subtitleLabel === 'referencia costo unitario' || subtitleLabel.indexOf('referencia costo unitario') !== -1) {
            continue;
          }

          if (subtitleLabel === 'costos asignados directamente' || subtitleLabel.indexOf('costos a repartir') !== -1 || subtitleLabel === 'costos a repartir') {
            // Do NOT render these subtitle header lines in Results (user requested they be removed)
            continue;
          }

          // otherwise render regular subtitle rows (kept)
          const tr = document.createElement('tr');
          tr.classList.add('subtitle-row');
          const colsToUse = (allCols.length>0) ? allCols : Array.from(document.querySelectorAll('#dynamic-table thead th')).map((th, i) => ({ id: 'col_' + i, label: (th.textContent||'').trim() }));
          colsToUse.forEach((col, cIdx) => {
            const td = document.createElement('td');
            if (cIdx === 0) {
              const container = document.createElement('div');
              container.style.display = 'flex';
              container.style.alignItems = 'center';
              container.style.justifyContent = 'center';
              container.style.gap = '8px';
              const strong = document.createElement('strong');
              strong.textContent = row.subtitleText || '';
              container.appendChild(strong);
              const plus = document.createElement('span');
              plus.className = 'subtitle-add-btn btn-placeholder';
              plus.innerText = '+';
              container.appendChild(plus);
              td.appendChild(container);
              td.style.textAlign = 'center';
            } else td.textContent = '';
            tr.appendChild(td);
          });
          tbody.appendChild(tr);

          // If this subtitle is "Departamentos apoyo", insert DA/DP right after it (idempotent)
          const subtitleLabelRaw = (row.subtitleText || '').trim().toLowerCase();
          if (subtitleLabelRaw === 'departamentos apoyo' || subtitleLabelRaw.indexOf('departamentos apoyo') !== -1) {
            insertSubtitleAfterInTbody(tbody, 'departamentos apoyo', 'DA/DP', allCols, null);
          }

          continue;
        }

        // Data rows
        // For data rows: detect if the row is inside 'costos a repartir' section (use rowSections map)
        const sectionName = (rowSections[rIdx] || '').toLowerCase();

        // If in "Costos a repartir", compute allocation for this row and display allocations in dyn columns
        let allocationMap = null;
        if (sectionName.indexOf('costos a repartir') !== -1 || sectionName.indexOf('a repartir') !== -1) {
          // compute cost total for this row
          const allColsLocal = (fixed.concat(dyn));
          let costoCol = allColsLocal.find(col => col && col.label && String(col.label).trim().toLowerCase() === 'costo');
          if (!costoCol) costoCol = fixed[1] || null;
          const costoId = costoCol ? costoCol.id : null;
          const costoRaw = costoId ? ((row.values && row.values[costoId] != null) ? row.values[costoId] : '') : '';
          const costoTotal = parseNumeric(costoRaw);
          // compute drivers
          const drivers = dyn.map(c => ({ id: c.id, val: parseNumeric((row.values && row.values[c.id] != null) ? row.values[c.id] : '') }));
          const sumDrv = drivers.reduce((s,x)=> s + (Number.isFinite(x.val)?x.val:0), 0);
          if (Number.isFinite(costoTotal) && sumDrv > 0) {
            allocationMap = {};
            for (const d of drivers) {
              allocationMap[d.id] = (Number.isFinite(d.val) && sumDrv > 0) ? (costoTotal * (d.val / sumDrv)) : NaN;
            }
          } else {
            allocationMap = null; // cannot allocate
          }
        }

        const tr = document.createElement('tr');
        const colsToUse = (allCols.length>0) ? allCols : Array.from(document.querySelectorAll('#dynamic-table thead th')).map((th, i) => ({ id: 'col_' + i, label: (th.textContent||'').trim() }));
        colsToUse.forEach((col, cIdx) => {
          const td = document.createElement('td');
          // default raw value
          const rawVal = (row.values && row.values[col.id] != null) ? row.values[col.id] : '';
          // if allocation for "Costos a repartir" and this is a dynamic column, show allocation
          if (allocationMap && cIdx >= (typeof FIXED_COUNT!=='undefined'?FIXED_COUNT:3)) {
            const alloc = allocationMap[col.id];
            if (typeof alloc === 'number' && Number.isFinite(alloc)) {
              const strong = document.createElement('strong');
              try {
                if (window.AsiapCalc && typeof window.AsiapCalc.formatNumberAnglo === 'function') strong.textContent = window.AsiapCalc.formatNumberAnglo(alloc);
                else strong.textContent = (Math.round((alloc + Number.EPSILON) * 100) / 100).toLocaleString('en-US');
              } catch(e) { strong.textContent = String(alloc); }
              td.appendChild(strong);
            } else {
              td.textContent = '';
            }
            // keep original driver in title for traceability
            const driverVal = (row.values && row.values[col.id] != null) ? row.values[col.id] : '';
            if (driverVal !== '') td.title = 'Driver: ' + String(driverVal);
            td.dataset.row = rIdx;
            td.dataset.colId = col.id;
            if (cIdx < (typeof FIXED_COUNT!=='undefined'?FIXED_COUNT:3)) td.classList.add('fixed-col');
            tr.appendChild(td);
            return;
          }

          // normal display (not allocated)
          let formatted = '';
          try {
            if (typeof window.normalizeAndFormatValue === 'function') {
              const nf = normalizeAndFormatValue(rawVal);
              formatted = (nf && nf.formatted !== undefined) ? nf.formatted : String(rawVal||'');
              if (nf && nf.canonical !== undefined) td.dataset.valueCanonical = nf.canonical;
            } else if (typeof window.AsiapCalc === 'object' && typeof window.AsiapCalc.formatNumberAnglo === 'function') {
              const parsed = window.AsiapCalc.parseNumberString ? window.AsiapCalc.parseNumberString(String(rawVal)) : NaN;
              formatted = Number.isFinite(parsed) ? window.AsiapCalc.formatNumberAnglo(parsed) : String(rawVal||'');
              if (!Number.isNaN(parsed)) td.dataset.valueCanonical = String(parsed);
            } else formatted = String(rawVal || '');
          } catch (e) { formatted = String(rawVal || ''); }

          td.textContent = formatted;
          td.dataset.row = rIdx;
          td.dataset.colId = col.id;
          if (cIdx < (typeof FIXED_COUNT!=='undefined'?FIXED_COUNT:3)) { td.classList.add('fixed-col'); td.dataset.colIndex = cIdx; }
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      }
    } else {
      // No model rows -> fallback: clone DOM and post-process it to replace drivers with allocations
      const domClone = buildTableFromDOMClone();
      if (!domClone) {
        return null;
      }
      try {
        const domTbody = domClone.querySelector('tbody');
        const domRows = Array.from(domTbody.querySelectorAll('tr'));

        // Remove subtitle lines "Costos asignados directamente", "Costos a repartir" and "Departamentos apoyo",
        // and also remove "Referencia costo unitario" from the clone,
        // since Results shouldn't display them.
        domRows.forEach(r => {
          if (r.classList && r.classList.contains('subtitle-row')) {
            const txt = (r.textContent || '').trim().toLowerCase();
            if (txt.indexOf('costos asignados directamente') !== -1 || txt.indexOf('costos a repartir') !== -1 || txt.indexOf('departamentos apoyo') !== -1 || txt.indexOf('referencia costo unitario') !== -1) {
              try { r.parentElement && r.parentElement.removeChild(r); } catch(e){}
            }
          }
        });

        // compute totals from DOM (already does prorrateo for totals)
        const domTotalsInfo = computePrimaryTotalsFromDOM();

        // Now post-process domClone: for each data row before apoyo subtitle, if it's in "Costos a repartir", compute allocation and replace dyn cols
        // find apoyo index in domRows (after removals)
        const domRowsUpdated = Array.from(domTbody.querySelectorAll('tr'));
        let apoyoIndex = null;
        for (let i = 0; i < domRowsUpdated.length; i++) {
          if (domRowsUpdated[i].classList && domRowsUpdated[i].classList.contains('subtitle-row')) {
            const txt = (domRowsUpdated[i].textContent || '').trim().toLowerCase();
            if (txt.indexOf('departamentos apoyo') !== -1 || txt.indexOf('departamentos de apoyo') !== -1) { apoyoIndex = i; break; }
          }
        }
        const FIXED = 3;
        const headerCount = domClone.querySelectorAll('thead th').length || 0;
        // iterate rows before apoyoIndex
        let currentSection = '';
        const rowsToProcess = domRowsUpdated.slice(0, (apoyoIndex !== null ? apoyoIndex : domRowsUpdated.length));
        for (let rIndex = 0; rIndex < rowsToProcess.length; rIndex++) {
          const tr = rowsToProcess[rIndex];
          if (!tr) continue;
          if (tr.classList.contains('subtitle-row')) {
            const firstTd = tr.querySelector('td');
            const strong = firstTd && firstTd.querySelector('strong');
            currentSection = strong ? (strong.textContent||'').trim().toLowerCase() : (firstTd ? (firstTd.textContent||'').trim().toLowerCase() : '');
            continue;
          }
          if (currentSection.indexOf('costos a repartir') !== -1 || currentSection.indexOf('a repartir') !== -1) {
            const tds = tr.querySelectorAll('td');
            // costo in column index 1
            const costoTd = tds[1] || null;
            const costoVal = costoTd ? parseNumberFromString((costoTd.textContent||'').trim()) : NaN;
            if (!Number.isFinite(costoVal)) continue;
            // compute drivers and sum
            const drivers = [];
            let sumDrv = 0;
            for (let ci = FIXED; ci < headerCount; ci++) {
              const td = tds[ci];
              const d = td ? parseNumberFromString((td.textContent||'').trim()) : NaN;
              const dv = Number.isFinite(d) ? d : 0;
              drivers.push({ idx: ci, val: dv, origin: td ? (td.textContent||'').trim() : '' });
              sumDrv += dv;
            }
            if (sumDrv <= 0) continue;
            // replace dyn cells with allocated values, wrap in <strong> to mimic subtitle appearance weight
            for (const d of drivers) {
              const alloc = costoVal * (d.val / sumDrv);
              const td = tds[d.idx];
              if (!td) continue;
              let display = '';
              try {
                if (window.AsiapCalc && typeof window.AsiapCalc.formatNumberAnglo === 'function') display = window.AsiapCalc.formatNumberAnglo(alloc);
                else display = (Math.round((alloc + Number.EPSILON) * 100) / 100).toLocaleString('en-US');
              } catch(e){ display = String(alloc); }
              // keep original driver as title
              td.title = 'Driver: ' + (d.origin || '');
              // wrap in strong to visually match subtitle weight/size
              td.textContent = '';
              const s = document.createElement('strong');
              s.textContent = display;
              td.appendChild(s);
              td.style.textAlign = 'center';
            }
          }
        }

        // insert totals row into domClone similarly as before, but using subtitle-row markup without '+'
        if (domTotalsInfo.found) {
          const trTot = document.createElement('tr');
          trTot.classList.add('primary-totals-row', 'subtitle-row');
          for (let cIdx = 0; cIdx < headerCount; cIdx++) {
            const td = document.createElement('td');
            if (cIdx === 0) {
              const container = document.createElement('div');
              container.style.display = 'flex';
              container.style.alignItems = 'center';
              container.style.justifyContent = 'center';
              container.style.gap = '8px';
              const strong = document.createElement('strong');
              strong.textContent = 'Costos primarios';
              container.appendChild(strong);
              // NO plus button here
              td.appendChild(container);
              td.style.textAlign = 'center';
            } else {
              let display = '';
              const dk = domTotalsInfo.dynFromDOM && domTotalsInfo.dynFromDOM.find(x => x.idx === cIdx);
              if (dk) {
                const val = domTotalsInfo.totals[dk.key];
                if (typeof val === 'number' && Number.isFinite(val)) {
                  try {
                    if (window.AsiapCalc && typeof window.AsiapCalc.formatNumberAnglo === 'function') display = window.AsiapCalc.formatNumberAnglo(val);
                    else display = (Math.round((val + Number.EPSILON) * 100) / 100).toLocaleString('en-US');
                  } catch(e){ display = String(val); }
                }
              }
              if (display !== '') {
                const s = document.createElement('strong');
                s.textContent = display;
                td.appendChild(s);
              } else td.textContent = '';
              td.style.textAlign = 'center';
            }
            trTot.appendChild(td);
          }

          // NEW: try to insert BEFORE DA/DP if present; otherwise fall back to buscar "departamentos apoyo"; finally append end
          let refNode = null;
          const domRows2 = Array.from(domTbody.querySelectorAll('tr'));
          // Prefer inserting before DA/DP if that subtitle exists in the clone
          for (let i = 0; i < domRows2.length; i++) {
            const r = domRows2[i];
            if (!r.classList || !r.classList.contains('subtitle-row')) continue;
            const strong = r.querySelector('td strong');
            const txt = strong ? (strong.textContent||'').trim().toLowerCase() : (r.textContent||'').trim().toLowerCase();
            if (txt === 'da/dp' || txt.indexOf('da/dp') !== -1) { refNode = r; break; }
          }
          // If DA/DP not found, look for 'departamentos apoyo' like before
          if (!refNode) {
            for (let i = 0; i < domRows2.length; i++) {
              const r = domRows2[i];
              if (!r.classList || !r.classList.contains('subtitle-row')) continue;
              const txt = (r.textContent || '').trim().toLowerCase();
              if (txt.indexOf('departamentos apoyo') !== -1 || txt.indexOf('departamentos de apoyo') !== -1) { refNode = r; break; }
            }
          }
          // Insert before refNode if found, otherwise append at end
          if (refNode) domTbody.insertBefore(trTot, refNode);
          else domTbody.appendChild(trTot);
        }

        // Insert "Costos finales por departamento" after "Referencia costo unitario" in the DOM clone (idempotent)
        insertSubtitleAfterInTbody(domTbody, 'referencia costo unitario', 'Costos finales por departamento', null, '1em');

        // Note: buildTableFromDOMClone will ensure TPA is added in clone path as well
        return domClone;
      } catch(e) {
        console.warn('Resultados: error en fallback DOM insert', e);
        return domClone;
      }
    }

    table.appendChild(tbody);

    // Ensure DA/DP and "Costos finales por departamento" are present in model-built flow (idempotent)
    try {
      const tb = table.querySelector('tbody');
      insertSubtitleAfterInTbody(tb, 'departamentos apoyo', 'DA/DP', allCols, null);
      insertSubtitleAfterInTbody(tb, 'referencia costo unitario', 'Costos finales por departamento', allCols, '1em');
    } catch (e) { /* ignore */ }

    // Ensure TPA row is present in the model-built table as well (idempotent)
    insertTPARowIntoTable(table, allCols);

    // minWidth
    try {
      let total = 0;
      allCols.forEach((col, idx) => {
        const w = (typeof window.getColWidthPx === 'function') ? getColWidthPx(col, idx) : '110px';
        total += parseInt(String(w).replace('px',''),10) || 110;
      });
      table.style.minWidth = total + 'px';
    } catch(e){}

    // centering
    try { applyCenteringToTable(table); } catch(e){}

    return table;
  }

  // ---- fallback clone ----
  function buildTableFromDOMClone() {
    const src = document.querySelector('#dynamic-table');
    if (!src) return null;
    const clone = src.cloneNode(true);
    cleanClonedTable(clone);
    clone.classList.add('resultados-table', 'summary-clone');

    try {
      const orig = document.querySelector('#dynamic-table');
      const origCols = orig.querySelectorAll('col');
      if (!(origCols && origCols.length)) {
        const ths = orig.querySelectorAll('thead th');
        if (ths && ths.length) {
          const cg = document.createElement('colgroup');
          Array.from(ths).forEach(th => {
            const rect = th.getBoundingClientRect();
            const c = document.createElement('col');
            c.style.width = (rect && rect.width) ? Math.round(rect.width) + 'px' : '110px';
            cg.appendChild(c);
          });
          const old = clone.querySelector('colgroup');
          if (old) old.parentNode.removeChild(old);
          clone.insertBefore(cg, clone.firstChild);
        }
      }
    } catch(e){}

    // make read-only: remove tabindex and contenteditable from clone
    qa('[tabindex]', clone).forEach(el => el.removeAttribute('tabindex'));
    qa('[contenteditable]', clone).forEach(el => el.removeAttribute('contenteditable'));

    try { applyCenteringToTable(clone); } catch(e){}

    // Insert DA/DP and Costos finales after relevant subtitles in clone path as safety (idempotent)
    try {
      const tb = clone.querySelector('tbody');
      insertSubtitleAfterInTbody(tb, 'departamentos apoyo', 'DA/DP', null, null);
      insertSubtitleAfterInTbody(tb, 'referencia costo unitario', 'Costos finales por departamento', null, '1em');
      // ensure TPA exists in clone too
      insertTPARowIntoTable(clone, null);
    } catch (e) { /* ignore */ }

    return clone;
  }

  // ---- sync computed styles from #dynamic-table -> resultados table (headers prioritized) ----
  function syncComputedStylesFromDynamicToResultados() {
    try {
      const src = document.querySelector('#dynamic-table');
      const dst = document.querySelector('#resultados-container .resultados-content table');
      if (!src || !dst) return;
      // copy CSS variables from :root if present
      try {
        const rootCs = getComputedStyle(document.documentElement);
        ['--fixed-col-bg','--col-a-bg','--col-b-bg','--col-a-width','--col-b-width'].forEach(v=>{
          const val = rootCs.getPropertyValue(v);
          if (val && val.trim()) dst.style.setProperty(v, val);
        });
      } catch(e){}
      const sThs = src.querySelectorAll('thead th');
      const dThs = dst.querySelectorAll('thead th');
      const props = ['backgroundColor','color','fontWeight','fontSize','paddingTop','paddingBottom','paddingLeft','paddingRight','textAlign','lineHeight','borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth','borderTopColor','borderBottomColor','borderLeftColor','borderRightColor'];
      for (let i=0;i<dThs.length;i++){
        const s = sThs[i], d=dThs[i];
        if (!s || !d) continue;
        const cs = getComputedStyle(s);
        props.forEach(p=>{ try{ const v=cs[p]; if (v!==undefined && v!==null) d.style[p]=v; }catch(e){} });
      }
      // copy a few cell-level properties using first data row as source
      const sFirst = src.querySelector('tbody tr:not(.subtitle-row)');
      if (sFirst) {
        const sTds = sFirst.querySelectorAll('td');
        const dRows = dst.querySelectorAll('tbody tr');
        dRows.forEach(dr=>{
          const dTds = dr.querySelectorAll('td');
          for (let c=0;c<dTds.length;c++){
            if (!sTds[c]) continue;
            try {
              const cs = getComputedStyle(sTds[c]);
              ['backgroundColor','color','textAlign','paddingTop','paddingBottom','paddingLeft','paddingRight','borderTopColor','borderBottomColor','borderLeftColor','borderRightColor'].forEach(p=>{
                const v = cs[p]; if (v) dTds[c].style[p]=v;
              });
            } catch(e){}
          }
        });
      }
    } catch(e){ console.warn('syncComputedStyles error', e); }
  }

  // ---- hide / restore original ----
  function hideDynamicTable() {
    const dyn = document.getElementById('dynamic-table');
    if (!dyn) return;
    if (!dyn.dataset._displayBeforeResultados) dyn.dataset._displayBeforeResultados = dyn.style.display || '';
    dyn.style.display = 'none';
  }
  function restoreDynamicTable() {
    const dyn = document.getElementById('dynamic-table');
    if (!dyn) return;
    dyn.style.display = dyn.dataset._displayBeforeResultados || '';
    delete dyn.dataset._displayBeforeResultados;
  }

  // ---- render ----
  function renderResultadosFromSummary() {
    removeLegacyResultadosContainers();
    const container = ensureResultadosContainer();
    const content = container.querySelector('.resultados-content');
    if (!content) return;
    content.innerHTML = '';

    let tbl = null;
    try { tbl = buildTableFromModel(); } catch(e){ tbl = null; }
    if (!tbl) tbl = buildTableFromDOMClone();
    if (!tbl) { alert('No se pudo construir la tabla Resultados (no se encontró el modelo ni #dynamic-table).'); return; }

    content.appendChild(tbl);
    container.dataset.rendered = '1';

    // centering applied in build; ensure app-level run
    try { if (typeof window.applyCentering === 'function') window.applyCentering(); } catch(e){}

    // Sync styles to ensure header colors match exact computed styles
    try { syncComputedStylesFromDynamicToResultados(); } catch(e){}

    hideDynamicTable();
    container.style.display = 'block';
    setTimeout(()=>container.scrollIntoView({ behavior:'smooth', block:'start' }), 50);
  }

  // ---- attach/move calcular button (compat) ----
  function attachOrMoveCalcularButton() {
    let btn = document.getElementById('calcular-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'calcular-btn';
      btn.type = 'button';
      btn.className = 'btn btn-calcular';
      btn.textContent = 'Calcular';
    } else {
      try { btn.removeEventListener && btn.removeEventListener('click', renderResultadosFromSummary); } catch(e){}
    }
    btn.addEventListener('click', renderResultadosFromSummary);

    // Try to locate a good container (near edit/toolbar) to insert the button
    const editBtn = document.getElementById('edit-summary-btn') || Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim()==='Editar Tabla Resumen');
    if (editBtn && editBtn.parentElement) {
      try { if (btn.parentElement && btn.parentElement !== editBtn.parentElement) btn.parentElement.removeChild(btn); } catch(e){}
      try { editBtn.parentElement.insertBefore(btn, editBtn.nextSibling); return; } catch(e){}
    }

    const fallbacks = [document.querySelector('.controls'), document.querySelector('.toolbar'), document.querySelector('.page-header'), document.body];
    for (const cont of fallbacks) {
      if (!cont) continue;
      try { if (btn.parentElement && btn.parentElement !== cont) btn.parentElement.removeChild(btn); } catch(e){}
      try { cont.appendChild(btn); return; } catch(e){}
    }
    if (!document.body.contains(btn)) document.body.appendChild(btn);
  }

  // ---- public API ----
  window.Resultados = window.Resultados || {};
  window.Resultados.show = renderResultadosFromSummary;
  window.Resultados.hide = function(){ const c=document.getElementById('resultados-container'); if(c){ c.style.display='none'; restoreDynamicTable(); } };
  window.Resultados.toggle = function(){ const c=document.getElementById('resultados-container'); if(!c || c.style.display==='none' || getComputedStyle(c).display==='none') renderResultadosFromSummary(); else { c.style.display = 'none'; restoreDynamicTable(); } };

  // Hook: run custom calculation function that mutates window.rows, then re-render.
  // fn: function(rows, fixedCols, dynCols) { ... mutate rows ... }
  window.Resultados.runCalcs = function(fn){
    if (typeof fn !== 'function') return;
    if (!window.rows) return;
    try {
      fn(window.rows, window.fixedCols || [], window.dynCols || []);
      // re-render both views: Resumen may reflect changes en window.rows if está visible
      renderResultadosFromSummary();
      if (typeof window.renderTable === 'function') try { window.renderTable(); } catch(e){}
    } catch(e){ console.error('runCalcs error', e); }
  };

  // init
  function initWhenReady(){
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(attachOrMoveCalcularButton,80);
    else document.addEventListener('DOMContentLoaded', ()=>setTimeout(attachOrMoveCalcularButton,80));
  }
  initWhenReady();

})();

// Auto-clean patch: define tiny clear function and call it after Resultados render.
// Pegar al final de static/resultados.js (después de la definición de renderResultadosFromSummary / window.Resultados).
(function(){
  // tiny clear function (la misma que probaste en consola)
  function clearFromPrimaryTiny() {
    let t = document.querySelector('#resultados-container .resultados-content table') || document.querySelector('#dynamic-table') || document.querySelector('.resultados-table.summary-clone') || document.querySelector('table.resultados-table');
    if (!t) return false;
    let rows = Array.from(t.querySelectorAll('tbody tr'));
    let p = rows.findIndex(r=>{
      const td = r.querySelector('td');
      if (!td) return false;
      const s = (td.querySelector('strong') ? td.querySelector('strong').textContent : td.textContent) || '';
      return s.toLowerCase().includes('costos primarios');
    });
    if (p === -1) return false;
    for (let i = p + 2; i < rows.length; i++) {
      Array.from(rows[i].querySelectorAll('td')).slice(1).forEach(td=>{
        try { td.textContent = ''; td.removeAttribute && td.removeAttribute('title'); } catch(e){}
      });
    }
    return true;
  }

  // Exponer en la API pública
  window.Resultados = window.Resultados || {};
  window.Resultados.clearFromPrimary = clearFromPrimaryTiny;

  // Si ya existe window.Resultados.show (que suele ejecutar renderResultadosFromSummary),
  // envolvemos la llamada para ejecutar la limpieza justo después del render.
  try {
    if (typeof window.Resultados.show === 'function') {
      const orig = window.Resultados.show;
      window.Resultados.show = function(...args) {
        const res = orig.apply(this, args);
        setTimeout(() => { try { window.Resultados.clearFromPrimary(); } catch(e){} }, 40);
        return res;
      };
    } else if (typeof renderResultadosFromSummary === 'function') {
      const orig = renderResultadosFromSummary;
      renderResultadosFromSummary = function(...args) {
        const res = orig.apply(this, args);
        setTimeout(() => { try { window.Resultados.clearFromPrimary(); } catch(e){} }, 40);
        return res;
      };
    }
  } catch (e) {
    console.warn('clearFromPrimary auto-hook failed', e);
  }
})();