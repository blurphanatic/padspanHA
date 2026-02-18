# Contributing to PadSpan HA

Thanks for helping!

## Dev quickstart
- Use Home Assistant OS or Container with `/config/custom_components/padspan_ha/` mapped.
- Copy `custom_components/padspan_ha` into your HA instance.
- Restart HA after backend changes.
- Hard refresh browser after UI changes.

## PRs
- Keep changes minimal and reversible.
- Prefer WebSocket calls over custom HTTP endpoints.
- Avoid adding optional dependencies unless required.
