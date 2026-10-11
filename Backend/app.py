import json
import math
import os
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Prediction-Training"))
import features as ft  # noqa: E402
import predict as predictor  # noqa: E402

app = Flask(__name__)
CORS(app)

# ---------- settings ----------
DB_PATH = "/root/sensor-api/plantcheck.db"
FIELDS = ("temperature", "humidity", "pressure")
STALE_AFTER = 10            # seconds without a reading = offline
SAVE_EVERY = 10             # save one reading to sensor_readings every 10 seconds
DEFAULT_VALVE_SECONDS = 60
MAX_VALVE_SECONDS = 600

# Disease scan photos are stored in this folder (the "bucket") and served by the API
UPLOAD_DIR = "/root/sensor-api/uploads/disease"
MAX_IMAGE_MB = 10
app.config["MAX_CONTENT_LENGTH"] = MAX_IMAGE_MB * 1024 * 1024

# Precipitation comes from the Google Weather API (same key and location as the dashboard)
GOOGLE_WEATHER_KEY = "PASTE_YOUR_GOOGLE_KEY_HERE"
LATITUDE = 1.5584
LONGITUDE = 110.3456
WEATHER_URL = ("https://weather.googleapis.com/v1/currentConditions:lookup"
               f"?key={GOOGLE_WEATHER_KEY}&location.latitude={LATITUDE}"
               f"&location.longitude={LONGITUDE}&unitsSystem=METRIC")
WEATHER_EVERY = 600         # refresh precipitation every 10 minutes (about 4,300 calls a month)

# How much history the prediction model is given (it needs 6 hours; a little slack avoids edge gaps)
PREDICT_HOURS = 6.5
PREDICT_BUCKET_SECONDS = ft.STEP_MIN * 60

# ---------- state ----------
sensor = {}
fan_on = False
valve_until = 0.0
last_saved = 0.0
precipitation = None
weather = {"updated": None, "error": None}


# ---------- database ----------
def query(sql, params=(), fetch=False):
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()] if fetch else None
        conn.commit()
        return rows if fetch else cur.lastrowid
    finally:
        conn.close()


def init_db():
    query("PRAGMA journal_mode=WAL")
    query("""CREATE TABLE IF NOT EXISTS sensor_readings (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 recorded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 temperature   DECIMAL(5,2),
                 humidity      DECIMAL(5,2),
                 pressure      DECIMAL(7,2),
                 precipitation DECIMAL(6,2))""")
    query("CREATE INDEX IF NOT EXISTS idx_sensor_readings_recorded_at ON sensor_readings(recorded_at)")
    query("""CREATE TABLE IF NOT EXISTS disease_detection (
                 id                INTEGER PRIMARY KEY AUTOINCREMENT,
                 scanned_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 status            VARCHAR(20) NOT NULL,
                 issue             VARCHAR(255),
                 confidence        DECIMAL(5,2),
                 health_percentage INTEGER CHECK (health_percentage BETWEEN 0 AND 100),
                 description       TEXT,
                 recommendations   TEXT,
                 image_path        VARCHAR(255))""")
    query("CREATE INDEX IF NOT EXISTS idx_disease_detection_scanned_at ON disease_detection(scanned_at)")
    # databases created before photos were supported get the new column added
    existing = [r["name"] for r in query("PRAGMA table_info(disease_detection)", fetch=True)]
    if "image_path" not in existing:
        query("ALTER TABLE disease_detection ADD COLUMN image_path VARCHAR(255)")
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def save_reading(reading, now):
    global last_saved
    if now - last_saved < SAVE_EVERY:
        return
    last_saved = now
    try:
        query("""INSERT INTO sensor_readings (temperature, humidity, pressure, precipitation)
                 VALUES (?, ?, ?, ?)""",
              (round(reading["temperature"], 2), round(reading["humidity"], 2),
               round(reading["pressure"], 2), precipitation))
    except sqlite3.Error as e:
        app.logger.warning("could not save reading: %s", e)


