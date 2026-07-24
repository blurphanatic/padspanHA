#!/usr/bin/env python3
"""Generate the fork explainer diagrams in docs/diagrams/ from one design system.

Four diagrams, one set of tokens (the PadSpan panel visual system:
Inter, dark green-navy #0a150e, green #52b788, teal #5eead4, amber #f59e0b):

  hero.svg          README masthead for the fork
  architecture.svg  advertisement -> floor plan pipeline, fork caps/fast-paths marked
  first-load.svg    the blank-floor-plan fix, before vs after
  lifecycle.svg     presence lifecycle: live -> silence -> away -> resurrection

Self-contained SVG: shapes and <text> only, no scripts, no external refs.
Text uses the Inter stack and falls back to Helvetica/Arial where Inter is
not installed (layout is sized for the widest of the three).

  python3 build.py            # writes all four SVGs
  python3 build.py --png      # also renders 2x PNGs via rsvg-convert
"""
from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent

# ---- design tokens (PadSpan panel system, styles.css / overview.js) --------
BG      = "#0a150e"   # canvas (panel --bg)
INKBG   = "#071008"   # map dot outline / deepest ground
PANEL   = "#0f1a12"   # card surface (--panel)
PANEL2  = "#0c1a0e"   # surface-alt (mono wells)
LINE    = "#1b3526"   # hairline (--line)
LINE2   = "#2d6a4f"   # strong hairline (button borders)
TEXT    = "#e2e8f0"   # headings, strong text
BODY    = "#cbd5e1"   # body text
MUTED   = "#94a3b8"   # secondary text; also the away grey
GREEN   = "#52b788"   # accent: live / high confidence / pass
TEAL    = "#5eead4"   # accent2: scanners, links, upstream
AMBER   = "#f59e0b"   # accent3: FORK changes, medium confidence
RED     = "#f87171"   # low confidence / the failure lane

FONT = "Inter, 'Helvetica Neue', Arial, sans-serif"
MONO = "ui-monospace, Menlo, Consolas, monospace"

R = 8          # card corner radius (panel uses 10-14; 8 reads right at SVG scale)
HAIR = 1       # hairline stroke
EMPH = 1.5     # emphasis stroke


