# PadSpan Enterprise Architecture (Starter)

## Components
1. **Receivers** (ESP32 / Linux BLE nodes)
   - scan BLE advertisements (passive + active)
   - send observations over MQTT/HTTPS to Hub

2. **Hub Service**
   - observation ingestion
   - device identity merge
   - room fit + distortion model
   - map storage and calibration

3. **Admin Console**
   - fleet management
   - map calibration workflow
   - diagnostics and drift checks

4. **Mobile Apps**
   - setup wizard for new sites
   - walk-to-identify
   - operator diagnostics

## v0.3.2 Notes
- Includes transport contracts and API stubs.
- Sidebar UX baseline shared with padspanHA.
