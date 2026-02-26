/*
  PadSpan HA — Lights Control Panel
  ===================================
  Standalone HA sidebar panel: full-house light control on the floor plan.
  No sidebar nav, no complexity toggle — just the light map and index.
  Tap a hexagon or table row to toggle a light on/off.

  BUILD_ID / APP_VERSION updated automatically by scripts/release.py.
*/

const APP_VERSION = "0.5.21";
const BUILD_ID = "20260226T183420Z";

// ── DOM helpers ──────────────────────────────────────────────────────────────
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==="class")  n.className = v;
    else if(k==="id") n.id = v;
    else if(k==="style") n.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2), v);
    else if(v!==undefined && v!==null) n.setAttribute(k, String(v));
  }
  if(!Array.isArray(children)) children=[children];
  for(const c of children){
    if(c===null||c===undefined) continue;
    if(typeof c==="string"||typeof c==="number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}
function esc(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

// ── Hex geometry helpers ─────────────────────────────────────────────────────

// Deterministic 3-char code: 1 letter + 2-digit number  (A01 … Z99)
function lightCode(idx){
  const letter = String.fromCharCode(65 + Math.floor(idx/99));
  const num    = String((idx%99)+1).padStart(2,"0");
  return letter+num;
}

// SVG polygon points for a pointy-top regular hexagon
function hexPts(cx, cy, r){
  const pts = [];
  for(let k=0; k<6; k++){
    const a = (90+k*60)*Math.PI/180;
    pts.push(`${(cx+r*Math.cos(a)).toFixed(2)},${(cy+r*Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// Cluster offsets for N hexes around a room centre (touching formation)
function hexCluster(n, r){
  const d = r*Math.sqrt(3)+2;   // touching distance + 2 px gap
  const ring = Array.from({length:6},(_,i)=>{
    const a=(30+i*60)*Math.PI/180;
    return [d*Math.cos(a), d*Math.sin(a)];
  });
  const positions = [[0,0],...ring];  // centre + 6-ring = 7
  if(n<=7) return positions.slice(0,n);
  return Array.from({length:n},(_,i)=>{
    const col=i%3, row=Math.floor(i/3);
    return [(col-1)*d, row*d*0.87];
  });
}

function escSVG(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

// ── Custom element ───────────────────────────────────────────────────────────
class PadSpanLightsApp extends HTMLElement {
  constructor(){
    super();
    this._hass   = null;
    this._booted = false;
    this._pollTimer = null;
    this.state = {
      maps:        { list:[] },
      activeMapId: null,
      model:       { areas:[] },
      _lightsReg:  null,   // { ts, areaMap }
    };
  }

  set hass(hass){
    this._hass = hass;
    if(!this._booted){ this._booted=true; this._boot(); }
  }

  async _boot(){
    if(!this._hass) return;
    await Promise.allSettled([
      this._loadMaps(),
      this._loadModel(),
      this._loadLightsReg(),
    ]);
    this._render();
    this._pollTimer = setInterval(()=>this._poll(), 5000);
  }

  async _poll(){
    if(!this._hass) return;
    // Refresh light registry every 60 s, otherwise just re-render with fresh hass.states
    if(!this.state._lightsReg || Date.now()-this.state._lightsReg.ts > 60000)
      await this._loadLightsReg();
    this._render();
  }

  // ── Data loaders ─────────────────────────────────────────────────────────
  async _loadMaps(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/maps_list" });
      this.state.maps.list = res?.maps || [];
      if(!this.state.activeMapId && this.state.maps.list.length)
        this.state.activeMapId = this.state.maps.list[0].id;
    }catch(e){ /* non-fatal */ }
  }

  async _loadModel(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/model_get" });
      this.state.model = { areas: res?.areas || [] };
    }catch(e){ /* non-fatal */ }
  }

  async _loadLightsReg(){
    try{
      const reg   = await this._hass.callWS({ type:"config/entity_registry/list" });
      const areas = this.state.model.areas;
      const areaIdToName = {};
      for(const a of areas) areaIdToName[a.id] = a.name;
      const areaMap = {};
      for(const e of reg){
        if(e.entity_id.startsWith("light."))
          areaMap[e.entity_id] = e.area_id ? (areaIdToName[e.area_id]||null) : null;
      }
      this.state._lightsReg = { ts:Date.now(), areaMap };
    }catch(e){
      this.state._lightsReg = { ts:Date.now(), areaMap:{} };
    }
  }

  // ── Toggle light ─────────────────────────────────────────────────────────
  async _toggle(eid){
    if(!this._hass) return;
    const on = this._hass.states[eid]?.state==="on";
    try{
      await this._hass.callService("light", on?"turn_off":"turn_on", {entity_id:eid});
      setTimeout(()=>this._render(), 600);
    }catch(e){
      this._toast("Could not toggle "+eid, true);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  _render(){
    if(!this.shadowRoot) return;
    const $c = this.shadowRoot.querySelector("#content");
    if(!$c) return;
    while($c.firstChild) $c.removeChild($c.firstChild);
    $c.appendChild(this._buildUI());
  }

  _buildUI(){
    const root = el("div",{});

    // Header
    root.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap"},[
      el("div",{style:"font-size:18px;font-weight:800;color:#e2e8f0"},"Lights"),
      el("span",{style:"font-size:12px;color:#94a3b8"},`v${APP_VERSION}`),
      el("span",{class:"muted",style:"font-size:12px"},"Tap a hex or row to toggle · Yellow\u00a0=\u00a0on · Grey\u00a0=\u00a0off"),
      el("button",{class:"btn inline",style:"margin-left:auto",onclick:()=>{
        this.state._lightsReg=null;
        this._boot().then(()=>this._render());
      }},"Refresh"),
    ]));

    // Registry not loaded yet
    if(!this.state._lightsReg){
      root.appendChild(el("div",{style:"padding:24px;color:#52b788;font-family:monospace;font-size:13px"},"Loading light registry\u2026"));
      return root;
    }

    // Gather lights from live hass states
    const states  = this._hass?.states || {};
    const regMap  = this.state._lightsReg.areaMap;
    const lights  = Object.keys(states)
      .filter(eid=>eid.startsWith("light."))
      .map(eid=>({
        entity_id:     eid,
        friendly_name: states[eid].attributes?.friendly_name || eid,
        state:         states[eid].state,
        area_name:     regMap[eid]||null,
      }))
      .sort((a,b)=>
        (a.area_name||"\xff").localeCompare(b.area_name||"\xff")||
        a.friendly_name.localeCompare(b.friendly_name));

    if(!lights.length){
      root.appendChild(el("div",{class:"muted",style:"padding:8px"},"No light entities found in Home Assistant."));
      return root;
    }

    lights.forEach((l,i)=>{ l.code=lightCode(i); });

    // ── Map selector ────────────────────────────────────────────────────────
    const maps = this.state.maps.list;
    const active = maps.find(m=>m.id===this.state.activeMapId) || maps[0] || null;

    if(maps.length>1){
      root.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px"},[
        el("span",{class:"muted",style:"font-size:12px"},"Floor plan:"),
        ...maps.map(m=>el("button",{
          class:"btn inline"+(m.id===active?.id?" primary":""),
          onclick:()=>{ this.state.activeMapId=m.id; this._render(); },
        }, m.name||m.id)),
      ]));
    }

    // Group by room
    const byRoom={};
    for(const l of lights){
      if(l.area_name)(byRoom[l.area_name]=byRoom[l.area_name]||[]).push(l);
    }
    const unassigned = lights.filter(l=>!l.area_name);

    // ── Floor-plan + hex overlay ─────────────────────────────────────────────
    const mapCard = el("div",{class:"card",style:"padding:0;overflow:hidden;margin-bottom:16px"});

    if(active?.image?.filename){
      const VW=1000, VH=1000, HEX_R=30;
      const rb = active.room_bounds||{};

      // Room centres from room_bounds (normalised → SVG coords)
      const roomCentre={};
      for(const [room,b] of Object.entries(rb)){
        if(!b) continue;
        if(b.type==="circle"){
          roomCentre[room]={ x:(b.cx??0.5)*VW, y:(b.cy??0.5)*VH };
        } else if(b.type==="poly"&&b.points?.length>=3){
          const pts=b.points;
          roomCentre[room]={
            x:(pts.reduce((s,p)=>s+p[0],0)/pts.length)*VW,
            y:(pts.reduce((s,p)=>s+p[1],0)/pts.length)*VH,
          };
        }
      }

      // Build SVG — hexagons only, clean map
      let svgInner="";
      for(const [room,roomLights] of Object.entries(byRoom)){
        const ctr=roomCentre[room];
        if(!ctr) continue;
        const offsets=hexCluster(roomLights.length, HEX_R);
        roomLights.forEach((l,idx)=>{
          const [dx,dy]=offsets[idx];
          const hx=(ctr.x+dx).toFixed(1);
          const hy=(ctr.y+dy).toFixed(1);
          const on    =l.state==="on";
          const fill  =on?"#fbbf24":"#374151";
          const stroke=on?"#f59e0b":"#4b5563";
          const tCol  =on?"#111827":"#fbbf24";
          svgInner+=
            `<g class="lhex" data-eid="${escSVG(l.entity_id)}" style="cursor:pointer">`+
            `<polygon points="${hexPts(+hx,+hy,HEX_R)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`+
            `<text x="${hx}" y="${hy}" text-anchor="middle" dominant-baseline="middle" `+
            `font-family="monospace" font-size="13" font-weight="700" fill="${tCol}" pointer-events="none">`+
            `${escSVG(l.code)}</text></g>`;
        });
      }

      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:100%";

      const imgEl = document.createElement("img");
      imgEl.src   = `/local/padspan_ha/maps/${active.image.filename}`;
      imgEl.style.cssText = "width:100%;display:block";
      imgEl.alt   = "Floor plan";
      wrap.appendChild(imgEl);

      const svgWrap = document.createElement("div");
      svgWrap.style.cssText = "position:absolute;inset:0;pointer-events:none";
      svgWrap.innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" `+
        `width="100%" height="100%" style="position:absolute;inset:0">${svgInner}</svg>`;
      wrap.appendChild(svgWrap);

      requestAnimationFrame(()=>{
        const svg=svgWrap.querySelector("svg");
        if(!svg) return;
        svg.style.pointerEvents="all";
        svg.querySelectorAll(".lhex").forEach(g=>{
          g.addEventListener("click",e=>{ e.stopPropagation(); this._toggle(g.dataset.eid); });
          g.addEventListener("mouseover",()=>{ g.style.opacity="0.75"; });
          g.addEventListener("mouseout", ()=>{ g.style.opacity="1"; });
        });
      });

      mapCard.appendChild(wrap);
    } else {
      mapCard.style.padding="16px";
      mapCard.appendChild(el("div",{class:"muted"},
        "No floor plan loaded (or no room boundaries drawn). "+
        "Upload a map and draw room bounds in PadSpan HA → Mapping → Edit."));
    }

    root.appendChild(mapCard);

    if(unassigned.length){
      root.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        `${unassigned.length} light(s) not assigned to a room \u2014 shown in index only.`));
    }

    // ── Light index table ────────────────────────────────────────────────────
    root.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#e2e8f0;margin-bottom:6px"},
      `Light Index (${lights.length})`));

    const tbl=el("table",{class:"table",style:"width:100%"});
    tbl.appendChild(el("thead",{},el("tr",{},[
      el("th",{},"Code"),
      el("th",{},"Light"),
      el("th",{},"Room"),
      el("th",{},"State"),
    ])));
    const tbody=el("tbody");
    for(const l of lights){
      const on=l.state==="on";
      tbody.appendChild(el("tr",{style:"cursor:pointer",onclick:()=>this._toggle(l.entity_id)},[
        el("td",{style:"font-family:monospace;font-weight:700;color:#52b788;font-size:12px"},l.code),
        el("td",{},l.friendly_name),
        el("td",{class:"muted"},l.area_name||"\u2014"),
        el("td",{},el("span",{
          style:`display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;`+
                `background:${on?"#fbbf24":"#374151"};color:${on?"#111827":"#fbbf24"}`,
        },on?"ON":"OFF")),
      ]));
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);

    return root;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  _toast(msg, isError=false){
    const t=document.createElement("div");
    t.textContent=msg;
    t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);`+
      `padding:10px 18px;border-radius:8px;font-size:13px;color:#e2e8f0;z-index:9999;`+
      `background:${isError?"#7f1d1d":"#1a3a2a"};`+
      `border:1px solid ${isError?"#dc2626":"#52b788"};`+
      `box-shadow:0 2px 12px rgba(0,0,0,.5);white-space:pre-wrap;max-width:320px;text-align:center`;
    document.body.appendChild(t);
    setTimeout(()=>{ try{document.body.removeChild(t);}catch(_){} },3500);
  }

  // ── Shadow DOM ────────────────────────────────────────────────────────────
  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.style.display="block";
    this.shadowRoot.innerHTML=`
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;
              font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
        #content{padding:16px;max-width:900px;margin:0 auto}
      </style>
      <div id="content"></div>
    `;
    if(this._booted) this._render();
  }

  disconnectedCallback(){
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer=null; }
  }
}

customElements.define("padspan-lights-app", PadSpanLightsApp);
