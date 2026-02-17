# Changelog

## 0.3.10 - 2026-02-16
- Auto-diagnostics added to panel + websocket backend.
- Version updated to 0.3.10.
- Added legacy `padspan` tombstone (config_flow disabled) to avoid duplicate integration listings.

## 0.3.7 - 2026-02-16
- Version label alignment build: package files report v0.3.7.

## 0.3.8 - 2026-02-16
- Hotfix for `Invalid handler specified` during config flow load.
- Simplified `config_flow.py` and `const.py` to reduce import-time failures.

## 0.3.7 - 2026-02-16
- Added sidebar cloud/integration status badges.
- Added sidebar action: Reconnect cloud now.
- Added diagnostics view in panel.
- Added room/object checklist with dynamic tag list.
- Added ALL/ANY room filter mode for tags.
- Kept local-first setup and non-fatal cloud failures.

## 0.3.6 - 2026-02-16
- Removed required API dependency for setup (local-first default).
- Prevented startup crash when `padspan-hub.local` DNS/mDNS lookup fails.
- Added non-fatal cloud degraded mode.
- Added test presence service (`padspan_ha.set_test_presence`).
- Kept sidebar panel working with persistent collapse state.
- Included brand asset pack for Home Assistant brands repository PR.