def blend(fg: str, bg: str = BG, a: float = 0.14) -> str:
    """fg at alpha a over bg, precomputed to a flat hex (keeps fills opaque)."""
    f = [int(fg[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(bg[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(bc + a * (fc - bc)):02x}" for fc, bc in zip(f, b))


GREEN_T = blend(GREEN)          # green tint card fill
TEAL_T  = blend(TEAL, a=0.10)
AMBER_T = blend(AMBER, a=0.12)
RED_T   = blend(RED, a=0.10)
GREY_T  = blend(MUTED, a=0.10)


# ---- primitives ------------------------------------------------------------
def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg_open(w: int, h: int) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}" font-family="{esc(FONT)}">')


def canvas(w: int, h: int) -> str:
    return (f'<rect width="{w}" height="{h}" fill="{BG}"/>'
            f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" fill="none" '
            f'stroke="{LINE}" stroke-width="1"/>')


def rect(x, y, w, h, fill=PANEL, stroke=LINE, sw=HAIR, r=R, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    s = f' stroke="{stroke}" stroke-width="{sw}"{d}' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" ry="{r}" fill="{fill}"{s}/>'


def text(x, y, s, size=12, fill=BODY, w=400, anchor="start", ls=None, font=FONT):
    lsa = f' letter-spacing="{ls}"' if ls else ""
    return (f'<text x="{x}" y="{y}" font-family="{esc(font)}" font-size="{size}" '
            f'font-weight="{w}" fill="{fill}" text-anchor="{anchor}"{lsa}>{esc(s)}</text>')


def kicker(x, y, s, fill=TEAL):
    return text(x, y, s.upper(), 10.5, fill, 600, ls=2.2)


def rule(x1, y1, x2, y2, stroke=LINE, sw=HAIR, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{stroke}" stroke-width="{sw}"{d}/>')


def grad_defs() -> str:
    """The sidebar signature: green -> teal -> amber gradient bar."""
    return ('<linearGradient id="padspan" x1="0" y1="0" x2="1" y2="0">'
            f'<stop offset="0" stop-color="{GREEN}"/>'
            f'<stop offset="0.5" stop-color="{TEAL}"/>'
            f'<stop offset="1" stop-color="{AMBER}"/></linearGradient>')


def grad_bar(x, y, w, h=4):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="url(#padspan)"/>'


def marker_defs() -> str:
    def m(mid, color):
        return (f'<marker id="{mid}" viewBox="0 0 10 10" refX="8.5" refY="5" '
                f'markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">'
                f'<path d="M0,1 L9,5 L0,9 z" fill="{color}"/></marker>')
    return ("<defs>" + grad_defs() + m("aTxt", TEXT) + m("aGrn", GREEN) +
            m("aTeal", TEAL) + m("aAmb", AMBER) + m("aRed", RED) +
            m("aMut", MUTED) + "</defs>")


def arrow(x1, y1, x2, y2, color=TEXT, sw=1.4, mk="aTxt"):
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
            f'stroke-width="{sw}" marker-end="url(#{mk})"/>')


def path_arrow(d, color=TEXT, sw=1.4, mk="aTxt"):
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" '
            f'marker-end="url(#{mk})"/>')


def est_w(s: str, size: float, weight: int = 400) -> float:
    """Rough width estimate sized for the widest font in the Inter stack."""
    k = 0.54 if weight < 500 else (0.57 if weight < 700 else 0.60)
    caps = sum(1 for c in s if c.isupper()) / max(len(s), 1)
    return len(s) * size * (k + 0.10 * caps)


def est_mono(s: str, size: float) -> float:
    """Monospace width: fixed advance, sized for the widest stack member."""
    return len(s) * size * 0.62


def pill(cx, cy, s, fill, size=9.5, padx=9, tcol=INKBG):
    w = est_w(s, size, 700) + 2 * padx
    h = size + 8
    return (rect(cx - w / 2, cy - h / 2, w, h, fill, None, 0, r=h / 2) +
            text(cx, cy + size * 0.36, s, size, tcol, 700, anchor="middle", ls=0.5))


def fork_tag(x, y, anchor="start"):
    """The amber FORK marker used at every fork intervention point."""
    w = est_w("FORK", 9, 700) + 14
    xx = x if anchor == "start" else x - w
    return (rect(xx, y - 9, w, 15, AMBER, None, 0, r=3) +
            text(xx + w / 2, y + 2.5, "FORK", 9, INKBG, 700, anchor="middle", ls=1.2))


def numdot(cx, cy, n, color=GREEN, r=10):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" '
            f'stroke-width="1.5"/>' +
            text(cx, cy + 3.8, str(n), 11, color, 700, anchor="middle"))


def radio_arcs(cx, cy, color=TEAL, n=3, r0=9, step=7, sw=1.3, a0=-55, a1=55):
    """Concentric signal arcs opening to the right of (cx, cy)."""
    out = []
    for i in range(n):
        r = r0 + i * step
        x1 = cx + r * math.cos(math.radians(a0))
        y1 = cy + r * math.sin(math.radians(a0))
        x2 = cx + r * math.cos(math.radians(a1))
        y2 = cy + r * math.sin(math.radians(a1))
        op = round(0.9 - i * 0.25, 2)
        out.append(f'<path d="M{x1:.1f},{y1:.1f} A{r},{r} 0 0 1 {x2:.1f},{y2:.1f}" '
                   f'fill="none" stroke="{color}" stroke-width="{sw}" opacity="{op}"/>')
    return "".join(out)


def scanner_glyph(cx, cy, color=TEAL, r=5):
    """Scanner node: solid dot + arcs, as on the maps."""
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}" stroke="{INKBG}" '
            f'stroke-width="1.2"/>' + radio_arcs(cx + 2, cy, color))


def device_dot(cx, cy, color=GREEN, r=8, badge=None, badge_col=None, op=1.0,
               ring=True):
    """Map device dot: dark-stroked circle, optional confidence ring + badge."""
    out = []
    if ring:
        out.append(f'<circle cx="{cx}" cy="{cy}" r="{r + 4}" fill="none" '
                   f'stroke="{color}" stroke-width="1.2" opacity="{op * 0.45:.2f}"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}" '
               f'stroke="{INKBG}" stroke-width="1.6" opacity="{op}"/>')
    if badge:
        bc = badge_col or color
        bw = est_w(badge, 9, 700) + 10
        by = cy - r - 18
        out.append(rect(cx - bw / 2, by, bw, 14, PANEL2, bc, 1, r=7))
        out.append(text(cx, by + 10.5, badge, 9, bc, 700, anchor="middle"))
    return "".join(out)


def signal_bars(x, y, color=GREEN, lit=3, bw=3.5, gap=2.2):
    unlit = blend(MUTED, BG, 0.20)
    out = []
    for i in range(4):
        h = 4 + i * 3.2
        c = color if i < lit else unlit
        out.append(f'<rect x="{x + i * (bw + gap):.1f}" y="{y - h:.1f}" width="{bw}" '
                   f'height="{h:.1f}" rx="1" fill="{c}"/>')
    return "".join(out)


