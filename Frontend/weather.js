/*
 * Weather card: live conditions from the Google Maps Platform Weather API,
 * place name from the Geocoding API (same key).
 *
 * Setup: paste your API key into WEATHER_CONFIG in index.html. Without a key the card shows demo data.
 *
 * Fires a 'weather:update' event so the plant scene can show rain, storms, clouds and wind.
 * Preview without an API key: index.html?weather=rain  (clear | partly | cloudy | rain | storm | snow | fog)
 */
(function () {
  'use strict';

  const CONFIG = window.WEATHER_CONFIG || {};
  const API_KEY = String(CONFIG.apiKey || '').trim();
  const IMPERIAL = String(CONFIG.unitsSystem || '').toUpperCase() === 'IMPERIAL';
  const REFRESH_MS = 10 * 60 * 1000;

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

  // Works with the API's condition type (e.g. LIGHT_RAIN_SHOWERS) or a plain description
  function classify(condition) {
    const c = String(condition || '').toLowerCase().replace(/_/g, ' ');
    if (/thunder|storm/.test(c)) return 'storm';
    if (/rain|shower|drizzle/.test(c)) return 'rain';
    if (/snow|sleet|hail|ice|flurr/.test(c)) return 'snow';
    if (/fog|mist|haze|smoke|dust/.test(c)) return 'fog';
    if (/partly|mostly clear|mostly sunny/.test(c)) return 'partly';
    if (/cloud|overcast/.test(c)) return 'cloudy';
    if (/clear|sunny/.test(c)) return 'clear';
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
  function render({ type, text, windKmh, location, night, timeZone, iconUrl, muted }) {
    const kind = classify(type || text);

    // Use Google's own condition icon when we have one, our SVG otherwise
    els.icon.innerHTML = iconSvg(kind, night);
    if (iconUrl) {
      const img = new Image();
      img.alt = '';
      img.onload = () => els.icon.replaceChildren(img);
      img.src = iconUrl;
    }

    els.text.textContent = text;
    els.sub.textContent = Number.isFinite(windKmh)
      ? `Wind ${Math.round(IMPERIAL ? windKmh / 1.609 : windKmh)} ${IMPERIAL ? 'mph' : 'km/h'}`
      : '';
    els.locationText.textContent = location;
    els.location.classList.toggle('is-muted', !!muted);

    document.dispatchEvent(new CustomEvent('weather:update', {
      detail: Object.assign({ phrase: text, kind, windSpeed: windKmh || 0, timeZone: timeZone || null }, KINDS[kind]),
    }));
  }

  const PREVIEW = {
    clear: 'Sunny', partly: 'Partly cloudy', cloudy: 'Cloudy', rain: 'Light rain',
    storm: 'Thunderstorm', snow: 'Light snow', fog: 'Fog',
  };

  function renderDemo(message) {
    const preview = new URLSearchParams(window.location.search).get('weather');
    const hour = new Date().getHours();
    render({
      text: PREVIEW[preview] || 'Partly cloudy',
      windKmh: 12,
      location: message,
      night: hour < 6 || hour >= 19,
      muted: true,
    });
  }

  /* ---------------- API calls ---------------- */
  function getCoords() {
    const lat = Number(CONFIG.latitude);
    const lon = Number(CONFIG.longitude);
    if (CONFIG.latitude != null && CONFIG.longitude != null && Number.isFinite(lat) && Number.isFinite(lon)) {
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    return data;
  }

  async function placeName({ lat, lon }) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${encodeURIComponent(API_KEY)}`;
    const data = await fetchJson(url);
    if (data.status !== 'OK') throw new Error(data.error_message || data.status);
    const parts = data.results.flatMap((r) => r.address_components);
    const find = (type) => parts.find((p) => p.types.includes(type));
    const city = find('locality') || find('administrative_area_level_2') || find('sublocality');
    const state = find('administrative_area_level_1');
    const country = find('country');
    // e.g. "Kuala Lumpur, MY" rather than "Kuala Lumpur, Kuala Lumpur"
    const region = state && (!city || state.short_name !== city.long_name) ? state : country;
    return [city && city.long_name, region && region.short_name].filter(Boolean).join(', ');
  }

  async function load() {
    const coords = await getCoords();
    if (!coords) {
      renderDemo('Set location in index.html');
      return;
    }

    const url = 'https://weather.googleapis.com/v1/currentConditions:lookup'
      + `?key=${encodeURIComponent(API_KEY)}`
      + `&location.latitude=${coords.lat}&location.longitude=${coords.lon}`
      + `&unitsSystem=${IMPERIAL ? 'IMPERIAL' : 'METRIC'}`;

    const [now, name] = await Promise.all([
      fetchJson(url),
      placeName(coords).catch((err) => {
        console.warn('Place name lookup failed (is the Geocoding API enabled for this key?):', err);
        return '';
      }),
    ]);

    const condition = now.weatherCondition || {};
    const speed = now.wind && now.wind.speed;
    let windKmh = speed ? Number(speed.value) : NaN;
    if (speed && /MILES/.test(speed.unit || '')) windKmh *= 1.609;

    render({
      type: condition.type,
      text: (condition.description && condition.description.text) || 'Unknown',
      windKmh,
      location: name || `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}`,
      night: now.isDaytime === false,
      timeZone: now.timeZone && now.timeZone.id,
      iconUrl: condition.iconBaseUri ? `${condition.iconBaseUri}.svg` : '',
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
    renderDemo('Add API key in index.html');
    return;
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