# ---------- weather ----------
def weather_loop():
    global precipitation
    while True:
        try:
            with urllib.request.urlopen(WEATHER_URL, timeout=10) as res:
                data = json.load(res)
            qpf = (data.get("precipitation") or {}).get("qpf") or {}
            value = qpf.get("quantity")
            if value is not None and qpf.get("unit") == "INCHES":
                value = float(value) * 25.4
            precipitation = round(float(value), 2) if value is not None else 0.0
            weather.update(updated=utc_text(time.time()), error=None)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            weather["error"] = f"Google Weather API returned {e.code}: {detail}"
            app.logger.warning(weather["error"])
        except Exception as e:
            weather["error"] = f"could not fetch precipitation: {e}"
            app.logger.warning(weather["error"])
        time.sleep(WEATHER_EVERY)


# ---------- helpers ----------
def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def is_connected():
    return bool(sensor) and time.time() - sensor["received_at"] < STALE_AFTER


def relay_state():
    remaining = max(0.0, valve_until - time.time())
    return {"fan": fan_on, "valve": remaining > 0, "valve_remaining": round(remaining)}


def utc_text(ts):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts))


def image_ext(head):
    """Detect the real image type from the first bytes, not from the file name."""
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def image_url(name):
    return f"/api/disease/images/{name}" if name else None


# ---------- routes ----------
@app.get("/")
def index():
    return jsonify(
        name="PlantCheck API",
        status="ok",
        sensor_connected=is_connected(),
        weather={"precipitation": precipitation, **weather},
        endpoints={
            "GET /api/sensor": "latest sensor reading",
            "GET /api/history?hours=24": "saved readings, averaged into time buckets (for charts)",
            "GET /api/readings?hours=24&limit=100&offset=0": "saved readings, newest first (for tables)",
            "GET /api/predict": "forecast for the next hour, from the saved readings",
            "GET /api/disease?limit=20": "saved disease scans, newest first",
            "POST /api/disease": "save a disease scan result",
            "POST /api/disease/<id>/image": "attach a photo to a scan (form field 'image')",
            "GET /api/disease/images/<file>": "a saved scan photo",
            "GET /api/relay": "fan and valve state",
            "POST /api/relay": "set fan or valve",
            "POST /data": "device: send a reading",
            "GET /status": "device: get relay state",
        },
    )


@app.post("/data")
def post_data():
    data = request.get_json(silent=True, force=True)
    if not isinstance(data, dict) or not all(is_number(data.get(k)) for k in FIELDS):
        return jsonify(error="invalid reading"), 400
    now = time.time()
    reading = {k: data[k] for k in FIELDS}
    sensor.clear()
    sensor.update(reading, received_at=now)
    save_reading(reading, now)
    return jsonify(ok=True)


@app.get("/status")
def get_status():
    s = relay_state()
    return jsonify(fan=s["fan"], valve=s["valve"])


@app.get("/api/sensor")
def get_sensor():
    if not sensor:
        return jsonify(connected=False, precipitation=precipitation)
    age = time.time() - sensor["received_at"]
    return jsonify({**sensor, "precipitation": precipitation,
                    "age": round(age, 1), "connected": age < STALE_AFTER})


