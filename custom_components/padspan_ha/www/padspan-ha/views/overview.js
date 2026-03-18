// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Overview — "control tower" dashboard
 *
 * Basic mode:  summary bar (rooms, objects, radios) + 3D iso map with room/beacon dots.
 * Advanced mode:  KPI cards + renderRoomGrid() SVG with heatmap + beacon pins.
 *
 * Data flow:
 *   snapshot.ble.radios            → scanner count & list
 *   snapshot.ble.advertisements    → ad monitor stream
 *   snapshot.objects.list          → all tracked objects (entities + BLE)
 *   snapshot.objects.summary       → counts, OUI breakdown
 *
 * Design rules:
 *   - Every KPI metric is clickable → opens a detail modal with the full list.
 *   - Uses `liveSnap` (not `snap`) — differs from other views. See memory note.
 *   - 3D iso map re-uses the maps list + stack transforms from the Maps tab.
 */

export function render(ctx){
  const { el, esc, pill, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const isBasic = ctx.state.complexity === "basic";

  const fmtNum = (n)=>{
    try{ return new Intl.NumberFormat().format(Number(n||0)); }catch(e){ return String(n||0); }
  };
  const fmtAgo = (sec)=>{
    if(sec==null || isNaN(sec)) return "";
    const s = Math.max(0, Math.round(Number(sec)));
    if(s < 60) return `${s}s ago`;
    const m = Math.round(s/60);
    if(m < 60) return `${m}m ago`;
    const h = Math.round(m/60);
    if(h < 48) return `${h}h ago`;
    const d = Math.round(h/24);
    return `${d}d ago`;
  };

  const dataMode = ctx.state.dataMode || "sample";
  const liveSnap = ctx.state.live?.snapshot || null;

  // When live mode is active but snapshot hasn't arrived yet, show placeholder
  const liveLoading = dataMode === "live" && !liveSnap;

  // Fallback counts based on roomTagMap (works in sample mode too).
  const roomTagMap = liveLoading ? {} : (ctx.state.roomTagMap || {});
  const roomsCount = Object.keys(roomTagMap).length;
  const tagsCount = (() => {
    const s = new Set();
    for(const r of Object.keys(roomTagMap)){
      (roomTagMap[r]||[]).forEach(eid=>s.add(eid));
    }
    return s.size;
  })();

  const objSummary = (liveSnap && liveSnap.objects && liveSnap.objects.summary) ? liveSnap.objects.summary : null;
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const objectsTotal = objSummary ? (_quietMode ? objSummary.identified : objSummary.total) : tagsCount;
  const unidentifiedCount = _quietMode ? 0 : (objSummary ? objSummary.unidentified : 0);

  const radios = (liveSnap && liveSnap.ble && Array.isArray(liveSnap.ble.radios)) ? liveSnap.ble.radios : [];
  const radiosCount = radios.length;

  // ---------- Modal helpers ----------
  function openRoomsList(){
    const body = el("div",{});
    const rows = Object.keys(roomTagMap).sort().map((room)=>{
      const eids = roomTagMap[room] || [];
      const hasFollowed = eids.some(eid => ctx.actions.followedHas(String(eid)));
      const roomLabel = el("td",{},[
        el("span",{}, room),
        hasFollowed ? el("span",{style:"margin-left:6px;font-size:10px;color:#fbbf24;font-weight:700"}, "\u25C9 tracked") : null,
      ].filter(Boolean));
      const row = el("tr",{},[
        roomLabel,
        el("td",{}, String(eids.length)),
        el("td",{}, eids.join(", "))
      ]);
      row.style.cursor = "pointer";
      row.title = "Click for room details";
      row.addEventListener("click", ()=>{ ctx.actions.closeModal(); ctx.actions.showRoomDetail(room); });
      return row;
    });

    body.appendChild(el("div",{class:"controls"},[
      el("span",{class:"badge"}, `${roomsCount} rooms`),
      el("span",{class:"badge"}, `${tagsCount} mapped entities`)
    ]));

    body.appendChild(el("table",{class:"table"},[
      el("thead",{}, el("tr",{},[
        el("th",{}, "Room"),
        el("th",{}, "Mapped entities"),
        el("th",{}, "Entity IDs")
      ])),
      el("tbody",{}, rows.length?rows:el("tr",{}, el("td",{colspan:3}, "No rooms in current map.")))
    ]));

    ctx.actions.openModal("Rooms", body, "Current room→entity map");
  }

  function openRadiosList(){
    const body = el("div",{});
    const r = radios || [];
    const areas = (liveSnap && Array.isArray(liveSnap.rooms_discovered)) ? liveSnap.rooms_discovered : [];
    body.appendChild(el("div",{class:"controls"},[
      el("span",{class:"badge"}, `${r.length} radios`),
      el("span",{class:"badge"}, "Areas read from HA device registry"),
    ]));
    const rows = r.map((x)=>{
      const assignBtn = el("button",{class:"btn tiny"}, x.area_name ? "Change" : "Assign");
      assignBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        openAreaAssign(x, areas);
      });
      const areaCell = el("td",{});
      if(x.disabled){
        areaCell.appendChild(el("span",{class:"badge warn",style:"background:rgba(148,100,220,.18);color:#c084fc;margin-right:4px"},"⊘ Disabled"));
      } else if(x.lost){
        areaCell.appendChild(el("span",{class:"badge warn",style:"background:rgba(245,158,11,.18);color:#f59e0b;margin-right:4px"},"⚠ Lost"));
      }
      areaCell.appendChild(document.createTextNode(x.area_name || (x.disabled||x.lost ? "" : "—")));
      const _ovRn = ctx.helpers.radioName(x.source);
      const tr = el("tr",{},[
        el("td",{style:"font-family:monospace;font-weight:700;font-size:12px;letter-spacing:.04em",title:(_ovRn?_ovRn+" \u00b7 ":"")+(x.source||"")}, _sid(x.source)),
        el("td",{}, x.name || ""),
        el("td",{}, x.source || ""),
        el("td",{}, (x.adapter!=null?String(x.adapter):"")),
        el("td",{}, (x.scanning==null?"":String(x.scanning))),
        el("td",{}, (x.connectable==null?"":String(x.connectable))),
        areaCell,
        el("td",{}, assignBtn),
      ]);
      tr.style.cursor = "pointer";
      tr.title = "Click for scanner details";
      tr.addEventListener("click",(e)=>{
        if(e.target.tagName==="BUTTON") return;
        ctx.actions.closeModal(); ctx.actions.showScannerDetail(x);
      });
      return tr;
    });

    body.appendChild(el("table",{class:"table"},[
      el("thead",{}, el("tr",{},[
        el("th",{}, "ID"),
        el("th",{}, "Name"),
        el("th",{}, "Source"),
        el("th",{}, "Adapter"),
        el("th",{}, "Scanning"),
        el("th",{}, "Connectable"),
        el("th",{}, "Area"),
        el("th",{}, ""),
      ])),
      el("tbody",{}, rows.length?rows:el("tr",{}, el("td",{colspan:8}, "No radios found. (Switch to Live mode + ensure Bluetooth is enabled in HA.)")))
    ]));
    ctx.actions.openModal("Bluetooth Radios", body, "ID = 3-letter label code · Areas read from HA device registry");
  }

  function openAreaAssign(radio, areas){
    const sid = _sid(radio.source);
    if(dataMode !== "live"){
      ctx.toast("Area assignment requires Live mode.", true);
      return;
    }
    const sel = el("select",{class:"select"});
    sel.appendChild(el("option",{value:""},"— No area (clear) —"));
    for(const a of areas){
      const opt = el("option",{value:a}, a);
      if(a === radio.area_name && !radio.lost && !radio.disabled) opt.selected = true;
      sel.appendChild(opt);
    }
    // Lost sentinel — always at bottom, visually distinct
    const lostOpt = el("option",{value:"__lost__"}, "⚠  Lost  —  exclude from location math");
    lostOpt.style.color = "#f59e0b";
    if(radio.lost) lostOpt.selected = true;
    sel.appendChild(lostOpt);
    // Disabled sentinel — below Lost
    const disabledOpt = el("option",{value:"__disabled__"}, "⊘  Disabled  —  intentionally off");
    disabledOpt.style.color = "#c084fc";
    if(radio.disabled) disabledOpt.selected = true;
    sel.appendChild(disabledOpt);

    const status = el("div",{class:"muted", style:"min-height:20px;margin-top:6px"});
    const saveBtn = el("button",{class:"btn"}, "Save");
    const cancelBtn = el("button",{class:"btn inline"}, "Cancel");
    cancelBtn.addEventListener("click", ()=>ctx.actions.closeModal());
    saveBtn.addEventListener("click", async ()=>{
      const v = sel.value;
      saveBtn.disabled = true;
      try {
        if(v === "__lost__"){
          if(radio.disabled) await ctx.actions.radioDisabledSet(radio.source, false);
          await ctx.actions.radioLostSet(radio.source, true);
          ctx.actions.closeModal();
          ctx.toast(`"${radio.name || radio.source}" marked as Lost`);
        } else if(v === "__disabled__"){
          if(radio.lost) await ctx.actions.radioLostSet(radio.source, false);
          await ctx.actions.radioDisabledSet(radio.source, true);
          ctx.actions.closeModal();
          ctx.toast(`"${radio.name || radio.source}" marked as Disabled`);
        } else {
          // Restore from lost/disabled if needed, then set area
          if(radio.lost)     await ctx.actions.radioLostSet(radio.source, false);
          if(radio.disabled) await ctx.actions.radioDisabledSet(radio.source, false);
          const payload = { area_name: v };
          if(radio.device_id) payload.device_id = radio.device_id;
          else if(radio.source) payload.source = radio.source;
          await ctx.actions.radioAreaSet(payload);
          ctx.actions.closeModal();
          ctx.toast(v ? `Area set to "${v}"` : "Area cleared");
        }
        await ctx.actions.refreshSnapshot();
      } catch(e) {
        status.textContent = "Failed to update. Check HA logs.";
        saveBtn.disabled = false;
      }
    });
    const radioLabel = [sid, radio.name || radio.source].filter(Boolean).join("  ·  ");
    const body = el("div",{},[
      el("div",{class:"muted", style:"margin-bottom:8px"}, `Radio: ${radioLabel}`),
      radio.lost     ? el("div",{style:"color:#f59e0b;font-size:12px;margin-bottom:8px"}, "⚠ Currently marked as Lost. Select a room to restore it.") : null,
      radio.disabled ? el("div",{style:"color:#c084fc;font-size:12px;margin-bottom:8px"}, "⊘ Currently Disabled. Select a room to re-enable it.") : null,
      el("div",{style:"color:#94a3b8;font-size:12px;margin-bottom:10px"}, areas.length ? "Select an HA area for this scanner:" : "No HA areas found. Add areas in HA Settings → Areas & Zones."),
      el("div",{class:"row",style:"gap:8px;flex-wrap:wrap"},[sel, saveBtn, cancelBtn]),
      status,
    ].filter(Boolean));
    ctx.actions.openModal("Assign Area", body, `HA area for "${radio.name || radio.source}"`);
  }

  async function fillVendorCell(mac, cell){
    // Cache by prefix (AA:BB:CC)
    ctx.state._vendorCache = ctx.state._vendorCache || {};
    const prefix = (mac||"").split(":").slice(0,3).join(":").toUpperCase();
    if(!prefix){ cell.textContent = ""; return; }

    const cached = ctx.state._vendorCache[prefix];
    if(cached){
      cell.innerHTML = renderVendorHTML(cached);
      return;
    }

    // Placeholder while fetching
    cell.innerHTML = `<span class="badge">Looking up…</span>`;
    try{
      const res = await ctx.actions.vendorLookup(mac, false);
      ctx.state._vendorCache[prefix] = res;
      cell.innerHTML = renderVendorHTML(res);
    }catch(e){
      cell.innerHTML = `<span class="badge err">Lookup failed</span>`;
    }
  }

  function renderVendorHTML(res){
    if(!res || res.enabled === false){
      return `<span class="badge warn">Vendor lookup disabled</span>`;
    }
    const v1 = res.sources?.macvendors || null;
    const v2 = res.sources?.maclookup?.company || null;
    const rand = res.sources?.maclookup?.isRand;
    const priv = res.sources?.maclookup?.isPrivate;
    const flags = [];
    if(rand===true) flags.push("randomized");
    if(priv===true) flags.push("private");
    const top = (v2 || v1 || "Unknown vendor");
    const sub = flags.length ? ` <span class="badge warn">${flags.join(", ")}</span>` : "";
    const bt = res.sources?.maclookup?.blockType ? ` · ${res.sources.maclookup.blockType}` : "";
    return `<div><span class="badge">${escapeHtml(top)}</span>${sub}${escapeHtml(bt)}</div>`;
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
  }

  function openObjectsList(initialFilter="all"){
    if(!liveSnap || !liveSnap.objects){
      const body = el("div",{},[
        el("p",{}, "Objects list is only available in Live mode (it includes BLE advertisement monitor data)."),
        el("p",{}, "Switch to Live in Settings, then reopen this list.")
      ]);
      ctx.actions.openModal("Objects", body, "Live snapshot required");
      return;
    }

    const list = liveSnap.objects.list || [];
    const summary = liveSnap.objects.summary || {};
    const commonPrefixes = summary.common_prefixes || {};

    // Dedup: suppress entity rows whose device already has a BLE/iBeacon/private_ble row
    const _ovBleAddrSet = new Set();
    for (const o of list) {
      if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
      if (o.address) _ovBleAddrSet.add(o.address);
      if (Array.isArray(o.all_addresses)) {
        for (const a of o.all_addresses) _ovBleAddrSet.add(String(a).toUpperCase());
      }
    }
    const _ovLinkedSet = new Set(
      list.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : [])
    );
    const _ovIsDup = (o) =>
      o.kind === "entity" && (
        (o.address && _ovBleAddrSet.has(String(o.address).toUpperCase())) ||
        (o.entity_id && _ovLinkedSet.has(o.entity_id))
      );

    // Away detection
    const awayTimeoutS = ((ctx.state.settings && ctx.state.settings.away_timeout_m != null)
      ? Number(ctx.state.settings.away_timeout_m) : 5) * 60;
    const _isAway = (o) => {
      if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") return false;
      const a = o.age_s;
      return typeof a === "number" && isFinite(a) && a > awayTimeoutS;
    };

    // Time range slider
    const _ageSteps = [300, 900, 3600, 21600, 86400, 259200, 604800];
    const _ageLabels = ["5 min", "15 min", "1 hour", "6 hours", "1 day", "3 days", "1 week"];
    if (ctx.state.objAgeMax == null) ctx.state.objAgeMax = 604800;
    const _ageIdx = _ageSteps.indexOf(ctx.state.objAgeMax);
    const _curIdx = _ageIdx >= 0 ? _ageIdx : _ageSteps.length - 1;

    const body = el("div",{});
    const controls = el("div",{class:"controls"});
    const search = el("input",{type:"text", placeholder:"Search address, name, label…"});
    const kindSel = el("select",{},[
      el("option",{value:"all"}, "All kinds"),
      el("option",{value:"entity"}, "Entities only"),
      el("option",{value:"ble"}, "BLE / beacon devices"),
    ]);
    const statusSel = el("select",{},[
      el("option",{value:"all"}, "All statuses"),
      el("option",{value:"identified"}, "Identified"),
      el("option",{value:"unidentified"}, "Unidentified"),
      el("option",{value:"away"}, "Away"),
    ]);
    statusSel.value = initialFilter === "unidentified" ? "unidentified" : "all";

    const commonOnly = el("label",{style:"display:flex;align-items:center;gap:6px"},[
      el("input",{type:"checkbox"}),
      el("span",{}, "Only common OUIs (≥3)")
    ]);

    const ageLabel = el("span",{class:"muted",style:"white-space:nowrap;font-size:12px"}, _ageLabels[_curIdx]);
    const ageSlider = el("input",{
      type:"range", min:"0", max:String(_ageSteps.length - 1), step:"1",
      value: String(_curIdx),
      style: "width:120px;accent-color:#52b788",
    });
    ageSlider.addEventListener("input", ()=>{
      const idx = Number(ageSlider.value);
      ctx.state.objAgeMax = _ageSteps[idx];
      ageLabel.textContent = _ageLabels[idx];
      apply();
    });

    const stats = el("div",{class:"spacer"});
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.total||0)} total`));
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.unidentified||0)} unidentified`));
    controls.appendChild(search);
    controls.appendChild(kindSel);
    controls.appendChild(statusSel);
    controls.appendChild(commonOnly);
    controls.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px"},
      [el("span",{class:"muted",style:"font-size:12px;white-space:nowrap"}, "History:"), ageSlider, ageLabel]));
    controls.appendChild(stats);

    const table = el("table",{class:"table"});
    const thead = el("thead",{}, el("tr",{},[
      el("th",{}, "Kind"),
      el("th",{}, "Name / Entity"),
      el("th",{}, "Address"),
      el("th",{}, "Room"),
      el("th",{}, "Signal"),
      el("th",{}, "Last seen"),
      el("th",{}, "OUI freq"),
      el("th",{}, "Follow"),
      el("th",{}, "Tag"),
      el("th",{}, "Vendor (online)"),
    ]));
    const tbody = el("tbody",{});
    table.appendChild(thead);
    table.appendChild(tbody);

    // Build rows once, then filter by show/hide (fast, no re-render).
    const rowEls = list.map((o)=>{
      // Skip entity rows that duplicate a BLE row for the same physical device
      if(_ovIsDup(o)) return null;

      const kind = o.kind || "";
      const identified = !!o.identified;
      const addr = o.address || "";
      const userLabel = o.user_label || "";
      const name = userLabel || o.name || o.entity_id || "";
      const room = o.room || "";
      const rssi = (o.rssi==null?"":String(o.rssi));
      const lastSeen = o.age_s!=null ? fmtAgo(o.age_s) : (o.last_seen || "");
      const pfxCount = o.prefix_count || 0;
      const pfx = (o.prefix || "").toUpperCase();
      const isCommon = pfx && (commonPrefixes[pfx] || 0) >= 3;

      const vendorCell = el("td",{}, kind==="ble" ? el("span",{class:"badge"}, "—") : el("span",{class:"badge"}, "n/a"));

      // Follow button
      const followKey = addr || o.entity_id || "";
      const followCell = (() => {
        if (!followKey) return el("td",{}, "");
        const isF = ctx.actions.followedHas(followKey);
        const btn = el("button",{
          class: "btn tiny",
          style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
        }, isF ? "✓ Following" : "Follow");
        btn.addEventListener("click",(e)=>{
          e.stopPropagation();
          ctx.actions.followedToggle(followKey);
          const nowF = ctx.actions.followedHas(followKey);
          btn.textContent = nowF ? "✓ Following" : "Follow";
          btn.style.cssText = nowF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "";
        });
        return el("td",{}, btn);
      })();

      // Tag button for BLE/iBeacon/private_ble rows
      const tagCell = (() => {
        const tagAddr = kind === "private_ble" ? (o.canonical_id || addr)
                      : kind === "ibeacon"     ? (o.key || "")
                      : addr;
        if ((kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") || !tagAddr) return el("td",{}, "");
        const btn = el("button",{class:"btn tiny"}, userLabel ? "Relabel" : "Tag");
        btn.addEventListener("click",(e)=>{
          e.stopPropagation();
          ctx.actions.tagObjectPrompt(tagAddr, userLabel);
        });
        const wrap = el("div",{style:"display:flex;align-items:center;gap:6px"});
        if(userLabel) wrap.appendChild(el("span",{style:"color:#94a3b8;font-size:12px"}, userLabel));
        wrap.appendChild(btn);
        return el("td",{}, wrap);
      })();

      const isAway = _isAway(o);
      const tr = el("tr",{
        "data-kind": kind,
        "data-identified": identified ? "1":"0",
        "data-common": isCommon ? "1":"0",
        "data-age": String(o.age_s != null ? Math.round(o.age_s) : 0),
        "data-search": [
          kind, name, addr, room, userLabel, o.entity_id,
          o.ibeacon_uuid, o.company_name, o.device_type,
          (o.service_names||[]).join(" "),
          o.canonical_id, o.key, o.name, o.private_ble_name,
          (o.all_addresses||[]).join(" "),
          (o.linked_entities||[]).join(" "),
          o.ibeacon_major, o.ibeacon_minor,
          o.vendor, o.device, o.prefix,
          o.first_seen,
          (o.service_uuids||[]).join(" "),
          isAway ? "away" : "",
        ].filter(Boolean).join(" ").toLowerCase(),
        "data-mac": addr,
      },[
        el("td",{}, kind==="ble" ? pill("BLE","") : pill("Entity","")),
        el("td",{}, [
          el("div",{}, name),
          (userLabel && (o.name && o.name !== userLabel) ? el("div",{style:"color:#94a3b8"}, `raw: ${o.name}`) : null),
          (o.entity_id ? el("div",{style:"color:#94a3b8"}, o.entity_id) : null),
          (Array.isArray(o.linked_entities) && o.linked_entities.length ? el("div",{style:"color:#94a3b8"}, `Linked: ${o.linked_entities.join(", ")}`) : null),
          (kind==="ble" && Array.isArray(o.sources) && o.sources.length ? el("div",{style:"color:#94a3b8"}, `Seen by: ${o.sources.map(s=>{const _src=typeof s==="object"?(s.source||""):String(s);const id=_sid(_src);const _fn=ctx.helpers.radioName(_src);return id?id+" "+(_fn||_src):(_fn||_src);}).join(", ")}`) : null),
          ((o.company_name || o.device_type || (o.service_names && o.service_names.length))
            ? el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:2px"}, [
                o.company_name ? el("span",{style:"font-size:10px;padding:1px 5px;border-radius:4px;background:#1a2a3a;color:#7dd3fc;border:1px solid #1e4976"}, o.company_name) : null,
                o.device_type  ? el("span",{style:"font-size:10px;padding:1px 5px;border-radius:4px;background:#2a1a3a;color:#c4b5fd;border:1px solid #5b21b6"}, o.device_type) : null,
                ...(o.service_names || []).slice(0,3).map(sn =>
                  el("span",{style:"font-size:10px;padding:1px 5px;border-radius:4px;background:#1a3a2a;color:#86efac;border:1px solid #166534"}, sn)
                ),
              ].filter(Boolean))
            : (kind==="ble" && o.manufacturer_data && Object.keys(o.manufacturer_data).length ? el("div",{style:"color:#94a3b8;font-size:11px"}, `Manuf ID: ${Object.keys(o.manufacturer_data).slice(0,3).join(", ")}`) : null)),
          (o.device && (o.device.manufacturer || o.device.model) ? el("div",{style:"color:#94a3b8"}, `${o.device.manufacturer||""} ${o.device.model||""}`.trim()) : null),
          (o.connectable === true ? el("span",{style:"font-size:9px;color:#52b788"}, "connectable") : null),
        ].filter(Boolean)),
        el("td",{}, addr || "—"),
        el("td",{}, room || "—"),
        el("td",{}, rssi ? `${rssi} dBm` : "—"),
        el("td",{}, lastSeen || "—"),
        el("td",{}, pfxCount>=3 ? el("span",{class:"badge warn"}, `${pfxCount}×`) : (pfxCount? String(pfxCount):"")),
        followCell,
        tagCell,
        vendorCell,
      ]);

      tr.style.cursor = "pointer";
      tr.addEventListener("click",(ev)=>{
        if(ev.target.tagName==="BUTTON"||ev.target.tagName==="A") return;
        ctx.actions.closeModal(); ctx.actions.showObjectDetail(o);
      });
      // kick vendor lookup for BLE rows (best-effort, after render)
      tr._vendorCell = vendorCell;
      return tr;
    }).filter(Boolean);

    rowEls.forEach(tr=>tbody.appendChild(tr));

    function apply(){
      const q = (search.value||"").trim().toLowerCase();
      const k = kindSel.value;
      const st = statusSel.value;
      const co = commonOnly.querySelector("input").checked;
      const maxAge = ctx.state.objAgeMax || 604800;

      let shown = 0;

      for(const tr of rowEls){
        const kind = tr.getAttribute("data-kind");
        const idf = tr.getAttribute("data-identified")==="1";
        const common = tr.getAttribute("data-common")==="1";
        const hay = tr.getAttribute("data-search") || "";
        const away = hay.includes(" away");
        const age = Number(tr.getAttribute("data-age") || "0");

        let ok = true;
        // Entity objects always pass the age filter
        if(kind !== "entity" && age > maxAge) ok = false;
        if(q && !hay.includes(q)) ok=false;
        // "ble" filter covers ble, private_ble, and ibeacon (all physical BLE devices)
        if(k === "ble" && kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") ok = false;
        else if(k!=="all" && k!=="ble" && kind!==k) ok=false;
        if(st==="identified" && !idf) ok=false;
        if(st==="unidentified" && idf) ok=false;
        if(st==="away" && !away) ok=false;
        if(co && !common) ok=false;

        tr.style.display = ok ? "" : "none";
        if(ok) shown++;
      }
      stats.textContent = `${shown} of ${rowEls.length}`;
    }

    search.addEventListener("input", apply);
    kindSel.addEventListener("change", apply);
    statusSel.addEventListener("change", apply);
    commonOnly.querySelector("input").addEventListener("change", apply);
    apply();

    body.appendChild(controls);
    body.appendChild(table);

    ctx.actions.openModal("Objects", body, "Filter + vendor lookup (best-effort)");

    // After modal opens, do vendor lookups for visible BLE rows (limited concurrency).
    const maxLookups = 40;
    const queue = rowEls
      .filter(tr=>tr.getAttribute("data-kind")==="ble")
      .slice(0, maxLookups);

    // lightweight concurrency limiter
    let i = 0;
    const conc = 3;
    const runOne = async ()=>{
      while(i < queue.length){
        const tr = queue[i++];
        if(tr.style.display==="none") continue;
        const mac = tr.getAttribute("data-mac") || "";
        const cell = tr._vendorCell;
        if(mac && cell) await fillVendorCell(mac, cell);
      }
    };
    for(let n=0;n<conc;n++) runOne();
  }

  // ---------- EXPERIMENTAL: 2D Flat Map (replaces 3D iso when enabled) ----------
  function render2DMap(){
    const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
    if(!maps_list.length) return renderRoomGrid();

    const _esc = s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const roomColorFn = ctx.helpers.roomColor;
    const _isScanner = ctx.helpers.isScanner;
    const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);

    // Determine which maps to show
    const hiddenIds = new Set((ctx.state.settings && ctx.state.settings.hidden_map_ids) || []);
    const visible = maps_list.filter(m => !hiddenIds.has(m.id));
    if(!visible.length) return renderRoomGrid();

    const multiFloor = visible.length > 1;
    const focusIdx = ctx.state._2dFocusIdx || 0;
    const activeMap = visible[Math.min(focusIdx, visible.length - 1)];

    // ── Floor stitching: collect all maps on the same floor ──────────────
    const haFloors2d = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
    const activeFloorId = activeMap.stack?.floor_id || activeMap.floor_id || "";
    const floorMaps = visible.filter(m => {
      const fid = m.stack?.floor_id || m.floor_id || "";
      return fid === activeFloorId;
    });
    // Use all floor maps if there are multiple on this floor, else just activeMap
    const renderMaps = floorMaps.length > 1 ? floorMaps : [activeMap];

    // ── Build mapPt transform for each map (local 0-1 → world coords) ────
    const _OUTSIDE_FID_2D = "__outside__";
    const _mapPts = {};
    for (const m of renderMaps) {
      const stk = m.stack || {};
      const ox = stk.x_offset || 0, oy = stk.y_offset || 0, sc = stk.scale || 1.0;
      const ar = (m.image?.height || 600) / (m.image?.width || 800);
      const arRef = stk.ref_ar || ar, sxAdj = stk.scale_x_adj || 1.0;
      const rot = (stk.rotation || 0) * Math.PI / 180;
      if (stk._m && stk._m.length === 4) {
        _mapPts[m.id] = (px, py) => {
          const u = px - 0.5, v = py - 0.5;
          return [stk._m[0]*u + stk._m[1]*v + 0.5 + ox, arRef*(stk._m[2]*u + stk._m[3]*v + 0.5 + oy)];
        };
      } else {
        _mapPts[m.id] = (px, py) => {
          const dx = (px - 0.5) * sc * sxAdj, dy = (py - 0.5) * sc * arRef;
          const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
          const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
          return [(0.5 + ox) + rx, arRef * (0.5 + oy) + ry];
        };
      }
    }

    // ── Compute world bounding box of all floor maps ─────────────────────
    let wBB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const m of renderMaps) {
      const mpt = _mapPts[m.id];
      if (!mpt) continue;
      for (const [cx, cy] of [[0,0],[1,0],[1,1],[0,1]]) {
        const [wx, wy] = mpt(cx, cy);
        wBB.minX = Math.min(wBB.minX, wx);
        wBB.minY = Math.min(wBB.minY, wy);
        wBB.maxX = Math.max(wBB.maxX, wx);
        wBB.maxY = Math.max(wBB.maxY, wy);
      }
    }
    if (!isFinite(wBB.minX)) wBB = { minX: 0, minY: 0, maxX: 1, maxY: 0.75 };
    // Add 2% padding
    const wPad = Math.max(wBB.maxX - wBB.minX, wBB.maxY - wBB.minY) * 0.02;
    wBB.minX -= wPad; wBB.minY -= wPad; wBB.maxX += wPad; wBB.maxY += wPad;
    const wW = wBB.maxX - wBB.minX;
    const wH = wBB.maxY - wBB.minY;
    // World → view normalized (0-1)
    const w2v = (wx, wy) => [(wx - wBB.minX) / wW, (wy - wBB.minY) / wH];
    // Is this a stitched multi-map view?
    const isStitched = renderMaps.length > 1;

    const imgW = isStitched ? 800 : (activeMap.image?.width || 800);
    const imgH = isStitched ? Math.round(800 * wH / wW) : (activeMap.image?.height || 600);
    const imgUrl = activeMap.image?.filename ? `/local/padspan_ha/maps/${activeMap.image.filename}` : null;

    // Filter state (persists within session)
    if(ctx.state._2dFilters === undefined) ctx.state._2dFilters = { scanners: true, tagged: true, unknown: false, rooms: true, mapImg: false, radioMap: false, distortion: false };
    const F = ctx.state._2dFilters;

    // Radio map state (must be declared before buildSVG closure captures them)
    let _radioMapScanner = ctx.state._2dRadioMapScanner || null;
    const _radioMapOn = !!(ctx.state.settings && ctx.state.settings.radio_map_enabled);
    const _distortionOn = !!(ctx.state.settings && ctx.state.settings.distortion_map_enabled);

    // Lazy-load calibration data for radio map / distortion map overlays
    let _calPoints = ctx.state._2dCalPoints || null;
    let _radioMapMod = ctx.state._2dRadioMapMod || null;
    if ((F.radioMap || F.distortion) && !_calPoints) {
      // Fetch calibration data once, then re-render
      (async () => {
        try {
          const calData = await ctx.actions.calibrationGet();
          ctx.state._2dCalPoints = calData.points || [];
          _calPoints = ctx.state._2dCalPoints;
          // Also compute available scanners for the scanner selector
          if (_radioMapMod) {
            ctx.state._2dCalScanners = (isStitched && _radioMapMod.getFloorScanners) ? _radioMapMod.getFloorScanners(_calPoints, renderMaps.map(m=>m.id)) : _radioMapMod.getMapScanners(_calPoints, activeMap.id);
          }
          // Trigger re-render of the SVG
          if (svgDiv) svgDiv.innerHTML = buildSVG();
          if (typeof _updateScannerBar === "function") _updateScannerBar();
        } catch (e) { console.warn("PadSpan: calibration fetch for radio map failed", e); }
      })();
    }
    // Lazy-load the radio_map module
    if ((_radioMapOn || _distortionOn) && !_radioMapMod) {
      (async () => {
        try {
          const mod = await import("./radio_map.js?b=" + (ctx.state.buildId || ""));
          ctx.state._2dRadioMapMod = mod;
          _radioMapMod = mod;
          // Recompute scanner list if cal data is already loaded
          if (_calPoints) {
            ctx.state._2dCalScanners = mod.getMapScanners(_calPoints, activeMap.id);
          }
          if (svgDiv) svgDiv.innerHTML = buildSVG();
        } catch (e) { console.warn("PadSpan: radio_map module load failed", e); }
      })();
    }

    // Zoom/pan state
    if(ctx.state._2dZoom === undefined) ctx.state._2dZoom = 1.0;
    if(ctx.state._2dPanX === undefined) ctx.state._2dPanX = 0;
    if(ctx.state._2dPanY === undefined) ctx.state._2dPanY = 0;

    // Objects on this map
    const objects = ((liveSnap && liveSnap.objects && liveSnap.objects.list) || []).filter(o => !_isScanner(o));
    const receivers = (activeMap.receivers || []);

    // Live radios for scanner status
    const liveRadios = (liveSnap && liveSnap.ble && liveSnap.ble.radios) || [];
    const liveRadioMap = {};
    for(const r of liveRadios) liveRadioMap[r.source] = r;

    // Stroke widths & marker sizes in normalized [0..1] space (matches Maps tab approach)
    const _sw = 0.003;           // room boundary stroke
    const _mkR = 0.015;          // scanner marker radius
    const _dotR = 0.008;         // object dot radius
    const _fsRoom = 0.022;       // room label font size
    const _fsScan = 0.014;       // scanner label font size
    const _fsObj = 0.013;        // object label font size

    // ── Point transform helper ───────────────────────────────────────────
    // In stitched mode, convert local map coords to view coords via world space.
    // In single-map mode, coords pass through unchanged (0-1 = view space).
    const _pt = (m, lx, ly) => {
      if (!isStitched) return [lx, ly];
      const mpt = _mapPts[m.id];
      if (!mpt) return [lx, ly];
      const [wx, wy] = mpt(lx, ly);
      return w2v(wx, wy);
    };
    const _f = v => v.toFixed(5);

    // Build SVG content — viewBox="0 0 1 {aspect}" with xMidYMid meet
    // for correct aspect ratio in stitched mode.
    const vAspect = isStitched ? (wH / wW) : 1;
    const buildSVG = () => {
      let s = `<svg viewBox="0 0 1 ${_f(vAspect)}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${isStitched ? "xMidYMid meet" : "none"}" width="100%" height="100%" style="display:block">`;
      s += `<rect x="0" y="0" width="1" height="${_f(vAspect)}" fill="#0d1f12"/>`;

      // ── Map images ──────────────────────────────────────────────────────
      if (F.mapImg) {
        for (const m of renderMaps) {
          const mUrl = m.image?.filename ? `/local/padspan_ha/maps/${m.image.filename}` : null;
          if (!mUrl) continue;
          if (isStitched) {
            // Project the 4 corners to get positioned image via SVG transform
            const [vTL_x, vTL_y] = _pt(m, 0, 0);
            const [vTR_x, vTR_y] = _pt(m, 1, 0);
            const [vBL_x, vBL_y] = _pt(m, 0, 1);
            // Compute affine transform from unit square to view quadrilateral
            // For SVG image: use x, y, width, height + transform
            const dx = vTR_x - vTL_x, dy = vTR_y - vTL_y;
            const ex = vBL_x - vTL_x, ey = vBL_y - vTL_y;
            // SVG matrix(a,b,c,d,e,f): maps (x,y) → (a*x+c*y+e, b*x+d*y+f)
            s += `<image href="${mUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" opacity="0.65" transform="matrix(${_f(dx)},${_f(dy)},${_f(ex)},${_f(ey)},${_f(vTL_x)},${_f(vTL_y)})"/>`;
          } else {
            s += `<image href="${mUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" opacity="0.75"/>`;
          }
        }
      }

      // ── Radio Map heatmap layer ─────────────────────────────────────────
      // Always use world-space floor heatmap — even single-map floors benefit
      // from the unified interpolation (consistent coordinate system, barrier
      // merging, and data from all maps on the floor contributes).
      if (F.radioMap && _radioMapMod && _calPoints && _calPoints.length && _radioMapMod.floorHeatmapSVG) {
        const floorSvg = _radioMapMod.floorHeatmapSVG(_calPoints, renderMaps, _mapPts, w2v, wBB, _radioMapScanner);
        if (floorSvg) s += floorSvg;
      }

      // ── Distortion Map layer ────────────────────────────────────────────
      if (F.distortion && _radioMapMod && _calPoints && _calPoints.length) {
        for (const m of renderMaps) {
          const dmSvg = _radioMapMod.distortionMapSVG(_calPoints, m.id, m.rf_barriers || [], m.receivers || []);
          if (dmSvg) {
            if (isStitched) {
              const [vTL_x, vTL_y] = _pt(m, 0, 0);
              const [vTR_x, vTR_y] = _pt(m, 1, 0);
              const [vBL_x, vBL_y] = _pt(m, 0, 1);
              const dx = vTR_x - vTL_x, dy = vTR_y - vTL_y;
              const ex = vBL_x - vTL_x, ey = vBL_y - vTL_y;
              s += `<g transform="matrix(${_f(dx)},${_f(dy)},${_f(ex)},${_f(ey)},${_f(vTL_x)},${_f(vTL_y)})">`;
              s += `<svg viewBox="0 0 1 1" width="1" height="1" preserveAspectRatio="none">${dmSvg}</svg>`;
              s += `</g>`;
            } else {
              s += dmSvg;
            }
          }
        }
      }

      // ── Room boundaries ─────────────────────────────────────────────────
      if (F.rooms) {
        for (const m of renderMaps) {
          for (const [room, b] of Object.entries(m.room_bounds || {})) {
            if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
            const color = roomColorFn(room);
            const pp = b.points.map(p => { const [vx, vy] = _pt(m, p[0], p[1]); return `${_f(vx)},${_f(vy)}`; }).join(" ");
            s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="${_sw}" stroke-opacity="0.7"/>`;
            const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
            const cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
            const [vcx, vcy] = _pt(m, cx, cy);
            s += `<text x="${_f(vcx)}" y="${_f(vcy)}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${_fsRoom}" font-weight="600" opacity="0.8">${_esc(room)}</text>`;
          }
        }
      }

      // ── Scanners ────────────────────────────────────────────────────────
      if (F.scanners) {
        for (const m of renderMaps) {
          for (const r of (m.receivers || [])) {
            const [px, py] = _pt(m, r.x != null ? r.x : 0.5, r.y != null ? r.y : 0.5);
            const src = r.source || r.id || "";
            const liveR = liveRadioMap[src];
            const isOnline = !!liveR;
            const rxColor = isOnline ? "#52b788" : "#4a6052";
            const rxName = (r.label || (liveR && liveR.name) || r.source || "radio").substring(0, 16);
            s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_mkR*1.8}" fill="none" stroke="${rxColor}" stroke-width="${_sw*0.5}" opacity="0.3"/>`;
            s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_mkR}" fill="none" stroke="${rxColor}" stroke-width="${_sw*0.7}" opacity="0.6"/>`;
            s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_mkR*0.5}" fill="${rxColor}" opacity="0.9"/>`;
            s += `<text x="${_f(px)}" y="${_f(py - _mkR*2.2)}" text-anchor="middle" fill="${rxColor}" font-size="${_fsScan}" font-weight="600">${_esc(rxName)}</text>`;
          }
        }
      }

      // ── Objects positioned on floor maps ─────────────────────────────────
      const roomCentroids = {};
      for (const m of renderMaps) {
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || !b.points || b.points.length < 3) continue;
          if (roomCentroids[room]) continue; // first map wins
          const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [vx, vy] = _pt(m, cx, cy);
          roomCentroids[room] = { x: vx, y: vy };
        }
      }

      const _roomObjIdx = {};
      for (const o of objects) {
        const isTagged = !!(o.user_label || o.identified);
        const isFollowed = ctx.actions.followedHas && (ctx.actions.followedHas(o.address || "") || ctx.actions.followedHas(o.key || ""));
        if (!F.tagged && isTagged && !isFollowed) continue;
        if (!F.unknown && !isTagged && !isFollowed) continue;
        if (_quietMode && !isTagged && !isFollowed) continue;

        let px, py;
        // k-NN position: check all floor maps
        const knnMap = renderMaps.find(m => o.knn_map_id === m.id);
        if (typeof o.x_frac === "number" && typeof o.y_frac === "number" && knnMap) {
          [px, py] = _pt(knnMap, o.x_frac, o.y_frac);
        } else if (o.room && roomCentroids[o.room]) {
          const c = roomCentroids[o.room];
          const idx = (_roomObjIdx[o.room] || 0);
          _roomObjIdx[o.room] = idx + 1;
          const angle = idx * 2.4;
          const spread = 0.04;
          px = c.x + Math.cos(angle) * Math.min(spread * (1 + idx * 0.3), spread * 3);
          py = c.y + Math.sin(angle) * Math.min(spread * (1 + idx * 0.3), spread * 3);
        } else {
          continue;
        }

        const lbl = (o.user_label || o.name || "").substring(0, 14);

        if (isFollowed) {
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR*2}" fill="#fbbf24" fill-opacity="0.15"/>`;
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR}" fill="#fbbf24" stroke="#071008" stroke-width="${_sw*0.5}"/>`;
          if (lbl) s += `<text x="${_f(px)}" y="${_f(py - _dotR*2)}" text-anchor="middle" fill="#fbbf24" font-size="${_fsObj}" font-weight="600">${_esc(lbl)}</text>`;
        } else if (isTagged) {
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR}" fill="#5eead4" stroke="#071008" stroke-width="${_sw*0.5}" opacity="0.9"/>`;
          if (lbl) s += `<text x="${_f(px)}" y="${_f(py - _dotR*1.8)}" text-anchor="middle" fill="#5eead4" font-size="${_fsObj}" font-weight="600" opacity="0.85">${_esc(lbl)}</text>`;
        } else {
          s += `<circle cx="${_f(px)}" cy="${_f(py)}" r="${_dotR*0.7}" fill="#f59e0b" stroke="#071008" stroke-width="${_sw*0.3}" opacity="0.5"/>`;
        }
      }

      s += `</svg>`;
      return s;
    };

    // ── DOM construction ──
    const outer = document.createElement("div");
    outer.style.cssText = "margin-bottom:16px";

    // Experimental badge
    const badge2d = document.createElement("div");
    badge2d.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    badge2d.innerHTML = `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:#422006;color:#fbbf24;border:1px solid #92400e;font-weight:700">EXPERIMENTAL</span><span style="font-size:12px;color:#94a3b8">2D Map Mode</span>`;
    outer.appendChild(badge2d);

    // Filter toggles
    const filterBar = document.createElement("div");
    filterBar.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";

    let _updateScannerBar = null; // set later if radio map enabled
    const makeFilterBtn = (key, label, color) => {
      const btn = document.createElement("button");
      btn.className = "btn inline";
      const update = () => {
        btn.style.cssText = F[key]
          ? `font-size:11px;padding:2px 8px;background:${color}22;border-color:${color};color:${color};font-weight:600`
          : "font-size:11px;padding:2px 8px;color:#64748b;border-color:#334155";
        btn.textContent = (F[key] ? "\u25C9 " : "\u25CB ") + label;
      };
      update();
      btn.addEventListener("click", () => {
        F[key] = !F[key];
        update();
        svgDiv.innerHTML = buildSVG();
        // Update scanner selector visibility when Radio Map toggled
        if (key === "radioMap" && _updateScannerBar) _updateScannerBar();
      });
      return btn;
    };

    // Layer toggles (map image + room lines) first — top left
    filterBar.appendChild(makeFilterBtn("mapImg", "Map", "#a78bfa"));
    filterBar.appendChild(makeFilterBtn("rooms", "Rooms", "#60a5fa"));
    // Separator
    const sep2d = document.createElement("span");
    sep2d.style.cssText = "width:1px;height:16px;background:#334155;margin:0 2px";
    filterBar.appendChild(sep2d);
    filterBar.appendChild(makeFilterBtn("scanners", "Scanners", "#52b788"));
    filterBar.appendChild(makeFilterBtn("tagged", "Tagged", "#5eead4"));
    filterBar.appendChild(makeFilterBtn("unknown", "Unknown", "#f59e0b"));

    // ── Radio Map & Distortion Map toggles (experimental, gated behind settings) ──
    if (_radioMapOn || _distortionOn) {
      const sep2d2 = document.createElement("span");
      sep2d2.style.cssText = "width:1px;height:16px;background:#334155;margin:0 2px";
      filterBar.appendChild(sep2d2);
      if (_radioMapOn) filterBar.appendChild(makeFilterBtn("radioMap", "Radio Map", "#e879f9"));
      if (_distortionOn) filterBar.appendChild(makeFilterBtn("distortion", "Distortion", "#fb923c"));
    }
    outer.appendChild(filterBar);

    // Scanner selector for per-scanner radio map (shown when radio map is active)
    const scannerBar = document.createElement("div");
    scannerBar.style.cssText = "display:none;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";
    if (_radioMapOn) {
      _updateScannerBar = () => {
        if (!F.radioMap) { scannerBar.style.display = "none"; return; }
        scannerBar.style.display = "flex";
        scannerBar.innerHTML = "";
        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:11px;color:#94a3b8";
        lbl.textContent = "Scanner:";
        scannerBar.appendChild(lbl);
        // "Combined" button
        const combBtn = document.createElement("button");
        combBtn.className = "btn inline";
        combBtn.style.cssText = !_radioMapScanner
          ? "font-size:10px;padding:2px 8px;background:#0a2a1a;border-color:#e879f9;color:#e879f9;font-weight:700"
          : "font-size:10px;padding:2px 8px;color:#64748b";
        combBtn.textContent = "Combined";
        combBtn.addEventListener("click", () => {
          _radioMapScanner = null;
          ctx.state._2dRadioMapScanner = null;
          _updateScannerBar();
          svgDiv.innerHTML = buildSVG();
        });
        scannerBar.appendChild(combBtn);
        // Per-scanner buttons (from calibration data)
        const calScanners = ctx.state._2dCalScanners || [];
        for (const sc of calScanners) {
          const btn = document.createElement("button");
          btn.className = "btn inline";
          const isActive = _radioMapScanner === sc.source;
          btn.style.cssText = isActive
            ? "font-size:10px;padding:2px 8px;background:#0a2a1a;border-color:#e879f9;color:#e879f9;font-weight:700"
            : "font-size:10px;padding:2px 8px;color:#64748b";
          btn.textContent = (sc.name || sc.source).substring(0, 20);
          btn.addEventListener("click", () => {
            _radioMapScanner = sc.source;
            ctx.state._2dRadioMapScanner = sc.source;
            _updateScannerBar();
            svgDiv.innerHTML = buildSVG();
          });
          scannerBar.appendChild(btn);
        }
      };
      _updateScannerBar();
    }
    outer.appendChild(scannerBar);

    // Floor / Map selector (only if multiple visible maps)
    if(multiFloor){
      const mapBar = document.createElement("div");
      mapBar.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";

      // Group maps by floor for the selector
      const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
      const floorGroups = new Map(); // floorLabel → [mapIndex, ...]
      for(let mi = 0; mi < visible.length; mi++){
        const m = visible[mi];
        const floorId = m.stack?.floor_id || m.floor_id || "";
        const haFlr = haFloors.find(f => String(f.id) === String(floorId));
        const flLbl = haFlr ? (haFlr.name || haFlr.id) : (m.name || m.id || `Map ${mi+1}`);
        if(!floorGroups.has(flLbl)) floorGroups.set(flLbl, []);
        floorGroups.get(flLbl).push(mi);
      }

      // If we have distinct floors, show floor buttons; otherwise fall back to map buttons
      const useFloors = floorGroups.size > 1 || (floorGroups.size === 1 && [...floorGroups.values()][0].length > 1);
      const lbl = document.createElement("span");
      lbl.style.cssText = "font-size:12px;color:#94a3b8";
      lbl.textContent = useFloors ? "Floor:" : "Map:";
      mapBar.appendChild(lbl);

      if(useFloors){
        for(const [floorName, mapIndices] of floorGroups){
          const isActive = mapIndices.includes(focusIdx);
          const fbtn = document.createElement("button");
          fbtn.className = "btn inline";
          fbtn.style.cssText = isActive
            ? "font-size:11px;padding:2px 10px;background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
            : "font-size:11px;padding:2px 10px;color:#94a3b8";
          fbtn.textContent = floorName;
          const firstIdx = mapIndices[0];
          fbtn.addEventListener("click", () => {
            ctx.state._2dFocusIdx = firstIdx;
            ctx.state._2dZoom = 1.0;
            ctx.state._2dPanX = 0;
            ctx.state._2dPanY = 0;
            ctx.actions.renderRooms();
          });
          mapBar.appendChild(fbtn);
          // If this floor has multiple maps and is active, show sub-buttons
          if(isActive && mapIndices.length > 1){
            for(const mi of mapIndices){
              const m = visible[mi];
              const sbtn = document.createElement("button");
              sbtn.className = "btn inline";
              sbtn.style.cssText = mi === focusIdx
                ? "font-size:10px;padding:1px 6px;background:#0a2a1a;border-color:#94a3b8;color:#e2e8f0;font-weight:600"
                : "font-size:10px;padding:1px 6px;color:#64748b";
              sbtn.textContent = m.name || m.id;
              const idx = mi;
              sbtn.addEventListener("click", () => {
                ctx.state._2dFocusIdx = idx;
                ctx.state._2dZoom = 1.0;
                ctx.state._2dPanX = 0;
                ctx.state._2dPanY = 0;
                ctx.actions.renderRooms();
              });
              mapBar.appendChild(sbtn);
            }
          }
        }
      } else {
        // Fallback: individual map buttons
        for(let mi = 0; mi < visible.length; mi++){
          const m = visible[mi];
          const mbtn = document.createElement("button");
          mbtn.className = "btn inline";
          mbtn.style.cssText = mi === focusIdx
            ? "font-size:11px;padding:2px 10px;background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
            : "font-size:11px;padding:2px 10px;color:#94a3b8";
          mbtn.textContent = m.name || m.id || `Map ${mi+1}`;
          const idx = mi;
          mbtn.addEventListener("click", () => {
            ctx.state._2dFocusIdx = idx;
            ctx.state._2dZoom = 1.0;
            ctx.state._2dPanX = 0;
            ctx.state._2dPanY = 0;
            ctx.actions.renderRooms();
          });
          mapBar.appendChild(mbtn);
        }
      }
      outer.appendChild(mapBar);
    }

    // SVG container with zoom/pan
    const svgWrap = document.createElement("div");
    svgWrap.style.cssText = "position:relative;overflow:hidden;border-radius:8px;background:#071008;cursor:grab;touch-action:none;width:100%";
    // Compute aspect-ratio container height: fill width, maintain aspect ratio
    const aspectPct = isStitched
      ? (wH / wW * 100).toFixed(2)
      : (imgH / imgW * 100).toFixed(2);
    svgWrap.style.paddingBottom = `${Math.min(80, Math.max(30, aspectPct))}%`;

    const svgDiv = document.createElement("div");
    svgDiv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;transform-origin:0 0`;
    svgDiv.innerHTML = buildSVG();

    // Zoom/pan logic
    let zoom = ctx.state._2dZoom;
    let panX = ctx.state._2dPanX;
    let panY = ctx.state._2dPanY;
    let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

    const applyTransform = () => {
      svgDiv.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    };
    applyTransform();

    svgWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svgWrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.max(0.5, Math.min(8, zoom * delta));
      // Zoom toward cursor
      panX = mx - (mx - panX) * (zoom / oldZoom);
      panY = my - (my - panY) * (zoom / oldZoom);
      ctx.state._2dZoom = zoom;
      ctx.state._2dPanX = panX;
      ctx.state._2dPanY = panY;
      applyTransform();
    }, { passive: false });

    svgWrap.addEventListener("pointerdown", (e) => {
      if(e.button !== 0) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      svgWrap.style.cursor = "grabbing";
      svgWrap.setPointerCapture(e.pointerId);
    });
    svgWrap.addEventListener("pointermove", (e) => {
      if(!dragging) return;
      panX = panStartX + (e.clientX - dragStartX);
      panY = panStartY + (e.clientY - dragStartY);
      ctx.state._2dPanX = panX;
      ctx.state._2dPanY = panY;
      applyTransform();
    });
    const endDrag = () => {
      dragging = false;
      svgWrap.style.cursor = "grab";
    };
    svgWrap.addEventListener("pointerup", endDrag);
    svgWrap.addEventListener("pointercancel", endDrag);

    // Reset zoom button
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn inline";
    resetBtn.style.cssText = "position:absolute;top:6px;right:6px;z-index:2;font-size:11px;padding:2px 8px;background:#071008cc;color:#94a3b8";
    resetBtn.textContent = "Reset zoom";
    resetBtn.addEventListener("click", () => {
      zoom = 1.0; panX = 0; panY = 0;
      ctx.state._2dZoom = 1; ctx.state._2dPanX = 0; ctx.state._2dPanY = 0;
      applyTransform();
    });

    svgWrap.appendChild(svgDiv);
    svgWrap.appendChild(resetBtn);
    outer.appendChild(svgWrap);

    return outer;
  }

  // ---------- 3D Iso Floor Stack (uses uploaded maps data + live presence) ----------
  function renderIsoFloorStack(){
    // ── Experimental 2D mode gate ──
    if(ctx.state.settings && ctx.state.settings.overview_2d_mode){
      return render2DMap();
    }
    const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
    // Fallback: sample floor plan → room grid
    if(!maps_list.length){
      if(liveSnap && liveSnap.floor_plan) return renderFloorPlan(liveSnap.floor_plan);
      return renderRoomGrid();
    }

    const TILE=220, CX=380, CY=590, W=760, BASE_H=940;
    const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
    const roomColorFn = ctx.helpers.roomColor;
    const _esc = s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    if(ctx.state._overviewFloorGap===undefined) ctx.state._overviewFloorGap = ctx.state.settings?.overview_iso_floor_gap ?? 150;
    if(ctx.state._overviewHorizGap===undefined) ctx.state._overviewHorizGap = ctx.state.settings?.overview_iso_horiz_gap ?? 0;
    let _ovFG=ctx.state._overviewFloorGap, _ovHG=ctx.state._overviewHorizGap;
    const iso = (wx,wy,wz)=>[CX+(wx-wy)*TILE*0.866+wz*_ovHG, CY+(wx+wy)*TILE*0.5-wz*_ovFG];
    const pt  = c=>`${Math.round(c[0])},${Math.round(c[1])}`;
    const pts = cs=>cs.map(pt).join(" ");

    const _isScanner = ctx.helpers.isScanner;
    const _allObjRaw = ((liveSnap && liveSnap.objects && Array.isArray(liveSnap.objects.list)) ? liveSnap.objects.list : [])
      .filter(o => !_isScanner(o));
    // Dedup: suppress entity rows whose physical device already has a BLE/iBeacon/private_ble row.
    // Build a room-inheritance map (entity room → BLE key) WITHOUT mutating shared snapshot objects.
    const _isoAddrSet = new Set();
    const _entityRoomByAddr = {};  // uppercase addr → entity's room (for inheritance)
    for (const o of _allObjRaw) {
      if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
      if (o.address) _isoAddrSet.add(String(o.address).toUpperCase());
      if (Array.isArray(o.all_addresses)) for (const a of o.all_addresses) _isoAddrSet.add(String(a).toUpperCase());
    }
    const _isoLinkedSet = new Set(_allObjRaw.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : []));
    // Collect entity rooms for inheritance (never mutate snapshot objects)
    for (const o of _allObjRaw) {
      if (o.kind !== "entity") continue;
      if (o.room && o.room !== "unknown" && o.room !== "not_home" && o.address) {
        _entityRoomByAddr[String(o.address).toUpperCase()] = o.room;
      }
    }
    const allObjects = _allObjRaw.filter(o => {
      if (o.kind === "entity" && (
        (o.address && _isoAddrSet.has(String(o.address).toUpperCase())) ||
        (o.entity_id && _isoLinkedSet.has(o.entity_id))
      )) return false;
      return true;
    }).map(o => {
      // For BLE objects missing a room, inherit from their suppressed entity counterpart
      // Return a shallow copy to avoid mutating shared snapshot state
      if ((o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") &&
          (!o.room || o.room === "unknown" || o.room === "not_home") && o.address) {
        const eRoom = _entityRoomByAddr[String(o.address).toUpperCase()];
        if (eRoom) return Object.assign({}, o, { room: eRoom });
      }
      return o;
    });
    const allRadios_live = radios;

    // Sync _hiddenMapIds from settings (authoritative, fetched on every refresh).
    // Fall back to localStorage only if settings hasn't populated it yet.
    const _savedHiddenIds = ctx.state.settings?.hidden_map_ids;
    if(Array.isArray(_savedHiddenIds)){
      ctx.state.maps._hiddenMapIds = new Set(_savedHiddenIds);
    } else if(!ctx.state.maps._hiddenMapIds){
      try{ ctx.state.maps._hiddenMapIds = new Set(JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]")); }
      catch(e){ ctx.state.maps._hiddenMapIds = new Set(); }
    }
    // Filter hidden maps
    const hiddenIds = ctx.state.maps._hiddenMapIds;
    const sorted = [...maps_list].filter(m=>!hiddenIds.has(m.id)).sort((a,b)=>(a.stack?.z_level||0)-(b.stack?.z_level||0));

    // Group maps by z_level
    const byLevel = new Map();
    for(const m of sorted){
      const z=m.stack?.z_level??0;
      if(!byLevel.has(z)) byLevel.set(z,[]);
      byLevel.get(z).push(m);
    }
    const sortedIsoLevels = [...byLevel.keys()].sort((a,b)=>a-b);
    const levelColor = (z) => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];

    // ── Slider positions: all → l0 → l0+l1 → l1 → l1+l2 → l2 → … ───────────
    // Each position is null (all), a single z-level, or [z0, z1] (adjacent pair).
    const _isoPos = [null];
    for(let _fi=0; _fi<sortedIsoLevels.length; _fi++){
      _isoPos.push(sortedIsoLevels[_fi]);
      if(_fi < sortedIsoLevels.length-1)
        _isoPos.push([sortedIsoLevels[_fi], sortedIsoLevels[_fi+1]]);
    }
    const _getFocusZ   = (idx) => _isoPos[Math.max(0,Math.min(idx,_isoPos.length-1))];
    const _getFocusLbl = (idx) => {
      const pos = _getFocusZ(idx);
      if(pos === null) return "All floors";
      const fl = ctx.state.model?.floors || [];
      const zArr = Array.isArray(pos) ? pos : [pos];
      return zArr.map(z=>{ const f=fl.find(x=>x.level===z); return f?(f.name||`L${z}`):`L${z}`; }).join(" + ");
    };

    // Build room centroid + receiver iso positions for live data overlay
    // _rebuildPositions() is called initially and whenever iso params change (slider)
    // Uses mapTransforms for correct rotation/ref_ar/scale_x_adj alignment.
    const roomIsoPos = {}, receiverIsoByRoom = {};
    function _rebuildPositions(){
      for(const k of Object.keys(roomIsoPos)) delete roomIsoPos[k];
      for(const k of Object.keys(receiverIsoByRoom)) delete receiverIsoByRoom[k];
      for(const m of sorted){
        const tf = mapTransforms[m.id]; if(!tf) continue;
        const z = tf.z;
        for(const [room,b] of Object.entries(m.room_bounds||{})){
          if(!b||b.type!=="poly"||!Array.isArray(b.points)||b.points.length<3) continue;
          const cx=b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
          const cy=b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
          const [wx,wy]=tf.mapPt(cx,cy);
          roomIsoPos[room] = iso(wx, wy, z);
        }
        for(const r of (m.receivers||[])){
          if(r.room && !receiverIsoByRoom[r.room]){
            const [wx,wy]=tf.mapPt(r.x||0, r.y||0);
            receiverIsoByRoom[r.room] = iso(wx, wy, z);
          }
        }
      }
    }

    if(ctx.state._overviewIsoFocusIdx === undefined)
      ctx.state._overviewIsoFocusIdx = Math.max(0, Math.min(ctx.state.settings?.overview_iso_focus ?? 0, _isoPos.length-1));
    const hasBounds = sorted.some(m=>Object.keys(m.room_bounds||{}).length>0);

    // ── Fingerprint positioning ─────────────────────────────────────────────
    // Load calibration data the first time (non-blocking; re-renders when ready)
    if(!ctx.state.calibration){
      ctx.actions.calibrationGet().then(d=>{
        ctx.state.calibration = d;
        ctx.actions.renderRooms();
      }).catch(()=>{});
    }
    const calPoints = (ctx.state.calibration?.points) || [];

    // ── Lazy-load radio_map module for 3D heatmap overlay ──────────────────
    const _isoRadioMapOn = !!(ctx.state.settings && ctx.state.settings.radio_map_enabled);
    let _isoRadioMapMod = ctx.state._2dRadioMapMod || null; // reuse same cache
    if (_isoRadioMapOn && !_isoRadioMapMod) {
      import("./radio_map.js?b=" + (ctx.state.buildId || "")).then(mod => {
        ctx.state._2dRadioMapMod = mod;
        ctx.actions.renderRooms();
      }).catch(e => console.warn("PadSpan: radio_map module load failed", e));
    }

    // Per-map coord transform: image-fraction (0-1) → ISO screen pixel
    // Uses the same mapPt formula as the room-polygon renderer so positions align exactly.
    // Built from ALL maps (not just visible) so objects on hidden maps can still be positioned.
    const _OUTSIDE_FID = "__outside__";
    const _isOutMap = m => (m.floor_id || "") === _OUTSIDE_FID;

    // Compute indoor bounding box (union of all non-outside maps) for fitting outside layers
    let _indoorBB = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(const m of maps_list){
      if(_isOutMap(m)) continue;
      const stk=m.stack||{}, ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
      const ar=(m.image?.height||600)/(m.image?.width||800);
      const arRef=stk.ref_ar||ar, sxAdj=stk.scale_x_adj||1.0;
      const rot=(stk.rotation||0)*Math.PI/180;
      const bbPt=(stk._m&&stk._m.length===4)?(px,py)=>{const u=px-0.5,v=py-0.5;return[stk._m[0]*u+stk._m[1]*v+0.5+ox,arRef*(stk._m[2]*u+stk._m[3]*v+0.5+oy_)];}:(px,py)=>{const dx=(px-0.5)*sc*sxAdj,dy=(py-0.5)*sc*arRef,rx=dx*Math.cos(rot)-dy*Math.sin(rot),ry=dx*Math.sin(rot)+dy*Math.cos(rot);return[(0.5+ox)+rx,arRef*(0.5+oy_)+ry];};
      for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){const[wx,wy]=bbPt(cx,cy);_indoorBB.minX=Math.min(_indoorBB.minX,wx);_indoorBB.minY=Math.min(_indoorBB.minY,wy);_indoorBB.maxX=Math.max(_indoorBB.maxX,wx);_indoorBB.maxY=Math.max(_indoorBB.maxY,wy);}
    }
    if(!isFinite(_indoorBB.minX)){_indoorBB={minX:0,minY:0,maxX:1,maxY:0.75};}

    const mapTransforms = {};
    for(const m of maps_list){
      const stk=m.stack||{}, z=stk.z_level||0;
      if(_isOutMap(m)){
        // Outside maps: fit 0-1 coords into the indoor bounding box
        mapTransforms[m.id]={z, mapPt:(px,py)=>{
          return[_indoorBB.minX+px*(_indoorBB.maxX-_indoorBB.minX), _indoorBB.minY+py*(_indoorBB.maxY-_indoorBB.minY)];
        }};
      } else {
        const ox=stk.x_offset||0, oy_=stk.y_offset||0, sc=stk.scale||1.0;
        const ar=(m.image?.height||600)/(m.image?.width||800);
        const arRefT=stk.ref_ar||ar, sxAdjT=stk.scale_x_adj||1.0;
        const rotRad=(stk.rotation||0)*Math.PI/180;
        const _mPt = (stk._m && stk._m.length === 4)
          ? (px,py)=>{ const u=px-0.5,v=py-0.5; return[stk._m[0]*u+stk._m[1]*v+0.5+ox, arRefT*(stk._m[2]*u+stk._m[3]*v+0.5+oy_)]; }
          : (px,py)=>{
              const dx=(px-0.5)*sc*sxAdjT, dy=(py-0.5)*sc*arRefT;
              const rx=dx*Math.cos(rotRad)-dy*Math.sin(rotRad);
              const ry=dx*Math.sin(rotRad)+dy*Math.cos(rotRad);
              return[(0.5+ox)+rx, arRefT*(0.5+oy_)+ry];
            };
        mapTransforms[m.id]={z, mapPt: _mPt};
      }
    }
    _rebuildPositions();

    // ── Scanner position map for RSSI trilateration ──────────────────────────
    // Maps scanner source → ISO screen coordinates so we can estimate object
    // positions from live RSSI without requiring calibration data.
    const _scannerIsoPos = {};
    for(const m of maps_list){
      const tf = mapTransforms[m.id]; if(!tf) continue;
      for(const r of (m.receivers||[])){
        // Match stored receiver to live radio — primary key is source
        const rSrc = r.source || "";
        const liveRadio = rSrc ? allRadios_live.find(rd=>rd.source===rSrc) : allRadios_live.find(rd=>rd.name===(r.label||""));
        const src = (liveRadio ? liveRadio.source : null) || rSrc || r.id || "";
        if(!src) continue;
        const [wx,wy] = tf.mapPt(r.x||0, r.y||0);
        const [sx,sy] = iso(wx, wy, tf.z);
        _scannerIsoPos[src] = {sx, sy, z: tf.z};
      }
    }

    // Trilateration: weighted centroid of scanner positions based on RSSI.
    // Returns {sx, sy, confidence} or null.  Works without calibration data.
    function _trilateratePos(obj){
      const readings = _getObjReadings(obj);
      const sources = Object.keys(readings);
      if(sources.length < 1) return null;
      let wx=0, wy=0, wTotal=0, matched=0;
      for(const src of sources){
        const pos = _scannerIsoPos[src];
        if(!pos) continue;
        const rssi = readings[src].rssi;
        const age = readings[src].age_s || 0;
        if(age > 60) continue;
        // Weight: exponential on RSSI (stronger signal = heavier weight).
        // Shift by +100 so typical range (-40 to -95) maps to positive exponents.
        const w = Math.pow(10, (rssi + 100) / 20) * Math.exp(-age / 45);
        wx += pos.sx * w;
        wy += pos.sy * w;
        wTotal += w;
        matched++;
      }
      if(matched < 2 || wTotal < 1e-10) return null;
      // Confidence scales with number of matched scanners (≥3 = full)
      const confidence = Math.min(1.0, matched / 3) * 0.35;
      return {sx: wx / wTotal, sy: wy / wTotal, confidence};
    }

    // Collect per-source RSSI for an object from the live advertisement stream.
    // obj.sources in the snapshot is a string array; the actual RSSI values are in
    // snap.ble.advertisements (one row per {address, source}).
    function _getObjReadings(obj){
      const addr = obj.address||"";
      if(!addr) return {};
      // For iBeacon objects, match by all rotating MAC addresses (not the
      // stable ibeacon:uuid:major:minor key which never appears in raw ads).
      const matchAddrs = new Set();
      matchAddrs.add(addr);
      if(Array.isArray(obj.all_addresses)){
        for(const a of obj.all_addresses) matchAddrs.add(String(a));
      }
      const readings={};
      for(const ad of (liveSnap?.ble?.advertisements||[])){
        if(!matchAddrs.has(ad.address) || !ad.source || ad.rssi==null) continue;
        if(!readings[ad.source] || (ad.age_s||0) < readings[ad.source].age_s)
          readings[ad.source]={rssi:ad.rssi, age_s:ad.age_s||0};
      }
      return readings;
    }

    // k-NN fingerprint match across all calibration points visible on current maps.
    // Returns {sx, sy, z, dist, confidence} (ISO screen coords) or null.
    // Age-decay: readings >45 s old contribute less weight.
    // Missing-source penalty: 28 dBm per calibration source absent from current scan.
    function _matchFingerprint(readings){
      if(!calPoints.length) return null;
      const obsSrcs = Object.keys(readings);
      if(!obsSrcs.length) return null;
      const scored=[];
      for(const p of calPoints){
        if(!mapTransforms[p.map_id]) continue;
        const cal=p.scanner_readings||{};
        let sumSq=0, count=0;
        for(const src of obsSrcs){
          if(cal[src]?.rssi!=null){
            const ageW = Math.exp(-(readings[src].age_s||0)/45);
            const diff  = readings[src].rssi - cal[src].rssi;
            sumSq += diff*diff * Math.max(ageW, 0.1);
            count++;
          }
        }
        if(count<1) continue;
        const missing = Object.keys(cal).length - count;
        const dist = Math.sqrt(sumSq/count) + missing*28;
        scored.push({p, dist});
      }
      if(!scored.length) return null;
      scored.sort((a,b)=>a.dist-b.dist);
      const k=Math.min(5, scored.length);
      // Find dominant map (highest total weight among top-k)
      const mapW={};
      for(let i=0;i<k;i++){
        const {p,dist}=scored[i]; const w=1/Math.max(dist*dist,0.01);
        mapW[p.map_id]=(mapW[p.map_id]||0)+w;
      }
      let bestMap=scored[0].p.map_id, bestW=0;
      for(const [mid,w] of Object.entries(mapW)){if(w>bestW){bestW=w;bestMap=mid;}}
      // Weighted centroid using only points on the dominant map
      let wx=0, wy=0, wTotal=0;
      for(let i=0;i<k;i++){
        const {p,dist}=scored[i];
        if(p.map_id!==bestMap) continue;
        const w=1/Math.max(dist*dist,0.01);
        wx+=p.x_frac*w; wy+=p.y_frac*w; wTotal+=w;
      }
      if(!wTotal) return null;
      const tf=mapTransforms[bestMap];
      const [lwx,lwy]=tf.mapPt(wx/wTotal, wy/wTotal);
      const [sx,sy]=iso(lwx, lwy, tf.z);
      return{sx, sy, z:tf.z, dist:scored[0].dist, confidence:Math.max(0,1-scored[0].dist/50)};
    }
    const LEGEND_H = 30;  // single-row compact legend

    if(ctx.state._overviewPersistentPins === undefined) ctx.state._overviewPersistentPins = !!(ctx.state.settings && ctx.state.settings.overview_persistent_pins);
    if(ctx.state._overviewShowWalls === undefined) ctx.state._overviewShowWalls = !!(ctx.state.settings && ctx.state.settings.overview_show_walls);
    if(ctx.state._overviewShowHeatmap === undefined) ctx.state._overviewShowHeatmap = false;
    if(ctx.state._overviewShowDistortion === undefined) ctx.state._overviewShowDistortion = false;

    const buildIsoSVG = (focusZ)=>{
      const slabWZ = 18/_ovFG;
      // Dynamic viewBox: expand upward so high floors aren't clipped when spacing is large
      const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length-1] : 0;
      const viewY   = Math.min(0, CY - maxIsoZ*_ovFG - 50);   // 50 px top padding
      const HTOTAL  = BASE_H + LEGEND_H - viewY;
      let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
      s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

      // Floor surface patterns — defined once per level, referenced by fill="url(#...)"
      s += `<defs>`;
      sortedIsoLevels.forEach((z2, li) => {
        const c2 = levelColor(z2);
        if(li === 0){
          // Ground floor: subtle paisley (teardrop + curl + inner dot)
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
          s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
          s += `<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
          s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
          s += `</pattern>`;
        } else if(li === 2){
          // Level 2: crosshatch (two diagonal sets of lines)
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
          s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
          s += `<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
          s += `</pattern>`;
        } else if(li >= 3){
          // Level 3+: hex dot grid
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
          s += `<circle cx="0"  cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="8"  cy="6.93"  r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="16" cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="0"  cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `</pattern>`;
        }
        // li === 1: no pattern (clean slab)
      });
      s += `</defs>`;

      if(!sorted.length){
        s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden</text>`;
        s += `</svg>`; return s;
      }

      // Emit 3D hatch pattern defs once (before any level renders cells)
      if (_isoRadioMapOn && _isoRadioMapMod && _isoRadioMapMod.isoHatchDefs && ctx.state._overviewShowHeatmap) {
        s += _isoRadioMapMod.isoHatchDefs();
      }

      for(const [z,group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
        const isFocused = focusZ===null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ===z);
        const go = isFocused ? 1.0 : 0.1;
        const lyrColor = levelColor(z);
        const lidx = sortedIsoLevels.indexOf(z);

        // Bounding box from indoor maps only; outside maps render as overlay inside
        let x0=Infinity,y0_=Infinity,x1=-Infinity,y1_=-Infinity;
        for(const m of group){
          if(_isOutMap(m)) continue;
          const stk=m.stack||{}, ox=stk.x_offset||0, oy__=stk.y_offset||0, sc=stk.scale||1.0;
          const ar=(m.image?.height||600)/(m.image?.width||800);
          const arRefBB=stk.ref_ar||ar, sxAdjBB=stk.scale_x_adj||1.0;
          const rot=(stk.rotation||0)*Math.PI/180;
          const bbPt=(stk._m&&stk._m.length===4)?(px,py)=>{const u=px-0.5,v=py-0.5;return[stk._m[0]*u+stk._m[1]*v+0.5+ox,arRefBB*(stk._m[2]*u+stk._m[3]*v+0.5+oy__)];}:(px,py)=>{const dx=(px-0.5)*sc*sxAdjBB,dy=(py-0.5)*sc*arRefBB,rx=dx*Math.cos(rot)-dy*Math.sin(rot),ry=dx*Math.sin(rot)+dy*Math.cos(rot);return[(0.5+ox)+rx,arRefBB*(0.5+oy__)+ry];};
          for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){const[wx,wy]=bbPt(cx,cy);x0=Math.min(x0,wx);y0_=Math.min(y0_,wy);x1=Math.max(x1,wx);y1_=Math.max(y1_,wy);}
        }
        // Level with only outside maps: use global indoor BB
        if(!isFinite(x0)){x0=_indoorBB.minX;y0_=_indoorBB.minY;x1=_indoorBB.maxX;y1_=_indoorBB.maxY;}
        if(!isFinite(x0)){x0=0;y0_=0;x1=1;y1_=0.75;}

        const TL=iso(x0,y0_,z), TR=iso(x1,y0_,z), BR=iso(x1,y1_,z), BL=iso(x0,y1_,z);
        const TR_b=iso(x1,y0_,z-slabWZ), BR_b=iso(x1,y1_,z-slabWZ), BL_b=iso(x0,y1_,z-slabWZ);

        s += `<g opacity="${go}">`;
        s += `<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
        s += `<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
        s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
        if(lidx !== 1){ s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`; }

        // ── Radio Map heatmap layer (3D isometric, behind room polygons) ──
        // Unified world-space heatmap per z-level — merges all maps, no stacking
        if (_isoRadioMapOn && _isoRadioMapMod && calPoints.length && ctx.state._overviewShowHeatmap) {
          if (_isoRadioMapMod.isoLevelHeatmapSVG) {
            s += _isoRadioMapMod.isoLevelHeatmapSVG(calPoints, group, mapTransforms, iso, z);
          }
        }

        // Room polygons
        for(const m of group){
          const tf = mapTransforms[m.id]; if(!tf) continue;
          const mapPt = tf.mapPt;
          for(const [room,b] of Object.entries(m.room_bounds||{})){
            if(!b||b.type!=="poly"||!Array.isArray(b.points)||b.points.length<3) continue;
            const color = roomColorFn(room);
            const pp = b.points.map(p=>{const[wx,wy]=mapPt(p[0],p[1]);return pt(iso(wx,wy,z));}).join(" ");
            const _objsHere = allObjects.filter(o=>o.room===room);
            const _roomTip = `${room}\n${_objsHere.length} object${_objsHere.length!==1?"s":""} detected`;
            s += `<g data-tip="${_esc(_roomTip)}"><polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/></g>`;
            const cx=b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
            const cy=b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
            const [lwx,lwy]=mapPt(cx,cy);
            const [lix,liy]=iso(lwx,lwy,z);
            s += `<text x="${Math.round(lix)}" y="${Math.round(liy)+lidx*2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="7">${_esc(room)}</text>`;
          }
          // RF barriers — dotted white lines on 3D map
          if(ctx.state._overviewShowWalls){
            const _bars = m.rf_barriers || [];
            for(let bi=0;bi<_bars.length;bi++){
              const bar = _bars[bi];
              const bpts = bar.points || bar.pts || [];
              if(bpts.length<2) continue;
              const bp = bpts.map(p=>{const[wx,wy]=mapPt(Number(p[0]),Number(p[1]));return pt(iso(wx,wy,z));}).join(" ");
              s += `<polyline points="${bp}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2.5" stroke-dasharray="4 8" stroke-linecap="round"/>`;
            }
          }
          // Placed receivers (with scanner tooltip + name label)
          // Show ALL stored receivers — match calibration Tune tab behavior.
          // Non-live receivers render dimmed instead of hidden.
          for(const r of (m.receivers||[])){
            const liveRadio = allRadios_live.find(rd=>rd.name===(r.label||"")||rd.source===(r.id||"")||rd.source===(r.source||"")||rd.name===(r.id||""));
            const isLive = !!liveRadio;
            const[wx,wy]=mapPt(r.x||0,r.y||0);
            const [px,py]=iso(wx,wy,z);
            const rxName = ((isLive ? liveRadio.name : null) || r.label || r.id || "receiver").substring(0, 16);
            const rsid = _sid((isLive ? liveRadio.source : null) || r.source || r.id || r.label || "");
            const _rTip = `${rsid} · ${(isLive ? liveRadio.name : null)||r.label||r.id||"receiver"}${r.room ? "\nArea: "+r.room : ""}${isLive && liveRadio.scanning!=null ? "\nScanning: "+(liveRadio.scanning?"Yes":"No") : ""}${!isLive ? "\n(offline)" : ""}`;
            const rxColor = isLive ? "#52b788" : "#4a6052";
            const rxOp = isLive ? 1.0 : 0.45;
            s += `<g data-tip="${_esc(_rTip)}" opacity="${rxOp}">`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="13" fill="none" stroke="${rxColor}" stroke-width="1.2" opacity="0.3"/>`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="7"  fill="none" stroke="${rxColor}" stroke-width="1.5" opacity="0.6"/>`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="4"  fill="${rxColor}" opacity="0.9"/>`;
            s += `<text x="${Math.round(px)}" y="${Math.round(py)-16}" text-anchor="middle" fill="${rxColor}" font-size="9" font-weight="600">${_esc(rxName)}</text>`;
            s += `</g>`;
          }
        }

        // Layer index dot at bottom-left corner (BL = front-left of top face)
        s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
        s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
        s += `</g>`;
      }

      // ── Helper: build tooltip string for any object ────────────────────────
      const _objTip = (o) => {
        const parts = [];
        const n = o.user_label || o.name || o.address || o.entity_id || "Unknown";
        parts.push(n);
        if(o.kind) parts.push(`Kind: ${o.kind}`);
        if(o.address && o.address !== n) parts.push(`Addr: ${o.address}`);
        if(o.room) parts.push(`Room: ${o.room}`);
        if(o.knn_confidence > 0) parts.push(`Calibrated: ${Math.round(o.knn_confidence * 100)}%`);
        if(o.rssi != null) parts.push(`RSSI: ${o.rssi} dBm`);
        if(o.age_s != null){
          const a = Number(o.age_s);
          parts.push(`Seen: ${a<60 ? Math.round(a)+"s ago" : Math.floor(a/60)+"m ago"}`);
        }
        if(o.sources && o.sources.length) parts.push(`Scanners: ${o.sources.map(s => typeof s === "object" ? (s.source || "") : String(s)).join(", ")}`);
        if(!o.user_label) parts.push("Click to tag / view details");
        return parts.join("|");  // pipe-delimited for data attribute, rendered as lines
      };

      // Track which object keys are rendered (to avoid duplicate dots for unlabeled layer)
      const _renderedObjKeys = new Set();

      // Followed beacons — positioned using server k-NN first (same as calibration
      // beacon tune), with client-side fingerprint as high-confidence enhancement only.
      const followedObjects = allObjects.filter(o =>
        ctx.actions.followedHas(o.address || "") || ctx.actions.followedHas(o.entity_id || "") || ctx.actions.followedHas(o.key || "")
      );
      const BEACON_CLR = "#fbbf24";
      const _awayTimeoutS2 = ((ctx.state.settings && ctx.state.settings.away_timeout_m != null) ? Number(ctx.state.settings.away_timeout_m) : 5) * 60;
      for(const o of followedObjects){
        _renderedObjKeys.add(o.key || o.address || o.entity_id || "");
        const isGhost = o._ghost || o._stale;
        const ageS = typeof o.age_s === "number" ? o.age_s : 0;
        const isAway = isGhost && (o.rssi == null) && (ageS > _awayTimeoutS2);
        const lbl = (o.user_label||o.name||"?").substring(0,14);
        let bx, by;
        let posConf = 0;  // confidence for dashed circle

        // Priority 1: Server k-NN position (x_frac/y_frac) — same source calibration uses
        if(typeof o.x_frac === "number" && typeof o.y_frac === "number" && o.knn_map_id && mapTransforms[o.knn_map_id]){
          const tf=mapTransforms[o.knn_map_id];
          const [lwx,lwy]=tf.mapPt(o.x_frac, o.y_frac);
          [bx,by]=iso(lwx, lwy, tf.z);
          posConf = o.knn_confidence || 0;
        }
        // Priority 2: Client-side fingerprint — only if no server k-NN AND confidence > 40%
        if(bx == null){
          const readings = _getObjReadings(o);
          const match = _matchFingerprint(readings);
          if(match && match.confidence > 0.4){
            bx=match.sx; by=match.sy;
            posConf = match.confidence;
          }
        }
        // Priority 2.5: Scanner trilateration — RSSI-weighted centroid of known scanner positions
        if(bx == null){
          const tri = _trilateratePos(o);
          if(tri){ bx=tri.sx; by=tri.sy; posConf=tri.confidence; }
        }
        // Priority 3: Room centroid
        if(bx == null && o.room && roomIsoPos[o.room]){
          [bx,by] = roomIsoPos[o.room];
        }
        // Never skip followed objects — show at map center as last resort
        if(bx == null){
          bx = CX; by = CY;
        }

        // Confidence circle (only when we have a real positioned match)
        if(posConf > 0){
          const cr = Math.round(10 + (1-posConf)*24);
          const op = (0.3 + posConf*0.55).toFixed(2);
          s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="${cr}" fill="none" stroke="${BEACON_CLR}" stroke-width="1.5" stroke-dasharray="5,3" opacity="${op}"/>`;
        }

        // Confidence badge — always visible, color-coded by quality
        const hasKnn = typeof o.x_frac === "number" && typeof o.y_frac === "number";
        const confPct = hasKnn ? Math.round((o.knn_confidence || 0) * 100) : 0;
        // Color: green > 60%, amber 30-60%, red < 30%, gray = no data
        const confColor = !hasKnn ? "#64748b" : confPct >= 60 ? "#52b788" : confPct >= 30 ? "#f59e0b" : "#f87171";
        const confLabel = !hasKnn ? "Room only" : confPct + "%";

        const _ok = _esc(o.key||o.address||o.entity_id||"");
        // Dim away/ghost objects
        const dotOp = isAway ? "0.35" : "0.97";
        const glowOp = isAway ? "0.08" : "0.18";
        const lblColor = isAway ? "#a0845c" : BEACON_CLR;
        s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(o))}" style="cursor:pointer">`;
        // Confidence badge below the dot (skip for away)
        if(!isAway){
          const cW = Math.min(confLabel.length * 6 + 8, 60);
          s += `<rect x="${Math.round(bx)-cW/2}" y="${Math.round(by)+18}" width="${cW}" height="12" rx="3" fill="#071008" opacity="0.8"/>`;
          s += `<text x="${Math.round(bx)}" y="${Math.round(by)+27}" text-anchor="middle" fill="${confColor}" font-size="8" font-weight="600">${_esc(confLabel)}</text>`;
          // Red warning ring only when truly bad (< 30% or no data)
          if(confPct < 30){
            s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="18" fill="none" stroke="${confColor}" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.5"/>`;
          }
        }
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="14" fill="${BEACON_CLR}" opacity="${glowOp}"/>`;
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="10" fill="${BEACON_CLR}" stroke="#071008" stroke-width="1.5" opacity="${dotOp}"/>`;
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="3" fill="#071008" opacity="0.7"/>`;
        const awayTag = isAway ? " (Away)" : "";
        const fullLbl = lbl + awayTag;
        const lblW = Math.min(fullLbl.length * 7 + 10, 130);
        s += `<rect x="${Math.round(bx)-lblW/2}" y="${Math.round(by)-30}" width="${lblW}" height="14" rx="3" fill="#071008" opacity="0.7"/>`;
        s += `<text x="${Math.round(bx)}" y="${Math.round(by)-19}" text-anchor="middle" fill="${lblColor}" font-size="11" font-weight="700">${_esc(fullLbl)}</text>`;
        s += `</g>`;
      }

      // Persistent pins + unlabeled objects with known room positions.
      // When persistent ON: show followed items at their last known room (away = red crosshair, active = teal dot).
      // When persistent OFF: only unlabeled objects shown as dim amber dots.
      {
        const _isFollowed = (o) => ctx.actions.followedHas(o.address || "") || ctx.actions.followedHas(o.entity_id || "") || ctx.actions.followedHas(o.key || "");
        const _mapAwayM = ((ctx.state.settings && ctx.state.settings.away_timeout_m != null) ? Number(ctx.state.settings.away_timeout_m) : 5) * 60;
        // For dots on the map: show active objects (within away timeout) + followed items when persistent is on
        // Skip very stale objects (>1hr unless followed) to prevent "army of dots" from 7-day history
        const _mapMaxAge = Math.max(_mapAwayM * 2, 3600); // show up to 2x away timeout or 1hr, whichever is larger
        const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
        const _mapObjs = allObjects.filter(o => {
          if (_renderedObjKeys.has(o.key || o.address || o.entity_id || "")) return false;
          const isFol = _isFollowed(o);
          const hasKnn = typeof o.x_frac === "number" && typeof o.y_frac === "number" && o.knn_map_id && mapTransforms[o.knn_map_id];
          const hasRoom = o.room && o.room !== "unknown" && o.room !== "not_home" && roomIsoPos[o.room];
          // Must have k-NN or a room to be positionable
          if (!hasKnn && !hasRoom) return false;
          // Quiet mode: only show followed or labeled/identified objects
          if (_quietMode && !isFol && !o.user_label && !o.identified) return false;
          // Persistent pins mode: only show followed items
          if (ctx.state._overviewPersistentPins && !isFol) return false;
          // Non-persistent, non-followed: only show labeled/identified objects.
          // Unlabeled random BLE devices are too numerous and cluster at scanner positions.
          if (!ctx.state._overviewPersistentPins && !isFol) {
            if (!o.user_label && !o.identified) return false;
            const age = typeof o.age_s === "number" ? o.age_s : 0;
            if (age > _mapMaxAge) return false;
          }
          return true;
        });
        const _roomObjCount = {};
        for(const obj of _mapObjs){
          const oKey = obj.key || obj.address || obj.entity_id || "";
          _renderedObjKeys.add(oKey);
          const _ok = _esc(oKey);
          const _awayThresh = ((ctx.state.settings && ctx.state.settings.away_timeout_m != null)
            ? Number(ctx.state.settings.away_timeout_m) : 5) * 60;
          const isAway = typeof obj.age_s === "number" && obj.age_s > _awayThresh;
          const objLabel = obj.user_label || obj.name || "";

          // Position: server k-NN first, then high-confidence fingerprint, then room centroid + stagger
          let px, py;
          if(typeof obj.x_frac === "number" && typeof obj.y_frac === "number" && obj.knn_map_id && mapTransforms[obj.knn_map_id]){
            const tf=mapTransforms[obj.knn_map_id];
            const [lwx,lwy]=tf.mapPt(obj.x_frac, obj.y_frac);
            [px,py]=[Math.round(iso(lwx,lwy,tf.z)[0]), Math.round(iso(lwx,lwy,tf.z)[1])];
          } else {
            const readings = _getObjReadings(obj);
            const fpMatch = _matchFingerprint(readings);
            if (fpMatch && fpMatch.confidence > 0.4) {
              px = Math.round(fpMatch.sx);
              py = Math.round(fpMatch.sy);
            } else {
              // Scanner trilateration — RSSI-weighted centroid (no calibration needed)
              const tri = _trilateratePos(obj);
              if(tri){
                px = Math.round(tri.sx);
                py = Math.round(tri.sy);
              } else if (obj.room && roomIsoPos[obj.room]) {
                const pos = roomIsoPos[obj.room];
                const idx = (_roomObjCount[obj.room] || 0);
                _roomObjCount[obj.room] = idx + 1;
                const angle = idx * 2.4;
                const radius = 8 + idx * 6;
                px = Math.round(pos[0] + Math.cos(angle) * Math.min(radius, 40));
                py = Math.round(pos[1] + Math.sin(angle) * Math.min(radius, 25));
              }
            }
          }
          // Skip if no position could be determined
          if(px == null || py == null) continue;

          if(ctx.state._overviewPersistentPins){
            if(isAway){
              // Red crosshair for away objects (persistent mode)
              s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(obj))}" style="cursor:pointer" opacity="0.92">`;
              s += `<circle cx="${px}" cy="${py}" r="20" fill="none" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<circle cx="${px}" cy="${py}" r="11" fill="none" stroke="#ef4444" stroke-width="2"/>`;
              s += `<circle cx="${px}" cy="${py}" r="4" fill="#ef4444"/>`;
              s += `<line x1="${px-25}" y1="${py}" x2="${px-13}" y2="${py}" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<line x1="${px+13}" y1="${py}" x2="${px+25}" y2="${py}" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<line x1="${px}" y1="${py-25}" x2="${px}" y2="${py-13}" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<line x1="${px}" y1="${py+13}" x2="${px}" y2="${py+25}" stroke="#ef4444" stroke-width="1.5"/>`;
              if(objLabel) s += `<text x="${px}" y="${py+36}" text-anchor="middle" fill="#fca5a5" font-size="9" font-weight="600">${_esc(objLabel)}</text>`;
              s += `</g>`;
            } else {
              // Teal dot for active objects (persistent mode)
              s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(obj))}" style="cursor:pointer" opacity="0.88">`;
              s += `<circle cx="${px}" cy="${py}" r="12" fill="#5eead4" opacity="0.15"/>`;
              s += `<circle cx="${px}" cy="${py}" r="8" fill="#5eead4" stroke="#071008" stroke-width="1.5" opacity="0.95"/>`;
              s += `<circle cx="${px}" cy="${py}" r="2.5" fill="#071008" opacity="0.7"/>`;
              if(objLabel) s += `<text x="${px}" y="${py+22}" text-anchor="middle" fill="#5eead4" font-size="9" font-weight="600">${_esc(objLabel)}</text>`;
              s += `</g>`;
            }
          } else if(!obj.user_label){
            // Small dim amber dot for unlabeled objects
            s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(obj))}" style="cursor:pointer" opacity="0.6">`;
            s += `<circle cx="${px}" cy="${py}" r="5" fill="#f59e0b" stroke="#071008" stroke-width="1" opacity="0.7"/>`;
            s += `</g>`;
          }
        }
      }

      // Only placed receivers (pinned to maps) are shown in the 3D view.
      // Live BLE radios without map placement are omitted — they have no
      // precise coordinates and would just clutter the spatial view.

      if(!hasBounds && sorted.length){
        s += `<text x="${W/2}" y="${BASE_H-20}" text-anchor="middle" fill="#4a6052" font-size="16">Go to Maps → Edit to draw room boundaries</text>`;
      }

      // Legend at bottom — compact single row
      s += `<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
      {
        const ly = BASE_H + 10;
        let lx = 12;
        sortedIsoLevels.forEach((z, i)=>{
          const color = levelColor(z);
          const groupLabel = byLevel.get(z).map(m=>m.name||m.id).join("+");
          s += `<circle cx="${lx+7}" cy="${ly+7}" r="7" fill="${color}" opacity="0.9"/>`;
          s += `<text x="${lx+7}" y="${ly+10}" text-anchor="middle" fill="#071008" font-size="9" font-weight="700">${i+1}</text>`;
          s += `<text x="${lx+18}" y="${ly+10}" fill="${color}" font-size="11" font-weight="500">${_esc(groupLabel)}</text>`;
          lx += 22 + groupLabel.length * 6;
          if (i < sortedIsoLevels.length - 1) {
            s += `<text x="${lx}" y="${ly+10}" fill="#4a6052" font-size="10">\u00B7</text>`;
            lx += 10;
          }
        });
      }

      s += `</svg>`;
      return s;
    };

    // Wrapper with floor focus slider + room list toggle
    const outer = document.createElement("div");
    outer.style.cssText = "margin-bottom:16px";

    const focusLbl = document.createElement("span");
    focusLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:80px;display:inline-block";
    focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);

    const focusSlider = document.createElement("input");
    focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(_isoPos.length-1);
    focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    focusSlider.value = String(ctx.state._overviewIsoFocusIdx);

    const isoWrap = document.createElement("div");
    isoWrap.style.cssText = "position:relative;margin-top:6px";

    const isoDiv = document.createElement("div");
    isoDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px";
    isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));

    // Hover info overlay — upper-left corner of the map
    const isoTipEl = document.createElement("div");
    isoTipEl.style.cssText = "position:absolute;top:8px;left:8px;background:rgba(7,16,8,0.92);" +
      "border:1px solid #2d6a4f;border-radius:8px;padding:6px 10px;font-size:11px;color:#a7f3d0;" +
      "pointer-events:none;white-space:pre-line;max-width:min(260px,calc(100vw - 40px));z-index:5;display:none;" +
      "font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.5";
    isoWrap.appendChild(isoDiv);
    isoWrap.appendChild(isoTipEl);

    // Event delegation: hover → show info overlay, click → open detail modal
    isoDiv.addEventListener("mouseover", (e) => {
      const g = e.target.closest("[data-tip]");
      if(g){
        isoTipEl.textContent = "";
        const lines = g.getAttribute("data-tip").split("|");
        lines.forEach((line, i) => {
          if(i > 0) isoTipEl.appendChild(document.createElement("br"));
          isoTipEl.appendChild(document.createTextNode(line));
        });
        isoTipEl.style.display = "block";
      }
    });
    isoDiv.addEventListener("mouseout", (e) => {
      const g = e.target.closest("[data-tip]");
      if(!g || !isoDiv.contains(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tip]")))
        isoTipEl.style.display = "none";
    });
    isoDiv.addEventListener("click", (e) => {
      const g = e.target.closest("[data-obj-key]");
      if(!g) return;
      const objKey = g.getAttribute("data-obj-key");
      if(!objKey) return;
      const obj = allObjects.find(o =>
        (o.key||"") === objKey || (o.address||"") === objKey || (o.entity_id||"") === objKey);
      if(obj) ctx.actions.showObjectDetail(obj);
    });

    const haFloors2 = ctx.state.model?.floors || [];
    focusSlider.addEventListener("input", ()=>{
      ctx.state._overviewIsoFocusIdx = parseInt(focusSlider.value, 10);
      focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);
      isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
    });

    // Room list toggle
    if(ctx.state._overviewShowRoomList === undefined) ctx.state._overviewShowRoomList = false;
    const roomListPanel = document.createElement("div");
    roomListPanel.style.cssText = `margin-top:10px;display:${ctx.state._overviewShowRoomList?"block":"none"}`;

    // Build room list from all visible maps
    const ovRoomRows = [];
    for(const m of sorted){
      const floorId = m.stack?.floor_id || m.floor_id || "";
      const haFlr = haFloors2.find(f=>String(f.id)===String(floorId));
      const flLbl = haFlr ? (haFlr.name||haFlr.id) : (floorId||"—");
      for(const room of Object.keys(m.room_bounds||{})){
        if(!ovRoomRows.find(r=>r.room===room)){
          const objsInRoom = allObjects.filter(o=>o.room===room);
          ovRoomRows.push({ room, map: m.name||m.id, floor: flLbl, count: objsInRoom.length, objects: objsInRoom });
        }
      }
    }
    ovRoomRows.sort((a,b)=>a.room.localeCompare(b.room));

    if(ovRoomRows.length){
      const thStyle = "padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left";
      const tbl = el("table",{style:"width:100%;border-collapse:collapse;font-size:13px"},[
        el("thead",{},el("tr",{style:"border-bottom:1px solid #1b3526"},[
          el("th",{style:thStyle+";width:24px"}),
          el("th",{style:thStyle},"Room"),
          el("th",{style:thStyle},"Floor"),
          el("th",{style:thStyle},"Objects"),
        ])),
      ]);
      const tbody2 = document.createElement("tbody");
      const roomColorFn2 = ctx.helpers.roomColor;
      for(const rr of ovRoomRows){
        const color = roomColorFn2(rr.room);
        const hasFollowed = rr.objects.some(o=> ctx.actions.followedHas(o.address||"") || ctx.actions.followedHas(o.entity_id||""));
        // Build object summary chips
        const objChips = el("div",{style:"display:flex;flex-wrap:wrap;gap:3px;margin-top:2px"});
        for(const o of (rr.objects||[]).slice(0,6)){
          const oKey = o.address || o.entity_id || "";
          const isF = ctx.actions.followedHas(oKey);
          const lbl = (o.user_label || o.name || o.address || "?").substring(0,16);
          const oc = isF ? "#fbbf24" : (o.identified ? "#5eead488" : "#f59e0b88");
          const chip = el("span",{style:`font-size:10px;padding:1px 5px;border-radius:3px;background:${oc}22;color:${isF?"#fbbf24":"#94a3b8"};border:1px solid ${oc};white-space:nowrap${isF?";font-weight:700":""}`}, isF ? lbl + " \u25C9" : lbl);
          objChips.appendChild(chip);
        }
        if(rr.objects.length > 6) objChips.appendChild(el("span",{style:"font-size:10px;color:#64748b"}, `+${rr.objects.length-6}`));

        const roomCell = el("td",{style:"padding:5px 8px"},[
          el("span",{style:"font-weight:600;color:#e2e8f0"}, rr.room),
          hasFollowed ? el("span",{style:"margin-left:6px;font-size:9px;color:#fbbf24;font-weight:700"}, "\u25C9 tracked") : null,
        ].filter(Boolean));

        const tr2 = el("tr",{style:"border-bottom:1px solid #0f2017;cursor:pointer"},[
          el("td",{style:"padding:5px 8px"},el("span",{style:`display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};vertical-align:middle`})),
          roomCell,
          el("td",{style:"padding:5px 8px;color:#94a3b8"}, rr.floor),
          el("td",{style:"padding:5px 8px"}, [
            el("span",{style:"color:#94a3b8"}, rr.count ? String(rr.count) : ""),
            objChips,
          ]),
        ]);
        tr2.addEventListener("click",()=>ctx.actions.showRoomDetail(rr.room));
        tbody2.appendChild(tr2);
      }
      tbl.appendChild(tbody2);
      roomListPanel.appendChild(tbl);
    } else {
      const msg = document.createElement("div");
      msg.className = "muted"; msg.style.cssText = "font-size:12px;padding:8px";
      msg.textContent = "No rooms drawn yet. Go to Maps → Edit to draw room boundaries.";
      roomListPanel.appendChild(msg);
    }

    const roomToggleBtn = document.createElement("button");
    roomToggleBtn.className = "btn inline";
    roomToggleBtn.style.cssText = "margin-left:auto";
    roomToggleBtn.textContent = ctx.state._overviewShowRoomList ? "☰ Hide Room List" : "☰ Room List";
    roomToggleBtn.addEventListener("click", ()=>{
      ctx.state._overviewShowRoomList = !ctx.state._overviewShowRoomList;
      roomToggleBtn.textContent = ctx.state._overviewShowRoomList ? "☰ Hide Room List" : "☰ Room List";
      roomListPanel.style.display = ctx.state._overviewShowRoomList ? "block" : "none";
    });

    // Spacing slider
    const ovGapLbl = document.createElement("span");
    ovGapLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
    ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
    const ovGapSlider = document.createElement("input");
    ovGapSlider.type="range"; ovGapSlider.min="60"; ovGapSlider.max="340"; ovGapSlider.step="10";
    ovGapSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ovGapSlider.value = String(ctx.state._overviewFloorGap);
    ovGapSlider.addEventListener("input",()=>{
      ctx.state._overviewFloorGap = parseInt(ovGapSlider.value, 10);
      _ovFG = ctx.state._overviewFloorGap;
      ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
      _rebuildPositions();
      isoDiv.innerHTML = buildIsoSVG(ctx.state._overviewIsoFocus);
    });

    // L/R horizontal offset slider
    const ovHorizLbl = document.createElement("span");
    ovHorizLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
    ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
    const ovHorizSlider = document.createElement("input");
    ovHorizSlider.type="range"; ovHorizSlider.min="-120"; ovHorizSlider.max="120"; ovHorizSlider.step="10";
    ovHorizSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ovHorizSlider.value = String(ctx.state._overviewHorizGap);
    ovHorizSlider.addEventListener("input",()=>{
      ctx.state._overviewHorizGap = parseInt(ovHorizSlider.value, 10);
      _ovHG = ctx.state._overviewHorizGap;
      ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
      _rebuildPositions();
      isoDiv.innerHTML = buildIsoSVG(ctx.state._overviewIsoFocus);
    });

    const ctrlRow = document.createElement("div");
    ctrlRow.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
    const floorLbl = document.createElement("span");
    floorLbl.style.cssText = "font-size:12px;color:#94a3b8";
    floorLbl.textContent = "Floor:";
    ctrlRow.appendChild(floorLbl);
    ctrlRow.appendChild(focusSlider);
    ctrlRow.appendChild(focusLbl);
    // Spacing
    const ovSpacingLbl = document.createElement("span");
    ovSpacingLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
    ovSpacingLbl.textContent = "Spacing:";
    ctrlRow.appendChild(ovSpacingLbl);
    ctrlRow.appendChild(ovGapSlider);
    ctrlRow.appendChild(ovGapLbl);
    // L/R
    const ovLRLbl = document.createElement("span");
    ovLRLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
    ovLRLbl.textContent = "L/R:";
    ctrlRow.appendChild(ovLRLbl);
    ctrlRow.appendChild(ovHorizSlider);
    ctrlRow.appendChild(ovHorizLbl);
    // Save button — persists all three slider values to settings store
    const ovSaveLbl = document.createElement("span");
    ovSaveLbl.style.cssText = "font-size:11px;color:#94a3b8;min-width:50px";
    const ovSaveBtn = document.createElement("button");
    ovSaveBtn.className = "btn inline";
    ovSaveBtn.style.cssText = "padding:2px 10px;font-size:12px";
    ovSaveBtn.title = "Save these slider positions so the view reopens with the same layout";
    ovSaveBtn.textContent = "Save";
    ovSaveBtn.addEventListener("click", async ()=>{
      ovSaveBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({
          overview_iso_floor_gap: ctx.state._overviewFloorGap,
          overview_iso_horiz_gap: ctx.state._overviewHorizGap,
          overview_iso_focus:     ctx.state._overviewIsoFocusIdx,
        });
        ovSaveLbl.textContent = "Saved ✓";
        setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
      }catch(e){ ovSaveLbl.textContent = "Error"; }
      ovSaveBtn.disabled = false;
    });
    const ovResetBtn = document.createElement("button");
    ovResetBtn.className = "btn inline";
    ovResetBtn.style.cssText = "padding:2px 10px;font-size:12px";
    ovResetBtn.title = "Reset sliders to default values and clear the saved layout";
    ovResetBtn.textContent = "Reset";
    ovResetBtn.addEventListener("click", async ()=>{
      ctx.state._overviewFloorGap = 150; _ovFG = 150;
      ctx.state._overviewHorizGap = 0;   _ovHG = 0;
      ctx.state._overviewIsoFocusIdx = 0;
      ovGapSlider.value   = "150"; ovGapLbl.textContent   = "150";
      ovHorizSlider.value = "0";   ovHorizLbl.textContent = "0";
      focusSlider.value   = "0";   focusLbl.textContent   = "All floors";
      _rebuildPositions();
      isoDiv.innerHTML = buildIsoSVG(null);
      ovResetBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({ overview_iso_floor_gap:150, overview_iso_horiz_gap:0, overview_iso_focus:0 });
        ovSaveLbl.textContent = "Reset ✓";
        setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
      }catch(e){ ovSaveLbl.textContent = "Error"; }
      ovResetBtn.disabled = false;
    });
    ctrlRow.appendChild(ovSaveBtn);
    ctrlRow.appendChild(ovResetBtn);
    ctrlRow.appendChild(ovSaveLbl);
    ctrlRow.appendChild(roomToggleBtn);

    const ovPersistentBtn = document.createElement("button");
    ovPersistentBtn.className = "btn inline";
    ovPersistentBtn.style.cssText = ctx.state._overviewPersistentPins
      ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700"
      : "color:#94a3b8";
    ovPersistentBtn.textContent = ctx.state._overviewPersistentPins ? "⊕ Persistent ON" : "⊕ Persistent";
    ovPersistentBtn.addEventListener("click", ()=>{
      ctx.state._overviewPersistentPins = !ctx.state._overviewPersistentPins;
      ovPersistentBtn.style.cssText = ctx.state._overviewPersistentPins
        ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700"
        : "color:#94a3b8";
      ovPersistentBtn.textContent = ctx.state._overviewPersistentPins ? "⊕ Persistent ON" : "⊕ Persistent";
      isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      // Persist to settings so it survives reboots
      ctx.actions.settingsSet({ overview_persistent_pins: ctx.state._overviewPersistentPins });
    });
    ctrlRow.appendChild(ovPersistentBtn);

    const ovWallsBtn = document.createElement("button");
    ovWallsBtn.className = "btn inline";
    ovWallsBtn.style.cssText = ctx.state._overviewShowWalls
      ? "background:#1a1a2e;border-color:#6366f1;color:#a5b4fc;font-weight:700"
      : "color:#94a3b8";
    ovWallsBtn.textContent = ctx.state._overviewShowWalls ? "⊞ Walls ON" : "⊞ Walls";
    ovWallsBtn.addEventListener("click", ()=>{
      ctx.state._overviewShowWalls = !ctx.state._overviewShowWalls;
      ovWallsBtn.style.cssText = ctx.state._overviewShowWalls
        ? "background:#1a1a2e;border-color:#6366f1;color:#a5b4fc;font-weight:700"
        : "color:#94a3b8";
      ovWallsBtn.textContent = ctx.state._overviewShowWalls ? "⊞ Walls ON" : "⊞ Walls";
      isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      ctx.actions.settingsSet({ overview_show_walls: ctx.state._overviewShowWalls });
    });
    ctrlRow.appendChild(ovWallsBtn);

    // ── Radio Map toggle (only if feature enabled) ────────────────────────
    if (_isoRadioMapOn) {
      const ovHeatBtn = document.createElement("button");
      ovHeatBtn.className = "btn inline";
      const _heatStyle = (on) => on
        ? "background:#2d1b4e;border-color:#a855f7;color:#d8b4fe;font-weight:700"
        : "color:#94a3b8";
      ovHeatBtn.style.cssText = _heatStyle(ctx.state._overviewShowHeatmap);
      ovHeatBtn.textContent = ctx.state._overviewShowHeatmap ? "\u25A3 Heatmap ON" : "\u25A3 Heatmap";
      ovHeatBtn.addEventListener("click", () => {
        ctx.state._overviewShowHeatmap = !ctx.state._overviewShowHeatmap;
        ovHeatBtn.style.cssText = _heatStyle(ctx.state._overviewShowHeatmap);
        ovHeatBtn.textContent = ctx.state._overviewShowHeatmap ? "\u25A3 Heatmap ON" : "\u25A3 Heatmap";
        isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      });
      ctrlRow.appendChild(ovHeatBtn);
    }

    // ── Distortion Map toggle (only if feature enabled) ───────────────────
    const _isoDistortionOn = !!(ctx.state.settings && ctx.state.settings.distortion_map_enabled);
    if (_isoDistortionOn) {
      const ovDistBtn = document.createElement("button");
      ovDistBtn.className = "btn inline";
      const _distStyle = (on) => on
        ? "background:#431407;border-color:#f97316;color:#fdba74;font-weight:700"
        : "color:#94a3b8";
      ovDistBtn.style.cssText = _distStyle(ctx.state._overviewShowDistortion);
      ovDistBtn.textContent = ctx.state._overviewShowDistortion ? "\u2192 Distortion ON" : "\u2192 Distortion";
      ovDistBtn.addEventListener("click", () => {
        ctx.state._overviewShowDistortion = !ctx.state._overviewShowDistortion;
        ovDistBtn.style.cssText = _distStyle(ctx.state._overviewShowDistortion);
        ovDistBtn.textContent = ctx.state._overviewShowDistortion ? "\u2192 Distortion ON" : "\u2192 Distortion";
        isoDiv.innerHTML = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      });
      ctrlRow.appendChild(ovDistBtn);
    }

    outer.appendChild(ctrlRow);
    outer.appendChild(isoWrap);
    outer.appendChild(roomListPanel);

    return outer;
  }
  // ---------- Room + radio grid (auto-generated from live HA data) ----------
  function renderRoomGrid(){
    const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
    const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];

    const allRadios  = (liveSnap && liveSnap.ble && Array.isArray(liveSnap.ble.radios)) ? liveSnap.ble.radios : [];
    const _rgIsScanner = ctx.helpers.isScanner;
    const _rgRaw = ((liveSnap && liveSnap.objects && Array.isArray(liveSnap.objects.list)) ? liveSnap.objects.list : [])
      .filter(o => !_rgIsScanner(o));
    // Dedup entity rows + filter stale history for room grid
    const _rgAddrSet = new Set();
    for (const o of _rgRaw) {
      if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
      if (o.address) _rgAddrSet.add(String(o.address).toUpperCase());
      if (Array.isArray(o.all_addresses)) for (const a of o.all_addresses) _rgAddrSet.add(String(a).toUpperCase());
    }
    const _rgLinkedSet = new Set(_rgRaw.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : []));
    const _rgAwayS = ((ctx.state.settings && ctx.state.settings.away_timeout_m != null) ? Number(ctx.state.settings.away_timeout_m) : 5) * 60;
    const allObjects = _rgRaw.filter(o => {
      if (o.kind === "entity" && (
        (o.address && _rgAddrSet.has(String(o.address).toUpperCase())) ||
        (o.entity_id && _rgLinkedSet.has(o.entity_id))
      )) return false;
      // Skip objects from deep history (>2x away timeout) for room grid dots
      const age = typeof o.age_s === "number" ? o.age_s : 0;
      if (o.kind !== "entity" && age > Math.max(_rgAwayS * 2, 3600)) return false;
      return true;
    });

    // Build room list from HA areas + roomTagMap (union)
    const roomSet = new Set(haAreas.map(a => a.name));
    for(const r of Object.keys(roomTagMap)) roomSet.add(r);
    const rooms = Array.from(roomSet).sort();

    if(!rooms.length && !allRadios.length) return null;

    // Group radios + objects by room
    const radiosByRoom = {}, objByRoom = {};
    for(const r of allRadios){
      const a = r.area_name || ""; if(a){ (radiosByRoom[a] = radiosByRoom[a]||[]).push(r); }
    }
    for(const o of allObjects){
      const r = o.room || ""; if(r){ (objByRoom[r] = objByRoom[r]||[]).push(o); }
    }
    const unassignedRadios = allRadios.filter(r => !r.area_name);

    // Layout constants — 2 columns, large boxes
    const COLS = 2, BW = 380, BH = 170, GAP = 16, PX = 14, PY = 14;
    const rows = Math.ceil(rooms.length / COLS);
    const svgW  = COLS * (BW + GAP) - GAP + PX * 2;
    const svgH  = rows * (BH + GAP) - GAP + PY * 2;
    const extraH = unassignedRadios.length ? BH * 0.6 + GAP : 0;
    const PALETTE = ["#52b788","#4caf50","#43a047","#388e3c","#66bb6a","#81c784","#a5d6a7","#2e7d32"];

    const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

    let s = `<svg viewBox="0 0 ${svgW} ${svgH + extraH}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;font-family:system-ui,sans-serif">`;
    s += `<rect width="${svgW}" height="${svgH + extraH}" fill="#071008" rx="8"/>`;

    rooms.forEach((room, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = PX + col * (BW + GAP);
      const y = PY + row * (BH + GAP);
      const color = PALETTE[idx % PALETTE.length];

      // Box
      s += `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" fill="${color}10" stroke="${color}" stroke-width="1.5" rx="10"/>`;

      // Room name
      s += `<text x="${x + BW/2}" y="${y + 22}" text-anchor="middle" fill="${color}" font-size="16" font-weight="700">${_esc(room)}</text>`;

      // Floor label from HA
      const haArea = haAreas.find(a => a.name === room);
      const haFloor = haFloors.find(f => f.id === (haArea?.floor_id||""));
      if(haFloor){
        s += `<text x="${x + BW/2}" y="${y + 37}" text-anchor="middle" fill="${color}88" font-size="11">${_esc(haFloor.name)}</text>`;
      }

      // Radios (antenna rings) — spread across the box width
      const roomRadios = radiosByRoom[room] || [];
      roomRadios.slice(0,5).forEach((r, ri) => {
        const rx = x + 22 + ri * 52, ry = y + 105;
        const sid = _sid(r.source || "");
        const rName = (r.name || r.source || "radio").substring(0, 12);
        s += `<circle cx="${rx}" cy="${ry}" r="14" fill="none" stroke="#52b788" stroke-width="0.7" opacity="0.2"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="8"  fill="none" stroke="#52b788" stroke-width="1"   opacity="0.5"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="4"  fill="#52b788"/>`;
        s += `<text x="${rx}" y="${ry - 18}" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600">${sid ? _esc(sid)+" " : ""}${_esc(rName)}</text>`;
        const lbl = (r.name || r.source || "").substring(0, 9);
        s += `<text x="${rx}" y="${ry + 20}" text-anchor="middle" fill="#52b788" font-size="8" opacity="0.7">${_esc(lbl)}</text>`;
      });

      // Objects (dots on the right side)
      const roomObjs = objByRoom[room] || [];
      roomObjs.slice(0,6).forEach((o, oi) => {
        const ox = x + BW - 16 - oi * 28, oy = y + 100;
        const oc = o.identified ? "#5eead4" : "#f59e0b";
        s += `<circle cx="${ox}" cy="${oy}" r="7" fill="${oc}" opacity="0.9"/>`;
        const lbl = (o.user_label || o.name || "?").substring(0, 6);
        s += `<text x="${ox}" y="${oy + 18}" text-anchor="middle" fill="${oc}" font-size="9">${_esc(lbl)}</text>`;
      });

      // Bottom summary
      const rc = roomRadios.length, oc = roomObjs.length;
      const sumTxt = [rc ? `${rc} radio${rc>1?"s":""}` : "", oc ? `${oc} obj${oc>1?"s":""}` : ""].filter(Boolean).join(" · ") || "no devices";
      s += `<text x="${x + BW - 8}" y="${y + BH - 7}" text-anchor="end" fill="${color}77" font-size="10">${_esc(sumTxt)}</text>`;
    });

    // Unassigned radios row
    if(unassignedRadios.length){
      const uy = svgH + GAP;
      s += `<text x="${PX}" y="${uy + 14}" fill="#94a3b8" font-size="12" font-weight="600">Radios not yet assigned to an HA area</text>`;
      unassignedRadios.slice(0,6).forEach((r, ri) => {
        const rx = PX + 20 + ri * 140, ry = uy + 42;
        const rName = (r.name || r.source || "Unknown").substring(0, 16);
        s += `<circle cx="${rx}" cy="${ry}" r="8" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.3"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="5" fill="none" stroke="#52b788" stroke-width="1"   opacity="0.6"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="3" fill="#52b78888"/>`;
        s += `<text x="${rx + 14}" y="${ry - 2}" fill="#52b788" font-size="10" font-weight="600">${_esc(rName)}</text>`;
        s += `<text x="${rx + 14}" y="${ry + 12}" fill="#94a3b8" font-size="9">${_esc(r.name || r.source || "Unknown")}</text>`;
      });
    }

    s += `</svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px";
    wrap.innerHTML = s;
    return wrap;
  }

  // ---------- Floor plan SVG ----------
  function renderFloorPlan(fp){
    if(!fp) return null;
    const vw = fp.vw || 800;
    const vh = fp.vh || 440;
    let s = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;border-radius:8px;background:#091209;display:block">`;

    // Rooms
    for(const r of (fp.rooms||[])){
      s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}18" stroke="${r.color}" stroke-width="1.5" rx="3"/>`;
      const tx = r.x + r.w/2, ty = r.y + 16;
      s += `<text x="${tx}" y="${ty}" text-anchor="middle" fill="${r.color}" font-size="12" font-family="system-ui,sans-serif" font-weight="600">${esc(r.name)}</text>`;
    }

    // Radio markers (concentric rings = scanning BT proxy)
    for(const radio of (fp.radios||[])){
      const {x,y} = radio;
      const rxName = (radio.name || radio.id || "radio").substring(0, 16);
      s += `<circle cx="${x}" cy="${y}" r="22" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.2"/>`;
      s += `<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="#52b788" stroke-width="1" opacity="0.4"/>`;
      s += `<circle cx="${x}" cy="${y}" r="8"  fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.7"/>`;
      s += `<circle cx="${x}" cy="${y}" r="4"  fill="#52b788" opacity="1"/>`;
      s += `<text x="${x}" y="${y-26}" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600">${esc(rxName)}</text>`;
      s += `<text x="${x}" y="${y+30}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui,sans-serif">${esc(radio.name)}</text>`;
    }

    // Objects (phones, keys, trackers)
    for(const obj of (fp.objects||[])){
      const {x,y,color,name} = obj;
      s += `<circle cx="${x}" cy="${y}" r="7" fill="${color}" opacity="0.95"/>`;
      s += `<text x="${x}" y="${y-11}" text-anchor="middle" fill="${color}" font-size="9" font-family="system-ui,sans-serif">${esc(name)}</text>`;
    }

    s += `</svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px";
    wrap.innerHTML = s;
    if(fp.name){
      const lbl = document.createElement("div");
      lbl.style.cssText = "color:#94a3b8;font-size:11px;margin-top:4px;text-align:center";
      lbl.textContent = fp.name;
      wrap.appendChild(lbl);
    }
    return wrap;
  }

  // Always try iso floor stack first; falls back to sample floor plan or room grid if no maps
  const mapEl = renderIsoFloorStack();

  // ---------- Basic mode layout ----------
  if(isBasic){
    const summary = el("div",{class:"basic-summary"},[
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, liveLoading ? "--" : String(roomsCount)),
        el("div",{class:"basic-summary-lbl"}, "Rooms"),
      ]),
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, liveLoading ? "--" : String(objectsTotal)),
        el("div",{class:"basic-summary-lbl"}, "Objects"),
      ]),
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, liveLoading ? "--" : String(radiosCount)),
        el("div",{class:"basic-summary-lbl"}, "Scanners"),
      ]),
      (() => {
        const cs = liveSnap?.calibration_status;
        if (!cs) return null;
        const total = cs.total_points || 0;
        const empty = cs.empty_points || 0;
        const usable = total - empty;
        const color = !usable ? "#f87171" : usable >= (cs.knn_min_required||5) ? "#52b788" : "#f59e0b";
        const algoName = cs.positioning_algorithm === "rf" ? "RF" : "k-NN";
        const knnLabel = cs.store_initialized === false ? "Store not loaded" :
          !cs.knn_active ? `Need ${(cs.knn_min_required||5) - usable} more` :
          cs.knn_positioned_objects > 0 ? `${algoName} active (${cs.knn_positioned_objects})` : `${algoName} ready`;
        const knnColor = cs.store_initialized === false ? "#f87171" :
          cs.knn_active && cs.knn_positioned_objects > 0 ? "#52b788" :
          cs.knn_active ? "#f59e0b" : "#94a3b8";
        return el("div",{style:"text-align:center"},[
          el("div",{class:"basic-summary-num",style:`color:${color}`}, liveLoading ? "--" : String(usable)),
          el("div",{class:"basic-summary-lbl"}, "Cal pts"),
          el("div",{style:`font-size:9px;color:${knnColor};margin-top:2px`}, knnLabel),
        ]);
      })(),
    ].filter(Boolean));

    const mapCard = el("div",{class:"card"},[
      el("div",{class:"card-head"},[
        el("div",{class:"h2"}, "Your home"),
        helpBtn("overview"),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        dataMode === "live" ? "Live view · updates every 5s" : "Sample data — switch to Live for your real home."),
    ]);
    if(mapEl) mapCard.appendChild(mapEl);

    // Companion phone discovery (basic mode) — collapsed by default
    const basicCompanionCard = el("div",{class:"card",style:"border-color:#2563eb"});
    if (dataMode === "live") {
      // Collapsed header row — click to expand
      const _phoneHdr = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
      const _phoneArrow = el("span",{style:"font-size:11px;color:#60a5fa;transition:transform .2s"}, "\u25B6");
      _phoneHdr.appendChild(_phoneArrow);
      _phoneHdr.appendChild(el("span",{style:"font-weight:600;font-size:13px;color:#60a5fa"}, "Track Your Phone"));
      _phoneHdr.appendChild(el("span",{class:"muted",style:"font-size:11px;flex:1"}, "Tap to expand"));
      basicCompanionCard.appendChild(_phoneHdr);
      const _phoneBody = el("div",{style:"display:none;margin-top:8px"});
      basicCompanionCard.appendChild(_phoneBody);
      _phoneHdr.addEventListener("click", () => {
        const open = _phoneBody.style.display !== "none";
        _phoneBody.style.display = open ? "none" : "block";
        _phoneArrow.style.transform = open ? "" : "rotate(90deg)";
        _phoneHdr.querySelector(".muted").textContent = open ? "Tap to expand" : "";
      });
      const _bLoadMsg = el("div",{class:"muted",style:"font-size:12px"}, "Discovering phones...");
      _phoneBody.appendChild(_bLoadMsg);
      (async () => {
        try {
          const res = await ctx.actions.wsCall("padspan_ha/companion_discover", {});
          const phones = res.phones || [];
          if (!phones.length) {
            _bLoadMsg.textContent = "No phones detected. Enable the HA Companion App with BLE Transmitter.";
            _bLoadMsg.style.color = "#64748b";
            return;
          }

          _bLoadMsg.textContent = "Phones with the HA Companion App. Track or unfollow below.";

          for (const phone of phones) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;background:#0f172a;margin-bottom:6px";

            // Name + status
            const info = document.createElement("div");
            info.style.cssText = "flex:1;min-width:0";
            const nameEl = document.createElement("div");
            nameEl.style.cssText = "font-weight:600;font-size:13px;color:#e2e8f0";
            nameEl.textContent = phone.device_name || "Phone";
            info.appendChild(nameEl);
            const meta = document.createElement("div");
            meta.style.cssText = "font-size:11px;color:#64748b;margin-top:2px";
            const parts = [];
            if (phone.is_disabled) parts.push("Entity disabled");
            else if (phone.is_transmitting) parts.push("BLE active");
            else parts.push(`BLE: ${phone.state || "off"}`);
            if (!phone.is_disabled) parts.push(phone.is_visible ? "visible" : "not seen");
            if (phone.is_followed) parts.push("tracked");
            if (phone.existing_label) parts.push(phone.existing_label);
            parts.push(phone.has_irk ? "IRK \u2713" : "no IRK");
            meta.textContent = parts.join(" · ");
            info.appendChild(meta);

            // IRK section — add button or show status
            if (!phone.has_irk && !phone.is_disabled) {
              const irkRow = document.createElement("div");
              irkRow.style.cssText = "margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap";

              const irkHint = document.createElement("span");
              irkHint.style.cssText = "font-size:10px;color:#f59e0b";
              irkHint.textContent = "No IRK \u2014 ";
              irkRow.appendChild(irkHint);

              const addIrkBtn = document.createElement("button");
              addIrkBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #2563eb;background:#1e3a5f;color:#93c5fd";
              addIrkBtn.textContent = "Add IRK";

              const irkInput = document.createElement("input");
              irkInput.type = "text";
              irkInput.placeholder = "Paste IRK (hex or base64)";
              irkInput.style.cssText = "font-size:10px;padding:2px 6px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:3px;width:220px;display:none;font-family:monospace";

              const irkSaveBtn = document.createElement("button");
              irkSaveBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #16a34a;background:#052e16;color:#4ade80;display:none";
              irkSaveBtn.textContent = "Save";

              addIrkBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                addIrkBtn.style.display = "none";
                irkInput.style.display = "inline";
                irkSaveBtn.style.display = "inline";
                irkInput.focus();
              });

              irkSaveBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const irk = irkInput.value.trim();
                if (!irk) return;
                irkSaveBtn.textContent = "Saving...";
                irkSaveBtn.disabled = true;
                try {
                  await ctx.actions.wsCall("padspan_ha/irk_add", {
                    name: phone.device_name || "Phone",
                    irk_hex: irk,
                  });
                  irkRow.innerHTML = "";
                  const ok = document.createElement("span");
                  ok.style.cssText = "font-size:10px;color:#4ade80";
                  ok.textContent = "\u2713 IRK saved — tracking will activate within 60 seconds";
                  irkRow.appendChild(ok);
                } catch (err) {
                  irkSaveBtn.textContent = "Error";
                  irkSaveBtn.style.color = "#f87171";
                  irkSaveBtn.style.borderColor = "#dc2626";
                  const errMsg = (err && err.message) || String(err);
                  const errDiv = document.createElement("div");
                  errDiv.style.cssText = "font-size:10px;color:#f87171;width:100%;margin-top:2px";
                  errDiv.textContent = errMsg;
                  irkRow.appendChild(errDiv);
                  irkSaveBtn.disabled = false;
                  irkSaveBtn.textContent = "Retry";
                }
              });

              irkRow.appendChild(addIrkBtn);
              irkRow.appendChild(irkInput);
              irkRow.appendChild(irkSaveBtn);

              // Help text
              const helpText = document.createElement("div");
              helpText.style.cssText = "font-size:9px;color:#64748b;width:100%;margin-top:2px;display:none";
              helpText.textContent = "IRK is optional — your phone is already tracked via iBeacon. For IRK (enhanced tracking), see Settings \u2192 Phone Tracking for extraction methods.";
              irkRow.appendChild(helpText);
              addIrkBtn.addEventListener("click", () => { helpText.style.display = "block"; });

              info.appendChild(irkRow);
            }
            row.appendChild(info);

            // Action button
            const btn = document.createElement("button");
            btn.className = "btn tiny";
            btn.style.cssText = "white-space:nowrap;font-size:12px;padding:4px 14px";

            // Helper to wire button as Track or Unfollow (allows toggling)
            const _setTrack = () => {
              btn.textContent = "Track";
              btn.style.color = "#60a5fa";
              btn.style.borderColor = "#2563eb";
              btn.disabled = false;
              btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = "Setting up...";
                try {
                  const r = await ctx.actions.wsCall("padspan_ha/companion_follow", {
                    ibeacon_key: phone.ibeacon_key,
                    device_name: phone.device_name,
                    entity_id: phone.entity_id,
                  });
                  if (r.follow_key) {
                    ctx.state.followedAddrs.add(r.follow_key);
                    try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                  }
                  if (r.verified_label && r.verified_followed) {
                    phone.is_followed = true;
                    meta.textContent = meta.textContent.replace("not tracked","tracked");
                    _setUnfollow();
                  } else {
                    btn.textContent = "Error — retry";
                    btn.style.color = "#f87171";
                    btn.disabled = false;
                  }
                } catch (e) {
                  btn.textContent = "Error — retry";
                  btn.style.color = "#f87171";
                  btn.disabled = false;
                }
              };
            };
            const _setUnfollow = () => {
              btn.textContent = "Unfollow";
              btn.style.color = "#f87171";
              btn.style.borderColor = "#7f1d1d";
              btn.disabled = false;
              btn.onclick = async () => {
                if (!confirm(`Stop tracking ${phone.device_name || "this phone"} and remove its label?`)) return;
                btn.disabled = true;
                btn.textContent = "Removing...";
                try {
                  await ctx.actions.wsCall("padspan_ha/companion_unfollow", {
                    ibeacon_key: phone.ibeacon_key,
                    device_name: phone.device_name,
                  });
                  ctx.state.followedAddrs.delete(phone.ibeacon_key);
                  ctx.state.followedAddrs.delete(phone.ibeacon_key.toUpperCase());
                  try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                  phone.is_followed = false;
                  meta.textContent = meta.textContent.replace("tracked","not tracked");
                  _setTrack();
                } catch (e) {
                  btn.textContent = "Error";
                  btn.style.color = "#f87171";
                  btn.disabled = false;
                }
              };
            };

            if (phone.state === "sensor_not_registered") {
              // Phone is registered with HA but BLE Transmitter sensor isn't enabled
              meta.textContent = (phone.model ? phone.model + " · " : "") + "BLE Transmitter sensor not enabled";
              btn.textContent = "Setup";
              btn.style.color = "#f59e0b";
              btn.style.borderColor = "#92400e";
              btn.addEventListener("click", () => {
                alert(
                  "To enable phone tracking:\n\n" +
                  "1. Open the HA Companion App on your phone\n" +
                  "2. Go to Settings > Companion App > Manage Sensors\n" +
                  "3. Find 'BLE Transmitter' and enable it\n" +
                  "4. Turn on 'Transmit enabled'\n" +
                  "5. Restart Home Assistant\n\n" +
                  "The BLE Transmitter sensor must be registered with HA before PadSpan can track the phone."
                );
              });
            } else if (phone.is_disabled) {
              btn.textContent = "Enable & Track";
              btn.style.color = "#f59e0b";
              btn.style.borderColor = "#92400e";
              btn.addEventListener("click", async () => {
                btn.disabled = true;
                btn.textContent = "Enabling...";
                try {
                  await ctx.actions.wsCall("config/entity_registry/update", {
                    entity_id: phone.entity_id,
                    disabled_by: null,
                  });
                  // Also auto-follow so the notify command turns on BLE transmitter
                  if (phone.ibeacon_key) {
                    await ctx.actions.wsCall("padspan_ha/companion_follow", {
                      ibeacon_key: phone.ibeacon_key,
                      device_name: phone.device_name,
                      entity_id: phone.entity_id,
                    });
                  }
                  btn.textContent = "Enabled — restart HA";
                  btn.style.color = "#34d399"; btn.style.borderColor = "#065f46";
                  meta.textContent = "Entity enabled & BLE command sent. Restart HA to complete.";
                } catch (e) {
                  btn.textContent = "Enable manually in HA";
                  btn.style.color = "#f59e0b";
                  btn.disabled = false;
                }
              });
            } else if (phone.is_followed) {
              _setUnfollow();
            } else {
              _setTrack();
            }
            row.appendChild(btn);
            _phoneBody.appendChild(row);
          }
        } catch (e) { _bLoadMsg.textContent = "Phone discovery error: " + (e.message||e); _bLoadMsg.style.color = "#f87171"; }
      })();
    } else {
      basicCompanionCard.style.display = "none";
    }

    // Basic mode quiet toggle
    const bQuietToggle = el("input",{type:"checkbox",style:"width:14px;height:14px;accent-color:#52b788;cursor:pointer;margin:0"});
    bQuietToggle.checked = _quietMode;
    bQuietToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ quiet_mode: bQuietToggle.checked });
        ctx.toast(bQuietToggle.checked ? "Quiet mode on" : "Quiet mode off");
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    const bQuietRow = el("div",{style:"display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:" + (_quietMode ? "#52b788" : "#64748b")},[
      bQuietToggle,
      el("span",{style:"user-select:none"}, "Quiet"),
    ]);
    bQuietRow.addEventListener("click", (e)=>{ if(e.target !== bQuietToggle){ bQuietToggle.checked = !bQuietToggle.checked; bQuietToggle.dispatchEvent(new Event("change")); } });

    const section = el("section",{},[
      el("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"},[
        el("div",{class:"row",style:"align-items:center;gap:8px"},[
          el("h2",{style:"margin:0"}, "Overview"),
          helpBtn("overview_grid"),
        ]),
        bQuietRow,
      ]),
      summary,
      basicCompanionCard,
      mapCard,
    ]);
    return section;
  }

  // ---------- Advanced mode layout ----------
  const grid = el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Rooms"),
        el("div",{class:"v"}, liveLoading ? "--" : String(roomsCount)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: openRoomsList}, "View rooms list"),
      ])
    ]),
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Objects"),
        el("div",{class:"v"}, liveLoading ? "--" : String(objectsTotal)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: ()=>openObjectsList("all")}, _quietMode ? "Tracked objects" : "All objects"),
        _quietMode ? null : el("button",{class:"btn", onclick: ()=>openObjectsList("unidentified")}, `Unidentified (${liveLoading ? "--" : unidentifiedCount})`),
      ].filter(Boolean)),
      unidentifiedCount > 0 ? el("div",{style:"margin-top:6px"},[
        el("button",{class:"btn inline",style:"font-size:11px;color:#f87171;border-color:#7f1d1d", onclick: async function(){
          if(!confirm("Clear all unidentified objects? Tagged and followed devices will be kept.")) return;
          this.disabled = true; this.textContent = "Clearing...";
          try {
            const r = await ctx.actions.wsCall("padspan_ha/objects_clear_history",{});
            ctx.toast(`Cleared ${r.removed} object${r.removed!==1?"s":""}, kept ${r.kept} tagged/followed`);
            await ctx.actions.refreshSnapshot();
          } catch(e){ ctx.toast("Failed: " + (e.message||e), true); }
          this.disabled = false; this.textContent = "Clear unidentified";
        }}, "Clear unidentified"),
      ]) : null,
    ]),
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Bluetooth radios"),
        el("div",{class:"v"}, liveLoading ? "--" : String(radiosCount)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: openRadiosList}, "View radios list"),
      ]),
      el("div",{style:"margin-top:8px;color:#94a3b8;font-size:12px"}, dataMode==="live" ? "Live snapshot" : "Sample data — switch to Live to see your real devices")
    ]),
    // Calibration status card
    (() => {
      const cs = liveSnap?.calibration_status;
      if (!cs) return null;
      const total = cs.total_points || 0;
      const empty = cs.empty_points || 0;
      const usable = total - empty;
      const ready = usable >= (cs.knn_min_required || 5);
      const storeOk = cs.store_initialized !== false;
      const knnPos = cs.knn_positioned_objects || 0;
      const color = !storeOk ? "#f87171" : !total ? "#f87171" : empty > 0 ? "#f59e0b" : ready ? "#52b788" : "#f59e0b";
      const algoLabel = cs.positioning_algorithm === "rf" ? "Random Forest" : "k-NN";
      const statusText = !storeOk ? "Store not loaded (restart HA)" :
        !total ? "No data" : !ready ? `Need ${(cs.knn_min_required||5) - usable} more` :
        knnPos > 0 ? `${algoLabel} — ${knnPos} objects positioned` : `${algoLabel} ready (no objects matched yet)`;
      const parts = [];
      if (cs.manual_points > 0) parts.push(`${cs.manual_points} manual`);
      if (cs.auto_points > 0) parts.push(`${cs.auto_points} auto`);
      if (empty > 0) parts.push(`${empty} empty (no RSSI)`);
      return el("div",{class:"card"},[
        el("div",{class:"kpi"},[
          el("div",{class:"k"}, "Calibration"),
          el("div",{class:"v",style:`color:${color}`}, `${usable} pts`),
        ]),
        el("div",{style:"font-size:11px;color:#94a3b8;margin-top:4px"},
          parts.join(" · ") + (cs.scanners ? ` · ${cs.scanners} scanners` : "") + (cs.maps ? ` · ${cs.maps} maps` : "")),
        el("div",{style:`font-size:11px;margin-top:4px;color:${color}`},
          `k-NN: ${statusText}`),
        !storeOk ? el("div",{style:"font-size:11px;margin-top:4px;color:#f87171;font-weight:600"},
          "CalibrationStore was not loaded at startup. Restart Home Assistant to activate k-NN positioning.") : null,
        empty > 0 ? el("div",{style:"font-size:11px;margin-top:4px;color:#f59e0b"},
          `${empty} point(s) have no RSSI data — re-calibrate to fix`) : null,
        // k-NN diagnostic: collapsible
        cs.source_overlap !== undefined ? (() => {
          const diagWrap = el("div",{style:"font-size:10px;margin-top:6px;padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:4px;color:#94a3b8"});
          const diagHdr = el("div",{style:"display:flex;align-items:center;gap:6px;cursor:pointer"});
          const diagArrow = el("span",{style:"font-size:9px;color:#60a5fa;transition:transform .2s"}, "\u25B6");
          diagHdr.appendChild(diagArrow);
          diagHdr.appendChild(el("span",{style:"font-weight:600;color:#e2e8f0"}, `${algoLabel} Diagnostic`));
          diagWrap.appendChild(diagHdr);
          const diagBody = el("div",{style:"display:none;margin-top:4px"});
          diagBody.appendChild(el("div",{}, `Cal sources: ${(cs.cal_sources||[]).length} · Live EMA sources: ${(cs.ema_sources||[]).length} · Overlap: ${cs.source_overlap}`));
          if (cs.source_overlap === 0) diagBody.appendChild(el("div",{style:"color:#f87171;font-weight:600;margin-top:3px"},
            "No scanner overlap between calibration data and live objects — cannot match!"));
          if (cs.source_overlap === 0 && (cs.cal_sources||[]).length > 0 && (cs.ema_sources||[]).length > 0)
            diagBody.appendChild(el("div",{style:"color:#f59e0b;margin-top:3px"},
              `Cal: ${(cs.cal_sources||[]).slice(0,3).join(", ")} · Live: ${(cs.ema_sources||[]).slice(0,3).join(", ")}`));
          (cs.knn_diag||[]).forEach(d => {
            diagBody.appendChild(el("div",{style:"margin-top:3px;border-top:1px solid #1e293b;padding-top:3px"}, [
              el("div",{}, `${d.key}: ${d.ema_scanners} EMA, ${d.shared_with_cal} overlap cal`),
              d.knn_result ? el("div",{style:"color:#52b788"},
                `→ conf=${(d.knn_result.confidence*100).toFixed(0)}% room=${d.knn_result.room} k=${d.knn_result.k_used} shared=${d.knn_result.shared_scanners||"?"}`) :
                el("div",{style:"color:#f87171"}, d.shared_with_cal > 0 ? "→ locate returned null" : "→ no shared scanners"),
            ]));
          });
          diagWrap.appendChild(diagBody);
          diagHdr.addEventListener("click", () => {
            const open = diagBody.style.display !== "none";
            diagBody.style.display = open ? "none" : "block";
            diagArrow.style.transform = open ? "" : "rotate(90deg)";
          });
          return diagWrap;
        })() : null,
      ].filter(Boolean));
    })(),
  ].filter(Boolean));

  // ---------- Companion App Phone Discovery ----------
  const companionCard = el("div",{class:"card",style:"border-color:#2563eb"});
  if (dataMode === "live") {
    // Collapsed header — click to expand
    const _aPhoneHdr = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
    const _aPhoneArrow = el("span",{style:"font-size:11px;color:#60a5fa;transition:transform .2s"}, "\u25B6");
    _aPhoneHdr.appendChild(_aPhoneArrow);
    _aPhoneHdr.appendChild(el("span",{style:"font-weight:700;font-size:14px;color:#60a5fa"}, "Track Your Phone"));
    _aPhoneHdr.appendChild(el("span",{class:"muted",style:"font-size:11px;flex:1"}, "Tap to expand"));
    companionCard.appendChild(_aPhoneHdr);
    const _aPhoneBody = el("div",{style:"display:none;margin-top:8px"});
    companionCard.appendChild(_aPhoneBody);
    _aPhoneHdr.addEventListener("click", () => {
      const open = _aPhoneBody.style.display !== "none";
      _aPhoneBody.style.display = open ? "none" : "block";
      _aPhoneArrow.style.transform = open ? "" : "rotate(90deg)";
      _aPhoneHdr.querySelector(".muted").textContent = open ? "Tap to expand" : "";
    });
    const _aLoadMsg = el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"}, "Discovering phones...");
    _aPhoneBody.appendChild(_aLoadMsg);
    (async () => {
      try {
        const res = await ctx.actions.wsCall("padspan_ha/companion_discover", {});
        const phones = res.phones || [];
        if (!phones.length) {
          _aLoadMsg.textContent = "No phones detected. Enable the HA Companion App with BLE Transmitter.";
          _aLoadMsg.style.color = "#64748b";
          return;
        }

        _aLoadMsg.textContent = "Phones running the HA Companion App with BLE Transmitter. Click to track.";

        for (const phone of phones) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;background:#0f172a;margin-bottom:6px";

          // Phone icon + name
          const info = document.createElement("div");
          info.style.cssText = "flex:1;min-width:0";
          const nameEl = document.createElement("div");
          nameEl.style.cssText = "font-weight:600;font-size:14px;color:#e2e8f0";
          nameEl.textContent = phone.device_name || "Phone";
          info.appendChild(nameEl);

          const meta = document.createElement("div");
          meta.style.cssText = "font-size:11px;color:#64748b;margin-top:2px";
          const statusParts = [];
          if (phone.is_disabled) statusParts.push("Entity disabled in HA");
          else if (phone.is_transmitting) statusParts.push("BLE active");
          else statusParts.push("BLE off");
          if (!phone.is_disabled) {
            if (phone.is_visible) statusParts.push("visible to scanners");
            else statusParts.push("not seen yet");
          }
          if (phone.existing_label) statusParts.push(`labelled: ${phone.existing_label}`);
          statusParts.push(phone.has_irk ? "IRK \u2713" : "no IRK");
          meta.textContent = statusParts.join(" · ");
          info.appendChild(meta);

          // IRK add form for phones without IRK (advanced view)
          if (!phone.has_irk && !phone.is_disabled) {
            const irkRow = document.createElement("div");
            irkRow.style.cssText = "margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap";
            const irkHint = document.createElement("span");
            irkHint.style.cssText = "font-size:10px;color:#f59e0b";
            irkHint.textContent = "No IRK \u2014 ";
            irkRow.appendChild(irkHint);
            const addIrkBtn = document.createElement("button");
            addIrkBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #2563eb;background:#1e3a5f;color:#93c5fd";
            addIrkBtn.textContent = "Add IRK";
            const irkInput = document.createElement("input");
            irkInput.type = "text";
            irkInput.placeholder = "Paste IRK (hex or base64)";
            irkInput.style.cssText = "font-size:10px;padding:2px 6px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:3px;width:220px;display:none;font-family:monospace";
            const irkSaveBtn = document.createElement("button");
            irkSaveBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #16a34a;background:#052e16;color:#4ade80;display:none";
            irkSaveBtn.textContent = "Save";
            addIrkBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              addIrkBtn.style.display = "none";
              irkInput.style.display = "inline";
              irkSaveBtn.style.display = "inline";
              irkHelp.style.display = "block";
              irkInput.focus();
            });
            irkSaveBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              const irk = irkInput.value.trim();
              if (!irk) return;
              irkSaveBtn.textContent = "Saving...";
              irkSaveBtn.disabled = true;
              try {
                await ctx.actions.wsCall("padspan_ha/irk_add", {
                  name: phone.device_name || "Phone",
                  irk_hex: irk,
                });
                irkRow.innerHTML = "";
                const ok = document.createElement("span");
                ok.style.cssText = "font-size:10px;color:#4ade80";
                ok.textContent = "\u2713 IRK saved — tracking will activate within 60 seconds";
                irkRow.appendChild(ok);
              } catch (err) {
                irkSaveBtn.textContent = "Error";
                irkSaveBtn.style.color = "#f87171";
                irkSaveBtn.style.borderColor = "#dc2626";
                const errDiv = document.createElement("div");
                errDiv.style.cssText = "font-size:10px;color:#f87171;width:100%;margin-top:2px";
                errDiv.textContent = (err && err.message) || String(err);
                irkRow.appendChild(errDiv);
                irkSaveBtn.disabled = false;
                irkSaveBtn.textContent = "Retry";
              }
            });
            irkRow.appendChild(addIrkBtn);
            irkRow.appendChild(irkInput);
            irkRow.appendChild(irkSaveBtn);
            const irkHelp = document.createElement("div");
            irkHelp.style.cssText = "font-size:9px;color:#64748b;width:100%;margin-top:2px;display:none";
            irkHelp.textContent = "IRK is optional — your phone is already tracked via iBeacon. For IRK (enhanced tracking), see Settings \u2192 Phone Tracking for extraction methods.";
            irkRow.appendChild(irkHelp);
            info.appendChild(irkRow);
          }
          row.appendChild(info);

          // Phone registered but BLE sensor not enabled (common on Android)
          if (phone.state === "sensor_not_registered") {
            meta.textContent = (phone.model ? phone.model + " · " : "") + "BLE Transmitter sensor not enabled in Companion App";
            const setupBtn = document.createElement("button");
            setupBtn.className = "btn inline";
            setupBtn.style.cssText = "font-size:12px;padding:4px 14px;color:#f59e0b;border-color:#92400e;font-weight:600;white-space:nowrap";
            setupBtn.textContent = "Setup";
            setupBtn.addEventListener("click", () => {
              alert(
                "To enable phone tracking:\n\n" +
                "1. Open the HA Companion App on your phone\n" +
                "2. Go to Settings > Companion App > Manage Sensors\n" +
                "3. Find 'BLE Transmitter' and enable it\n" +
                "4. Turn on 'Transmit enabled'\n" +
                "5. Restart Home Assistant\n\n" +
                "The BLE Transmitter sensor must be registered with HA before PadSpan can track the phone."
              );
            });
            row.appendChild(setupBtn);
            _aPhoneBody.appendChild(row);
            continue;
          }

          // Disabled entity — enable + auto-follow
          if (phone.is_disabled) {
            const enableBtn = document.createElement("button");
            enableBtn.className = "btn inline";
            enableBtn.style.cssText = "font-size:12px;padding:4px 14px;color:#f59e0b;border-color:#92400e;font-weight:600;white-space:nowrap";
            enableBtn.textContent = "Enable & Track";
            enableBtn.addEventListener("click", async () => {
              enableBtn.disabled = true;
              enableBtn.textContent = "Enabling...";
              try {
                // Enable the entity via HA entity registry
                await ctx.actions.wsCall("config/entity_registry/update", {
                  entity_id: phone.entity_id,
                  disabled_by: null,
                });
                // Also auto-follow so the notify command turns on BLE transmitter
                if (phone.ibeacon_key) {
                  await ctx.actions.wsCall("padspan_ha/companion_follow", {
                    ibeacon_key: phone.ibeacon_key,
                    device_name: phone.device_name,
                    entity_id: phone.entity_id,
                  });
                }
                enableBtn.textContent = "Enabled — restart HA";
                enableBtn.style.color = "#34d399";
                enableBtn.style.borderColor = "#065f46";
                meta.textContent = "Entity enabled & BLE command sent. Restart Home Assistant to complete setup.";
              } catch (e) {
                enableBtn.textContent = "Enable manually";
                enableBtn.disabled = false;
                meta.textContent = `Go to HA → Settings → Devices → ${phone.device_name} → Entities → BLE Transmitter → Enable`;
              }
            });
            row.appendChild(enableBtn);
            _aPhoneBody.appendChild(row);
            continue;
          }

          // Status badge + untrack
          if (phone.is_followed) {
            const btnWrap = document.createElement("div");
            btnWrap.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
            const badge = document.createElement("span");
            if (phone.is_visible) {
              badge.style.cssText = "font-size:11px;color:#34d399;font-weight:600;padding:3px 8px;border:1px solid #065f46;border-radius:4px";
              badge.textContent = "Tracked";
            } else if (phone.is_transmitting) {
              badge.style.cssText = "font-size:11px;color:#fbbf24;font-weight:600;padding:3px 8px;border:1px solid #92400e;border-radius:4px";
              badge.textContent = "Waiting for signal";
            } else {
              badge.style.cssText = "font-size:11px;color:#f87171;font-weight:600;padding:3px 8px;border:1px solid #7f1d1d;border-radius:4px";
              badge.textContent = "BLE off";
            }
            btnWrap.appendChild(badge);
            const unBtn = document.createElement("button");
            unBtn.className = "btn inline";
            unBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#f87171;border-color:#7f1d1d";
            unBtn.textContent = "Untrack";
            unBtn.addEventListener("click", async () => {
              if (!confirm(`Stop tracking ${phone.device_name || "this phone"} and remove its label?`)) return;
              unBtn.disabled = true;
              unBtn.textContent = "Removing...";
              try {
                await ctx.actions.wsCall("padspan_ha/companion_unfollow", {
                  ibeacon_key: phone.ibeacon_key,
                });
                // Sync local state
                const fk = phone.ibeacon_key.toUpperCase();
                ctx.state.followedAddrs.delete(fk);
                try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                badge.textContent = "Removed";
                badge.style.color = "#64748b";
                badge.style.borderColor = "#334155";
                unBtn.style.display = "none";
                setTimeout(() => ctx.actions.renderRooms(), 1500);
              } catch (e) {
                unBtn.textContent = "Error";
                unBtn.disabled = false;
              }
            });
            btnWrap.appendChild(unBtn);
            row.appendChild(btnWrap);
          } else {
            // Follow button
            const btn = document.createElement("button");
            btn.className = "btn inline";
            btn.style.cssText = "font-size:12px;padding:4px 14px;color:#60a5fa;border-color:#2563eb;font-weight:600";
            btn.textContent = "Track this phone";
            btn.addEventListener("click", async () => {
              btn.disabled = true;
              btn.textContent = "Setting up...";
              try {
                const r = await ctx.actions.wsCall("padspan_ha/companion_follow", {
                  ibeacon_key: phone.ibeacon_key,
                  device_name: phone.device_name,
                  entity_id: phone.entity_id,
                });
                // Sync local followed set so Follow view + overview see it immediately
                if (r.follow_key) {
                  ctx.state.followedAddrs.add(r.follow_key);
                  try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                }
                // Show status based on actual phone state
                if (r.verified_label && r.verified_followed) {
                  if (phone.is_visible) {
                    btn.textContent = "Tracked!";
                    btn.style.cssText = "font-size:12px;padding:4px 14px;color:#34d399;border-color:#065f46;font-weight:600";
                    meta.textContent = `Tagged as "${r.verified_label}" · visible to scanners`;
                  } else if (phone.is_transmitting || r.transmitter_enabled) {
                    btn.textContent = "Registered — waiting for signal";
                    btn.style.cssText = "font-size:12px;padding:4px 14px;color:#fbbf24;border-color:#92400e;font-weight:600";
                    meta.textContent = `Tagged as "${r.verified_label}" · BLE active but not yet seen by scanners. Walk near a scanner.`;
                  } else {
                    btn.textContent = "Registered — enable BLE";
                    btn.style.cssText = "font-size:12px;padding:4px 14px;color:#f59e0b;border-color:#92400e;font-weight:600";
                    meta.textContent = `Tagged as "${r.verified_label}" · BLE transmitter is OFF. Enable it in Companion App → Settings → Manage Sensors → BLE Transmitter.`;
                  }
                } else {
                  btn.textContent = "Error saving — retry";
                  btn.style.cssText = "font-size:12px;padding:4px 14px;color:#f87171;border-color:#7f1d1d;font-weight:600";
                  btn.disabled = false;
                }
                // Refresh to update map + follow view
                setTimeout(() => ctx.actions.renderRooms(), 1500);
              } catch (e) {
                btn.textContent = "Error — try again";
                btn.style.color = "#f87171";
                btn.disabled = false;
              }
            });
            row.appendChild(btn);
          }

          _aPhoneBody.appendChild(row);
        }

        // Help note
        const helpNote = el("div",{style:"font-size:11px;color:#475569;margin-top:8px"},
          "Not seeing your phone? Open Companion App \u2192 Settings \u2192 Companion App \u2192 Manage Sensors \u2192 BLE Transmitter \u2192 Enable. The phone will appear here once the transmitter is active.");
        _aPhoneBody.appendChild(helpNote);
      } catch (e) {
        _aLoadMsg.textContent = "Phone discovery error: " + (e.message||e);
        _aLoadMsg.style.color = "#f87171";
      }
    })();
  } else {
    companionCard.style.display = "none";
  }

  // Quiet Mode toggle for top-right
  const quietToggle = el("input",{type:"checkbox",style:"width:14px;height:14px;accent-color:#52b788;cursor:pointer;margin:0"});
  quietToggle.checked = _quietMode;
  quietToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ quiet_mode: quietToggle.checked });
      ctx.toast(quietToggle.checked ? "Quiet mode on" : "Quiet mode off");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed to save", true); }
  });
  const quietRow = el("div",{style:"display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:" + (_quietMode ? "#52b788" : "#64748b")},[
    quietToggle,
    el("span",{style:"user-select:none"}, "Quiet"),
  ]);
  quietRow.addEventListener("click", (e)=>{ if(e.target !== quietToggle){ quietToggle.checked = !quietToggle.checked; quietToggle.dispatchEvent(new Event("change")); } });

  const section = el("section",{},[
    el("div",{style:"display:flex;align-items:center;justify-content:space-between"},[
      el("h2",{style:"margin:0"}, "Overview"),
      quietRow,
    ]),
    el("div",{style:"color:#94a3b8;margin-top:2px;margin-bottom:10px"}, `Mode: ${dataMode.toUpperCase()} · ${ctx.state.versionInfo?.version || ""} (${ctx.state.versionInfo?.build_id || ""})`),
  ]);
  section.appendChild(companionCard);
  if(mapEl) section.appendChild(mapEl);
  section.appendChild(grid);
  return section;
}
