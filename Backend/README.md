# Plant Check API

A small Flask app that sits between Weisen's ESP SERVER and the dashboard. It keeps the latest sensor
reading and the fan / valve state in memory.

```
ESP32 --serial--> ESP SERVER --POST /data, GET /status--> this API <--GET /api/sensor, /api/relay-- dashboard
                                                                     <--POST /api/relay------------ dashboard
```

| Endpoint | Used by | What it does |
|---|---|---|
| `GET /` | Anyone | `{"name": "PlantCheck API", "status": "ok", "sensor_connected": bool, "endpoints": {...}}`; the dashboard's data source menu shows it |
| `POST /data` | ESP SERVER | Stores `{"temperature", "humidity", "pressure"}` (numbers). Needs `X-API-Key: DEVICE_KEY` only when `REQUIRE_DEVICE_KEY=1`. |
| `GET /status` | ESP SERVER | Returns `{"fan": bool, "valve": bool}` |
| `GET /api/sensor` | Dashboard | Latest reading plus `received_at`, `age`, `connected` (false once the reading is 10 s old), or `{"connected": false}` |
| `GET /api/relay` | Dashboard | `{"fan": bool, "valve": bool, "valve_remaining": seconds}` |
| `POST /api/relay` | Dashboard | No key needed. Body `{"fan": bool}`, `{"valve": true, "seconds": N}` (max 600) or `{"valve": false}`. Values must be real JSON booleans. |

## Settings

The settings are constants at the top of `app.py`; edit them there:

- `DEVICE_KEY`: key for the ESP SERVER
- `REQUIRE_DEVICE_KEY`: set to `True` to make `POST /data` require `X-API-Key: DEVICE_KEY`

## On the VPS

The app runs as a systemd service that starts `Backend/app.py` from this repo. After `git pull`, restart the service
so it picks up changes:

```bash
sudo systemctl restart <your-service-name>
```

## Run it locally

```powershell
cd Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1 #windows
source .venv/bin/activate #mac
pip install -r requirements.txt
python app.py
```

It listens on port 9012 (`http://localhost:9012/api/sensor`).
