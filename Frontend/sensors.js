/*
 * Live temperature + humidity for the Temperature / Humidity cards and Automate mode.
 *
 * Set SENSOR_CONFIG.url in index.html to an endpoint that returns the ESP32 telemetry JSON,
 * e.g. {"temperature": 31.2, "humidity": 74.5, "pressure": 1008.2}. It is polled every few seconds.
 * Without a URL, a demo feed drifts through Kuching-like readings so Automate has something to react to.
 *
 * Data source (chosen on the simulation page, the remote control; remembered in localStorage):
 *   'live'       – polls GET /api/sensor (and GET /api/relay) on the backend every API_CONFIG.pollSeconds.
 *                  Uses the API's own "connected" flag; no reading / unreachable server → cards go empty.
 *   'sample'     – the demo feed (or SENSOR_CONFIG.url); nothing from the backend or the simulation.
 *   'simulation' – same as live, but answered by the simulated backend on simulation.html (see api.js);
 *                  never the network.
 *
 * Fires 'sensor:update' with { temperature, humidity, pressure?, demo },
 * 'sensor:lost' when readings stop, 'sensor:source' with { mode, state, reason } whenever the source or
 * connection changes (state: 'sample' | 'connecting' | 'connected' | 'disconnected';
 * reason: 'no-data' | 'unreachable'), and 'api:relay' with each polled relay state in live / simulation mode.
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

  function push({ temperature, humidity, pressure, demo = false }) {
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

    const detail = { temperature: t, humidity: h, demo };
    if (Number.isFinite(Number(pressure))) detail.pressure = Number(pressure);
    document.dispatchEvent(new CustomEvent('sensor:update', { detail }));
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

  /* ---------- Data source + connection ---------- */
  const SOURCE_KEY = 'plantcheck:data-source';
  // Chosen on the simulation page (the remote control): real-time ('live') or sample (the demo feed, made in this tab).
  // Without an API configured it's always sample.
  const MODES = ['live', 'sample'];
  const API_CFG = window.API_CONFIG || {};
  const DEFAULT_MODE = !(window.PlantAPI && PlantAPI.configured)
    ? 'sample'
    : MODES.includes(API_CFG.defaultSource) ? API_CFG.defaultSource : 'live';

  const readMode = () => {
    try {
      const stored = localStorage.getItem(SOURCE_KEY);
      return MODES.includes(stored) ? stored : DEFAULT_MODE;
    } catch {
      return DEFAULT_MODE;
    }
  };

  let mode = readMode();
  let modeSince = Date.now();
  const serverMode = () => mode === 'live' || mode === 'simulation';
  let state = null;
  let reason = null;

  function clearCards(message) {
    if (els.tempValue) {
      els.tempValue.textContent = '—';
      els.tempSub.textContent = message;
    }
    if (els.humValue) {
      els.humValue.textContent = '—';
      els.humSub.textContent = message;
    }
  }

  const LOST_TEXT = {
    live: { 'no-data': 'ESP32 not connected', unreachable: "Can't reach the server" },
    simulation: { 'no-data': 'Simulated ESP32 not connected', unreachable: 'Simulation not running' },
  };

  function setState(next, why = null) {
    if (next === state && why === reason) return;
    const wasDisconnected = state === 'disconnected';
    state = next;
    reason = why;
    if (next === 'connecting') clearCards(mode === 'live' ? 'Connecting to the server…' : 'Connecting to the simulation…');
    if (next === 'disconnected') {
      clearCards((LOST_TEXT[mode] || {})[why] || 'Not connected');
      if (!wasDisconnected) document.dispatchEvent(new CustomEvent('sensor:lost'));
    }
    document.dispatchEvent(new CustomEvent('sensor:source', { detail: { mode, state, reason } }));
  }

  // Live / simulation: ask the backend. It decides "connected" (reading younger than 10 s); the browser's clock isn't used.
  let polling = false;
  let failures = 0; // one slow or failed poll isn't an outage; two in a row is
  async function pollLive() {
    if (!serverMode() || polling || !window.PlantAPI) return;
    polling = true;
    const startedAt = Date.now();
    const since = modeSince;
    const [sensorRes, relayRes] = await Promise.allSettled([PlantAPI.getSensor(), PlantAPI.getRelay()]);
    polling = false;
    if (!serverMode() || since !== modeSince) return; // switched source while waiting

    // Relays: the server is the source of truth for fan / valve in live mode
    if (relayRes.status === 'fulfilled' && relayRes.value.ok && relayRes.value.data) {
      document.dispatchEvent(new CustomEvent('api:relay', { detail: { ...relayRes.value.data, at: startedAt } }));
    }

    if (sensorRes.status !== 'fulfilled' || !sensorRes.value.ok) {
      failures += 1;
      if (failures >= 2) setState('disconnected', 'unreachable');
      return;
    }
    failures = 0;
    const d = sensorRes.value.data || {};
    if (d.connected === true && Number.isFinite(Number(d.temperature)) && Number.isFinite(Number(d.humidity))) {
      setState('connected');
      push({ temperature: d.temperature, humidity: d.humidity, pressure: d.pressure, demo: false });
    } else {
      setState('disconnected', 'no-data');
    }
  }

  function enterMode() {
    state = null;
    failures = 0;
    reason = null;
    if (mode === 'sample') {
      setState('sample');
      tick();
    } else {
      setState('connecting');
      pollLive();
    }
  }

  function setMode(next, { save = true } = {}) {
    if (!MODES.includes(next) || next === mode) return;
    mode = next;
    modeSince = Date.now();
    if (save) {
      try {
        localStorage.setItem(SOURCE_KEY, mode);
      } catch { /* private mode: still switch for this page */ }
    }
    enterMode();
  }

  // Another tab (e.g. the simulation page) changed the setting
  window.addEventListener('storage', (e) => {
    if (e.key === SOURCE_KEY) setMode(e.newValue, { save: false });
  });

  // Sample mode: the demo feed (or SENSOR_CONFIG.url) every few seconds
  const tick = () => {
    if (mode !== 'sample') return;
    if (SOURCE_URL) poll();
    else push(demoReading());
  };

  enterMode();
  setInterval(tick, INTERVAL_MS);
  setInterval(pollLive, window.PlantAPI ? PlantAPI.pollMs : 2000);

  window.PlantSensors = {
    push,
    setMode,
    retry: pollLive,
    modes: MODES,
    get mode() { return mode; },
    get state() { return state; },
    get reason() { return reason; },
  };
})();
