# PadSpan HA — Full Review & Accuracy Improvement Plan (2026-07-15)

Synthesized from a 9-scope multi-agent code review (52 agents; verifier verdicts on all high findings: 28 confirmed, 10 partially-correct, 5 unverified, 0 refuted) plus an end-to-end location-pipeline deep dive. Target version: v0.20.71 (+ commits f43df90, 8bfba39 this session).

**Goal ranking:** everything below is ordered by impact on *exact-location accuracy* first, then correctness, then the rest. Findings the verifier never reached (session limits) are tagged **[unverified]**; partially-correct findings appear only in their corrected form.

---

## 1. Executive summary

The architecture is genuinely good: per-scanner Kalman filtering, an IDW spatial centroid with room-polygon lookup, k-NN fingerprinting in metre space, hysteresis + majority vote + velocity gating, and guarded adaptive learning. But the implementation has drifted from its own documentation in ways that directly cost exactness, and the coordinate estimator is a **weighted average of receiver positions, not multilateration** — a tag can never be placed outside the convex hull of scanners and effectively snaps to the strongest one.

The single biggest accuracy problem is **stale-data poisoning**: the 30 s BLE reseed re-stamps minutes-old scanner-cache readings as 0 s old (bluetooth_live.py:251), the coordinator builds its per-poll RSSI matrix with **no age check** against a 4-hour snapshot window (presence_coordinator.py:471-484, websocket.py:495), and the websocket fallback room assigner has the same defect (websocket.py:2649). A receiver that last heard the tag long ago keeps dragging the position toward where the tag *used to be*, every poll. Fixing this (honest timestamps + a ~30 s age gate) is small effort and the largest single win.

After that, the highest-leverage changes are: **WLS multilateration** seeded by the existing IDW centroid (positions between/outside receivers become possible); **normalizing the k-NN distance metric** (it currently prefers 1-scanner fingerprints over 5-scanner ones — confirmed, one-line class of fix); **median-of-N sampling per poll** (today ~95% of advertisements are discarded) followed by a faster poll; and **per-receiver/per-tag path-loss calibration** using data the code already ingests but never uses (iBeacon measured power, ESPresense rssi@1m and distance, per-scanner OLS fits).

Realistic ceiling: with these fixes plus 3-4 well-placed receivers per floor and per-device TX calibration, **~1-2 m median error is achievable; ~2-4 m is the RSSI norm otherwise**. Instantaneous 5-10 m errors are multipath physics, not bugs. Sub-metre requires UWB or BLE 5.1 AoA hardware — no software change gets there.

Correctness health is weaker than accuracy health: a confirmed config-entry-reload bug **permanently kills the BLE feed until HA restart** (saving options triggers it), the opt-in Random Forest path is corrupted by a bootstrap-index bug, and 29 pre-existing test failures accumulated because no CI runs the suite. websocket.py is a 10,356-line monolith that has absorbed positioning logic that belongs in the coordinator.

---

## 2. Fixed this session (do not re-do)

| What | Where | Commit |
|---|---|---|
| Vote threshold 1-of-2 degeneration → strict majority + deterministic tie-break | presence_coordinator.py | f43df90 |
| `_evict_object` address-keyed Kalman leak (`_ema_rssi`/`_kalman_p`/`_silence_miss` popped by object key, not MAC) + `clear_scanner` now clears `_silence_miss` | presence_coordinator.py | f43df90 |
| `room_confidence` deque-fill denominator (divided by `len(votes)` instead of window size; fresh confirmations no longer report 1.0) | presence_coordinator.py:1525 | f43df90 |
| Adaptive obs: ground-truth corroboration (closes the learn-from-own-choice feedback loop the review flagged at adaptive_store.py:126) | adaptive_store.py / presence_coordinator.py | 8bfba39 |
| Adaptive obs: 2-min dwell gate | 〃 | 8bfba39 |
| Adaptive obs: novelty gate (parked/stationary devices can no longer rewrite a room fingerprint — main mitigation for the confirmed variance-collapse finding at adaptive_store.py:44) | 〃 | 8bfba39 |
| Adaptive obs: per-device normalized fingerprints, schema v2 (resets learned fingerprints on first load; addresses the adaptive-store half of the TX-power train/serve-skew finding) | 〃 | 8bfba39 |
| Adaptive: maturity-scaled tie-break authority | 〃 | 8bfba39 |

Residuals from these findings that remain open: `score_rooms` variance floor of 1.0 dBm² is still too tight and pairs have no staleness expiry (`n` accumulates forever) — see P0-13; k-NN/RF fingerprints are still not per-device normalized — see P0-7.

---

## 3. P0 — Exact-location accuracy upgrades (ordered work plan)

### P0-1. Stop fusing stale readings (age-gate + honest reseed timestamps) — **do this first**
*Merged finding: deep-dive P1 / upgrades #1-#2 + confirmed ble-ingest reseed finding + confirmed coordinator age finding + confirmed websocket fallback-room finding.*
- **Where:** `bluetooth_live.py:251,267-271` (`_seed_from_discovered`), `presence_coordinator.py:471-484` (`addr_src_rssi` build), `websocket.py:495-503` (4 h default window), `websocket.py:2637-2722` (strongest-scanner fallback room).
- **What:** (a) Use the scanner's `discovered_device_timestamps` (habluetooth exposes it; Bermuda uses it) instead of stamping `seen = _now()` on every reseeded cache entry; skip re-stamping when unavailable. (b) In the coordinator, skip advertisements with `age_s` greater than ~3× the poll interval (e.g. 30 s) when building `addr_src_rssi`; keep the 4 h window for the UI object list only. (c) Apply the same recency cutoff in the websocket fallback room assigner — the iBeacon grouping at websocket.py:1256-1264 already uses a 60 s cutoff; this block is the odd one out. (d) Fix the RPA merge keeping the *strongest* RSSI across rotating-MAC generations (presence_coordinator.py:479) — a strong reading from a previous MAC heard hours ago permanently outranks the fresh weaker one; prefer freshest-per-scanner.
- **Why:** Every stale receiver injects its old RSSI into the Kalman, the IDW centroid, and room scoring every poll; the silence-decay mechanism almost never fires for cached-but-stale sources. Position is dragged toward where the tag used to be.
- **Expected gain:** Large — the biggest phantom-error source in the pipeline. **Effort:** small (a, b, c each small; d small).

