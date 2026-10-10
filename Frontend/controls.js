/*
 * Device controls: Automate mode, fan toggle and irrigation countdown timer.
 * Hook your backend calls into onFanChange / onIrrigationStart / onIrrigationStop.
 * Also fires 'device:fan' and 'device:irrigation' events so the plant scene can react,
 * and listens for 'sensor:update' (from sensors.js) to drive Automate mode.
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

  /* ---------------- Backend hooks (replace with real API calls) ---------------- */
  function onFanChange(isOn) { /* e.g. fetch('/api/fan', { method: 'POST', body: JSON.stringify({ on: isOn }) }) */ }
  function onIrrigationStart(seconds) { /* e.g. fetch('/api/irrigation/start', { ... }) */ }
  function onIrrigationStop(finished) { /* e.g. fetch('/api/irrigation/stop', { ... }) */ }

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

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

  function setFan(on) {
    if (on === fanOn) return;
    fanOn = on;
    renderFan();
    onFanChange(on);
    emit('device:fan', { on });
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

  const CIRCUMFERENCE = 2 * Math.PI * 52;
  progress.style.strokeDasharray = String(CIRCUMFERENCE);
  progress.style.strokeDashoffset = String(CIRCUMFERENCE);

  let endTime = 0;
  let total = 0;
  let tick = null;
  let doneTimeout = null;

  const isWatering = () => tick !== null;
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

  function start(minutes, label) {
    clearInterval(tick);
    clearTimeout(doneTimeout);
    irrigation.classList.remove('is-done');
    total = Math.round(minutes * 60);
    endTime = Date.now() + total * 1000;
    statusEl.textContent = `Watering for ${label}…`;
    presetButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.minutes) === minutes));
    customButton.classList.toggle('active', !Array.from(presetButtons).some((b) => Number(b.dataset.minutes) === minutes));
    tick = setInterval(render, 250);
    setRunning(true);
    render();
    onIrrigationStart(total);
    emit('device:irrigation', { running: true, seconds: total });
  }

  function finish(completed) {
    clearInterval(tick);
    tick = null;
    setRunning(false);
    presetButtons.forEach((b) => b.classList.remove('active'));
    customButton.classList.remove('active');
    timerText.textContent = '00:00';
    progress.style.strokeDashoffset = String(CIRCUMFERENCE);
    onIrrigationStop(completed);
    emit('device:irrigation', { running: false, completed });

    if (completed) {
      irrigation.classList.add('is-done');
      statusEl.textContent = 'Done! Plant watered 💧';
      doneTimeout = setTimeout(() => {
        irrigation.classList.remove('is-done');
        statusEl.textContent = idleMessage();
      }, 4000);
    } else {
      statusEl.textContent = autoOn ? 'Stopped' : 'Stopped. Pick a duration to start';
    }
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
    const m = Math.round(Number(customInput.value));
    if (!Number.isFinite(m) || m < 1 || m > 120) {
      customInput.setCustomValidity('Enter 1 to 120 minutes');
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
    if (!fanOn && (hot || humid)) {
      setFan(true);
      log(`Fan on (${hot ? `${t.toFixed(1)}°C` : `${Math.round(h)}% humidity`})`);
    } else if (fanOn && t < R.fanOffBelow.temperature && h < R.fanOffBelow.humidity) {
      setFan(false);
      log('Fan off (back to normal)');
    }

    const cooledDown = Date.now() - lastAutoWater >= R.waterCooldownMinutes * 60 * 1000;
    if (t >= R.waterAt.temperature && !isWatering() && cooledDown) {
      lastAutoWater = Date.now();
      start(R.waterMinutes, `${R.waterMinutes} min (auto)`);
      log(`Watering (${t.toFixed(1)}°C)`);
    }
  }

  autoToggle.addEventListener('click', () => {
    autoOn = !autoOn;
    if (!isWatering() && !irrigation.classList.contains('is-done')) statusEl.textContent = idleMessage();
    updateLocks();
    renderFan();
    renderAuto();
    if (autoOn) applyRules();
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
})();
