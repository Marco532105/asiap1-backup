// static/summaryEditor.js — SummaryEditor con validaciones:
//  - "Costos asignados directamente" (validación de suma) (mantenida)
//  - "Departamentos apoyo": inhabilitar intersecciones fila==columna
//  - "Referencia costo unitario": solo permitir edición en columnas dinámicas tipo 'A'
(function(){
  if (window.SummaryEditor) return;

  function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

  // ---------------- Helpers: normalización y regla de celda inhabilitada ----------------
  function normalizeLabel(s) {
    if (!s) return '';
    try {
      s = String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {}
    return String(s).trim().toLowerCase();
  }

  function isDisabledDepartmentCell(rowLabel, colLabel) {
    const r = normalizeLabel(rowLabel || '');
    const c = normalizeLabel(colLabel || '');
    if (!r || !c) return false;
    return r === c;
  }

  // Robust parsing & formatting:
  function parseAndFormatForSave(raw) {
    if (typeof raw === 'number' && isFinite(raw)) {
      if (window.AsiapCalc && typeof AsiapCalc.formatNumberAnglo === 'function') {
        return { stored: raw, display: AsiapCalc.formatNumberAnglo(raw) };
      }
      return { stored: raw, display: raw.toLocaleString('en-US') };
    }

    const s = raw == null ? '' : String(raw).trim();
    if (s === '') return { stored: '', display: '' };

    if (window.AsiapCalc && typeof AsiapCalc.parseNumberString === 'function' && typeof AsiapCalc.formatNumberAnglo === 'function') {
      try {
        const num = AsiapCalc.parseNumberString(s);
        if (typeof num === 'number' && isFinite(num)) {
          return { stored: num, display: AsiapCalc.formatNumberAnglo(num) };
        }
      } catch (e) {
        // fall through
      }
    }

    let normalized = s.replace(/\s+/g, '');
    if (normalized.indexOf('.') !== -1 && normalized.indexOf(',') !== -1) {
      normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
    } else if (normalized.indexOf(',') !== -1 && normalized.indexOf('.') === -1) {
      normalized = normalized.replace(/,/g, '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }

    const maybe = Number(normalized);
    if (isFinite(maybe)) {
      if (window.AsiapCalc && typeof AsiapCalc.formatNumberAnglo === 'function') {
        return { stored: maybe, display: AsiapCalc.formatNumberAnglo(maybe) };
      }
      return { stored: maybe, display: maybe.toLocaleString('en-US') };
    }

    return { stored: s, display: s };
  }

  function formatValueForDisplay(raw) {
    if (typeof raw === 'number' && isFinite(raw)) {
      if (window.AsiapCalc && typeof AsiapCalc.formatNumberAnglo === 'function') {
        return AsiapCalc.formatNumberAnglo(raw);
      }
      return raw.toLocaleString('en-US');
    }
    return parseAndFormatForSave(raw).display;
  }

  // Format department-like header labels
  function formatDeptHeaderLabel(label) {
    if (!label) return '';
    const s = String(label).trim().replace(/\s+/g, ' ');
    const words = s.split(' ').slice(0, 2);
    if (words.length === 1) return words[0];
    const lenSum = (words[0].length || 0) + (words[1].length || 0);
    if (lenSum > 13) {
      return words[0] + '\n' + words[1];
    }
    return words.join(' ');
  }

  function createModal() {
    const overlay = document.createElement('div');
    overlay.className = 'se-overlay';

    const modal = document.createElement('div');
    modal.className = 'se-modal';

    const header = document.createElement('div');
    header.className = 'se-header';
    modal.appendChild(header);

    const title = document.createElement('div');
    title.className = 'se-title';
    title.textContent = 'Editor — Tabla Resumen';
    header.appendChild(title);

    const headerBtns = document.createElement('div');
    headerBtns.className = 'se-header-btns';
    header.appendChild(headerBtns);

    const btnSave = document.createElement('button');
    btnSave.className = 'se-btn se-save';
    btnSave.textContent = 'Guardar';
    headerBtns.appendChild(btnSave);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'se-btn se-cancel';
    btnCancel.textContent = 'Cancelar';
    headerBtns.appendChild(btnCancel);

    const body = document.createElement('div');
    body.className = 'se-body';
    modal.appendChild(body);

    const tabs = document.createElement('div');
    tabs.className = 'se-tabs';
    body.appendChild(tabs);

    const tabContent = document.createElement('div');
    tabContent.className = 'se-tab-content';
    body.appendChild(tabContent);

    const footer = document.createElement('div');
    footer.className = 'se-footer';
    footer.textContent = ''; // messages here
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    return { overlay, modal, header, title, headerBtns, btnSave, btnCancel, body, tabs, tabContent, footer };
  }

  // Build the grid for a given subtitle index
  function buildGrid(container, state, subtitleIndex) {
    container.innerHTML = '';
    const allCols = state.fixedCols.concat(state.dynCols);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'se-table-wrapper';

    const table = document.createElement('table');
    table.className = 'se-table';

    // --- colgroup: try to read exact widths from main table, otherwise use CSS vars ---
    try {
      const colgroup = document.createElement('colgroup');

      const mainCols = Array.from(document.querySelectorAll('#dynamic-table col'));
      if (mainCols.length === allCols.length) {
        mainCols.forEach((mc) => {
          const rect = mc.getBoundingClientRect();
          const colEl = document.createElement('col');
          if (rect && rect.width > 0) {
            colEl.style.width = Math.round(rect.width) + 'px';
          } else {
            colEl.style.width = '110px';
          }
          colgroup.appendChild(colEl);
        });
      } else {
        const mainThs = Array.from(document.querySelectorAll('#dynamic-table thead th'));
        if (mainThs.length === allCols.length) {
          mainThs.forEach((th) => {
            const rect = th.getBoundingClientRect();
            const colEl = document.createElement('col');
            if (rect && rect.width > 0) colEl.style.width = Math.round(rect.width) + 'px';
            else colEl.style.width = '110px';
            colgroup.appendChild(colEl);
          });
        } else {
          allCols.forEach((col, idx) => {
            const colEl = document.createElement('col');
            let w;
            if (idx === 0) w = getComputedStyle(document.documentElement).getPropertyValue('--col1-width').trim();
            else if (idx === 1) w = getComputedStyle(document.documentElement).getPropertyValue('--col2-width').trim();
            else if (idx === 2) w = getComputedStyle(document.documentElement).getPropertyValue('--col3-width').trim();
            else {
              w = (col.type === 'B')
                ? getComputedStyle(document.documentElement).getPropertyValue('--col-b-width').trim()
                : getComputedStyle(document.documentElement).getPropertyValue('--col-a-width').trim();
            }
            colEl.style.width = w || '110px';
            colgroup.appendChild(colEl);
          });
        }
      }
      table.appendChild(colgroup);
    } catch (e) {
      // fallback: continue without colgroup
    }

    // thead
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    allCols.forEach((col) => {
      const th = document.createElement('th');
      const rawLabel = col.label || '';
      const formatted = formatDeptHeaderLabel(rawLabel);
      th.textContent = formatted;
      th.title = rawLabel;
      if (col.type === 'A') th.classList.add('col-type-A');
      if (col.type === 'B') th.classList.add('col-type-B');
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    // tbody: rows belonging to subtitleIndex
    const tbody = document.createElement('tbody');

    // Helper: find subtitle section range
    const subtitlePositions = [];
    for (let i = 0; i < state.rows.length; i++) if (state.rows[i].isSubtitle) subtitlePositions.push(i);
    const startPos = (typeof subtitlePositions[subtitleIndex] === 'number') ? subtitlePositions[subtitleIndex] : null;
    const endPos = (subtitleIndex + 1 < subtitlePositions.length) ? subtitlePositions[subtitleIndex + 1] : state.rows.length;
    const rowsInSection = [];
    for (let i = startPos + 1; i < endPos; i++) {
      if (state.rows[i] && !state.rows[i].isSubtitle) rowsInSection.push({ row: state.rows[i], idx: i });
    }

    // Determine if this section is "Departamentos apoyo" or "Referencia costo unitario"
    const isApoyoSection = (Array.isArray(state.subtitles) && state.subtitles[subtitleIndex] === 'Departamentos apoyo');
    const isReferenciaSection = (Array.isArray(state.subtitles) && state.subtitles[subtitleIndex] === 'Referencia costo unitario');

    rowsInSection.forEach(({row, idx}) => {
      const tr = document.createElement('tr');
      tr.dataset.rowIndex = idx;
      allCols.forEach((col, colIndex) => {
        const td = document.createElement('td');
        td.dataset.row = idx;
        td.dataset.colId = col.id;

        // ---- FIX: ensure description column falls back to row.label when row.values[col.id] is undefined ----
        const isDescCol = (state.fixedCols && state.fixedCols.length > 0 && col.id === state.fixedCols[0].id);
        const raw = isDescCol
          ? ((row.values && row.values[col.id] != null) ? row.values[col.id] : (row.label || ''))
          : ((row.values && row.values[col.id] != null) ? row.values[col.id] : '');
        const display = formatValueForDisplay(raw);

        // Decide if this cell must be disabled:
        let isDisabledCell = false;
        let disabledReason = '';

        if (isApoyoSection) {
          // In Departamentos apoyo: disable where rowName == colLabel (intersection)
          const dynStartIndex = state.fixedCols ? state.fixedCols.length : 3;
          if (colIndex >= dynStartIndex) {
            const rowName = (row.values && row.values['c1']) ? String(row.values['c1']) : (row.label || '');
            const colLabel = col.label || '';
            if (isDisabledDepartmentCell(rowName, colLabel)) {
              isDisabledCell = true;
              disabledReason = 'fila y columna coinciden en Departamentos apoyo';
            }
          }
        }

        if (isReferenciaSection) {
          // In Referencia costo unitario:
          // - DO NOT disable Descripcion (first fixed column)
          // - disable the other fixed columns (Costo, BR, etc.)
          // - for dynamic columns: only type 'A' are editable; others disabled
          const dynStartIndex = state.fixedCols ? state.fixedCols.length : 3;
          if (colIndex < dynStartIndex) {
            // fixed columns: only first (index 0) remains editable
            if (colIndex !== 0) {
              isDisabledCell = true;
              disabledReason = 'columna fija no editable en Referencia costo unitario';
            }
          } else {
            // dynamic columns: only type A editable
            if (col.type !== 'A') {
              isDisabledCell = true;
              disabledReason = 'solo editable en columnas de Departamentos producción';
            }
          }
        }

        if (isDisabledCell) {
          // inhabilitar: no focus, no editable, visual cue
          td.classList.add('cell-disabled');
          td.setAttribute('aria-disabled', 'true');
          td.tabIndex = -1;
          // KEEP the display value visible even when disabled (fix for missing Descripcion)
          td.textContent = display;
          // add title to explain why disabled
          td.title = 'No editable: ' + (disabledReason || 'restricción de sección');
          tr.appendChild(td);
          return; // skip normal handlers
        }

        // Normal editable cell
        td.textContent = display;
        td.tabIndex = 0;

        // pointerdown to remember last focused for paste
        td.addEventListener('pointerdown', () => {
          container._lastFocusedTd = td;
        });

        td.addEventListener('dblclick', () => {
          td.contentEditable = 'true';
          td.focus();
          const range = document.createRange(); range.selectNodeContents(td);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        });

        td.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
        });

        td.addEventListener('blur', () => {
          if (td.contentEditable === 'true') {
            td.contentEditable = 'false';
            const textRaw = td.textContent;
            const rIdx = parseInt(td.dataset.row, 10);
            const cid = td.dataset.colId;
            const parsed = parseAndFormatForSave(textRaw);
            if (state.rows[rIdx]) {
              if (!state.rows[rIdx].values) state.rows[rIdx].values = {};
              state.rows[rIdx].values[cid] = parsed.stored;
            }
            // show formatted (number formatted anglo or raw text)
            td.textContent = parsed.display;
          }
        });

        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);

    // Paste handling — try to parse numbers and format anglo; do not create rows
    tableWrapper.addEventListener('paste', (ev) => {
      const focusedTd = container._lastFocusedTd || (document.activeElement && document.activeElement.closest && document.activeElement.closest('td'));
      if (!focusedTd) return;
      if (ev.clipboardData && ev.clipboardData.getData) {
        const text = ev.clipboardData.getData('text/plain') || '';
        if (!text) return;
        ev.preventDefault();
        const rawRows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(r => r.length > 0);
        const tableData = rawRows.map(r => {
          if (r.indexOf('\t') !== -1) return r.split('\t');
          if (r.indexOf(';') !== -1) return r.split(';');
          return r.split(',');
        });
        const all = state.fixedCols.concat(state.dynCols);
        const startRowIdx = parseInt(focusedTd.dataset.row, 10);
        const startColId = focusedTd.dataset.colId;
        let startColIndex = all.findIndex(c => c.id === startColId);
        if (startColIndex === -1) startColIndex = 0;

        // recompute subtitlePositions locally to evaluate target rows sections
        const localSubtitlePositions = subtitlePositions.slice();

        for (let r = 0; r < tableData.length; r++) {
          const destRowIdx = startRowIdx + r;
          if (!state.rows[destRowIdx]) continue; // do not create new rows
          const cols = tableData[r];
          for (let c = 0; c < cols.length; c++) {
            const destColIndex = startColIndex + c;
            if (destColIndex >= all.length) break;
            const destColId = all[destColIndex].id;

            // determine whether destination cell is disabled under any rule
            let destIsDisabled = false;

            // find which subtitle section destRowIdx belongs to
            let destSectionIdx = -1;
            for (let si = 0; si < localSubtitlePositions.length; si++) {
              const sp = localSubtitlePositions[si];
              const next = (si + 1 < localSubtitlePositions.length) ? localSubtitlePositions[si+1] : state.rows.length;
              if (destRowIdx > sp && destRowIdx < next) { destSectionIdx = si; break; }
            }

            // if destination is in Departamentos apoyo, check intersection rule
            if (destSectionIdx >= 0 && Array.isArray(state.subtitles) && state.subtitles[destSectionIdx] === 'Departamentos apoyo') {
              const dynStartIndex = state.fixedCols ? state.fixedCols.length : 3;
              if (destColIndex >= dynStartIndex) {
                const destRow = state.rows[destRowIdx];
                const rowName = (destRow.values && destRow.values['c1']) ? String(destRow.values['c1']) : (destRow.label || '');
                const destColLabel = all[destColIndex].label || '';
                if (isDisabledDepartmentCell(rowName, destColLabel)) destIsDisabled = true;
              }
            }

            // if destination is in Referencia costo unitario, enforce same rules:
            // - fixed columns other than first (Descripcion) are disabled
            // - dynamic columns only editable if type === 'A'
            if (!destIsDisabled && destSectionIdx >= 0 && Array.isArray(state.subtitles) && state.subtitles[destSectionIdx] === 'Referencia costo unitario') {
              const dynStartIndex = state.fixedCols ? state.fixedCols.length : 3;
              if (destColIndex < dynStartIndex) {
                if (destColIndex !== 0) destIsDisabled = true;
              } else {
                if (all[destColIndex].type !== 'A') destIsDisabled = true;
              }
            }

            if (destIsDisabled) {
              // skip writing into disabled cells
              continue;
            }

            const cellRaw = cols[c];
            const parsed = parseAndFormatForSave(cellRaw);
            if (!state.rows[destRowIdx].values) state.rows[destRowIdx].values = {};
            state.rows[destRowIdx].values[destColId] = parsed.stored;
          }
        }
        // re-render this section
        buildGrid(container, state, subtitleIndex);
      }
    });

    // append table wrapper
    container.appendChild(tableWrapper);
  }

  // Main exposed object
  const SummaryEditor = {
    open: function(options){
      if (!options) options = {};
      const state = {
        rows: deepClone(options.rows || []),
        fixedCols: options.fixedCols ? deepClone(options.fixedCols) : [],
        dynCols: options.dynCols ? deepClone(options.dynCols) : [],
        subtitles: options.subtitles || ['Costos asignados directamente','Costos a repartir','Departamentos apoyo','Referencia costo unitario']
      };
      const onApply = typeof options.onApply === 'function' ? options.onApply : () => {};

      const ui = createModal();
      ui.title.textContent = 'Editor — Tabla Resumen';

      // helper: clear any previous validation highlights/messages
      function clearValidationUI() {
        // clear footer
        ui.footer.textContent = '';
        ui.footer.style.color = '';
        // clear highlighted cells
        const highlighted = ui.modal.querySelectorAll('td[data-validation-highlight="true"]');
        highlighted.forEach(td => {
          td.removeAttribute('data-validation-highlight');
          td.style.background = '';
          td.style.borderColor = '';
        });
      }

      // validation: for "Costos asignados directamente" check Costo == sum(departments)
      function validateCostSums() {
        clearValidationUI();
        const sectionName = 'Costos asignados directamente';
        let secIdx = state.subtitles.indexOf(sectionName);
        if (secIdx === -1) secIdx = 0; // fallback assume first subtitle

        // compute subtitle positions
        const subtitlePositions = [];
        for (let i = 0; i < state.rows.length; i++) if (state.rows[i].isSubtitle) subtitlePositions.push(i);
        const startPos = (typeof subtitlePositions[secIdx] === 'number') ? subtitlePositions[secIdx] : null;
        const endPos = (secIdx + 1 < subtitlePositions.length) ? subtitlePositions[secIdx + 1] : state.rows.length;

        if (startPos === null) return { ok: true };

        // determine cost column id (try find label 'Costo' case-insensitive among allCols)
        const allCols = state.fixedCols.concat(state.dynCols);
        let costoCol = allCols.find(c => c.label && String(c.label).trim().toLowerCase() === 'costo');
        if (!costoCol) {
          // fallback to second fixed column (index 1)
          costoCol = state.fixedCols[1] || allCols[1];
        }
        const costoColId = costoCol ? costoCol.id : (allCols[1] && allCols[1].id) || null;
        if (!costoColId) return { ok: true };

        // department columns are state.dynCols
        const deptCols = state.dynCols || [];

        // iterate rows in range
        for (let r = startPos + 1; r < endPos; r++) {
          const row = state.rows[r];
          if (!row || row.isSubtitle) continue;
          const costoRaw = (row.values && row.values[costoColId] != null) ? row.values[costoColId] : '';
          const costoParsed = parseAndFormatForSave(costoRaw);
          const costoNum = (typeof costoParsed.stored === 'number') ? costoParsed.stored : null;

          // sum departments
          let sum = 0;
          let anyDeptNumeric = false;
          for (let dc of deptCols) {
            const v = (row.values && row.values[dc.id] != null) ? row.values[dc.id] : '';
            const p = parseAndFormatForSave(v);
            if (typeof p.stored === 'number' && isFinite(p.stored)) {
              sum += p.stored;
              anyDeptNumeric = true;
            } else {
              // non-numeric treated as 0 for sum
            }
          }

          // if neither costo nor any department numeric, skip validation (nothing to check)
          if (costoNum === null && !anyDeptNumeric) continue;

          // If costo is not numeric but departments sum to numeric, that's a mismatch
          const epsilon = 0.005;
          const sumRounded = Math.round((sum + Number.EPSILON) * 100) / 100;
          const costoValForCompare = (typeof costoNum === 'number' && isFinite(costoNum)) ? Math.round((costoNum + Number.EPSILON) * 100) / 100 : null;

          const mismatch = (costoValForCompare === null) ? (Math.abs(sumRounded) > epsilon) : (Math.abs(costoValForCompare - sumRounded) > epsilon);

          if (mismatch) {
            // build message using description if exists
            const descCol = state.fixedCols[0];
            const descVal = (row.values && descCol && row.values[descCol.id] != null) ? row.values[descCol.id] : (row.label || '');
            const displayCosto = (costoValForCompare === null) ? (costoParsed.display || '(vacío)') : (window.AsiapCalc && AsiapCalc.formatNumberAnglo ? AsiapCalc.formatNumberAnglo(costoValForCompare) : costoValForCompare.toLocaleString('en-US'));
            const displaySum = (window.AsiapCalc && AsiapCalc.formatNumberAnglo) ? AsiapCalc.formatNumberAnglo(sumRounded) : sumRounded.toLocaleString('en-US');

            ui.footer.textContent = `Validación: la fila "${descVal}" en "Costos asignados directamente": Costo = ${displayCosto} debe ser igual a la suma de departamentos = ${displaySum}. Corrige antes de guardar.`;
            ui.footer.style.color = 'crimson';

            // highlight the costo cell in the currently rendered table(s)
            // look for td inside modal with matching data-row and data-col-id
            try {
              const selector = `td[data-row="${r}"][data-col-id="${costoColId}"]`;
              const td = ui.modal.querySelector(selector);
              if (td) {
                td.setAttribute('data-validation-highlight', 'true');
                td.style.background = '#fff2f2';
                td.style.borderColor = '#e06';
                td.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                td.focus();
              }
            } catch (e) {
              // ignore highlight errors
            }

            return { ok: false, rowIndex: r, message: ui.footer.textContent };
          }
        }

        // all rows OK
        clearValidationUI();
        return { ok: true };
      }

      // build UI tabs and initial content
      ui.tabs.innerHTML = '';
      state.subtitles.forEach((s, idx) => {
        const tbtn = document.createElement('button');
        tbtn.className = 'se-tab-btn';
        tbtn.textContent = s;
        tbtn.dataset.idx = idx;
        ui.tabs.appendChild(tbtn);
      });

      // initial render for tab 0
      let activeIdx = 0;
      buildTab(activeIdx);

      ui.tabs.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button.se-tab-btn') : null;
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx, 10);
        if (Number.isNaN(idx)) return;
        activeIdx = idx;
        buildTab(activeIdx);
      });

      ui.btnCancel.addEventListener('click', () => {
        SummaryEditor.close();
      });

      // Save: validate first, then apply
      ui.btnSave.addEventListener('click', () => {
        const v = validateCostSums();
        if (!v.ok) {
          // validation failed; do not close
          return;
        }
        // all validations passed
        onApply(deepClone(state.rows));
        SummaryEditor.close();
      });

      function buildTab(idx) {
        Array.from(ui.tabs.querySelectorAll('.se-tab-btn')).forEach(b => b.classList.remove('se-tab-active'));
        const btn = ui.tabs.querySelector(`.se-tab-btn[data-idx="${idx}"]`);
        if (btn) btn.classList.add('se-tab-active');

        ui.title.textContent = state.subtitles[idx];

        ui.tabContent.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'se-section-container';
        ui.tabContent.appendChild(container);
        buildGrid(container, state, idx);

        // focus first cell if exists
        setTimeout(() => {
          const firstTd = container.querySelector('td');
          if (firstTd) firstTd.focus();
        }, 50);
      }

      // store reference for close
      ui.overlay._se_state = { ui, state };

      // allow closing by ESC
      function onKey(ev){
        if (ev.key === 'Escape') SummaryEditor.close();
      }
      document.addEventListener('keydown', onKey);
      ui.overlay._se_onKey = onKey;

      // expose for close
      window.__lastSummaryEditorUI = ui;
    },
    close: function(){
      const ui = window.__lastSummaryEditorUI;
      if (!ui) return;
      document.removeEventListener('keydown', ui.overlay._se_onKey);
      ui.overlay.parentElement.removeChild(ui.overlay);
      window.__lastSummaryEditorUI = null;
    }
  };

  window.SummaryEditor = SummaryEditor;
})();