### P0-2. Exclude 'lost'/'disabled' radios from positioning math
- **Where:** `websocket.py:4500` (ws_radio_lost_set), `:4528` (ws_radio_disabled_set); consumers `websocket.py:2637-2722` (source_to_area) and `presence_coordinator.py:469-484, 507-529`. Verdict: **confirmed** (critical).
- **What:** `lost_radios`/`disabled_radios` are only used to decorate the UI (websocket.py:946-960); both handlers *document* "excluded from location math" but nothing filters them. Filter these sources out of `addr_src_rssi`, `source_to_area`, and the fallback room assigner.
- **Why:** A scanner the user explicitly disabled — moved, bad antenna, taken to another site — keeps voting in every position estimate.
- **Expected gain:** Large in any deployment that has ever marked a radio lost/disabled; zero otherwise. **Effort:** medium.

### P0-3. Normalize the k-NN RSSI distance metric
- **Where:** `calibration_store.py:488` (knn_locate), `:681` (loo_accuracy), `:583-590` (confidence calc). Verdict: **confirmed** (critical).
- **What:** `dist_sq` is an unnormalized sum over shared scanners: a point sharing 5 scanners each off by 5 dB scores 125; a point sharing 1 scanner off by 5 dB scores 55 after the (too-weak) missing-scanner penalty — and wins. Divide by `len(shared)` (mean squared error) before the penalty, in both knn_locate and loo_accuracy; and divide `best_dist_sq` by the best point's *own* shared count (currently the union of top-k sources) in the confidence calc.
- **Why:** Top-k systematically prefers sparse, poorly-observed fingerprints exactly where coverage is good; LOO validation uses the same metric so it can't see the bias.
- **Expected gain:** Large for fingerprint positioning (the default algorithm). **Effort:** small — the reviewer called it "the single highest-leverage accuracy fix in this file".

### P0-4. WLS multilateration on top of the IDW centroid
- **Where:** `presence_coordinator.py:1110-1150`. *Deep-dive upgrade #4 / precision-loss P2.*
- **What:** After computing per-scanner distances, run 2-3 Gauss-Newton iterations minimizing Σwᵢ(‖x−pᵢ‖−dᵢ)², seeded by the current IDW centroid; weights from Kalman covariance `kp` + distance. Room polygon check unchanged. Today `w = 1/(d²+0.01)` with d clamped ≥ 0.3 m gives a ~275:1 weight ratio between a 0.3 m and 5 m scanner — the estimate can never leave the receivers' convex hull and snaps to the strongest receiver; the per-scanner distance estimates are computed and then *not used as constraints*.
- **Expected gain:** Large — "the single biggest exactness win" (deep-dive): positions between/outside receivers become possible. **Effort:** medium.
- **Related [unverified]:** the RF-barrier "correction" subtracts attenuation (`_eff -= _barrier_attenuation(...)`, presence_coordinator.py:1116-1121) where recovering geometric distance requires *adding* it back — the current sign doubles the through-wall distance error and distorts centroid geometry. Flip to `+=` (apply any desired down-weighting as a separate weight factor) while touching this code. The `r_floor` parameter of `_barrier_attenuation` (line 197) is dead. Effort: small.

### P0-5. Median-of-N sampling per poll, then a faster poll
- **Where:** `bluetooth_live.py:210-227` (`_on_adv` keeps only the latest ad per `{addr, source}`), `presence_coordinator.py:469-484`; setting `presence_poll_interval_s` (settings_store.py:77). *Deep-dive upgrades #3 + #10 / P3.*
- **What:** Keep a small timestamped deque per `{addr, source}`; the coordinator takes the median of samples since the last poll before the Kalman. A 1-2 Hz beacon emits 10-20 ads per 10 s window; ~95% are currently discarded with no outlier rejection, and the Kalman runs at 0.1 Hz with an ~80-90 s time constant — simultaneously laggy and undersmoothed. Once median-of-N feeds the filter, drop the poll to 2-5 s.
- **Expected gain:** Large — √N noise reduction on the Kalman input; then medium latency/motion-resolution gains from the faster poll. **Effort:** medium + trivial.

### P0-6. Exclude synthetic (ghost) RSSI from spatial and fingerprint inputs
- **Where:** `presence_coordinator.py:1022` area (decay loop 1013-1025), consumers at 1078 (IDW), 1154 (room scores), 1302 (adaptive), 1339-1341 (k-NN/RF). Verdict: **confirmed**. *Deep-dive upgrade #7 / P6.*
- **What:** Silent sources decay toward −95/−100 via synthetic Kalman measurements and take ~26 polls (~260 s) to reach the −98 prune threshold — the code comment claiming "~7-8 polls" (presence_coordinator.py:120-122) is wrong for a settled filter. During that time the fabricated values compete in room scoring, feed k-NN/RF/adaptive as if live, and pull the IDW centroid. Also: under **total** silence the decay target is −95 (line 1007), *above* the −98 prune threshold, so entries asymptotically approach −95 and are never pruned. Fix: in the IDW/WLS loop and fingerprint/adaptive inputs use only sources with `_miss[src] == 0` (reported this poll); keep decaying values for display only; and either prune on a miss-count cap or set the all-silent target below the prune threshold.
- **Expected gain:** Medium — removes fake measurements from fusion, speeds room switches after fast movement. **Effort:** small-medium.

