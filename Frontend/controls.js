/*
 * Device controls: Automate mode, fan toggle and irrigation countdown timer.
 *
 * Live mode (data source 'live'): every change goes to the backend through onFanChange / onIrrigationStart /
 * onIrrigationStop (POST /api/relay, see api.js), and the server is the source of truth: the polled relay state
 * ('api:relay') sets the fan and drives the watering countdown from valve_remaining. Failed commands are undone.
 * Sample / simulation modes: everything stays local, as before.
 *
 * Fires 'device:fan' and 'device:irrigation' so the plant scene can react, and listens for 'sensor:update'
 * (from sensors.js) to drive Automate mode.
 */
(function () {
  'use strict';

  /* ---------------- Automate rules ---------------- */
  const AUTO_RULES = {
    fanOnAt: { temperature: 32, humidity: 80 },     // fan turns on when either reading reaches this
    fanOffBelow: { temperature: 31, humidity: 75 }, // ...and off once both drop below (the gap stops it flickering)
    waterAt: { temperature: 33 },                   // water when it gets this hot
    waterMinutes: 1,
    waterCooldownMinutes: 30,                       // at most one automatic watering per 30 minutes
  };
  const LIVE_MAX_MINUTES = 10; // the server caps one watering at 600 s
  const LOCAL_MAX_MINUTES = 120;

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const toast = (message, kind = 'error') => window.PlantToast && PlantToast(message, kind);
  const isLive = () => !!(window.PlantAPI && window.PlantSensors && PlantSensors.mode === 'live');

  /* ---------------- Backend hooks: POST /api/relay in live mode, local only otherwise ---------------- */
  let lastCommandAt = 0; // polled relay states that started before our latest command are ignored

  // auto: sent by Automate (never prompts; a password problem turns Automate off)
  // quiet: no prompt and no error message (e.g. telling the server a watering it already ended is over)
  // revert: undoes the optimistic UI change when the command fails
  async function remote(body, { auto = false, quiet = false, revert } = {}) {
    if (!isLive()) return true;
    if (quiet && !PlantAPI.hasKey()) return true;
    lastCommandAt = Date.now();
    try {
      await PlantAPI.setRelay(body, { prompt: !auto && !quiet });
      return true;
    } catch (err) {
      if (quiet) return false;
      if (revert) revert();
      if (auto && (err.code === 'unauthorized' || err.code === 'no-key')) {
        setAuto(false);
        toast(`${err.message} Automate has been turned off.`);
      } else {
        toast(err.message);
      }
      return false;
    } finally {
      lastCommandAt = Date.now();
    }
  }

  function onFanChange(isOn, opts) { return remote({ fan: isOn }, opts); }
  function onIrrigationStart(seconds, opts) { return remote({ valve: true, seconds }, opts); }
  function onIrrigationStop(finished, opts) { return remote({ valve: false }, opts); } // safe even if the server already finished

  let autoOn = false;

  /* ---------------- Fan ---------------- */
  const fanControl = document.getElementById('fan-control');
  const fanToggle = document.getElementById('fan-toggle');
  const fanStatus = document.getElementById('fan-status');
  let fanOn = false;

  function renderFan() {
    fanToggle.setAttribute('aria-checked', String(fanOn));
    fanControl.classList.toggle('is-on', fanOn);
    fanStatus.textContent = `${fanOn ? 'On · Cooling' : 'Off'}${autoOn ? ' · Auto' : ''}`;
  }

  // Show a fan state without sending anything (used for server updates and reverts)
  function applyFan(on) {
    if (on === fanOn) return;
    fanOn = on;
    renderFan();
    emit('device:fan', { on });
  }

  function setFan(on, { auto = false } = {}) {
    if (on === fanOn) return;
    applyFan(on);
    onFanChange(on, { auto, revert: () => applyFan(!on) });
  }

  fanToggle.addEventListener('click', () => {
    if (!autoOn) setFan(!fanOn);
  });

  /* ---------------- Irrigation ---------------- */
  const irrigation = document.getElementById('irrigation-control');
  const statusEl = document.getElementById('irrigation-status');
  const timerText = document.getElementById('timer-text');
  const progress = document.getElementById('timer-progress');
  const presetButtons = irrigation.querySelectorAll('.presets button[data-minutes]');
  const customButton = irrigation.querySelector('.presets button[data-custom]');
  const customForm = document.getElementById('custom-form');
  const customInput = document.getElementById('custom-minutes');
  const stopButton = document.getElementById('irrigation-stop');
  const limitNote = document.getElementById('irrigation-limit');

  const CIRCUMFERENCE = 2 * Math.PI * 52;
  progress.style.strokeDasharray = String(CIRCUMFERENCE);
  progress.style.strokeDashoffset = String(CIRCUMFERENCE);

  let endTime = 0;
  let total = 0;
  let tick = null;
  let doneTimeout = null;

  const isWatering = () => tick !== null;
  const maxMinutes = () => (isLive() ? LIVE_MAX_MINUTES : LOCAL_MAX_MINUTES);
  const idleMessage = () => (autoOn ? 'Automate will water when it gets hot' : 'Pick a duration to start');

  const format = (secs) => {
    const s = Math.max(0, Math.ceil(secs));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  // Manual buttons are locked while watering or while Automate is in charge
  function updateLocks() {
    const locked = isWatering() || autoOn;
    presetButtons.forEach((b) => { b.disabled = locked; });
    customButton.disabled = locked;
    fanToggle.disabled = autoOn;
    fanToggle.title = autoOn ? 'Turn off Automate to control the fan yourself' : '';
    if (locked) hideCustom();
  }

  // In live mode one watering is limited to what the server allows, and the limit is shown
  function renderLimits() {
    const max = maxMinutes();
    customInput.max = String(max);
    customInput.placeholder = `1–${max} min`;
    if (limitNote) limitNote.hidden = !isLive();
  }

  function setRunning(running) {
    irrigation.classList.toggle('is-running', running);
    stopButton.hidden = !running;
    updateLocks();
  }

  function render() {
    const remaining = (endTime - Date.now()) / 1000;
    timerText.textContent = format(remaining);
    const fraction = total ? Math.max(0, remaining) / total : 0;
    progress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
    if (remaining <= 0) finish(true);
  }

  function markActive(minutes) {
    presetButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.minutes) === minutes));
    customButton.classList.toggle('active', minutes !== null && !Array.from(presetButtons).some((b) => Number(b.dataset.minutes) === minutes));
  }

  // Start the countdown on screen only (no command)
  function startLocal(seconds, statusText, minutes = null) {
    clearInterval(tick);
    clearTimeout(doneTimeout);
    irrigation.classList.remove('is-done');
    total = Math.max(1, Math.round(seconds));
    endTime = Date.now() + total * 1000;
    statusEl.textContent = statusText;
    markActive(minutes);
    tick = setInterval(render, 250);
    setRunning(true);
    render();
    emit('device:irrigation', { running: true, seconds: total });
  }

  // End the countdown on screen only. how: 'completed' | 'stopped' | 'reverted'
  function stopLocal(how) {
    clearInterval(tick);
    tick = null;
    setRunning(false);
    markActive(null);
    timerText.textContent = '00:00';
    progress.style.strokeDashoffset = String(CIRCUMFERENCE);
    emit('device:irrigation', { running: false, completed: how === 'completed' });

    if (how === 'completed') {
      irrigation.classList.add('is-done');
      statusEl.textContent = 'Done! Plant watered 💧';
      doneTimeout = setTimeout(() => {
        irrigation.classList.remove('is-done');
        statusEl.textContent = idleMessage();
      }, 4000);
    } else if (how === 'stopped') {
      statusEl.textContent = autoOn ? 'Stopped' : 'Stopped. Pick a duration to start';
    } else {
      statusEl.textContent = idleMessage();
    }
  }

  function start(minutes, label, { auto = false } = {}) {
    minutes = Math.min(minutes, maxMinutes());
    startLocal(minutes * 60, `Watering for ${label}…`, minutes);
    onIrrigationStart(total, { auto, revert: () => stopLocal('reverted') });
  }

  function finish(completed) {
    if (completed) {
      stopLocal('completed');
      onIrrigationStop(true, { quiet: true }); // the server ends it on its own; this just makes sure
      return;
    }
    const remaining = (endTime - Date.now()) / 1000;
    const before = total;
    stopLocal('stopped');
    onIrrigationStop(false, {
      revert: () => {
        if (remaining > 0) {
          startLocal(remaining, 'Still watering (the stop didn’t go through)');
          total = before;
        }
      },
    });
  }

  // Live mode: follow the server's valve (also shows a watering started on another screen or before a reload)
  function syncWatering(remaining) {
    if (!isWatering()) {
      startLocal(remaining, 'Watering… (synced with the server)');
      return;
    }
    endTime = Date.now() + remaining * 1000;
    if (remaining > total) total = Math.round(remaining);
  }

  function hideCustom() {
    customForm.hidden = true;
    customButton.setAttribute('aria-expanded', 'false');
  }

  presetButtons.forEach((b) => {
    b.addEventListener('click', () => {
      const m = Number(b.dataset.minutes);
      start(m, `${m} min`);
    });
  });

  customButton.addEventListener('click', () => {
    const open = customForm.hidden;
    customForm.hidden = !open;
    customButton.setAttribute('aria-expanded', String(open));
    if (open) customInput.focus();
  });

  customForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const max = maxMinutes();
    const m = Math.round(Number(customInput.value));
    if (!Number.isFinite(m) || m < 1 || m > max) {
      customInput.setCustomValidity(isLive() ? `Enter 1 to ${max} minutes (the server's limit in live mode)` : `Enter 1 to ${max} minutes`);
      customInput.reportValidity();
      return;
    }
    customInput.setCustomValidity('');
    start(m, `${m} min`);
    customInput.value = '';
  });

  customInput.addEventListener('input', () => customInput.setCustomValidity(''));

  stopButton.addEventListener('click', () => finish(false));

  /* ---------------- Automate ---------------- */
  const autoControl = document.getElementById('auto-control');
  const autoToggle = document.getElementById('auto-toggle');
  const autoStatus = document.getElementById('auto-status');
  const autoRules = document.getElementById('auto-rules');
  const autoLog = document.getElementById('auto-log');

  let latest = null;
  let lastAutoWater = -Infinity;
  let desiredFan = null; // what Automate last decided; a command is only sent when this changes

  autoRules.textContent =
    `Fan on at ${AUTO_RULES.fanOnAt.temperature}°C or ${AUTO_RULES.fanOnAt.humidity}% humidity · ` +
    `Waters ${AUTO_RULES.waterMinutes} min at ${AUTO_RULES.waterAt.temperature}°C`;

  function log(text) {
    autoLog.textContent = `${clock()} · ${text}`;
    autoLog.hidden = false;
  }

  function renderAuto() {
    autoToggle.setAttribute('aria-checked', String(autoOn));
    autoControl.classList.toggle('is-on', autoOn);
    if (!autoOn) autoStatus.textContent = 'Off · Manual control';
    else if (latest) autoStatus.textContent = `On · Now ${latest.temperature.toFixed(1)}°C, ${Math.round(latest.humidity)}%`;
    else autoStatus.textContent = 'On · Waiting for sensor readings';
  }

  function applyRules() {
    if (!autoOn || !latest) return;
    const { temperature: t, humidity: h } = latest;
    const R = AUTO_RULES;

    const hot = t >= R.fanOnAt.temperature;
    const humid = h >= R.fanOnAt.humidity;
    let desired = desiredFan;
    if (hot || humid) desired = true;
    else if (t < R.fanOffBelow.temperature && h < R.fanOffBelow.humidity) desired = false;
    else if (desired === null) desired = fanOn; // in the gap between the thresholds: leave it as it is

    if (desired !== desiredFan) {
      desiredFan = desired;
      if (desired !== fanOn) {
        setFan(desired, { auto: true });
        log(desired ? `Fan on (${hot ? `${t.toFixed(1)}°C` : `${Math.round(h)}% humidity`})` : 'Fan off (back to normal)');
      }
    }

    const cooledDown = Date.now() - lastAutoWater >= R.waterCooldownMinutes * 60 * 1000;
    if (t >= R.waterAt.temperature && !isWatering() && cooledDown) {
      lastAutoWater = Date.now();
      start(R.waterMinutes, `${R.waterMinutes} min (auto)`, { auto: true });
      log(`Watering (${t.toFixed(1)}°C)`);
    }
  }

  function setAuto(on) {
    if (on && isLive() && !PlantAPI.hasKey() && !PlantAPI.askKey()) {
      toast('Automate needs the control password in live mode.');
      return;
    }
    autoOn = on;
    desiredFan = null;
    if (!isWatering() && !irrigation.classList.contains('is-done')) statusEl.textContent = idleMessage();
    updateLocks();
    renderFan();
    renderAuto();
    if (autoOn) applyRules();
  }

  autoToggle.addEventListener('click', () => setAuto(!autoOn));

  /* ---------------- Live mode: the server's relay state ---------------- */
  document.addEventListener('api:relay', (e) => {
    if (!isLive()) return;
    const d = e.detail || {};
    if ((d.at || 0) < lastCommandAt) return; // fetched before our latest command; the next poll is fresher
    if (typeof d.fan === 'boolean') applyFan(d.fan);
    if (d.valve === true && d.valve_remaining > 0) syncWatering(d.valve_remaining);
    else if (d.valve === false && isWatering()) stopLocal(endTime - Date.now() < 3000 ? 'completed' : 'stopped');
  });

  document.addEventListener('sensor:source', () => {
    renderLimits();
    if (autoOn && isLive() && !PlantAPI.hasKey()) {
      setAuto(false);
      toast('Automate was turned off: live mode needs the control password. Switch it on again to enter it.', 'info');
    }
  });

  // No readings: stop acting on stale numbers
  document.addEventListener('sensor:lost', () => {
    latest = null;
    renderAuto();
  });

  document.addEventListener('sensor:update', (e) => {
    const { temperature, humidity } = e.detail || {};
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return;
    latest = { temperature, humidity };
    renderAuto();
    applyRules();
  });

  renderFan();
  renderAuto();
  renderLimits();

  // Lets other parts of the page (e.g. the status banner's buttons) act on the devices
  window.PlantControls = {
    water(minutes = 1) {
      if (!isWatering()) start(minutes, `${minutes} min`);
    },
    fanOn() {
      setFan(true);
    },
    get watering() { return isWatering(); },
    get fan() { return fanOn; },
  };
})();
