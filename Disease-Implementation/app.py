import base64
import json
import os
import re
import uuid

from flask import Flask, render_template, request, send_from_directory, url_for
from openai import OpenAI

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["ALLOWED_EXTENSIONS"] = {"png", "jpg", "jpeg", "webp", "bmp"}
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

DEEPSEEK_API_KEY = "sk-de105445e21f463a8ae733d50e94e35a"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"

client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in app.config["ALLOWED_EXTENSIONS"]
    )


def encode_image(filepath):
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def analyze_plant_image(filepath):
    ext = filepath.rsplit(".", 1)[1].lower()
    mime = "image/jpeg" if ext in {"jpg", "jpeg"} else f"image/{ext}"
    b64_image = encode_image(filepath)

    response = client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
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
                ),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64_image}"},
                    },
                    {
                        "type": "text",
                        "text": "Analyze this plant image and report any issues using the requested JSON format.",
                    },
                ],
            },
        ],
        max_tokens=1024,
    )

    return response.choices[0].message.content


def parse_ai_response(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        file = request.files.get("image")
        if not file or file.filename == "":
            return render_template("index.html", error="No file selected")

        if not allowed_file(file.filename):
            return render_template("index.html", error="Unsupported file type")

        ext = file.filename.rsplit(".", 1)[1].lower()
        filename = f"{uuid.uuid4().hex}.{ext}"
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        try:
            raw = analyze_plant_image(filepath)
            analysis = parse_ai_response(raw)
        except Exception as exc:
            return render_template(
                "index.html",
                error=f"Model analysis failed: {exc}",
                image_url=url_for("uploaded_file", filename=filename),
            )

        return render_template(
            "index.html",
            image_url=url_for("uploaded_file", filename=filename),
            analysis=analysis,
        )

    return render_template("index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8765, debug=True)
