/*
 * Live temperature + humidity for the Temperature / Humidity cards and Automate mode.
 *
 * Set SENSOR_CONFIG.url in index.html to an endpoint that returns the ESP32 telemetry JSON,
 * e.g. {"temperature": 31.2, "humidity": 74.5, "pressure": 1008.2}. It is polled every few seconds.
 * Without a URL, a demo feed drifts through Kuching-like readings so Automate has something to react to.
 *
 * Fires a 'sensor:update' event with { temperature, humidity, demo }.
 * Other code can push readings directly with PlantSensors.push({ temperature, humidity }).
 */
(function () {
  'use strict';

  const CONFIG = window.SENSOR_CONFIG || {};
  const SOURCE_URL = String(CONFIG.url || '').trim();
  const INTERVAL_MS = Math.max(2, Number(CONFIG.intervalSeconds) || 5) * 1000;

  const els = {
    tempValue: document.getElementById('temp-value'),
    tempSub: document.getElementById('temp-sub'),
    humValue: document.getElementById('humidity-value'),
    humSub: document.getElementById('humidity-sub'),
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // Dew point in °C (Magnus formula)
  function dewPoint(t, rh) {
    const a = 17.62;
    const b = 243.12;
    const g = Math.log(Math.max(rh, 1) / 100) + (a * t) / (b + t);
    return (b * g) / (a - g);
  }

  // "Feels like" in °C using the NOAA heat index; only applies when it's warm
  function feelsLike(t, rh) {
    if (t < 27) return t;
    const f = (t * 9) / 5 + 32;
    const hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh
      - 0.00683783 * f * f - 0.05481717 * rh * rh + 0.00122874 * f * f * rh
      + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh;
    return ((hi - 32) * 5) / 9;
  }

  function push({ temperature, humidity, demo = false }) {
    const t = Number(temperature);
    const h = clamp(Number(humidity), 0, 100);
    if (!Number.isFinite(t) || !Number.isFinite(h)) return;

    if (els.tempValue) {
      els.tempValue.textContent = `${Math.round(t)}°C`;
      els.tempSub.textContent = `Feels like ${feelsLike(t, h).toFixed(1)}°C`;
    }
    if (els.humValue) {
      els.humValue.textContent = `${Math.round(h)}%`;
      els.humSub.textContent = `Dew point ${dewPoint(t, h).toFixed(1)}°C`;
    }

    document.dispatchEvent(new CustomEvent('sensor:update', { detail: { temperature: t, humidity: h, demo } }));
  }

  // Demo feed: slow waves plus a little noise, crossing the Automate thresholds every couple of minutes
  const started = Date.now();
  function demoReading() {
    const s = (Date.now() - started) / 1000;
    return {
      temperature: 31.3 + 2.4 * Math.sin((s * 2 * Math.PI) / 150) + (Math.random() - 0.5) * 0.3,
      humidity: 72 + 11 * Math.sin((s * 2 * Math.PI) / 110 + 1.2) + (Math.random() - 0.5) * 1.5,
      demo: true,
    };
  }

  async function poll() {
    try {
      const res = await fetch(SOURCE_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      push(await res.json());
    } catch (err) {
      console.warn('Sensor reading failed:', err);
    }
  }

  const tick = SOURCE_URL ? poll : () => push(demoReading());
  tick();
  setInterval(tick, INTERVAL_MS);

  window.PlantSensors = { push };
})();
