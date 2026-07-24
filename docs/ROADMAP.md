# Roadmap

The Ghosthunter Edition's direction, written against the code as delivered.
Anything listed as delivered has been verified on a live installation;
anything planned is intent, not a promise.

## Delivered in 0.30.0

- Upstream 0.21.0 merged in full: WLS multilateration, per-receiver path-loss
  fits, TX-invariant fingerprints, stale-data gates, poll-scaled silence
  grace with a hard prune cap, pytest CI and the accuracy test suite.
- Configurable retention for untagged device history (Settings, Unidentified
  History Retention; default one hour). Measured effect on the reference
  installation: 19,641 cached objects became 936, a 14MB snapshot became
  1MB, a 17 second poll pipeline became 156ms, and a pinned CPU core became
  21% (settling to 8% idle).
- First-load resilience: map geometry fetched first and awaited, one retry
  that never replaces a valid list, self-healing from the poll loop, polling
  started after the first refresh resolves.
- Event hygiene: arrive and depart bus events for labelled devices only.
- Presence honesty: explicit "Away (no signal)" state on both maps;
  cache-resurrected objects skip the smoothing pipeline until fresh signal.
- Cluster declutter on both maps: spatial-hash grouping into numbered
  glyphs, click-to-spiderfy with leader lines, pair handling, grey all-away
  clusters, middle-truncated labels with full names in hover tips.
- The 2D map lays floors out side by side in named slots instead of
  superimposing them.
- The Ghosthunter identity: masthead and explainer diagrams generated from
  docs/diagrams/build.py, a rewritten README, and an adversarially reviewed
  legal stack (NOTICE.md, LICENSE.ghosthunter.md).

## In progress for 0.31.0

- Mobile control-bar redesign: full-width slider rows with attached value
  chips and touch-sized toggle pills on narrow panels.
- Map text readability: room labels beneath the object layer, halo strokes
  on object and cluster labels.
- Ghost Report: the snapshot now counts identities expired by the retention
  window (per cycle and since restart), surfaced as an Overview tile.
- Documentation consolidated against the delivered code: the duplicate
  architecture, install and troubleshooting docs are merged, and the
  surviving docs no longer describe files or flows that do not exist.

## Planned

- Track the five open upstream pull requests (#49 to #53) and keep merging
  upstream releases; the merge posture is documented in NOTICE.md.
- Mobile polish beyond the control bars: padding in the summary cards at
  the top of the Overview, and a density strategy for followed-device
  labels on the maps at phone widths (they bypass clustering by design and
  can still overlap when zoomed out).
- Soak-test the spiderfy label fallback against naturally occurring live
  clusters (unit-proven; a live cluster had dispersed before the last
  browser check).
- Optional: registration of the Ghosthunter marks at the UK IPO if the
  Edition ever carries commercial weight.
