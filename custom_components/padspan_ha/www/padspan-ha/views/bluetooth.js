// PadSpan HA – Bluetooth view
// Shows Bluetooth scanners (“radios”) and recent advertisements (“tags”).

export function render(ctx) {
  const { el, esc, pill } = ctx.helpers;

  const isLive = ctx.state.dataMode === "live";
  const snap = isLive ? (ctx.state.live && ctx.state.live.snapshot) : null;
  const ble = snap && snap.ble ? snap.ble : { radios: [], advertisements: [] };

  const radios = Array.isArray(ble.radios) ? ble.radios : [];
  const adsAll = Array.isArray(ble.advertisements) ? ble.advertisements : [];

  // Simple UI state
  if (typeof ctx.state.bleFilter !== "string") ctx.state.bleFilter = "";
  if (typeof ctx.state.bleLimit !== "number") ctx.state.bleLimit = 80;

  const fmtAgo = (iso) => {
    try {
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return "";
      const s = Math.max(0, Math.round((Date.now() - t) / 1000));
      if (s < 60) return `${s}s`;
      const m = Math.round(s / 60);
      if (m < 60) return `${m}m`;
      const h = Math.round(m / 60);
      if (h < 48) return `${h}h`;
      const d = Math.round(h / 24);
      return `${d}d`;
    } catch (e) {
      return "";
    }
  };

  const filter = ctx.state.bleFilter.trim().toLowerCase();
  let ads = adsAll;
  if (filter) {
    ads = adsAll.filter((a) => {
      const s = `${a.address || ""} ${a.name || ""} ${a.source || ""}`.toLowerCase();
      return s.includes(filter);
    });
  }

  // Sort: most recently seen first (prefer age_s if present)
  ads = ads
    .slice()
    .sort((a, b) => {
      const aa = typeof a.age_s === "number" ? a.age_s : 1e9;
      const bb = typeof b.age_s === "number" ? b.age_s : 1e9;
      return aa - bb;
    });

  const limited = ads.slice(0, ctx.state.bleLimit);

  const root = el(
    "section",
    { id: "bluetooth" },
    el(
      "div",
      { class: "view-header" },
      el("h2", {}, "Bluetooth"),
      el(
        "div",
        { class: "muted" },
        isLive ? "Live snapshot" : "Switch Data Mode to Live to see current Bluetooth data"
      )
    ),

    el(
      "div",
      { class: "grid-2" },
      // Radios
      el(
        "div",
        { class: "card" },
        el(
          "div",
          { class: "card-header" },
          el("div", { class: "card-title" }, "Radios"),
          pill(`${radios.length}`)
        ),
        radios.length
          ? el(
              "div",
              { class: "table" },
              el(
                "div",
                { class: "tr th" },
                el("div", { class: "td" }, "Source"),
                el("div", { class: "td" }, "Name")
              ),
              ...radios.map((r) =>
                el(
                  "div",
                  { class: "tr" },
                  el("div", { class: "td mono" }, esc(r.source || "")),
                  el("div", { class: "td" }, esc(r.name || ""))
                )
              )
            )
          : el(
              "div",
              { class: "muted" },
              isLive
                ? "No radios found (yet). If you expect scanners, confirm Home Assistant Bluetooth is configured and you have a working adapter/proxy."
                : "—"
            )
      ),

      // Ads
      el(
        "div",
        { class: "card" },
        el(
          "div",
          { class: "card-header" },
          el("div", { class: "card-title" }, "Tags (Advertisements)"),
          pill(`${adsAll.length}`)
        ),
        el(
          "div",
          { class: "row" },
          el("input", {
            class: "input",
            placeholder: "Filter (address / name / source)…",
            value: ctx.state.bleFilter,
            oninput: (e) => {
              ctx.state.bleFilter = e.target.value || "";
              ctx.actions.renderRooms();
            },
          }),
          el(
            "select",
            {
              class: "select",
              value: String(ctx.state.bleLimit),
              onchange: (e) => {
                const n = parseInt(e.target.value, 10);
                ctx.state.bleLimit = Number.isFinite(n) ? n : 80;
                ctx.actions.renderRooms();
              },
            },
            el("option", { value: "40" }, "40"),
            el("option", { value: "80" }, "80"),
            el("option", { value: "150" }, "150"),
            el("option", { value: "300" }, "300")
          )
        ),

        limited.length
          ? el(
              "div",
              { class: "table" },
              el(
                "div",
                { class: "tr th" },
                el("div", { class: "td" }, "Seen"),
                el("div", { class: "td" }, "RSSI"),
                el("div", { class: "td" }, "Address"),
                el("div", { class: "td" }, "Name"),
                el("div", { class: "td" }, "Radio")
              ),
              ...limited.map((a) => {
                const seen =
                  typeof a.age_s === "number"
                    ? `${Math.round(a.age_s)}s`
                    : a.last_seen
                      ? fmtAgo(a.last_seen)
                      : "";
                const rssi = a.rssi === 0 || a.rssi ? String(a.rssi) : "";
                return el(
                  "div",
                  { class: "tr" },
                  el("div", { class: "td" }, esc(seen)),
                  el("div", { class: "td mono" }, esc(rssi)),
                  el("div", { class: "td mono" }, esc(a.address || "")),
                  el("div", { class: "td" }, esc(a.name || a.address || "")),
                  el("div", { class: "td mono" }, esc(a.source || ""))
                );
              })
            )
          : el("div", { class: "muted" }, filter ? "No matches." : "No advertisements captured yet.")
      )
    ),

    el(
      "div",
      { class: "muted", style: "margin-top:12px" },
      "Tip: If this looks empty but Home Assistant’s Bluetooth visualization shows devices, open PadSpan → Diagnostics and confirm backend & UI versions match (stale cached static files can cause mismatches)."
    )
  );

  return root;
}