@app.get("/api/history")
def get_history():
    try:
        hours = float(request.args.get("hours", 24))
        bucket = int(request.args.get("bucket", 0))
    except ValueError:
        return jsonify(error="hours and bucket must be numbers"), 400
    hours = min(max(hours, 0.1), 24 * 365)
    if bucket <= 0:
        bucket = int(hours * 3600 / 300)          # about 300 points per chart
    bucket = min(max(bucket, SAVE_EVERY), 86400)
    since = utc_text(time.time() - hours * 3600)
    rows = query(
        """SELECT CAST(strftime('%s', recorded_at) AS INTEGER) / ? * ? AS t,
                  ROUND(AVG(temperature), 2)   AS temperature,
                  ROUND(AVG(humidity), 2)      AS humidity,
                  ROUND(AVG(pressure), 2)      AS pressure,
                  ROUND(AVG(precipitation), 2) AS precipitation,
                  COUNT(*)                     AS samples
           FROM sensor_readings
           WHERE recorded_at >= ?
           GROUP BY CAST(strftime('%s', recorded_at) AS INTEGER) / ?
           ORDER BY t""",
        (bucket, bucket, since, bucket),
        fetch=True,
    )
    return jsonify(hours=hours, bucket_seconds=bucket, points=rows)


@app.get("/api/readings")
def get_readings():
    try:
        hours = min(max(float(request.args.get("hours", 24)), 0.1), 24 * 365)
        limit = min(max(int(request.args.get("limit", 100)), 1), 1000)
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        return jsonify(error="hours, limit and offset must be numbers"), 400
    since = utc_text(time.time() - hours * 3600)
    total = query("SELECT COUNT(*) AS n FROM sensor_readings WHERE recorded_at >= ?", (since,), fetch=True)[0]["n"]
    rows = query("""SELECT id, recorded_at, temperature, humidity, pressure, precipitation
                    FROM sensor_readings WHERE recorded_at >= ?
                    ORDER BY recorded_at DESC, id DESC LIMIT ? OFFSET ?""",
                 (since, limit, offset), fetch=True)
    return jsonify(hours=hours, total=total, limit=limit, offset=offset, readings=rows)


# Buckets the saved readings the same way /api/history does, so the model always sees evenly spaced
# steps regardless of how often the ESP32 actually reported.
def predict_buckets():
    since = utc_text(time.time() - PREDICT_HOURS * 3600)
    return query(
        """SELECT CAST(strftime('%s', recorded_at) AS INTEGER) / ? * ? AS t,
                  ROUND(AVG(temperature), 2)   AS temperature,
                  ROUND(AVG(humidity), 2)      AS humidity,
                  ROUND(AVG(pressure), 2)      AS pressure,
                  ROUND(AVG(precipitation), 2) AS precipitation
           FROM sensor_readings
           WHERE recorded_at >= ?
           GROUP BY CAST(strftime('%s', recorded_at) AS INTEGER) / ?
           ORDER BY t""",
        (PREDICT_BUCKET_SECONDS, PREDICT_BUCKET_SECONDS, since, PREDICT_BUCKET_SECONDS),
        fetch=True,
    )


@app.get("/api/predict")
def get_predict():
    buckets = predict_buckets()
    if len(buckets) < ft.MIN_ROWS:
        return jsonify(ready=False, needed_minutes=ft.MIN_ROWS * ft.STEP_MIN, have_minutes=len(buckets) * ft.STEP_MIN)

    readings = [{"recorded_at": utc_text(b["t"]), **{k: b[k] for k in ft.COLS}} for b in buckets]
    result = predictor.predict(readings)
    if not result.get("ready"):
        return jsonify(result)

    now_ts = time.time()
    history = [
        {"minutes_ago": round((now_ts - b["t"]) / 60), **{k: b[k] for k in ft.COLS}}
        for b in buckets
    ]
    return jsonify(ready=True, history=history, prediction=result)


@app.get("/api/disease")
def get_disease():
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 500)
    except ValueError:
        return jsonify(error="limit must be a number"), 400
    rows = query("SELECT * FROM disease_detection ORDER BY scanned_at DESC, id DESC LIMIT ?",
                 (limit,), fetch=True)
    for row in rows:
        try:
            row["recommendations"] = json.loads(row["recommendations"])
        except (TypeError, ValueError):
            pass
        row["image_url"] = image_url(row.get("image_path"))
    return jsonify(scans=rows)


