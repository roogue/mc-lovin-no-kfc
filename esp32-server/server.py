import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
import requests
import serial
import serial.tools.list_ports

# --- Configuration ---
BAUD_RATE = 115200

BASE_URL = "https://api.putrinaqibah.com"
DATA_URL = f"{BASE_URL}/data"
STATUS_URL = f"{BASE_URL}/status"

STATUS_POLL_INTERVAL = 1.0  # Poll /status every 1 second
REQUEST_TIMEOUT = 2.0       # Max network wait before triggering fallback

# Persistent HTTP session reuses TLS connections to minimize latency
http_session = requests.Session()
http_session.headers.update({"Content-Type": "application/json"})

# Background worker for fire-and-forget POST requests
executor = ThreadPoolExecutor(max_workers=2)

# Hardware IDs for dynamic device identification
KNOWN_VIDS = {
    0x303A: "Espressif (ESP32-S3)",
    0x10C4: "Silicon Labs (CP210x)",
    0x1A86: "WCH (CH340)",
    0x0403: "FTDI",
}


def find_esp_port() -> Optional[str]:
    """Scans connected COM ports and identifies the ESP32."""
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return None

    # 1. Match by known Vendor ID
    for p in ports:
        if p.vid in KNOWN_VIDS:
            return p.device

    # 2. Match by device description keywords
    keywords = ["espressif", "ch340", "cp210", "uart", "jtag", "usb serial"]
    for p in ports:
        desc = (p.description or "").lower()
        mfg = (p.manufacturer or "").lower()
        if any(k in desc or k in mfg for k in keywords):
            return p.device

    # 3. Fallback: single active serial port on the system
    if len(ports) == 1:
        return ports[0].device

    return None


def connect_serial() -> serial.Serial:
    """Blocks and retries until a matching ESP32 is detected and connected."""
    while True:
        port = find_esp_port()
        if port:
            try:
                ser = serial.Serial(port=port, baudrate=BAUD_RATE, timeout=0.1)
                time.sleep(2)  # Wait for ESP32-S3 reset
                ser.reset_input_buffer()
                print(f"[CONNECTED] ESP32 found on {port}. Gateway active...\n")
                return ser
            except (serial.SerialException, OSError) as e:
                print(f"[WAIT] Port {port} busy or not ready: {e}. Retrying in 1.5s...")
        else:
            print("[WAIT] No ESP32 detected. Plug in your device...", end="\r")

        time.sleep(1.5)


def send_telemetry_async(telemetry_data: dict):
    """Fire-and-forget POST to /data in the background pool."""
    def _post():
        try:
            http_session.post(DATA_URL, json=telemetry_data, timeout=REQUEST_TIMEOUT)
        except Exception:
            # Explicitly ignore delivery failures as requested
            pass

    executor.submit(_post)


def fetch_actuator_status() -> dict:
    """Fetch status from /status with strict fallback to False on any failure."""
    fallback_state = {"fan": True, "valve": True}
    try:
        response = http_session.get(STATUS_URL, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            payload = response.json()
            if isinstance(payload, dict) and "fan" in payload and "valve" in payload:
                return {
                    "fan": bool(payload["fan"]),
                    "valve": bool(payload["valve"])
                }
            print("[WARN] Invalid JSON structure from /status. Falling back to OFF.")
        else:
            print(f"[WARN] /status returned HTTP {response.status_code}. Falling back to OFF.")
    except (requests.RequestException, ValueError) as err:
        print(f"[WARN] Server unreachable or bad response ({err.__class__.__name__}). Falling back to OFF.")

    return fallback_state


def run_gateway():
    ser = None
    try:
        ser = connect_serial()
        last_status_check = 0.0

        while True:
            try:
                # 1. Read telemetry from ESP32-S3
                raw_line = ser.readline().decode("utf-8", errors="replace").strip()
                if raw_line:
                    try:
                        sensor_raw = json.loads(raw_line)
                        # Ensure fields exist and are cast to float
                        telemetry = {
                            "temperature": float(sensor_raw["temperature"]),
                            "humidity": float(sensor_raw["humidity"]),
                            "pressure": float(sensor_raw["pressure"])
                        }
                        print(f"[SERIAL RECV] {telemetry}")

                        # Post to /data asynchronously (does not block loop)
                        send_telemetry_async(telemetry)

                    except (json.JSONDecodeError, KeyError, ValueError):
                        # Discard partial serial lines or non-telemetry messages
                        pass

                # 2. Poll /status periodically and send control state to ESP32
                now = time.time()
                if now - last_status_check >= STATUS_POLL_INTERVAL:
                    last_status_check = now

                    actuator_state = fetch_actuator_status()
                    command_line = json.dumps(actuator_state) + "\n"
                    ser.write(command_line.encode("utf-8"))

                    status_str = f"Fan: {'ON' if actuator_state['fan'] else 'OFF'} | Valve: {'ON' if actuator_state['valve'] else 'OFF'}"
                    print(f"[STATUS SENT] -> {status_str}")

            except (serial.SerialException, OSError):
                # Triggered if device is unplugged or COM port resets mid-execution
                print("\n[DISCONNECT] ESP32 disconnected! Re-scanning for COM port...")
                if ser and ser.is_open:
                    try:
                        ser.close()
                    except Exception:
                        pass
                ser = connect_serial()
                last_status_check = 0.0

    except KeyboardInterrupt:
        print("\nShutting down gateway...")
    finally:
        executor.shutdown(wait=False)
        if ser and ser.is_open:
            try:
                # Send emergency shutdown command to hardware before closing port
                emergency_cmd = json.dumps({"fan": False, "valve": False}) + "\n"
                ser.write(emergency_cmd.encode("utf-8"))
                ser.close()
            except Exception:
                pass
        http_session.close()
        print("Resources released. Port closed.")


if __name__ == "__main__":
    run_gateway()