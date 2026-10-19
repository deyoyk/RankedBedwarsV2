export function render() {
  const { el } = window.RBW ? window.RBW.UI : { el: (t, a, c) => { const n = document.createElement(t); return n; } };
  return el('div', { class: 'error-box' },
    el('h2', { text: 'Page not found' }),
    el('p', { text: 'The page you are looking for does not exist.' }),
    el('p', { style: 'margin-top:12px' }, el('a', { href: '#/', text: '← Back home' }))
  );
}