### P0-7. Per-receiver + per-tag path-loss calibration in positioning
- **Where:** `presence_coordinator.py:1031-1042, 1112-1128` (global ref/n only), `calibration_store.py:386-444` (`fit_path_loss` — display-only, consumed only at websocket.py:5735, and fit in map-fraction units so the intercept is not a physical RSSI@1m), `espresense_mqtt.py:327,336` (rssi@1m and per-node distance ingested, never consumed), `presence_coordinator.py:481-484` (addr_tx_power captured, positioning never uses it). *Deep-dive upgrades #5 + #8 / P4-P5; sub-details [unverified].*
- **What:** (a) Refit `fit_path_loss` in metres (points have x_m/y_m) so `rssi_1m` becomes a true per-receiver reference power; store `{rssi_1m, n}` per source in the model and use per-source fits in the IDW/WLS distance conversion. (b) Substitute the tag's own reference when available — **with validation**: iBeacon measured power (~−59) is a genuine RSSI@1m; BLE AD 0x0A "Tx Power Level" (0 to +12 dBm) is radiated power and must be converted/clamped, never used raw (see P1-2 for the confirmed sensor bug this already causes). (c) Add a guided 1 m reference-calibration flow in the UI: hold a known tag 1 m from each receiver, record median RSSI, auto-write `scanner_offsets` (setter already exists at websocket.py:3402) and per-source `rssi_1m`. Today `scanner_offsets` defaults empty and 5-10 dBm inter-radio variation means 1.6-2.5× distance error per receiver.
- **Expected gain:** Medium-large — distance errors shrink 2-3× per receiver. **Effort:** medium (a, b) + small-medium (c).
- Extend per-device normalization (done for the adaptive store in 8bfba39) to **k-NN/RF fingerprints**: learn a per-device offset or switch to TX-invariant features (pairwise scanner differences / mean-centering) [unverified, effort large — do after a/b/c].

