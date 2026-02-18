
class PadSpanApp extends HTMLElement {
  set hass(hass) {
    this.innerHTML = `
      <div style="padding:16px">
        <h2>PadSpan HA Diagnostics</h2>
        <pre>${JSON.stringify({
          version: "0.3.22",
          time: new Date().toISOString(),
          hass_version: hass?.connection?.haVersion,
          ws_connected: hass?.connection?.connected,
        }, null, 2)}</pre>
        <p>If you see this panel, the sidebar + panel loaded correctly.</p>
      </div>
    `;
  }
}
customElements.define("padspan-ha-app", PadSpanApp);
