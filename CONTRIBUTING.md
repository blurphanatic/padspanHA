# Contributing

Ghosthunter Edition is a personal build of
[gbroeckling/padspanHA](https://github.com/gbroeckling/padspanHA). Pull
requests and issues are welcome.

Before opening a PR, install the test dependencies with
`pip install -r requirements_test.txt` and check that
`python -m pytest tests -q` passes. Frontend changes should also pass
`node --check` and be tested in a browser against a running Home Assistant
instance.
