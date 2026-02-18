# Bermuda Live Discovery Notes

Bermuda is a common backbone for BLE receiver/tag systems in HA.

We attempt a robust, low-assumption integration:

- Prefer entities/devices owned by Bermuda config entries.
- Treat any entity whose **state equals an Area name** as a tag currently in that room.
- Radios are (a) Bermuda-owned devices, or (b) devices whose metadata suggests BLE/proxy/receiver.

This is intentionally best-effort and should never crash HA even if Bermuda is missing.
As we learn your exact entity patterns, we can tighten these heuristics.
