# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Reporting a Vulnerability

If you find a security issue in PadSpan HA, **please do not open a public GitHub issue.**

Instead, report it privately:

1. Go to the [Security Advisories](https://github.com/gbroeckling/padspanHA/security/advisories) page
2. Click **"Report a vulnerability"**
3. Describe the issue and how to reproduce it

You should receive a response within 7 days. If the issue is confirmed, a fix will be released as soon as practical and you will be credited in the changelog (unless you prefer to remain anonymous).

## What Counts as a Security Issue

- XSS or injection vulnerabilities in the frontend panel
- Path traversal in file operations (map uploads, etc.)
- Authentication bypass on WebSocket handlers
- Exposure of sensitive data (API keys, credentials, private BLE IRKs)

## What Doesn't Count

- Issues that require physical access to the Home Assistant instance
- Denial of service against a local-only integration
- Bugs that don't have a security impact

## Security Measures Already in Place

- All user-controlled strings are escaped before SVG/HTML rendering
- Destructive WebSocket handlers require HA admin privileges
- Map uploads are size-limited (20 MB) with path traversal protection
- BLE IRK data stays local — never sent to external services
