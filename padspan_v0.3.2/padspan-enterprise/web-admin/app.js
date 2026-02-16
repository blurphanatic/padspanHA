(() => {
  const root = document.getElementById('root');
  const btnToggle = document.getElementById('btnToggle');
  const btnMenu = document.getElementById('btnMenu');
  const title = document.getElementById('title');
  const view = document.getElementById('view');
  let lock = false;

  const pages = {
    ops: '<div class="card"><h3>Operations</h3><p>Hub online. Receiver heartbeat monitor placeholder.</p></div>',
    sites: '<div class="card"><h3>Sites</h3><p>Multi-site management starter screen.</p></div>',
    receivers: '<div class="card"><h3>Receivers</h3><p>Firmware health, RSSI stats, and sync lag will appear here.</p></div>',
    map: '<div class="card"><h3>Map Fit</h3><p>Per-room fitting and distortion controls starter.</p></div>',
    settings: '<div class="card"><h3>Settings</h3><p>State persistence is enabled for sidebar collapse.</p></div>'
  };

  const saved = localStorage.getItem('padspan_ent_sidebar_c');
  if (saved === '1') root.classList.add('c');

  function route() {
    const r = location.hash.replace('#', '') || 'ops';
    return pages[r] ? r : 'ops';
  }

  function render() {
    const r = route();
    title.textContent = r.charAt(0).toUpperCase() + r.slice(1);
    view.innerHTML = pages[r];
    document.querySelectorAll('.item').forEach(a => a.classList.toggle('active', a.dataset.route === r));
  }

  function toggle() {
    if (lock) return;
    lock = true;
    root.classList.toggle('c');
    localStorage.setItem('padspan_ent_sidebar_c', root.classList.contains('c') ? '1' : '0');
    setTimeout(() => lock = false, 220);
  }

  btnToggle.addEventListener('click', toggle);
  btnMenu.addEventListener('click', () => root.classList.toggle('mo'));
  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', (e) => {
    if (e.key === '[') toggle();
    if (e.key === 'Escape') root.classList.remove('mo');
  });

  document.addEventListener('click', (e) => {
    if (!root.classList.contains('mo')) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const inSide = document.getElementById('side').contains(t);
    const inBtn = btnMenu.contains(t);
    if (!inSide && !inBtn) root.classList.remove('mo');
  });

  render();
})();
