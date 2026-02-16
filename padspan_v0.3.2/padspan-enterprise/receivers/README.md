# Receiver Firmware Contract (v0.3.2)

Receivers emit JSON batches:

```json
{
  "receiver_id": "rx-01",
  "site_id": "site-001",
  "items": [
    {"mac":"AA:BB:CC:DD:EE:FF","rssi":-66,"tx_power":-4,"ts_utc":"2026-02-16T20:00:00Z"}
  ]
}
```

Transport:
- Primary: MQTT (`padspan/<site_id>/observations`)
- Fallback: HTTPS POST `/api/v1/observations`
