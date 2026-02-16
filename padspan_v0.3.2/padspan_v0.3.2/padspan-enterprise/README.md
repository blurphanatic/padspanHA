# padspan-enterprise v0.3.2

Standalone enterprise stack starter:

- **hub**: BLE ingest + map service API
- **receivers**: edge BLE listeners
- **mobile**: iOS/Android app contracts
- **web-admin**: operations console with a **working sidebar**

## Run hub API (dev)
```bash
cd hub
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8092
```

## Run web admin
Open `web-admin/index.html` in a browser.