### P0-8. Consume ESPresense's calibrated distance; stop double-filtering its RSSI
- **Where:** `espresense_mqtt.py:327,336` (rssi@1m, `espresense_distance` ingested), `presence_coordinator.py:469-484 / 1110-1150`. *Deep-dive upgrade #6 / P7; [unverified] sub-finding at espresense_mqtt.py:179.*
- **What:** For `espresense_*` sources use `espresense_distance` (node-calibrated, node-filtered) as dᵢ directly instead of re-deriving from RSSI; and since ESPresense RSSI is already node-filtered (module's own doc, line 152), lower Kalman R for those sources or bypass the Kalman stage (optionally ingest the `var` payload field as per-reading R).
- **Expected gain:** Medium — free accuracy for ESPresense nodes; removes added lag on exactly the one-per-room scanners. **Effort:** small.

### P0-9. Spatial room decision: use the smoothed position and add hysteresis
- **Where:** `presence_coordinator.py:1137` (room from raw per-poll IDW centroid), `1197-1201` (spatial candidate bypasses the dBm hysteresis block at 1205-1234), `1447-1455` (EMA applied only afterwards, for display); `model_store.py:584-614` (bare point-in-polygon, no margin). Verdict: **partially-correct — corrected version**: the centroid inputs are Kalman-filtered (so jitter is damped, not raw), but the position-level EMA is bypassed for the room decision; and because the velocity gate relaxes to `vote_threshold` whenever the spatial candidate agrees (`_spatial_confirms_new`, 1587-1593), spatially-driven boundary flapping was possible poll-to-poll at *any* dwell (partly mitigated by the f43df90 vote-threshold fix).
- **What:** Compute the EMA-smoothed position *before* the room lookup and run `beacon_room_from_geometry` on it; add sticky-room hysteresis to the spatial path (require the smoothed point some margin inside the new polygon, or keep the current room while within ~0.5-1 m of the shared boundary).
- **Expected gain:** Medium — eliminates boundary oscillation for devices near room edges. **Effort:** medium.

### P0-10. Replace position EMAs with a 2D constant-velocity Kalman (or α-β) filter
- **Where:** `presence_coordinator.py:1386-1405` (k-NN velocity-aware EMA; alpha 0.03 under 0.8 m freezes sub-metre movement), `1449-1455` (spatial fixed EMA alpha 0.15 ≈ 60 s to converge at 0.1 Hz). *Deep-dive upgrade #9 / P8.*
- **What:** One 2D CV Kalman on x/y with process noise tuned to walking speed (~1.4 m/s); keep hysteresis/vote at the room/presentation layer only (already the case — the vote window is room-level, lines 1498+).
- **Expected gain:** Medium — responsive yet smooth track; fixes both over-damping regimes. **Effort:** medium. Do after P0-5 (faster, cleaner input makes tuning meaningful).

### P0-11. Calibration data quality cluster (garbage-in fixes)
1. **Age-filter the calibration collection loops** — `www/padspan-ha/views/calibration.js:677-686` (_startCollection), `3864-3872` (Beacon Tune timer), `5120-5135` (_guidePoll). Verdict: **confirmed** (critical). All three push the latest snapshot RSSI per scanner once per second with no age filter and keep the *strongest* ad per radio (line 1387), not the freshest — a scanner that last heard the beacon minutes ago (while the user walked over) contributes 15-60 identical location-inconsistent samples to the fingerprint. Filter on `age_s` (perRadio entries already carry it, line 1391) and dedup repeats. Effort: small.
2. **Outlier rejection + minimum sample count on stored points** — `calibration_store.py:124-139`. Verdict: **confirmed**. `mean_rssi` is a plain mean; BLE noise is heavy-tailed (multipath fades drop 15-20 dB), single-sample points are accepted, no std-based quality gate. Use median (or trimmed mean), require a minimum sample count, flag std > ~8 dB. Every downstream consumer inherits this noise. Effort: small.
3. **"Open (no wall)" barriers stored/rendered as 6 dB walls (falsy-zero)** — `www/padspan-ha/views/maps.js:1672` (`_matAtten[mat] || 6` turns 0 into 6; persisted via maps_store.py:299 into rf_barriers_m) and the same `|| 6` coercion throughout radio_map.js (255, 63, 905, 1181, 853, 992, 1137, 1309). Verdict: **confirmed**. Use `?? 6` / explicit null checks; migrate already-persisted open barriers back to 0. Effort: small.

### P0-12. Random Forest: fix or retire (opt-in `positioning_algorithm='rf'` is currently garbage)
Three **confirmed** defects + one gap mean anyone selecting RF gets corrupted room votes silently:
1. **Bootstrap-index bug** — `random_forest.py:323` (fit at 63-69): `node.indices` are positions within the bootstrap sample, but `predict` dereferences them against `self._points` (the original list), so room/map votes come from arbitrary points; points with index ≥ 0.8n can never receive a vote. Fix: store `sample_idx` on the tree and map leaf indices through it (x/y regression is unaffected). Effort: small.
2. **Confidence collapse in metre space** — `random_forest.py:341`: `1/(1+total_var/0.01)` assumes 0-1 fraction coords, but training is in metres whenever ≥4 points have x_m (calibration_store.py:636-641); ±0.5 m tree spread → ~2% confidence, always below `_KNN_LIVE_THRESHOLD` 0.15 (presence_coordinator.py:1364) → RF silently disabled. Scale the reference variance by coordinate space. Effort: small.
3. **Floor-blind** — `random_forest.py:346-362`: one pooled x/y regression across overlapping floors, and `predict` never returns `floor_id`, so the geometry room check (presence_coordinator.py:1367-1373) and metres→frac derivation (1412-1419) never fire for RF results. Mirror knn's dominant-floor handling. Effort: medium.
4. **No validation metric** — `calibration_store.py:650-709` `loo_accuracy` hardcodes k-NN, so the UI reports accuracy for an algorithm not in use and RF failures are invisible [unverified]. Effort: medium.

If RF isn't worth this investment, remove the `rf` option — a broken silent alternative is worse than none.

### P0-13. Adaptive-store residuals (post-8bfba39)
- **Where:** `adaptive_store.py:262` (variance floor 1.0 dBm² in score_rooms), `:107` (`n` accumulates forever; no per-pair timestamp, so `_MIN_PAIR_OBS` gates pass on months-stale stats). From the **confirmed** variance-collapse finding — ingestion side largely fixed this session (novelty/dwell gates), scoring side open.
- **What:** Floor EWMA variance at a realistic room-scale spread (9-16 dBm², not 1.0); add a last-updated timestamp per pair and decay/ignore stale pairs instead of gating on lifetime n.
- **Expected gain:** Small-medium (adaptive is a tie-breaker only). **Effort:** small-medium.

---

## 4. P1 — Confirmed bugs (correctness; not primarily exactness)

1. **Config-entry reload permanently kills the BLE live feed** — `__init__.py:549` (unload tears down bluetooth_live/TagIntegration/ESPresense MQTT at 548-556/531-546, but they are created only in `async_setup`'s `_background_init`, once per HA boot; `async_setup_entry`:433 never re-creates them). The options flow is `OptionsFlowWithReload` (config_flow.py:85), so **saving options** stops all positioning until HA restart: `get_bluetooth_live(hass)` (websocket.py:492) returns None forever. **Confirmed, critical.** Fix: re-create the feeds in setup_entry (or move creation into setup_entry symmetrically). Effort: small. *Related [unverified]: the only option in the flow, CONF_SCAN_INTERVAL, is itself a no-op (config_flow.py:48, stored on a dataclass nothing polls with) — saving a dead setting triggers the kill.*
2. **Distance sensors use BLE AD 0x0A "Tx Power Level" as RSSI@1m** — `sensor.py:64-72` (`ref = float(tx_power)` unclamped, bypassing the [-100, 0] clamp at line 61; sourced from bluetooth_live.py:108-121). A device advertising +4 dBm at rssi −70, n 2.5 → ~912 m. **Confirmed.** Fix: only trust iBeacon measured power as an RSSI@1m reference; clamp; convert AD 0x0A or ignore it. Effort: small. (Same physical-quantity confusion must be avoided in P0-7b.)
3. **ObjectStore→DeviceRegistry startup migration never runs** — `__init__.py:159`: `_init_device_registry` reads `hass.data[DOMAIN].get(DATA_OBJECTS)` but `_init_objects` runs in the *same* `asyncio.gather` batch (194-213) whose results are written to hass.data only after it completes (214-216) — obj_store is always None. User labels never get automatic padspan_ids; stable identity materializes only via the manual websocket call. **Confirmed.** Fix ordering. Effort: small.
4. **MAC-rotation bridging can never bridge non-IRK devices and drops bridges after one cycle** — `websocket.py:1134-1206`: fingerprint cache seeded only from `canonical_by_addr` (line 1166, i.e. already-IRK-resolved addresses that don't need bridging), so AirTag/SmartTag-class devices never enter it; and a fired bridge hits `if cached_entry["addr"] == addr: continue` (1189) which never refreshes `ts`, so the entry purges after `_BRIDGE_STALE_S`=30 s. **Confirmed.** Effort: medium.
5. **Occupancy dwell filter inverted** — `websocket.py:8853,8866-8870`: `dwell_s = age_s` (seconds since last ad, not time present), so actively-advertising phones (age≈0) are always excluded as "dwell too short" and only devices silent 5-10 min are counted; the infrastructure check at 8871 (`dwell_s > 86400`) is unreachable. **Confirmed.** Track first-seen time per address instead. Effort: small.
6. **`ws_settings_set` schema rejects keys its handler supports** — `websocket.py:2745-2812` omits 8 handled keys; corrected scope: 3 have UI paths broken by the schema (`ble_max_age_s` settings.js:928 — this is the stale-ad window control, accuracy-relevant; `occupancy_hybrid_enabled` occupancy.js:175; `occupancy_cluster_threshold` occupancy.js:208 — all fail with a visible "Failed" toast). `scanner_offsets` works via its dedicated command (websocket.py:3388) so that branch is dead; `occupancy_multiplier`/`occupancy_dwell_min` are never sent; `onboarding_completed` (panel.js:2459/2472) and `distance_stationary_devices` (traceback.js:2004) call `ctx.actions.settingsSave`, **which does not exist** (only `settingsSet`, panel.js:1527) — a separate frontend bug schema keys alone won't fix. **Partially-correct → corrected.** Fix: add the schema keys + rename the frontend calls. Effort: small.
7. **`async_clear_map` never persists detached points** — `calibration_store.py:207`: `before != len(points)` compares a list against itself (always False); when all points on a deleted map have x_m, the `map_id=""` mutation isn't saved, coverage isn't invalidated, RF isn't retrained; after restart points reference a deleted map. **Confirmed.** Effort: small.
8. **Re-entry `_stale` flag is dead code** — `presence_coordinator.py:617-632` and the beacon-autocal skip at 1873 read `obj['_stale']`, which nothing ever sets (websocket.py only pops it at 2512/4421). The documented "vote window cleared on re-appearance" never executes. Fix must mark **both** the grace copy and `_known_objs` (setting it only at line 744 revives 1873 but not 617), and should clear `_confirmed_room` on stale re-entry (residual from the corrected room-confidence finding: re-entry retains `_confirmed_room`, letting a first-poll observation be attributed to the stale room). **Confirmed.** Effort: small.
9. **`_smooth_room` crashes when `source_to_floor` is None** — corrected location: `presence_coordinator.py:962` (`source_to_floor.get(_src2, "")` inside the `_scanners_per_floor` loop, 960-964; guards exist at 953/1166/1252/1696 but not here). Production survives because both call sites pass a dict; this one line errors 27 of 28 tests in test_presence_coordinator.py. **Partially-correct → corrected.** Fix: `(source_to_floor or {}).get(...)` or normalize at entry. Effort: one line.
10. **Entity unique_id fragmentation — corrected scope: plain `ble:`-keyed objects only** — `sensor.py:218-220,308-310,387-390`, `device_tracker.py:169-171`. IRK-resolved devices key on stable `irk:<hex>` (private_ble_resolver.py:94, websocket.py:1565), iBeacon/entity keys are stable; the devices that mint `_2`, `_3`… orphan entities and fragment recorder history are labelled rotating phones **without** a registered IRK (bridge cache is in hass.data, lost on restart), random-static MACs, and IRK devices in crypto-unavailable degraded mode. **Partially-correct → corrected.** Fix: derive unique_id from padspan_id/canonical identity where available. Effort: medium.
11. **Guide-capture overlay patch is dead code** — `www/padspan-ha/views/calibration.js:5282`: `_refreshSVGPatched` is never applied (nothing calls it; `_refreshSVG` never reassigned), so the "PLACE HERE" spiral and countdown ring vanish on every refresh after initial assembly. **Confirmed.** Effort: small.
12. **Tune/Beacon Tune transforms omit the `_m` affine branch** — `calibration.js:1590-1604, 2855-2869` lack the raw-affine branch every other view (maps.js:586-610/148-151, overview.js, traceback.js) and the backend (maps_store.py:517-556) apply first; Point-Align-solved maps render the whole slab with the lossy decomposed transform — cross-map placement (1921-1924, 3685-3688), same-floor drags (1837), and the guide marker position (5241-5263, display-only) are wrong. **Partially-correct → corrected.** Fix via P2-5 (shared transform module). Effort: medium.

**High-priority likely bugs the verifier never reached [unverified]** (grep-supported by the reviewer; verify then fix):
- **Lights panel resets `data_mode` to "sample" when hiding a light** — `lights_panel.js:298` sends settings_set without data_mode; backend defaults it to "sample" (websocket.py:2822-2827) → hiding a light flips the integration out of Live mode. Sibling `_saveSettings` (364-370) hardcodes `data_mode:"live"`. Effort: small.
- **`ctx.actions.toast` does not exist** — panel exposes `ctx.toast` (panel.js:1579); health.js (14 sites incl. 317) and overview.js (4 sites) call `ctx.actions.toast` → Retrain RF / Resync Scanners / Reset Spatial Model / Migrate to Fabric / occupancy Train buttons throw mid-flow and stick disabled. Effort: small.
- **"Mark as stationary reference" always fails** — traceback.js:2004 calls nonexistent `settingsSave` + `distance_stationary_devices` missing from schema; the BLE-accuracy (jitter) banner can never populate. Effort: small.
- **`async_recompute_transform_for_map` uses the map's own scale for non-master origins** — model_store.py:1115-1116 vs async_derive_transforms:761-766 (master's scale); replacing a non-master map image silently shifts every metre coordinate derived from it. Directly accuracy-relevant. Effort: small.
- **RF never retrained after `async_remove_scanner` / `async_prune_auto_points`** — calibration_store.py:237-276, 216-235; model keeps serving deleted data. Effort: small.
- **Traceback playback returns oldest-N, not downsampled** — traceback_store.py:165-171 (break makes the downsampling block unreachable); "where was my tag today" silently truncates to the oldest ~11 h. Effort: small.

---

## 5. P2 — Robustness, performance, maintainability

1. **Split the websocket.py monolith (10,356 lines)** [unverified, reviewer proposal]: keep `async_register_websockets` in websocket.py and extract by ownership — `snapshot_pipeline.py` (object build + D1-D7 dedup + strongest-scanner room heuristic, owned by the coordinator), `object_history.py` (7-day cache + Store lifecycle), `rotation_bridge.py`, `occupancy.py` (compute_occupancy_estimate, ~500 lines), then thin handler modules `ws_maps.py`, `ws_calibration.py`, `ws_fabric.py`, `ws_identity.py`. Positioning-critical logic (room assignment, history persistence, bridging) currently lives in the API layer and has already drifted from presence_coordinator.py. Effort: large (mechanical; do incrementally).
2. **`_live_snapshot` rebuilds the entire ~2,300-line pipeline per caller** — websocket.py:461; invoked by the panel poll (5 s per client), the coordinator (10 s), ws_room_tags, beacon profiles, and fabric resync (twice) — ~18 full runs/minute with one dashboard, each including O(radios×devices) bidirectional-substring matching (856-865). **Confirmed.** Add a short-TTL shared snapshot cache (e.g. 2 s). Effort: medium.
3. **TracebackStore rewrites the full 7-day frame buffer (up to 60,480 frames, tens of MB) every 30 s** — traceback_store.py:129-136, driven from the hot snapshot path (websocket.py:3364-3365); ~2,880 full writes/day = severe SD wear. **Confirmed.** Append-only segments or delay-save with dirty-tracking. Effort: medium.
4. **Pure-Python PNG decode/encode on the event loop** — maps_store.py:621 (async_extend_canvas → _extend_png), :699 (_crop_png); per-pixel unfilter loops on a 3000×2000 plan block the loop for seconds on Pi-class hardware, stalling BLE processing and the presence poll (corrected: default 10 s, not 5). **Partially-correct → corrected.** Offload to executor. Effort: small.
5. **Extract one shared map→world transform module** — the stack transform is reimplemented ~12× across maps.js/calibration.js/overview.js/traceback.js with live divergences (calibration.js lacks `_m` entirely; maps.js:5786 mapPt vs :5736 bbPt disagree; `_m_ar` handling differs). **Confirmed.** One JS module + delete copies; fixes P1-12 structurally. Effort: medium.
6. **Timing constants expressed in polls silently retune with `presence_poll_interval_s`** [unverified] — presence_coordinator.py:129 (_AWAY_GRACE_POLLS=12), :1001 (_SILENCE_GRACE), Kalman Q/R per-step, _RELIABILITY_WINDOW; only the vote window converts from seconds. At 60 s polls, away grace = 12 min and filter lag sextuples. Convert to seconds; scale Q with the interval. **Matters for P0-5's faster poll — do together.** Effort: medium.
7. Shorter items [unverified unless noted]: MovementStore bypasses SafeStore + full sync save per room transition (movement_store.py:32,58); IRK reload never clears the negative-resolution cache → new IRKs unresolved up to 20 min (private_ble_resolver.py:77); `async_replace_image` decodes unbounded base64, no PNG validation (maps_store.py:390); whole integration source dir served unauthenticated at /padspan_ha_int (panel.py:79-80) — serve only the icon; diagnostics dumps entry.data unredacted incl. api_key slot (diagnostics.py:24); blocking iterdir in backup handler (websocket.py:6256); fuzzy bidirectional-substring radio→device matching feeds wrong areas into positioning fallback (websocket.py:856-865) — exact-slug match first; per-poll settings/lookup-table rebuilds in _smooth_room (presence_coordinator.py:943-958); panel resize-listener leak (panel.js:479) and modal ESC `{once:true}` (panel.js:1622); follow view claims 5 s updates but renders every 35 s and misses transitions (panel.js:906-919); overview "cheap" poll rebuilds the full iso SVG + client k-NN every 5 s (overview.js:2119); UI poll interval caps at 10 s regardless of setting (panel.js:848); MQTT device handler swallows all exceptions with no per-node diagnostics (espresense_mqtt.py:219); scanner-reliability learning can never activate without spatial fabric (presence_coordinator.py:1644); DeviceRegistry ephemeral cache double-keying halves capacity, TTL constant unused (device_registry.py:38); SafeStore read-back can validate the in-memory cache, not disk (safe_store.py:47).

---

## 6. Test & CI health

Current state: **29 failed / 149 passed** (Python 3.14.3, pytest 9.0.2, 1.5 s). Root causes decompose exactly:
- **No CI runs pytest at all** — only hacs.yml + hassfest.yml; scripts/release.py doesn't run tests either. **Partially-correct → corrected numbers:** test_presence_coordinator.py has 28 tests, 27 fail, 1 passes; the other 2 failures are elsewhere. This is the direct enabler of the pile-up. Fix: a `pytest` GitHub Actions workflow + a test invocation in release.py. Effort: small.
- **27 failures = one production line + one rotted helper.** (a) The unguarded `source_to_floor.get` at presence_coordinator.py:962 (P1-9). (b) `_make_coordinator` (tests/test_presence_coordinator.py:62-77) builds via `__new__` and hand-sets 12 of ~30 `__init__` attributes; first missing is `_silence_miss` (used at line 1008). Fix: construct via real `__init__` with a fake hass (note: the fake DataUpdateCoordinator must still set `coord.hass` — `_smooth_room` reads `self.hass.data` at line 949; drift is bidirectional: the helper sets `_pending_room_changes`, which `__init__` no longer sets). **Partially-correct → corrected.** Effort: small.
- **2 residual failures are genuine behavior drift, not rot** [unverified]: `test_silent_source_decays_toward_minus_100` predates `_SILENCE_GRACE=2`; `test_silent_source_eventually_pruned` asserts an impossibility (all-silent target −95 never crosses the −98 prune — the real defect in P0-6). Update the first; rewrite the second against partial silence + pin the all-silent behavior explicitly.
- **Stale assertions** [unverified]: test_calibration_store.py:155 expects population std, code deliberately uses sample std (N-1) — assert `sqrt(32/7)`; test_config_flow.py:48 expects clamp-to-5, code clamps to 1.
- **No pinned test dependencies** [unverified]: pyproject.toml is 3 lines; pytest-asyncio is an implicit undeclared dependency; a fresh clone/CI runner can't reproduce the suite. Add requirements_test.txt with pins.
- **Zero coverage on accuracy-critical modules** — model_store.py (1,166 lines: transforms, fabric geometry), random_forest.py (contains the confirmed room-vote bug a single test would have caught), bluetooth_live.py, adaptive_store.py, websocket.py. **Confirmed.** Highest-value additions, in order: (1) an end-to-end synthetic positioning test (known scanner positions + synthetic RSSI → assert room + x/y within tolerance) — this pins P0-1/4/6 behavior; (2) reseed-timestamp honesty test (stale cache entry must not reappear as age 0); (3) knn_locate normalization regression (5-shared vs 1-shared fingerprint ordering); (4) RF leaf-index round-trip; (5) ws_settings_set schema ⊇ every key the frontend sends (would have caught P1-6).

---

## 7. Hardware & placement recommendations (deep-dive HARD-LIMITS)

- **Set expectations:** RSSI indoor positioning norms are ~2-4 m median error; ~1-2 m only with 3-4 well-placed receivers per room-cluster, per-device TX calibration, and dense fingerprints. Instantaneous 5-10 m single-reading errors are multipath physics. **Sub-metre is not achievable with RSSI** — that requires UWB (or BLE 5.1 AoA / WiFi FTM) hardware.
- **Body shadowing** at 2.4 GHz costs 5-10 dB (~2-3× distance error) whenever a person is between tag and receiver — no software fix.
- **Receiver count/placement is the gate for any x/y exactness:** the spatial path activates only when ≥3 scanners have fabric positions (presence_coordinator.py:1084); with fewer it silently falls back to nearest-room RSSI scoring. Aim for ≥3 non-collinear receivers per floor, spaced every 4-6 m, in **corners not centers**.
- **Consistent receiver hardware** beats algorithms: ESPresense on ESP32 with decent antennas rather than mixed Shelly passive proxies (5-10 dB RX-gain spread between radio types).
- **Beacons:** ≥2 Hz advertising rate, fixed (non-rotating) MAC or iBeacon UUID.

---

## 8. Dead code & dead settings inventory

**Dead settings (exposed in UI, do nothing):**
- `signal_loss_linger_s` — settable (websocket.py:2953, settings.js:888), read nowhere in the engine. Verified via the corrected away-detection finding. Remove or wire in; also rewrite the presence_coordinator.py:57-67 HOME/AWAY docstring, which misdescribes the actual snapshot-cache mechanism (websocket.py:2274-2404).
- `room_sigma_m` — read into `_sigma` (presence_coordinator.py:1036), never referenced; still exposed (settings.js:1616), validated (websocket.py:2843), and explained to users (qa.js:382). The Gaussian scoring it belonged to no longer exists. [unverified]
- Config-flow `CONF_SCAN_INTERVAL` — stored on a dataclass nothing polls with; real cadence is `presence_poll_interval_s`. Saving it only triggers the P1-1 reload bug. [unverified]
- Vestigial cloud keys `CONF_ENABLE_CLOUD`/`CONF_HUB_URL`/`CONF_API_KEY` hardcoded to False/""/"" (config_flow.py:68-73). [unverified]

**Dead code (confirmed):**
- `transition_prior` (adaptive_store.py:271), `floor_transition_prior` (:191), `floor_confidence` (:290) — recorded via presence_coordinator.py:1626/1695, persisted forever, zero callers. Either wire transition priors into candidate scoring (one of the cheapest anti-impossible-jump wins) or delete all three + the recording calls. The `source_to_area` params of observe()/score_rooms() are also unused.
- `_stale` flag never set anywhere (presence_coordinator.py:617, 1873) — see P1-8.
- Occupancy infrastructure check `dwell_s > 86400` unreachable (websocket.py:8871) — see P1-5.

**Dead code [unverified]:**
- Placeholder modules `api.py`, `cloud.py`, `config.py`, `util.py`, `migrations.py` — license header + "# placeholder" only, nothing imports them; delete.
- `binary_sensor.py` — empty stub in PLATFORMS (__init__.py:68); README advertises binary sensors that don't exist. Implement or drop.
- presence_coordinator.py constants `_OUTDOOR_SCORE_DAMPING`, `_ISOLATED_SCANNER_DAMPING`, `_ISOLATED_SCANNER_STRONG_DBM`, `_VG_RAPID_COOLDOWN_S`, `_ADJACENCY_SIGMOID_MID_M` (143-151); `_scanners_per_floor` built per call, never read; `_elapsed`/`_last_change` in the velocity gate; `_ALERT_COOLDOWN_S` shadowed by a hardcoded 60 (line 2010); unreachable hysteresis else-branch (1233-1234). Module docstring still documents window=5/threshold=3.
- `_barrier_attenuation`'s `r_floor` parameter ignored (presence_coordinator.py:197).
- websocket.py: `_last_receiver_prune` global (3449/3455), unused `now_mono` (8780), `DATA_OBJECTS_CACHE` imported/popped but never set, unused `_math` imports (5659, 5849), `_SAVE_INTERVAL` comment drift (2498).
- maps_store.py: `async_prune_stale_receivers` uncalled and ignores its `known_sources` param (438); normalization dirty-check compares an object to itself (115).
- Frontend: `views/history.js`, `events.js`, `debug.js` unreachable but shipped/downloaded (panel.js:51-58); unused `DEV_ONLY_TABS`/`_staticViews`; `_modelRSSI` dead + model-physics loop inlined 3× (radio_map.js:50); `clearGlobalRange` never called → 3D-stack color range leaks into all later heatmaps (radio_map.js:126); `_refreshSVGPatched` (see P1-11); duplicated `getattr(si, "service_uuids", ...)` operand — advertisement fallback never happens (bluetooth_live.py:69); duplicate COMPANY_IDS key 2 (ble_enrichment.py:79); DeviceRegistry `_EPHEMERAL_TTL_S` unused (device_registry.py:38); `_config_domains` unused (model_store.py:387); `_welford_update` is EWMA, not Welford (adaptive_store.py:93-122) — rename; random_forest min-appearances comment says 20%, code 15% (:226-235), and RF ignores per-point `weight` that knn honors.

---

## 9. Appendix A — Refuted findings

None. The verifier refuted zero findings outright (28 confirmed, 10 partially-correct — included above in corrected form only, 5 unverified). The closest to a refutation was the away-detection headline ("sensors stuck at unknown/home=True forever"), whose core claim was disproved — away detection works for all entity-backed devices via the websocket snapshot cache — and only its narrower sub-claims (dead `signal_loss_linger_s`, wrong docstring, unreachable coordinator grace path) survive, as recorded in sections 4 and 8.

## 10. Appendix B — Unverified findings not covered above

High-priority unverified (verifier hit session limits) are already listed in P1's "[unverified]" block (lights_panel data_mode, ctx.actions.toast, stationary reference, model_store transform inconsistency, RF retrain gaps, traceback oldest-N) and inline throughout P0/P2/section 8. Remaining brief one-liners:

- [unverified] Single-scanner `rssi_margin_confidence` reported as 1.0, the maximum — presence_coordinator.py:1066-1067; overstates certainty exactly when positioning is weakest. Effort: small.
- [unverified] `collected_at` stored but never used — no calibration staleness detection/age weighting (calibration_store.py:150). Effort: medium.
- [unverified] RF frac-fallback mode mixes x_frac targets across different maps — unrelated coordinate systems blended (calibration_store.py:640). Effort: medium.
- [unverified] `fit_path_loss` uses anisotropic map-fraction distances; `rssi_1m` intercept is not dBm-at-1m (calibration_store.py:407-413) — superseded by P0-7a. Effort: medium.
- [unverified] No per-receiver hardware-offset drift detection when a proxy is replaced/re-flashed (calibration_store.py:771). Effort: large.
- [unverified] Fragile substring matching of scanners to receiver pins; last map processed silently wins `path_loss[src]` (calibration_store.py:787-793). Effort: small.
- [unverified] `loo_accuracy` diverges from the runtime knn_locate (ignores weights, skips map/floor filtering) — validation doesn't measure the deployed estimator (calibration_store.py:692). Effort: medium.
- [unverified] Distortion/deformation overlays use different k-NN scoring than the backend they visualize (radio_map.js:505, 1471-1524). Effort: medium.
- [unverified] Hardcoded `MAP_SCALE_M = 15` drives heatmap metre math despite real transforms existing (radio_map.js:35). Effort: medium.
- [unverified] Scanner "quality offset" heuristic measures device proximity, not scanner quality — skews model heatmaps ±20 dB (radio_map.js:1084-1107). Effort: medium.
- [unverified] Roam next-target ignores room polygons — targets void space; 100% coverage unreachable (calibration.js:1457-1471). Effort: small.
- [unverified] Guide capture matches `ad.canonical_id` instead of `ad._xref.canonical_id` — rotating-MAC devices lose samples mid-capture (calibration.js:5127). Effort: small.
- [unverified] Pin & Listen save panel lacks the beacon flow's data-quality warnings (calibration.js:729-808). Effort: small.
- [unverified] `score_rooms` ignores missing-scanner evidence and coverage imbalance (adaptive_store.py:241). Effort: small.
- [unverified] sensor.py lacks device_tracker.py's stale-key re-migration path (sensor.py:110). Effort: small.
- [unverified] Onboarding completion never persists (`this.actions?.settingsSave` undefined + schema gap, panel.js:2458-2472). Effort: small.
- [unverified] Client-side fallback positioning diverges from backend and mislabels its dots (overview.js:1907, 1596-1618). Effort: medium.
- [unverified] Sandbox rows call nonexistent `ctx.actions.navigate`; settings.js references nonexistent `renderView`/`refreshLive` (sandbox.js:87, settings.js:2041/2167). Effort: small.
- [unverified] Pure Live can't be added as an Advanced tab — three drifted allowlist copies (panel.js:145, settings.js:2444, websocket.py:2956). Effort: small.