def write(path: Path, parts: list[str]) -> None:
    path.write_text("\n".join(parts) + "\n")
    print(f"wrote {path.name}")


# ---- isometric floor plan (hero motif) -------------------------------------
def iso(u, v, ox, oy, s=1.0):
    """2:1 isometric projection of plan coords (u, v) in px units."""
    return (ox + (u - v) * 0.866 * s, oy + (u + v) * 0.5 * s)


def iso_poly(pts, ox, oy, s, fill, stroke, sw=1.2, dash=None, opacity=None):
    p = " ".join(f"{x:.1f},{y:.1f}" for x, y in (iso(u, v, ox, oy, s) for u, v in pts))
    d = f' stroke-dasharray="{dash}"' if dash else ""
    o = f' opacity="{opacity}"' if opacity else ""
    return (f'<polygon points="{p}" fill="{fill}" stroke="{stroke}" '
            f'stroke-width="{sw}" stroke-linejoin="round"{d}{o}/>')


def iso_floor(ox, oy, s, W=170, D=96, fill=None, rooms=True):
    """One floor slab with a 3-room split, matching the 3D iso map look."""
    fill = fill or blend(GREEN, BG, 0.07)
    e = [iso_poly([(0, 0), (W, 0), (W, D), (0, D)], ox, oy, s, fill, LINE2, 1.3)]
    if rooms:
        # room partitions: one long wall + one cross wall
        wu = round(W * 0.59)
        wv = round(D * 0.54)
        for a, b in (((0, wv), (wu, wv)), ((wu, 0), (wu, D))):
            (x1, y1), (x2, y2) = iso(*a, ox, oy, s), iso(*b, ox, oy, s)
            e.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                     f'stroke="{LINE2}" stroke-width="1" opacity="0.8"/>')
    return "".join(e)


# ===========================================================================
# hero.svg (1200 x 300)  README masthead
# ===========================================================================
def build_hero():
    W, H = 1200, 300
    e = [svg_open(W, H), marker_defs(), canvas(W, H)]

    # ambient glow behind the iso plan
    e.append(f'<circle cx="960" cy="150" r="220" fill="{blend(TEAL, BG, 0.05)}"/>')

    # left: the fork's own brand carries the masthead; the base project gets
    # the kicker credit line. Both marks keep their ™ (PadSpan is Garry's,
    # Ghosthunter is the fork's).
    e.append(grad_bar(58, 40, 190))
    e.append(text(56, 66, "A PADSPAN™ HA BUILD FROM WESTBOURNE", 12.5, TEAL, 600, ls=2.4))
    e.append(
        f'<text x="53" y="130" font-family="Inter, \'Helvetica Neue\', Arial, sans-serif" '
        f'font-size="64" font-weight="800" fill="{AMBER}" letter-spacing="1">GHOSTHUNTER'
        f'<tspan font-size="24" font-weight="700" dy="-28" fill="{TEXT}">™</tspan></text>'
    )
    # scope glyph: an away-grey ghost dot caught in an amber crosshair
    gx = 56 + est_w("GHOSTHUNTER", 64, 800) + 58
    e.append(f'<circle cx="{gx}" cy="106" r="22" fill="none" stroke="{AMBER}" stroke-width="2"/>')
    for dx, dy in ((-30, 0), (30, 0), (0, -30), (0, 30)):
        e.append(f'<line x1="{gx + dx*0.63:.0f}" y1="{106 + dy*0.63:.0f}" x2="{gx + dx:.0f}" '
                 f'y2="{106 + dy:.0f}" stroke="{AMBER}" stroke-width="2"/>')
    e.append(f'<circle cx="{gx}" cy="106" r="8" fill="{MUTED}" opacity="0.75"/>')
    e.append(f'<circle cx="{gx}" cy="106" r="2.5" fill="{INKBG}"/>')
    e.append(text(56, 168, "Room-level BLE presence that hunts ghosts for sport:", 17.5, BODY))
    e.append(text(56, 192, "19,000 phantom devices purged, floor plans instant, event bus untouchable.", 17.5, BODY))

    chips = [("phantoms purged on sight", GREEN),
             ("first paint, every time", TEAL),
             ("away means away", MUTED)]
    cx0 = 56
    for s, c in chips:
        cw = est_w(s, 13.5, 500) + 32
        e.append(rect(cx0, 214, cw, 32, blend(c, BG, 0.10), blend(c, BG, 0.45), 1, r=16))
        e.append(f'<circle cx="{cx0 + 16}" cy="230" r="3.5" fill="{c}"/>')
        e.append(text(cx0 + 27, 235, s, 13.5, TEXT, 500))
        cx0 += cw + 12
    e.append(text(56, 276, "Fork of", 13.5, MUTED))
    rx0 = 56 + est_w("Fork of", 13.5) + 7
    e.append(text(rx0, 276, "gbroeckling/padspanHA", 13.5, TEAL, 600, font=MONO))
    e.append(text(rx0 + est_mono("gbroeckling/padspanHA", 13.5) + 10, 276,
                  "· tracks upstream (0.21.0 WLS merged) · fixes PR'd back",
                  13.5, MUTED))

    # right: two-floor isometric plan with scanners, arcs, and device dots
    s = 1.15
    ox, oy = 990, 76             # upper floor origin; ground floor 64px below
    e.append(iso_floor(ox, oy + 64, s, fill=blend(TEAL, BG, 0.06)))    # ground floor
    e.append(iso_floor(ox, oy, s))                                     # upper floor
    # floor connector posts
    for u, v in ((0, 0), (170, 0), (170, 96), (0, 96)):
        (x1, y1) = iso(u, v, ox, oy, s)
        e.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x1:.1f}" y2="{y1 + 64:.1f}" '
                 f'stroke="{LINE2}" stroke-width="1" opacity="0.5"/>')
    # scanners (teal, with arcs) on the upper floor
    for u, v in ((24, 18), (140, 78)):
        x, y = iso(u, v, ox, oy, s)
        e.append(scanner_glyph(x, y))
    # devices: live green, medium amber, away grey (as the maps draw them)
    x, y = iso(56, 74, ox, oy, s)
    e.append(device_dot(x, y, GREEN, badge="94%"))
    x, y = iso(128, 24, ox, oy, s)
    e.append(device_dot(x, y, AMBER, badge="62%"))
    x, y = iso(120, 70, ox, oy + 64, s)
    e.append(device_dot(x, y, MUTED, badge="away", op=0.55, ring=False))

    e.append("</svg>")
    write(OUT / "hero.svg", e)


