/*
 * Weather card: live conditions + location from The Weather Company (weather.com) API.
 *
 * Setup: copy env.example.js to env.js and paste your API key (env.js is git-ignored).
 * Without a key the card shows demo data.
 *
 * Fires a 'weather:update' event so the plant scene can show rain, storms, clouds and wind.
 * Preview without an API key: index.html?weather=rain  (clear | partly | cloudy | rain | storm | snow | fog)
 */
(function () {
  'use strict';

  const ENV = window.ENV || {};
  const API_KEY = String(ENV.WEATHER_API_KEY || '').trim();
  const UNITS = ENV.WEATHER_UNITS === 'e' ? 'e' : 'm';
  const REFRESH_MS = 10 * 60 * 1000;
  const API = 'https://api.weather.com/v3';

  const els = {
    location: document.getElementById('weather-location'),
    locationText: document.getElementById('weather-location-text'),
    icon: document.getElementById('weather-icon'),
    text: document.getElementById('weather-text'),
    sub: document.getElementById('weather-sub'),
  };
  if (!els.text) return;

  /* ---------------- Condition → icon / scene ---------------- */
  const KINDS = {
    clear:  { cloudy: 0 },
    partly: { cloudy: 0.2 },
    cloudy: { cloudy: 0.55 },
    fog:    { cloudy: 0.5 },
    rain:   { cloudy: 0.8, rain: true },
    storm:  { cloudy: 0.9, rain: true, storm: true },
    snow:   { cloudy: 0.6 },
  };

  function classify(phrase) {
    const p = String(phrase || '').toLowerCase();
    if (/thunder|t-storm|storm/.test(p)) return 'storm';
    if (/rain|shower|drizzle|sprinkle/.test(p)) return 'rain';
    if (/snow|sleet|flurr|ice|hail|wintry/.test(p)) return 'snow';
    if (/fog|mist|haze|smoke|dust/.test(p)) return 'fog';
    if (/partly|mostly sunny|mostly clear|few clouds/.test(p)) return 'partly';
    if (/cloud|overcast/.test(p)) return 'cloudy';
    if (/sunny|clear|fair/.test(p)) return 'clear';
    return 'partly';
  }

  const SUN = '<circle cx="24" cy="24" r="11" fill="#FFC94D"/>';
  const MOON = '<path d="M30 10a14 14 0 1 0 12 22A12 12 0 0 1 30 10z" fill="#F4E3A1"/>';
  const CLOUD = (fill) => `<path d="M22 50a10 10 0 0 1-1-19.9A13 13 0 0 1 45.5 33 8.5 8.5 0 0 1 46 50z" fill="${fill}"/>`;
  const CLOUD_HIGH = (fill) => `<path d="M22 40a10 10 0 0 1-1-19.9A13 13 0 0 1 45.5 23 8.5 8.5 0 0 1 46 40z" fill="${fill}"/>`;

  function iconSvg(kind, night) {
    const body = {
      clear:  night ? '<path d="M38 12a18 18 0 1 0 14 28A15 15 0 0 1 38 12z" fill="#F4E3A1"/>' : '<circle cx="32" cy="32" r="16" fill="#FFE7A0"/><circle cx="32" cy="32" r="12" fill="#FFC94D"/>',
      partly: (night ? MOON : SUN) + CLOUD('#FFFFFF'),
      cloudy: '<path d="M30 40a9 9 0 0 1-1-17.9A11 11 0 0 1 50 24a7 7 0 0 1 0 14z" fill="#C9CED6"/>' + CLOUD('#FFFFFF'),
      fog:    CLOUD_HIGH('#D5D9DF') + '<path d="M14 46h36M18 53h30" stroke="#B4BAC4" stroke-width="4" stroke-linecap="round"/>',
      rain:   CLOUD_HIGH('#C3CAD4') + '<path d="M24 46l-3 7M33 46l-3 7M42 46l-3 7" stroke="#4FA8F0" stroke-width="3.5" stroke-linecap="round"/>',
      storm:  CLOUD_HIGH('#8F98A6') + '<path d="M34 40l-8 11h7l-4 9 11-13h-7l4-7z" fill="#FFC94D"/>',
      snow:   CLOUD_HIGH('#D5D9DF') + '<g fill="#9FCBF5"><circle cx="24" cy="49" r="2.5"/><circle cx="33" cy="54" r="2.5"/><circle cx="42" cy="49" r="2.5"/></g>',
    }[kind];
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  /* ---------------- Rendering ---------------- */
  function render({ phrase, windSpeed, location, night, timeZone, muted }) {
    const kind = classify(phrase);
    els.icon.innerHTML = iconSvg(kind, night);
    els.text.textContent = phrase;
    els.sub.textContent = Number.isFinite(windSpeed) ? `Wind ${Math.round(windSpeed)} ${UNITS === 'e' ? 'mph' : 'km/h'}` : '';
    els.locationText.textContent = location;
    els.location.classList.toggle('is-muted', !!muted);

    const windKmh = UNITS === 'e' ? windSpeed * 1.609 : windSpeed;
    document.dispatchEvent(new CustomEvent('weather:update', {
      detail: Object.assign({ phrase, kind, windSpeed: windKmh || 0, timeZone: timeZone || null }, KINDS[kind]),
    }));
  }

  const PREVIEW_PHRASES = { clear: 'Sunny', partly: 'Partly Cloudy', cloudy: 'Cloudy', rain: 'Light Rain', storm: 'Thunderstorm', snow: 'Light Snow', fog: 'Fog' };

  function renderDemo(message) {
    const preview = new URLSearchParams(window.location.search).get('weather');
    const hour = new Date().getHours();
    render({
      phrase: PREVIEW_PHRASES[preview] || 'Partly Cloudy',
      windSpeed: 12,
      location: message,
      night: hour < 6 || hour >= 19,
      muted: true,
    });
  }

  /* ---------------- Weather API ---------------- */
  function getCoords() {
    const lat = Number(ENV.WEATHER_LAT);
    const lon = Number(ENV.WEATHER_LON);
    if (ENV.WEATHER_LAT != null && ENV.WEATHER_LON != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      return Promise.resolve({ lat, lon });
    }
    if (!('geolocation' in navigator)) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather API responded ${res.status}`);
    return res.json();
  }

  async function load() {
    const coords = await getCoords();
    if (!coords) {
      renderDemo('Set WEATHER_LAT / WEATHER_LON in env.js');
      return;
    }

    const query = `geocode=${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}&language=en-US&format=json&apiKey=${encodeURIComponent(API_KEY)}`;
    const [obs, place] = await Promise.all([
      fetchJson(`${API}/wx/observations/current?${query}&units=${UNITS}`),
      fetchJson(`${API}/location/point?${query}`).catch(() => null),
    ]);

    const loc = (place && place.location) || {};
    const name = [loc.city || loc.displayName, loc.adminDistrictCode || loc.adminDistrict || loc.countryCode]
      .filter(Boolean)
      .join(', ');

    render({
      phrase: obs.wxPhraseLong || obs.wxPhraseShort || 'Unknown',
      windSpeed: Number(obs.windSpeed),
      location: name || `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}`,
      night: obs.dayOrNight === 'N',
      timeZone: loc.ianaTimeZone,
    });
  }

  function refresh() {
    load().catch((err) => {
      console.warn('Weather update failed:', err);
      els.locationText.textContent = 'Weather unavailable';
      els.location.classList.add('is-muted');
    });
  }

  if (!API_KEY) {
    renderDemo('Add your API key in env.js');
    return;
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
