import json
import random
import time
import serial

SERIAL_PORT = "COM3"  # Change to your actual port (e.g., 'COM4' or '/dev/ttyACM0')
BAUD_RATE = 115200
COMMAND_INTERVAL = 3.0  # Send mock control states every 3 seconds

def run_serial_controller():
    try:
        # Short read timeout ensures loop remains responsive to transmit timers
        ser = serial.Serial(port=SERIAL_PORT, baudrate=BAUD_RATE, timeout=0.1)
        time.sleep(2)  # Allow ESP32-S3 to finish reset
        ser.reset_input_buffer()
        print(f"Connected to {SERIAL_PORT}. Monitoring and sending mock commands...\n")

        last_command_time = time.time()

        while True:
            # 1. Read telemetry incoming from the ESP32-S3
            raw_line = ser.readline().decode("utf-8", errors="replace").strip()
            if raw_line:
                try:
                    telemetry = json.loads(raw_line)
                    temp = telemetry.get("temperature", 0.0)
                    hum = telemetry.get("humidity", 0.0)
                    press = telemetry.get("pressure", 0.0)
                    print(f"[RECV SENSOR] Temp: {temp:>5.2f} °C | Hum: {hum:>5.2f}% | Press: {press:>7.2f} hPa")
                except json.JSONDecodeError:
                    pass

            # 2. Mock trigger: Send random relay states on schedule
            current_time = time.time()
            if current_time - last_command_time >= COMMAND_INTERVAL:
                last_command_time = current_time

                cmd_payload = {
                    "fan": random.choice([True, False]),
                    "valve": random.choice([True, False])
                }
                
                # Serial line must terminate with '\n'
                payload_str = json.dumps(cmd_payload) + "\n"
                ser.write(payload_str.encode("utf-8"))
                print(f"[SENT RELAY ] Fan -> {'ON ' if cmd_payload['fan'] else 'OFF'} | Valve -> {'ON ' if cmd_payload['valve'] else 'OFF'}")

    except serial.SerialException as err:
        print(f"Serial connection error: {err}")
    except KeyboardInterrupt:
        print("\nStopping controller.")
    finally:
        if "ser" in locals() and ser.is_open:
            ser.close()
            print("Port closed.")

if __name__ == "__main__":
    run_serial_controller()