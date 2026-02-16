# Changelog

## 0.3.2 - 2026-02-16
### Added
- Monorepo package layout for `padspanHA` and `padspan-enterprise`.
- Unified sidebar UI behavior in both web consoles.
- Export/import JSON placeholder for map project (docs + API stubs).
- Enterprise hub API skeleton (FastAPI), receiver protocol outline, mobile app contracts.

### Fixed
- Sidebar toggle race-condition edge case (debounced click + transition guard).
- Incorrect active navigation state when using hash routes.
- Collapsed-state persistence bugs after page refresh.
