# Plant Check API

A Flask app that sits between Weisen's ESP SERVER and the dashboard. It saves every sensor reading to a
SQLite database (`plantcheck.db`) and keeps the fan / valve state and the latest reading in memory.

```
ESP32 --serial--> ESP SERVER --POST /data, GET /status--> this API <--GET /api/sensor, /api/relay-- dashboard
                                                                     <--POST /api/relay------------ dashboard
                                                     (sensor_readings table)
```

| Endpoint | Used by | What it does |
|---|---|---|
| `GET /` | Anyone | `{"name": "PlantCheck API", "status": "ok", "sensor_connected": bool, "weather": {...}, "endpoints": {...}}`; the dashboard's data source menu shows it |
| `POST /data` | ESP SERVER | Stores `{"temperature", "humidity", "pressure"}` (numbers); saves a row to `sensor_readings` at most once every `SAVE_EVERY` seconds |
| `GET /status` | ESP SERVER | Returns `{"fan": bool, "valve": bool}` |
| `GET /api/sensor` | Dashboard | Latest reading plus `precipitation`, `age`, `connected` (false once the reading is 10 s old), or `{"connected": false}` |
| `GET /api/history?hours=24` | Monitoring history, report | Saved readings averaged into time buckets: `{hours, bucket_seconds, points: [{t, temperature, humidity, pressure, precipitation, samples}]}` |
| `GET /api/readings?hours=24&limit=100&offset=0` | Monitoring history table | Saved readings newest first: `{hours, total, limit, offset, readings: [...]}` |
| `GET /api/predict` | Prediction page | Forecast for the next hour, run on the last ~6.5 h of saved readings (see below) |
| `GET /api/disease?limit=20` | Disease page | Saved scans newest first, each with `image_url` |
| `POST /api/disease` | Disease page | Saves one scan result |
| `POST /api/disease/<id>/image` | Disease page | Attaches a photo (form field `image`, JPEG/PNG/WebP, max 10 MB) |
| `GET /api/disease/images/<file>` | Disease page | Serves a saved scan photo |
| `GET /api/relay` | Dashboard | `{"fan": bool, "valve": bool, "valve_remaining": seconds}` |
| `POST /api/relay` | Dashboard | No key needed. Body `{"fan": bool}`, `{"valve": true, "seconds": N}` (max 600) or `{"valve": false}`. Values must be real JSON booleans. |

## Prediction (`GET /api/predict`)

Buckets `sensor_readings` the same way `/api/history` does (10-minute steps, same as training), feeds
them to `Prediction-Training/predict.py` (loads `model.joblib`), and returns:

```json
{"ready": true, "history": [{"minutes_ago": 390, "temperature": 26.6, ...}, ...],
 "prediction": {"temperature": 28.1, "humidity": 72.8, "precipitation": 0.0,
                "stress_probability": 0.98, "horizon_minutes": 60, "stress_window_minutes": 180}}
```

Until there's about 6 hours of saved readings it answers `{"ready": false, "needed_minutes": N, "have_minutes": N}`
instead. This needs `Prediction-Training/` to sit next to `Backend/` (same as in this repo) with
`model.joblib` present — run `Prediction-Training/training.py` to produce it if it's missing.

## Settings

The settings are constants at the top of `app.py`; edit them there:

- `DB_PATH`: where `plantcheck.db` lives
- `GOOGLE_WEATHER_KEY`, `LATITUDE`, `LONGITUDE`: precipitation comes from the Google Weather API
- `UPLOAD_DIR`: where disease-scan photos are saved

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
