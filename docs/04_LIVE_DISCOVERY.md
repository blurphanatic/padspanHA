# Live discovery (Sample ↔ Live switch)

## Why a toggle exists
We need two operating modes:
- **Sample**: repeatable UI for development/testing
- **Live**: reflect real BLE environment

The switch lives in the panel header (top-right) so you can quickly compare.

## Live discovery strategy
Live discovery tries to build:
- Rooms list
- Receivers list
- Tags list
- Room↔tag mapping

### Rooms
Use HA Areas registry.

### Receivers (radios)
Best-effort heuristics:
- device names/models with keywords: proxy, ble, bluetooth, receiver, scanner, bermuda
- device has BLE-related entities
- device lives in a known area

### Tags
Bermuda-first heuristics:
- sensors that represent “device is in area/room”
- entity ids with naming patterns: `bermuda`, `room`, `area`, `presence`

## How to make this deterministic
Provide one of:
- a list of receiver entity_ids
- a regex naming convention for receivers
- a list of tag entity_ids (or tag domain)
- which integration is authoritative for tag-room assignment (Bermuda vs something else)

Then we lock the discovery to those patterns.