# ===========================================================================
# architecture.svg (1200 x 640)  advertisement -> floor plan, fork marks
# ===========================================================================
def build_architecture():
    W, H = 1200, 640
    e = [svg_open(W, H), marker_defs(), canvas(W, H)]

    e.append(kicker(56, 52, "PadSpan HA · resilience fork"))
    e.append(text(56, 86, "From advertisement to floor plan", 26, TEXT, 700))
    e.append(text(56, 112, "The live pipeline, with every place the fork caps, gates, or "
                           "short-circuits it marked in amber.", 12.5, MUTED))
    e.append(grad_bar(56, 126, 220, 3))

    midy = 334

    # -- 1 · sources ---------------------------------------------------------
    sx, sy, sw_, sh = 56, 220, 204, 228
    e.append(rect(sx, sy, sw_, sh, PANEL, LINE2, HAIR))
    e.append(text(sx + 16, sy + 28, "BLE ADVERTISEMENTS", 11.5, TEXT, 600, ls=1.0))
    e.append(rule(sx + 16, sy + 40, sx + sw_ - 16, sy + 40))
    for i, (name, det) in enumerate([("ESPresense", "espresense_mqtt.py"),
                                     ("HA Bluetooth proxy", "bluetooth_live.py"),
                                     ("Bermuda trackers", "resolved-MAC match")]):
        gy = sy + 68 + i * 52
        e.append(scanner_glyph(sx + 30, gy, TEAL, 4))
        e.append(text(sx + 58, gy - 2, name, 11.5, TEXT, 500))
        e.append(text(sx + 58, gy + 13, det, 9.5, MUTED, font=MONO))
    e.append(text(sx + 16, sy + sh - 14, "rotating MACs, IRKs, iBeacons", 9.5, MUTED))
    e.append(arrow(sx + sw_ + 6, midy, sx + sw_ + 34, midy, TEAL, 1.5, "aTeal"))

    # -- 2 · snapshot pipeline ----------------------------------------------
    px, py, pw, ph = 294, 196, 252, 276
    e.append(rect(px, py, pw, ph, PANEL, LINE2, HAIR))
    e.append(text(px + 16, py + 28, "LIVE SNAPSHOT", 11.5, TEXT, 600, ls=1.0))
    e.append(text(px + pw - 16, py + 28, "websocket.py", 9.5, TEAL, 500, anchor="end", font=MONO))
    e.append(rule(px + 16, py + 40, px + pw - 16, py + 40))
    e.append(text(px + 16, py + 62, "adverts enriched, xref'd, and", 11, BODY))
    e.append(text(px + 16, py + 78, "serialized for the panel poll", 11, BODY))
    fy = py + 96
    e.append(rect(px + 14, fy, pw - 28, 104, AMBER_T, AMBER, 1.2))
    e.append(fork_tag(px + 26, fy + 20))
    e.append(text(px + 26, fy + 42, "address history capped at", 10.5, TEXT, 500))
    e.append(text(px + 26, fy + 57, "96 per object", 10.5, AMBER, 700, font=MONO))
    e.append(text(px + 26, fy + 76, "one rotating-MAC phone hit 42k", 9.5, MUTED))
    e.append(text(px + 26, fy + 90, "addresses → ~300MB snapshots", 9.5, MUTED))
    e.append(text(px + 16, py + ph - 32, "poisoned cache entries scrubbed", 10, BODY))
    e.append(text(px + 16, py + ph - 17, "in place at resurrection", 10, BODY))
    e.append(arrow(px + pw + 6, midy, px + pw + 34, midy, TEAL, 1.5, "aTeal"))

    # -- 3 · coordinator -----------------------------------------------------
    cx, cy, cw, ch = 580, 196, 252, 276
    e.append(rect(cx, cy, cw, ch, PANEL, LINE2, HAIR))
    e.append(text(cx + 16, cy + 28, "PRESENCE COORDINATOR", 11.5, TEXT, 600, ls=1.0))
    e.append(text(cx + cw - 16, cy + 28, "5s poll", 9.5, MUTED, 500, anchor="end", font=MONO))
    e.append(rule(cx + 16, cy + 40, cx + cw - 16, cy + 40))
    for i, (t, c) in enumerate([("Kalman RSSI smoothing", BODY),
                                ("k-NN room scoring", BODY),
                                ("WLS multilateration", TEAL)]):
        e.append(text(cx + 16, cy + 64 + i * 19, t, 11, c, 500))
    e.append(text(cx + 16, cy + 64 + 3 * 19, "upstream 0.21.0, merged", 9.5, MUTED))
    fy = cy + 148
    e.append(rect(cx + 14, fy, cw - 28, 96, AMBER_T, AMBER, 1.2))
    e.append(fork_tag(cx + 26, fy + 20))
    e.append(text(cx + 26, fy + 42, "cache-resurrected objects skip", 10.5, TEXT, 500))
    e.append(text(cx + 26, fy + 57, "the heavy pipeline while stale:", 10.5, TEXT, 500))
    e.append(text(cx + 26, fy + 74, "CPU scales with live devices,", 9.5, AMBER, 600))
    e.append(text(cx + 26, fy + 87, "not devices-ever-seen", 9.5, AMBER, 600))
    e.append(text(cx + 16, cy + ch - 14, "no-signal objects: no ghost rooms", 10, BODY))

    # forked outputs
    e.append(path_arrow(f"M{cx+cw+6},{midy} H{cx+cw+22} V236 H{866}", TEAL, 1.5, "aTeal"))
    e.append(path_arrow(f"M{cx+cw+22},{midy} V424 H{866}", TEAL, 1.5, "aTeal"))

    # -- 4a · HA surface -----------------------------------------------------
    hx, hy, hw, hh = 872, 160, 272, 152
    e.append(rect(hx, hy, hw, hh, PANEL, LINE2, HAIR))
    e.append(text(hx + 16, hy + 28, "HOME ASSISTANT SURFACE", 11.5, TEXT, 600, ls=1.0))
    e.append(rule(hx + 16, hy + 40, hx + hw - 16, hy + 40))
    e.append(text(hx + 16, hy + 62, "sensors · device_trackers · events", 10.5, BODY, font=MONO))
    fy = hy + 76
    e.append(rect(hx + 14, fy, hw - 28, 62, AMBER_T, AMBER, 1.2))
    e.append(fork_tag(hx + 26, fy + 18))
    e.append(text(hx + 26, fy + 38, "arrive/depart fire for labelled", 10.5, TEXT, 500))
    e.append(text(hx + 26, fy + 53, "devices only; bus stays under 4096", 10.5, TEXT, 500))

    # -- 4b · panel ----------------------------------------------------------
    qx, qy, qw, qh = 872, 348, 272, 152
    e.append(rect(qx, qy, qw, qh, PANEL, LINE2, HAIR))
    e.append(text(qx + 16, qy + 28, "PANEL · 2D MAP + 3D ISO", 11.5, TEXT, 600, ls=1.0))
    e.append(rule(qx + 16, qy + 40, qx + qw - 16, qy + 40))
    e.append(device_dot(qx + 30, qy + 66, GREEN, 6, ring=False))
    e.append(device_dot(qx + 52, qy + 66, AMBER, 6, ring=False))
    e.append(device_dot(qx + 74, qy + 66, MUTED, 6, ring=False, op=0.6))
    e.append(text(qx + 92, qy + 70, "confidence-colored · explicit away", 10, BODY))
    fy = qy + 84
    e.append(rect(qx + 14, fy, qw - 28, 54, AMBER_T, AMBER, 1.2))
    e.append(fork_tag(qx + 26, fy + 18))
    e.append(text(qx + 26, fy + 36, "map geometry loads first, retries,", 10, TEXT, 500))
    e.append(text(qx + 26, fy + 49, "and self-heals on every poll tick", 10, TEXT, 500))

    # legend
    ly = 540
    e.append(rule(56, ly - 16, W - 56, ly - 16, LINE))
    e.append(rect(56, ly, 12, 12, AMBER, None, 0, r=3))
    e.append(text(76, ly + 10, "fork change (this repo)", 11, BODY))
    e.append(rect(266, ly, 12, 12, TEAL, None, 0, r=3))
    e.append(text(286, ly + 10, "upstream flow · 0.21.0 merged and tracked", 11, BODY))
    e.append(text(W - 56, ly + 10, "fixes are PR'd back upstream", 11, MUTED, anchor="end"))

    e.append("</svg>")
    write(OUT / "architecture.svg", e)


