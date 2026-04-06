// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Occupancy Dashboard — building and per-room people estimation.
 * Uses hybrid BLE counting: identified devices 1:1, unidentified with multiplier.
 * Training with actual headcounts adjusts the multiplier over time.
 */

export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("div", { id: "occupancy" });

  // Header
  root.appendChild(el("div", { style: "margin-bottom:14px" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-size:24px" }, "\ud83c\udfe2"),
      el("div", { style: "font-weight:700;font-size:16px;color:#5eead4" }, "Occupancy Dashboard"),
    ]),
    el("div", { style: "font-size:12px;color:#94a3b8;margin-top:2px" },
      "Estimated occupancy from BLE device counting with RSSI co-location clustering. Devices carried together are grouped into clusters."),
  ]));

  // Container for async content
  const content = el("div", {});
  root.appendChild(content);

  // Load and render
  _loadOccupancy(ctx, el, content);

  return root;
}

async function _loadOccupancy(ctx, el, container) {
  container.innerHTML = "";
  container.appendChild(el("div", { style: "text-align:center;color:#94a3b8;padding:20px" }, "Loading occupancy data\u2026"));

  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/occupancy_estimate" });
    container.innerHTML = "";

    const confColor = res.confidence === "high" ? "#52b788" : res.confidence === "medium" ? "#f59e0b" : "#f87171";

    // ── Building summary ─────────────────────────────────────────────────
    const summary = el("div", { class: "card", style: "margin-bottom:12px;border-color:" + confColor + "44" });
    summary.appendChild(el("div", { style: "display:flex;align-items:center;gap:14px" }, [
      el("div", { style: "font-size:42px;line-height:1" }, "\ud83c\udfe2"),
      el("div", { style: "flex:1" }, [
        el("div", { style: `font-weight:800;font-size:28px;color:${confColor}` },
          `~${res.total_estimate}`),
        el("div", { style: "font-size:13px;color:#94a3b8;margin-top:2px" },
          `${res.total_estimate === 1 ? "person" : "people"} estimated in building`),
        el("div", { style: "font-size:11px;color:#64748b;margin-top:4px" },
          `Range: ${res.total_low}\u2013${res.total_high} \u00b7 Confidence: ${res.confidence} \u00b7 Multiplier: ${res.multiplier}x` +
          (res.clusters != null ? ` \u00b7 ${res.clusters} cluster${res.clusters !== 1 ? "s" : ""}` : "")),
      ]),
    ]));

    // KPIs
    summary.appendChild(el("div", { style: "display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:8px;margin-top:12px" }, [
      _kpi(el, String(res.identified), "Identified", "#52b788"),
      _kpi(el, String(res.unidentified), "Unidentified", "#f59e0b"),
      _kpi(el, String(res.clusters ?? res.unidentified), "Clusters", "#a78bfa"),
      _kpi(el, String(res.excluded), "Excluded", "#64748b"),
      _kpi(el, String(res.total_devices || 0), "Total BLE", "#5eead4"),
    ]));
    if (res.clusters != null && res.clusters < res.unidentified) {
      summary.appendChild(el("div", { style: "font-size:10px;color:#a78bfa;margin-top:6px" },
        `Co-location clustering grouped ${res.unidentified} unidentified devices into ${res.clusters} cluster${res.clusters !== 1 ? "s" : ""} (threshold: ${res.cluster_threshold || 8} dBm). Each cluster \u2248 one person.`));
    }
    container.appendChild(summary);

    // ── Per-room breakdown ───────────────────────────────────────────────
    const rooms = res.rooms || [];
    if (rooms.length) {
      const roomCard = el("div", { class: "card", style: "margin-bottom:12px" });
      roomCard.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px" },
        "Per-Room Breakdown"));

      const grid = el("div", { style: "display:grid;grid-template-columns:1fr auto auto auto auto;gap:6px 12px;font-size:12px;align-items:center" });
      for (const h of ["Room", "Identified", "Unidentified", "Clusters", "Estimate"]) {
        grid.appendChild(el("div", { style: "font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase" }, h));
      }

      const sortedRooms = [...rooms].sort((a, b) => (b.estimate || 0) - (a.estimate || 0));
      for (const r of sortedRooms) {
        const est = r.estimate || 0;
        const color = est > 3 ? "#52b788" : est > 1 ? "#5eead4" : est > 0 ? "#94a3b8" : "#334155";
        const roomColor = ctx.helpers.roomColor ? ctx.helpers.roomColor(r.room) : color;
        const clust = r.clusters ?? r.unidentified;

        grid.appendChild(el("div", { style: `color:${roomColor};font-weight:600` }, r.room || "Unknown"));
        grid.appendChild(el("div", { style: "text-align:right;color:#52b788;font-weight:600;font-family:monospace" }, String(r.identified || 0)));
        grid.appendChild(el("div", { style: "text-align:right;color:#f59e0b;font-family:monospace" }, String(r.unidentified || 0)));
        grid.appendChild(el("div", { style: "text-align:right;color:#a78bfa;font-family:monospace" }, String(clust)));
        grid.appendChild(el("div", { style: `text-align:right;color:${color};font-weight:700;font-family:monospace;font-size:14px` }, String(est)));
      }
      roomCard.appendChild(grid);

      // Empty rooms note
      const emptyCount = rooms.filter(r => (r.estimate || 0) === 0).length;
      if (emptyCount) {
        roomCard.appendChild(el("div", { style: "margin-top:8px;font-size:10px;color:#64748b" },
          `${emptyCount} empty room${emptyCount !== 1 ? "s" : ""} not shown above`));
      }
      container.appendChild(roomCard);
    }

    // ── Tuning ─────────────────────────────────────────────────────────
    const tuneCard = el("div", { class: "card", style: "margin-bottom:12px" });
    tuneCard.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px" },
      "Clustering Tuning"));
    tuneCard.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-bottom:10px" },
      "Lower threshold = stricter grouping (fewer clusters, lower count). Higher = looser (more clusters, higher count)."));

    const threshRow = el("div", { style: "display:flex;align-items:center;gap:8px" });
    const threshVal = res.cluster_threshold || 8;
    const threshSlider = document.createElement("input");
    threshSlider.type = "range"; threshSlider.min = "2"; threshSlider.max = "20"; threshSlider.step = "1";
    threshSlider.value = String(threshVal);
    threshSlider.style.cssText = "width:160px;accent-color:#a78bfa";
    const threshLbl = el("span", { style: "font-size:12px;color:#a78bfa;min-width:80px" }, `Threshold: ${threshVal} dBm`);
    threshSlider.addEventListener("input", () => {
      threshLbl.textContent = `Threshold: ${threshSlider.value} dBm`;
    });
    const threshSaveBtn = el("button", { class: "btn", style: "padding:4px 12px;font-size:11px" }, "Save & Refresh");
    threshSaveBtn.addEventListener("click", async () => {
      const v = parseFloat(threshSlider.value) || 8;
      threshSaveBtn.disabled = true; threshSaveBtn.textContent = "Saving\u2026";
      try {
        await ctx.actions.settingsSet({ occupancy_cluster_threshold: v });
        ctx.toast(`Cluster threshold set to ${v} dBm`);
        _loadOccupancy(ctx, el, container);
      } catch (e) {
        ctx.toast("Failed: " + (e.message || e), true);
        threshSaveBtn.disabled = false; threshSaveBtn.textContent = "Save & Refresh";
      }
    });
    threshRow.appendChild(threshLbl);
    threshRow.appendChild(threshSlider);
    threshRow.appendChild(threshSaveBtn);
    tuneCard.appendChild(threshRow);
    container.appendChild(tuneCard);

    // ── Training ─────────────────────────────────────────────────────────
    const trainCard = el("div", { class: "card", style: "margin-bottom:12px" });
    trainCard.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px" },
      "Train the Estimator"));
    trainCard.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-bottom:10px" },
      "Enter the actual number of people in the building right now. This trains the BLE device multiplier for more accurate future estimates."));

    const trainRow = el("div", { style: "display:flex;align-items:center;gap:8px" });
    const trainInput = document.createElement("input");
    trainInput.type = "number"; trainInput.min = "0"; trainInput.max = "500"; trainInput.step = "1";
    trainInput.placeholder = "Actual headcount";
    trainInput.style.cssText = "width:120px;padding:6px 10px;border:1px solid #334155;border-radius:6px;background:#1e293b;color:#e2e8f0;font-size:13px";
    trainRow.appendChild(trainInput);

    const trainBtn = el("button", { class: "btn", style: "padding:6px 16px;font-size:12px" }, "Train");
    trainBtn.addEventListener("click", async () => {
      const actual = parseInt(trainInput.value, 10);
      if (isNaN(actual) || actual < 0) { ctx.toast("Enter a valid count"); return; }
      trainBtn.disabled = true; trainBtn.textContent = "Training\u2026";
      try {
        const r = await ctx.actions.callWS({ type: "padspan_ha/occupancy_train", actual_count: actual });
        ctx.toast(`Trained: multiplier ${r.old_multiplier}x \u2192 ${r.new_multiplier}x`);
        trainInput.value = "";
        _loadOccupancy(ctx, el, container); // refresh
      } catch (e) {
        ctx.toast("Failed: " + (e.message || e), true);
        trainBtn.disabled = false; trainBtn.textContent = "Train";
      }
    });
    trainRow.appendChild(trainBtn);
    trainCard.appendChild(trainRow);

    // Training history
    const training = ctx.state.settings?.occupancy_training || [];
    if (training.length) {
      trainCard.appendChild(el("div", { style: "margin-top:12px;font-weight:600;font-size:11px;color:#64748b" }, `Training History (${training.length} observations)`));
      const histGrid = el("div", { style: "display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:3px 10px;font-size:10px;margin-top:4px" });
      for (const h of ["Date", "Actual", "Estimated", "Multiplier"]) {
        histGrid.appendChild(el("div", { style: "font-weight:600;color:#475569" }, h));
      }
      for (const obs of [...training].reverse().slice(0, 20)) {
        const d = obs.timestamp ? new Date(obs.timestamp * 1000).toLocaleDateString() : "?";
        histGrid.appendChild(el("div", { style: "color:#94a3b8" }, d));
        histGrid.appendChild(el("div", { style: "color:#52b788;font-weight:600;text-align:right" }, String(obs.actual_count ?? "?")));
        histGrid.appendChild(el("div", { style: "color:#5eead4;text-align:right" }, String(obs.estimated ?? "?")));
        histGrid.appendChild(el("div", { style: "color:#f59e0b;text-align:right" }, obs.computed_multiplier ? `${obs.computed_multiplier}x` : "?"));
      }
      trainCard.appendChild(histGrid);
    }
    container.appendChild(trainCard);

    // ── Refresh button ───────────────────────────────────────────────────
    const refreshBtn = el("button", { class: "btn inline", style: "font-size:11px;padding:3px 12px" }, "\u21bb Refresh");
    refreshBtn.addEventListener("click", () => _loadOccupancy(ctx, el, container));
    container.appendChild(refreshBtn);

  } catch (e) {
    container.innerHTML = "";
    container.appendChild(el("div", { style: "color:#f87171;font-size:12px;padding:12px" },
      "Failed to load occupancy data: " + (e.message || e)));
  }
}

function _kpi(el, num, label, color) {
  return el("div", { style: "text-align:center;padding:8px;background:#0d1f14;border:1px solid #1b3526;border-radius:6px" }, [
    el("div", { style: `font-size:20px;font-weight:700;color:${color}` }, num),
    el("div", { style: "font-size:10px;color:#94a3b8" }, label),
  ]);
}