@app.post("/api/disease/<int:scan_id>/image")
def upload_disease_image(scan_id):
    upload = request.files.get("image")
    if upload is None:
        return jsonify(error="send the photo as a form field called 'image'"), 400
    data = upload.read()
    if not data:
        return jsonify(error="the photo is empty"), 400
    ext = image_ext(data[:12])
    if ext is None:
        return jsonify(error="only JPEG, PNG or WebP photos are accepted"), 400
    rows = query("SELECT image_path FROM disease_detection WHERE id = ?", (scan_id,), fetch=True)
    if not rows:
        return jsonify(error=f"scan {scan_id} not found"), 404
    name = f"scan-{scan_id}-{uuid.uuid4().hex[:12]}.{ext}"
    with open(os.path.join(UPLOAD_DIR, name), "wb") as out:
        out.write(data)
    query("UPDATE disease_detection SET image_path = ? WHERE id = ?", (name, scan_id))
    old = rows[0]["image_path"]
    if old:
        old_path = os.path.join(UPLOAD_DIR, os.path.basename(old))
        if os.path.exists(old_path):
            os.remove(old_path)
    return jsonify(ok=True, id=scan_id, image_url=image_url(name), bytes=len(data))


@app.get("/api/disease/images/<path:name>")
def disease_image(name):
    return send_from_directory(UPLOAD_DIR, name, max_age=86400)


@app.post("/api/disease")
def post_disease():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        return jsonify(error="invalid json"), 400
    status = d.get("status")
    if not isinstance(status, str) or not status.strip() or len(status) > 20:
        return jsonify(error="status is required (text, max 20 characters)"), 400
    issue = d.get("issue")
    if issue is not None and (not isinstance(issue, str) or len(issue) > 255):
        return jsonify(error="issue must be text, max 255 characters"), 400
    confidence = d.get("confidence")
    if confidence is not None and not (is_number(confidence) or
                                       (isinstance(confidence, str) and len(confidence) <= 20)):
        return jsonify(error="confidence must be a number or short text"), 400
    health = d.get("health_percentage")
    if health is not None and (not isinstance(health, int) or isinstance(health, bool)
                               or not 0 <= health <= 100):
        return jsonify(error="health_percentage must be a whole number from 0 to 100"), 400
    description = d.get("description")
    if description is not None and not isinstance(description, str):
        return jsonify(error="description must be text"), 400
    recs = d.get("recommendations")
    if recs is not None and not isinstance(recs, str):
        recs = json.dumps(recs)
    new_id = query("""INSERT INTO disease_detection
                          (status, issue, confidence, health_percentage, description, recommendations)
                      VALUES (?, ?, ?, ?, ?, ?)""",
                   (status.strip(), issue, confidence, health, description, recs))
    return jsonify(ok=True, id=new_id)


@app.get("/api/relay")
def get_relay():
    return jsonify(relay_state())


@app.post("/api/relay")
def post_relay():
    global fan_on, valve_until
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="invalid json"), 400
    for k in ("fan", "valve"):
        if k in data and not isinstance(data[k], bool):
            return jsonify(error=f"{k} must be true or false"), 400
    if "fan" in data:
        fan_on = data["fan"]
    if "valve" in data:
        if data["valve"]:
            try:
                secs = int(data.get("seconds", DEFAULT_VALVE_SECONDS))
            except (TypeError, ValueError):
                return jsonify(error="seconds must be a number"), 400
            valve_until = time.time() + min(max(secs, 1), MAX_VALVE_SECONDS)
        else:
            valve_until = 0.0
    return jsonify(relay_state())


@app.errorhandler(413)
def too_large(e):
    return jsonify(error=f"the photo is too large (max {MAX_IMAGE_MB} MB)"), 413


@app.errorhandler(404)
def not_found(e):
    return jsonify(error="not found", path=request.path), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify(error="method not allowed", path=request.path), 405


init_db()
threading.Thread(target=weather_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host="::", port=9012)