# ===========================================================================
# first-load.svg (1200 x 620)  the blank-floor-plan fix, before vs after
# ===========================================================================
def build_first_load():
    W, H = 1200, 620
    e = [svg_open(W, H), marker_defs(), canvas(W, H)]

    e.append(kicker(56, 52, "First-load resilience"))
    e.append(text(56, 86, "Why the floor plan went blank, and why it can't now", 26, TEXT, 700))
    e.append(text(56, 112, "Geometry is small; the snapshot is not. The fork fetches "
                           "small-and-first, retries, and self-heals.", 12.5, MUTED))
    e.append(grad_bar(56, 126, 220, 3))

    # ---- BEFORE lane ----
    by, bh = 168, 176
    e.append(rect(56, by, W - 112, bh, blend(RED, BG, 0.05), RED, 1.2))
    e.append(pill(132, by + 26, "BEFORE · UPSTREAM", RED, 10, 12))
    lane_y = by + 96
    steps = [
        ("panel entry", None, PANEL, LINE2, 128),
        ("one batched fetch", "snapshot + maps_list + model_get", PANEL, LINE2, 196),
        ("~300MB snapshot", "42,000 addresses on one phone", RED_T, RED, 196),
        ("websocket killed", "maps never arrive", RED_T, RED, 168),
    ]
    x = 88
    for name, det, fill, strk, bw in steps:
        e.append(rect(x, lane_y - 30, bw, 60, fill, strk, 1.1))
        col = RED if strk == RED else TEXT
        e.append(text(x + bw / 2, lane_y - 4 if det else lane_y + 4, name, 11.5, col, 600, anchor="middle"))
        if det:
            e.append(text(x + bw / 2, lane_y + 15, det, 9, MUTED, anchor="middle", font=MONO))
        x += bw + 34
        if x < 940:
            e.append(arrow(x - 30, lane_y, x - 4, lane_y, RED, 1.4, "aRed"))
    # terminal: blank floor plan
    tx = x
    e.append(arrow(tx - 30, lane_y, tx - 4, lane_y, RED, 1.4, "aRed"))
    e.append(rect(tx, lane_y - 44, 178, 88, INKBG, RED, 1.2, dash="5 4"))
    e.append(text(tx + 89, lane_y - 10, "BLANK FLOOR PLAN", 11.5, RED, 700, anchor="middle", ls=0.5))
    e.append(text(tx + 89, lane_y + 8, "nothing re-fetches,", 9.5, MUTED, anchor="middle"))
    e.append(text(tx + 89, lane_y + 22, "live poll never starts", 9.5, MUTED, anchor="middle"))

    # ---- AFTER lane ----
    ay, ah = 376, 196
    e.append(rect(56, ay, W - 112, ah, blend(GREEN, BG, 0.05), GREEN, 1.2))
    e.append(pill(122, ay + 26, "AFTER · FORK", GREEN, 10, 12))
    lane_y = ay + 106
    x = 88
    # step 1
    e.append(rect(x, lane_y - 34, 128, 68, PANEL, LINE2, 1.1))
    e.append(text(x + 64, lane_y + 4, "panel entry", 11.5, TEXT, 600, anchor="middle"))
    x += 128 + 34
    e.append(arrow(x - 30, lane_y, x - 4, lane_y, GREEN, 1.4, "aGrn"))
    # step 2: geometry first
    gw = 232
    e.append(rect(x, lane_y - 44, gw, 88, GREEN_T, GREEN, 1.3))
    e.append(numdot(x + 22, lane_y - 24, 1, GREEN, 9))
    e.append(text(x + 38, lane_y - 20, "geometry first, awaited", 11.5, TEXT, 600))
    e.append(text(x + 16, lane_y + 1, "maps_list + model_get", 10, GREEN, 600, font=MONO))
    e.append(text(x + 16, lane_y + 18, "small · retried · never clobbers", 9.5, MUTED))
    e.append(text(x + 16, lane_y + 32, "a good list with a failure", 9.5, MUTED))
    x += gw + 34
    e.append(arrow(x - 30, lane_y, x - 4, lane_y, GREEN, 1.4, "aGrn"))
    # step 3: map paints
    mw = 158
    e.append(rect(x, lane_y - 44, mw, 88, PANEL, GREEN, 1.3))
    e.append(text(x + mw / 2, lane_y - 22, "floor plan paints", 11.5, GREEN, 700, anchor="middle"))
    # mini plan glyph
    e.append(f'<rect x="{x + 34}" y="{lane_y - 8}" width="90" height="40" rx="3" '
             f'fill="{blend(GREEN, BG, 0.10)}" stroke="{LINE2}" stroke-width="1"/>')
    e.append(rule(x + 74, lane_y - 8, x + 74, lane_y + 32, LINE2))
    e.append(rule(x + 74, lane_y + 14, x + 124, lane_y + 14, LINE2))
    e.append(device_dot(x + 55, lane_y + 12, GREEN, 5, ring=False))
    x += mw + 34
    e.append(arrow(x - 30, lane_y, x - 4, lane_y, GREEN, 1.4, "aGrn"))
    # step 4: snapshot follows
    sw2 = 210
    e.append(rect(x, lane_y - 44, sw2, 88, PANEL, LINE2, 1.1))
    e.append(numdot(x + 22, lane_y - 24, 2, GREEN, 9))
    e.append(text(x + 38, lane_y - 20, "snapshot follows", 11.5, TEXT, 600))
    e.append(text(x + 16, lane_y + 1, "capped: 96 addresses/object", 10, AMBER, 600, font=MONO))
    e.append(text(x + 16, lane_y + 18, "heavyweight payload can no", 9.5, MUTED))
    e.append(text(x + 16, lane_y + 32, "longer take the socket down", 9.5, MUTED))
    x += sw2 + 34
    e.append(arrow(x - 30, lane_y, x - 4, lane_y, GREEN, 1.4, "aGrn"))
    # step 5: poll heals
    pw2 = 206
    e.append(rect(x, lane_y - 44, pw2, 88, PANEL, LINE2, 1.1))
    e.append(numdot(x + 22, lane_y - 24, 3, GREEN, 9))
    e.append(text(x + 38, lane_y - 20, "live poll starts", 11.5, TEXT, 600))
    e.append(text(x + 16, lane_y + 1, "after the first refresh resolves", 9.5, BODY))
    e.append(text(x + 16, lane_y + 18, "every tick re-fetches geometry", 9.5, BODY))
    e.append(text(x + 16, lane_y + 32, "if it is still missing", 9.5, BODY))

    # footer
    e.append(text(56, H - 22, "Three compounding causes, three fixes: payload caps, "
                              "geometry-first ordering, and a poll that starts on first boot "
                              "and heals what a failed fetch left behind.", 11, MUTED))
    e.append("</svg>")
    write(OUT / "first-load.svg", e)


