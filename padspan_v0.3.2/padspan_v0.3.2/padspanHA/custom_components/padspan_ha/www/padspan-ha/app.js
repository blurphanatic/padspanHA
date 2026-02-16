(() => {
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const collapseBtn = document.getElementById("collapseBtn");
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const content = document.getElementById("content");
  const routeTitle = document.getElementById("routeTitle");

  const templates = {
    dashboard: "tpl-dashboard",
    map: "tpl-map",
    calibration: "tpl-calibration",
    devices: "tpl-devices",
    settings: "tpl-settings",
  };

  const safeRoute = (r) => templates[r] ? r : "dashboard";
  const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  let transitionLock = false;

  const saved = localStorage.getItem("padspan_sidebar_collapsed");
  if (saved === "1") app.classList.add("sidebar-collapsed");

  function render(route) {
    const key = safeRoute(route);
    const tpl = document.getElementById(templates[key]);
    content.replaceChildren(tpl.content.cloneNode(true));
    routeTitle.textContent = titleCase(key);

    document.querySelectorAll(".nav-link").forEach((a) => {
      a.classList.toggle("active", a.dataset.route === key);
    });
  }

  function currentRoute() {
    const hash = window.location.hash.replace("#", "").trim();
    return safeRoute(hash || "dashboard");
  }

  function applyRouteFromHash() {
    render(currentRoute());
  }

  function toggleSidebarCollapsed() {
    if (transitionLock) return;
    transitionLock = true;
    app.classList.toggle("sidebar-collapsed");
    localStorage.setItem("padspan_sidebar_collapsed", app.classList.contains("sidebar-collapsed") ? "1" : "0");
    setTimeout(() => (transitionLock = false), 220);
  }

  collapseBtn.addEventListener("click", toggleSidebarCollapsed);
  mobileMenuBtn.addEventListener("click", () => app.classList.toggle("mobile-open"));

  window.addEventListener("hashchange", applyRouteFromHash);
  window.addEventListener("keydown", (e) => {
    if (e.key === "[") toggleSidebarCollapsed();
    if (e.key === "Escape") app.classList.remove("mobile-open");
  });

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (app.classList.contains("mobile-open")) {
      const clickedInsideSidebar = sidebar.contains(target);
      const clickedMobileBtn = mobileMenuBtn.contains(target);
      if (!clickedInsideSidebar && !clickedMobileBtn) app.classList.remove("mobile-open");
    }
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      app.classList.remove("mobile-open");
    });
  });

  applyRouteFromHash();
})();
