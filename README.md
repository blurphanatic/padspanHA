
# PadSpan HA v0.3.22

## Purpose
Diagnostic build to resolve:
- blank sidebar panel
- config flow 500 error
- caching issues

## After installing
Open PadSpan from sidebar and copy the diagnostics block.

## If gear icon fails
Enable logging:

```
logger:
  default: info
  logs:
    custom_components.padspan_ha: debug
```

Then retry and paste logs.
