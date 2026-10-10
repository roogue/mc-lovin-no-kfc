/*
 * CCTV lightbox: opens from the camera button on the Plant Condition card.
 * Set CCTV_CONFIG.streamUrl in index.html to an MJPEG stream (e.g. ESP32-CAM) or an .mp4 / .webm URL.
 * Closes with the X button, the Esc key, or a click outside the panel. The stream stops when it closes.
 */
(function () {
  'use strict';

  const CONFIG = window.CCTV_CONFIG || {};
  const STREAM_URL = String(CONFIG.streamUrl || '').trim();
  const IS_VIDEO = /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(STREAM_URL);

  const dialog = document.getElementById('cctv-dialog');
  const openBtn = document.getElementById('cctv-open');
  if (!dialog || !openBtn) return;

  const els = {
    title: document.getElementById('cctv-title'),
    status: document.getElementById('cctv-status'),
    close: document.getElementById('cctv-close'),
    screen: document.getElementById('cctv-screen'),
    empty: document.getElementById('cctv-empty'),
    emptyTitle: document.getElementById('cctv-empty-title'),
    emptyMsg: document.getElementById('cctv-empty-msg'),
    time: document.getElementById('cctv-time'),
  };

  if (CONFIG.name) els.title.textContent = `CCTV · ${CONFIG.name}`;

  let media = null;
  let clock = null;

  function setStatus(text, live) {
    els.status.textContent = text;
    dialog.classList.toggle('is-live', live);
  }

  function showEmpty(title, msg) {
    els.emptyTitle.textContent = title;
    els.emptyMsg.textContent = msg;
    els.empty.hidden = false;
  }

  function startStream() {
    if (!STREAM_URL) {
      setStatus('No signal', false);
      showEmpty('No camera connected', 'Add your camera stream URL to CCTV_CONFIG in index.html.');
      return;
    }

    els.empty.hidden = true;
    setStatus('Connecting…', false);

    media = IS_VIDEO ? document.createElement('video') : new Image();
    media.className = 'cctv-media';
    if (IS_VIDEO) {
      Object.assign(media, { autoplay: true, muted: true, loop: true, playsInline: true });
      media.addEventListener('playing', () => setStatus('Live', true));
    } else {
      media.alt = 'Live camera view of the plant';
      media.addEventListener('load', () => setStatus('Live', true));
    }
    media.addEventListener('error', () => {
      stopStream();
      setStatus('Offline', false);
      showEmpty('Camera offline', 'Could not load the stream. Check the camera is on and the URL is right.');
    });
    media.src = STREAM_URL;
    els.screen.prepend(media);
  }

  function stopStream() {
    if (!media) return;
    media.removeAttribute('src'); // drops the connection so the camera isn't streaming in the background
    if (media.load) media.load();
    media.remove();
    media = null;
  }

  function tick() {
    els.time.textContent = new Date().toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  openBtn.addEventListener('click', () => {
    dialog.showModal();
    startStream();
    tick();
    clock = setInterval(tick, 1000);
  });

  els.close.addEventListener('click', () => dialog.close());

  // Clicking the dimmed backdrop (outside the panel) closes it
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // Covers every way of closing, including Esc
  dialog.addEventListener('close', () => {
    stopStream();
    clearInterval(clock);
  });
})();
