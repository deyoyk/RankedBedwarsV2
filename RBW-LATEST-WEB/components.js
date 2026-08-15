// Shared UI components for the Ranked Bedwars web app.
// Pure DOM helpers — no framework, no dependencies.

const UI = (() => {
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function skeleton(width = '100%', height = '16px', style = '') {
    const s = el('div', { class: 'skeleton', style: `width:${width};height:${height};${style}` });
    return s;
  }

  function skeletonRows(count, height = '18px') {
    return el('div', { style: 'display:flex;flex-direction:column;gap:10px;padding:16px' },
      Array.from({ length: count }, () => skeleton('100%', height))
    );
  }

  function errorBox(message, detail = '') {
    return el('div', { class: 'error-box' },
      el('h2', { text: message }),
      detail ? el('p', { class: 'muted', text: detail }) : null
    );
  }

  function emptyBox(text) {
    return el('div', { class: 'empty', text });
  }

  function link(text, href) {
    return el('a', { href, text });
  }

  function pill(text, tone = '') {
    return el('span', { class: `pill${tone ? ' ' + tone : ''}`, text });
  }

  function statCell(label, value, tone = '') {
    return el('div', { class: 'stat-cell' },
      el('div', { class: 'label', text: label }),
      el('div', { class: `value ${tone}`, text: value })
    );
  }

  function card(title, body, actions = null) {
    return el('div', { class: 'card' },
      title !== null ? el('div', { class: 'card-head' }, el('span', { text: title }), actions || null) : null,
      el('div', { class: 'card-body' }, body)
    );
  }

  function table(headers, rows, opts = {}) {
    const thead = el('thead', {}, el('tr', {}, headers.map(h =>
      el('th', { class: h.align === 'num' ? 'num' : '', text: h.label })
    )));
    const tbody = el('tbody', {}, rows.map((row, i) =>
      el('tr', {},
        row.map((cell, j) => {
          const isNum = headers[j] && headers[j].align === 'num';
          const cls = isNum ? 'num' : (j === 0 && cell !== null && cell !== undefined ? 'rank' : '');
          return el('td', { class: cls, ...(cell && typeof cell === 'object' && cell.attrs ? cell.attrs : {}) },
            cell && typeof cell === 'object' && cell.attrs ? cell.content : cell
          );
        })
      )
    ));
    return el('div', { class: 'table-wrap' }, el('table', {}, thead, tbody));
  }

  function pager({ page, totalPages, onPage, canPrev, canNext }) {
    const info = el('span', { class: 'info', text: `Page ${page} of ${totalPages || 1}` });
    const prev = el('button', { class: 'btn', text: 'Previous', disabled: canPrev === false ? '' : null, onclick: () => onPage(page - 1) });
    const next = el('button', { class: 'btn', text: 'Next', disabled: canNext === false ? '' : null, onclick: () => onPage(page + 1) });
    return el('div', { class: 'pager' }, prev, info, next);
  }

  function modeBar(modes, active, hrefFor) {
    return el('div', { class: 'mode-bar' },
      modes.map(m => el('a', {
        href: hrefFor(m),
        class: m === active ? 'active' : '',
        text: m
      }))
    );
  }

  // Inline SVG sparkline from an array of numbers. No chart library.
  function sparkline(values, opts = {}) {
    const w = opts.width || 560;
    const h = opts.height || 72;
    const pad = 4;
    if (!values || values.length < 2) {
      return el('div', { class: 'muted', style: `height:${h}px;display:flex;align-items:center;font-size:12.5px`,
        text: 'Not enough data yet' });
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y];
    });
    const line = pts.map(p => p.join(',')).join(' ');
    const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', h);
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.id = `grad-${Math.random().toString(36).slice(2, 8)}`;
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#0070f3'); stop1.setAttribute('stop-opacity', '0.35');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#0070f3'); stop2.setAttribute('stop-opacity', '0');
    grad.append(stop1, stop2);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.append(grad);
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', `M ${area} Z`);
    areaPath.setAttribute('fill', `url(#${grad.id})`);
    const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    linePath.setAttribute('points', line);
    linePath.setAttribute('fill', 'none');
    linePath.setAttribute('stroke', '#0070f3');
    linePath.setAttribute('stroke-width', '1.5');
    svg.append(defs, areaPath, linePath);
    return svg;
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatPlaytime(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const s = Math.max(0, Math.floor(seconds));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  function formatNumber(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString();
  }

  function formatValue(mode, value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (mode === 'playtimeSeconds') return formatPlaytime(value);
    if (mode === 'kdr' || mode === 'wlr') return Number(value).toFixed(2);
    return formatNumber(value);
  }

  return {
    el, skeleton, skeletonRows, errorBox, emptyBox, link, pill,
    statCell, card, table, pager, modeBar, sparkline,
    formatDuration, formatPlaytime, formatDate, formatDateTime, timeAgo,
    formatNumber, formatValue,
  };
})();