# ===========================================================================
# lifecycle.svg (1200 x 470)  live -> silence -> away -> resurrection
# ===========================================================================
def build_lifecycle():
    W, H = 1200, 470
    e = [svg_open(W, H), marker_defs(), canvas(W, H)]

    e.append(kicker(56, 52, "Presence honesty"))
    e.append(text(56, 86, "The presence lifecycle, with a real away state", 26, TEXT, 700))
    e.append(text(56, 112, "A device that stops advertising becomes visibly away, "
                           "not a stale dot claiming confident room presence.", 12.5, MUTED))
    e.append(grad_bar(56, 126, 220, 3))

    cw, ch, gap = 228, 176, 56
    x0 = 60
    y0 = 178
    cards = [
        ("LIVE", GREEN, GREEN_T,
         ["fresh adverts every poll", "Kalman + k-NN + WLS each tick", "dot colored by confidence"]),
        ("SILENCE", AMBER, AMBER_T,
         ["adverts stop arriving", "last room held for the grace", "window · recency fade on map"]),
        ("AWAY (NO SIGNAL)", MUTED, GREY_T,
         ["after away_timeout (5 min)", "grey dot + away badge on", "both maps · no ghost rooms"]),
        ("RESURRECTION", TEAL, TEAL_T,
         ["seen again from history cache", "returns marked _stale: skips", "the pipeline until fresh signal"]),
    ]
    for i, (name, col, tint, lines) in enumerate(cards):
        x = x0 + i * (cw + gap)
        e.append(rect(x, y0, cw, ch, tint, col, 1.3))
        # glyph row
        gy = y0 + 42
        if i == 0:
            e.append(device_dot(x + 36, gy, GREEN, 9, badge="94%"))
            e.append(signal_bars(x + 62, gy + 8, GREEN, 4))
        elif i == 1:
            e.append(device_dot(x + 36, gy, AMBER, 9, op=0.75))
            e.append(signal_bars(x + 62, gy + 8, AMBER, 1))
        elif i == 2:
            e.append(device_dot(x + 36, gy, MUTED, 9, badge="away", op=0.55, ring=False))
            e.append(signal_bars(x + 62, gy + 8, MUTED, 0))
        else:
            e.append(device_dot(x + 36, gy, TEAL, 9, ring=False, op=0.8))
            e.append(text(x + 58, gy + 4, "_stale", 10, TEAL, 600, font=MONO))
        e.append(text(x + cw - 16, y0 + 30, name, 11.5, col, 700, anchor="end", ls=0.8))
        e.append(rule(x + 16, y0 + 68, x + cw - 16, y0 + 68, blend(col, BG, 0.35)))
        for j, ln in enumerate(lines):
            e.append(text(x + 16, y0 + 92 + j * 18, ln, 10.5, BODY))
        if i < 3:
            mk = ("aAmb", "aMut", "aTeal")[i]
            mcol = (AMBER, MUTED, TEAL)[i]
            e.append(arrow(x + cw + 6, y0 + ch / 2, x + cw + gap - 6, y0 + ch / 2, mcol, 1.5, mk))

    # transition captions between cards (backed with a canvas chip so the
    # caption never strikes through a card border)
    caps = ["silence begins", "grace expires", "adverts resume"]
    for i, c in enumerate(caps):
        xm = x0 + (i + 1) * (cw + gap) - gap / 2
        tw = est_w(c, 9) + 12
        e.append(rect(xm - tw / 2, y0 + ch / 2 - 22, tw, 14, BG, None, 0, r=3))
        e.append(text(xm, y0 + ch / 2 - 12, c, 9, MUTED, anchor="middle"))

    # return loop: resurrection -> live
    lx1 = x0 + 3 * (cw + gap) + cw / 2   # center of card 4
    lx2 = x0 + cw / 2                    # center of card 1
    ly = y0 + ch + 34
    e.append(path_arrow(f"M{lx1},{y0 + ch + 6} V{ly} H{lx2} V{y0 + ch + 10}",
                        GREEN, 1.5, "aGrn"))
    e.append(text((lx1 + lx2) / 2, ly - 8,
                  "fresh signal · full pipeline again · re-entry vote reset works",
                  10, GREEN, 600, anchor="middle"))

    e.append(text(56, H - 24, "Fork behavior: explicit no-signal detection on both maps, and "
                              "resurrection that costs nothing until the device is really back.",
                  11, MUTED))
    e.append(fork_tag(W - 56, H - 28, anchor="end"))
    e.append("</svg>")
    write(OUT / "lifecycle.svg", e)


# ===========================================================================
def render_pngs():
    for t in ("hero", "architecture", "first-load", "lifecycle"):
        svg = OUT / f"{t}.svg"
        png = OUT / f"{t}.png"
        subprocess.run(["rsvg-convert", "-z", "2", str(svg), "-o", str(png)], check=True)
        print(f"rendered {png.name}")


if __name__ == "__main__":
    build_hero()
    build_architecture()
    build_first_load()
    build_lifecycle()
    if "--png" in sys.argv:
        render_pngs()
