# Room/Tag Checklist Behavior (v0.3.7)

The panel includes an **Objects by Rooms** view.

## How it works
1. Select one or more rooms via checkboxes.
2. The tag list recalculates from selected rooms.

## Modes
- **ALL selected rooms** (default): intersection of tags found in every selected room.
- **ANY selected room**: union of tags found in at least one selected room.

## Notes
- In local-only mode, demo room/tag data is supplied so UI testing works immediately.
- If cloud payload includes `room` + `tag` fields, those values replace demo values.
