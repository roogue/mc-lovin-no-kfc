"""
ESP SERVER: bridge between the ESP32 (USB serial) and the PlantCheck API.

  ESP32 --serial--> this script --POST /data-->  api.putrinaqibah.com
  ESP32 <--serial-- this script <--GET /status-- api.putrinaqibah.com

Run:
  pip install pyserial requests
  python server.py
"""

import json
import time

import requests
import serial

SERIAL_PORT = "COM3"
BAUD_RATE = 115200
API = "https://api.putrinaqibah.com"
DEVICE_KEY = ""
HEADERS = {"X-API-Key": DEVICE_KEY} if DEVICE_KEY else {}
POLL_EVERY = 1.0          # seconds between GET /status calls
FIELDS = ("temperature", "humidity", "pressure")

session = requests.Session()
_last_message = None


def report(message):
    """Print a status message, but don't repeat the same one every second."""
    global _last_message
    if message != _last_message:
        print(message)
        _last_message = message


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def read_newest_reading(ser, buf):
    """Read everything waiting on serial. Returns (newest valid reading or None, leftover bytes)."""
    buf += ser.read(ser.in_waiting or 1)
    *lines, buf = buf.split(b"\n")
    if len(buf) > 4096:
        buf = b""

    newest = None
    for raw in lines:
        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            continue                       # boot noise, or 'nan' when the BME280 is missing
        if not isinstance(msg, dict):
            continue
        if "error" in msg:
            report(f"[ESP32] {msg['error']}")
            continue
        if all(is_number(msg.get(k)) for k in FIELDS):
            newest = {k: msg[k] for k in FIELDS}
    return newest, buf


def post_reading(reading):
    try:
        r = session.post(f"{API}/data", json=reading, headers=HEADERS, timeout=3)
        if r.status_code == 200:
            report("[API] sending readings OK")
        else:
            report(f"[API] POST /data returned {r.status_code}: {r.text[:200]}")
    except requests.RequestException as e:
        report(f"[API] POST /data failed, will retry: {e}")


def poll_status(ser, last_relay):
    """Get the wanted fan/valve state and write it to the ESP32. Returns the state sent."""
    try:
        r = session.get(f"{API}/status", headers=HEADERS, timeout=3)
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError) as e:
        report(f"[API] GET /status failed, will retry: {e}")
        return last_relay

    desired = {"fan": bool(data.get("fan")), "valve": bool(data.get("valve"))}
    ser.write((json.dumps(desired) + "\n").encode("utf-8"))  # every poll, not only on change
    if desired != last_relay:
        fan = "ON " if desired["fan"] else "OFF"
        valve = "ON " if desired["valve"] else "OFF"
        print(f"[RELAY] Fan -> {fan} | Valve -> {valve}")
    return desired


def bridge(ser):
    buf = b""
    last_poll = 0.0
    last_relay = None
    while True:
        reading, buf = read_newest_reading(ser, buf)
        if reading:
            print(f"[SENSOR] Temp: {reading['temperature']:>5.2f} °C | "
                  f"Hum: {reading['humidity']:>5.2f}% | Press: {reading['pressure']:>7.2f} hPa")
            post_reading(reading)

        now = time.time()
        if now - last_poll >= POLL_EVERY:
            last_poll = now
            last_relay = poll_status(ser, last_relay)


def main():
    print(f"API: {API}  |  serial: {SERIAL_PORT}  |  device key: {'set' if DEVICE_KEY else 'not set'}")
    while True:  # keep reconnecting if the USB cable is pulled
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=0.1) as ser:
                time.sleep(2)              # let the ESP32 finish resetting
                ser.reset_input_buffer()
                print(f"Connected to {SERIAL_PORT}")
                bridge(ser)
        except (serial.SerialException, OSError) as e:
            report(f"[SERIAL] {e}. Retrying in 3 s...")
            time.sleep(3)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")