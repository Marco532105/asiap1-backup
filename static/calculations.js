// Minimal utilities for parsing/formatting numbers — asiap utilities (no validations here)
// Intended to be required later by app.js or summaryEditor.js if needed.
// Note: this file deliberately small (AS-SIMPLE-AS-POSSIBLE).

(function(){
  if (window.AsiapCalc) return;

  function parseNumberString(s) {
    if (s == null) return NaN;
    s = String(s).trim();
    if (s === '') return NaN;
    s = s.replace(/\u00A0/g, '').replace(/\s+/g, '');
    s = s.replace(/[^0-9\-,.\u2212+eE]/g, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastComma !== -1) {
      const countComma = (s.match(/,/g) || []).length;
      if (countComma === 1) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
    } else {
      const countDot = (s.match(/\./g) || []).length;
      if (countDot > 1) s = s.replace(/\./g, '');
    }
    if (/^[+-]?$/.test(s)) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatNumberAnglo(n) {
    if (!Number.isFinite(n)) return '';
    const isNeg = n < 0;
    const abs = Math.abs(n);
    if (Number.isInteger(Math.round(abs * 100) / 100) && Math.abs(Math.round(abs * 100) / 100 - Math.trunc(abs)) < 1e-9 && Math.trunc(abs) === abs) {
      const s = String(Math.trunc(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return isNeg ? '-' + s : s;
    }
    const rounded = Math.round((isNeg ? -n : n) * 100) / 100;
    let fixed = Math.abs(rounded).toFixed(2);
    fixed = fixed.replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const res = parts.length > 1 ? parts[0] + '.' + parts[1] : parts[0];
    return isNeg ? '-' + res : res;
  }

  window.AsiapCalc = {
    parseNumberString,
    formatNumberAnglo
  };
})();