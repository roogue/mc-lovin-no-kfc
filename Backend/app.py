import base64
import json
import math
import re
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI

app = Flask(__name__)
CORS(app)

# Settings (edit here; nothing is read from the environment)
DEVICE_KEY = ""
REQUIRE_DEVICE_KEY = False  # True: POST /data needs the header X-API-Key: DEVICE_KEY
FIELDS = ("temperature", "humidity", "pressure")
STALE_AFTER = 10
DEFAULT_VALVE_SECONDS = 60
MAX_VALVE_SECONDS = 600

DEEPSEEK_API_KEY = "sk-de105445e21f463a8ae733d50e94e35a"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "DeepSeek-V4-Pro-0813"
SCAN_MIMES = {"image/jpeg", "image/png", "image/webp"}
MAX_SCAN_BYTES = 8 * 1024 * 1024

DISEASE_SCAN_PROMPT = (
    "You are an expert plant pathologist. Examine the uploaded plant image "
    "and return ONLY a JSON object with this exact structure:\n"
    "{\n"
    '  "status": "healthy" | "diseased" | "pest_damage" | "nutrient_deficiency" | "other",\n'
    '  "issue": "short issue name or null if healthy",\n'
    '  "confidence": "low" | "medium" | "high",\n'
    '  "health_percentage": 0 to 100 (estimated overall plant health),\n'
    '  "description": "detailed explanation of visible symptoms or healthy state",\n'
    '  "recommendations": ["step 1", "step 2", "step 3"]\n'
    "}\n"
    "No markdown, no commentary, only valid JSON."
)

ai_client = (
    OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    if DEEPSEEK_API_KEY
    else None
)

sensor = {}
fan_on = False
valve_until = 0.0


def parse_ai_response(text):
    # Models sometimes wrap JSON in ```json fences despite instructions
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    result = json.loads(text)
    if not isinstance(result, dict):
        raise ValueError("expected a JSON object")
    return result


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def relay_state():
    remaining = max(0.0, valve_until - time.time())
    return {"fan": fan_on, "valve": remaining > 0, "valve_remaining": round(remaining)}


def sensor_is_fresh():
    return bool(sensor) and time.time() - sensor["received_at"] < STALE_AFTER


# ---- Overview ----

@app.get("/")
def index():
    return jsonify(
        name="PlantCheck API",
        status="ok",
        sensor_connected=sensor_is_fresh(),
        endpoints={
            "GET /api/sensor": "latest sensor reading",
            "GET /api/relay": "fan and valve state",
            "POST /api/relay": "set fan or valve",
            "POST /data": "device: send a reading" + (" (needs X-API-Key)" if REQUIRE_DEVICE_KEY else ""),
            "GET /status": "device: get relay state",
        },
    )


# ---- ESP SERVER <-> backend (team diagram) ----


@app.post("/data")
def post_data():
    if REQUIRE_DEVICE_KEY and request.headers.get("X-API-Key") != DEVICE_KEY:
        return jsonify(error="unauthorized"), 401
    data = request.get_json(silent=True, force=True)
    if not isinstance(data, dict) or not all(is_number(data.get(k)) for k in FIELDS):
        return jsonify(error="invalid reading"), 400
    sensor.clear()
    sensor.update({k: data[k] for k in FIELDS}, received_at=time.time())
    return jsonify(ok=True)


@app.get("/status")
def get_status():
    s = relay_state()
    return jsonify(fan=s["fan"], valve=s["valve"])


# ---- Frontend <-> backend ----


@app.get("/api/sensor")
def get_sensor():
    if not sensor:
        return jsonify(connected=False)
    age = time.time() - sensor["received_at"]
    return jsonify({**sensor, "age": round(age, 1), "connected": age < STALE_AFTER})


@app.get("/api/relay")
def get_relay():
    return jsonify(relay_state())


@app.post("/api/relay")
def post_relay():
    global fan_on, valve_until
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="invalid json"), 400
    # Only real JSON booleans, so the string "false" can't switch anything on
    for k in ("fan", "valve"):
        if k in data and not isinstance(data[k], bool):
            return jsonify(error=f"{k} must be true or false"), 400
    secs = None
    if data.get("valve") is True:
        try:
            secs = int(data.get("seconds", DEFAULT_VALVE_SECONDS))
        except (TypeError, ValueError):
            return jsonify(error="seconds must be a number"), 400
    # Everything is valid: apply it all at once, so a rejected request changes nothing
    if "fan" in data:
        fan_on = data["fan"]
    if "valve" in data:
        valve_until = (
            time.time() + min(max(secs, 1), MAX_VALVE_SECONDS)
            if secs is not None
            else 0.0
        )
    return jsonify(relay_state())


# ---- Disease scan: image -> DeepSeek -> structured JSON ----


@app.post("/api/disease-scan")
def disease_scan():
    if ai_client is None:
        return jsonify(error="DEEPSEEK_API_KEY is not configured on the server"), 503
    file = request.files.get("image")
    if not file or file.mimetype not in SCAN_MIMES:
        return jsonify(error="image must be a jpeg, png or webp file"), 400
    raw = file.read(MAX_SCAN_BYTES + 1)
    if not raw or len(raw) > MAX_SCAN_BYTES:
        return jsonify(error="image must be between 1 byte and 8 MB"), 400
    b64 = base64.b64encode(raw).decode("ascii")

    try:
        response = ai_client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": DISEASE_SCAN_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{file.mimetype};base64,{b64}"},
                        },
                        {
                            "type": "text",
                            "text": "Analyze this plant image and report any issues using the requested JSON format.",
                        },
                    ],
                },
            ],
            max_tokens=1024,
            timeout=90,
        )
    except Exception:
        app.logger.warning("DeepSeek request failed", exc_info=True)
        return jsonify(error="the analysis service could not process the image"), 502

    try:
        return jsonify(parse_ai_response(response.choices[0].message.content))
    except (ValueError, TypeError, IndexError, AttributeError):
        app.logger.warning("Unparseable DeepSeek reply: %s", response)
        return (
            jsonify(error="the analysis service returned an unexpected response"),
            502,
        )


# Log failed device requests with their body, to debug format mismatches
@app.after_request
def log_device_errors(resp):
    if request.path in ("/data", "/status") and resp.status_code >= 400:
        app.logger.warning(
            "%s %s -> %s | UA=%s | body=%s",
            request.method,
            request.path,
            resp.status_code,
            request.headers.get("User-Agent"),
            request.get_data(as_text=True)[:300],
        )
    return resp


if __name__ == "__main__":
    app.run(host="::", port=9012)
