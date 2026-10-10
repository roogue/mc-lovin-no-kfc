/*
 * Device controls: fan toggle + irrigation countdown timer.
 * Hook your backend calls into onFanChange / onIrrigationStart / onIrrigationStop.
 * Also fires 'device:fan' and 'device:irrigation' events so the plant scene can react.
 */
(function () {
  'use strict';

  /* ---------------- Backend hooks (replace with real API calls) ---------------- */
  function onFanChange(isOn) { /* e.g. fetch('/api/fan', { method: 'POST', body: JSON.stringify({ on: isOn }) }) */ }
  function onIrrigationStart(seconds) { /* e.g. fetch('/api/irrigation/start', { ... }) */ }
  function onIrrigationStop(finished) { /* e.g. fetch('/api/irrigation/stop', { ... }) */ }

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  /* ---------------- Fan ---------------- */
  const fanControl = document.getElementById('fan-control');
  const fanToggle = document.getElementById('fan-toggle');
  const fanStatus = document.getElementById('fan-status');

  if (fanToggle) {
    fanToggle.addEventListener('click', () => {
      const on = fanToggle.getAttribute('aria-checked') !== 'true';
      fanToggle.setAttribute('aria-checked', String(on));
      fanControl.classList.toggle('is-on', on);
      fanStatus.textContent = on ? 'On · Cooling' : 'Off';
      onFanChange(on);
      emit('device:fan', { on });
    });
  }

  /* ---------------- Irrigation ---------------- */
  const irrigation = document.getElementById('irrigation-control');
  if (!irrigation) return;

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

  const format = (secs) => {
    const s = Math.max(0, Math.ceil(secs));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function setRunning(running) {
    irrigation.classList.toggle('is-running', running);
    presetButtons.forEach((b) => { b.disabled = running; });
    customButton.disabled = running;
    stopButton.hidden = !running;
    if (running) hideCustom();
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
    setRunning(true);
    render();
    tick = setInterval(render, 250);
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
        statusEl.textContent = 'Pick a duration to start';
      }, 4000);
    } else {
      statusEl.textContent = 'Stopped. Pick a duration to start';
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
})();
