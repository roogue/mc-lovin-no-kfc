/*
 * Weather + Precipitation cards: live conditions from the Google Maps Platform Weather API,
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
    precipValue: document.getElementById('precip-value'),
    precipSub: document.getElementById('precip-sub'),
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

  // Google weather icons (https://developers.google.com/maps/documentation/weather/weather-condition-icons).
  // The live API gives us the exact icon; this map is for demo mode and as a fallback.
  const ICON_BASE = 'https://maps.gstatic.com/weather/v1/';
  const ICONS = {
    clear:  { day: 'sunny', night: 'clear' },
    partly: { day: 'partly_cloudy', night: 'partly_clear' },
    cloudy: { day: 'cloudy', night: 'cloudy' },
    fog:    { day: 'mist', night: 'mist' },
    rain:   { day: 'showers', night: 'showers' },
    storm:  { day: 'strong_tstorms', night: 'strong_tstorms' },
    snow:   { day: 'snow_showers', night: 'snow_showers' },
  };
  const iconFor = (kind, night) => `${ICON_BASE}${ICONS[kind][night ? 'night' : 'day']}.svg`;

  /* ---------------- Precipitation card ---------------- */
  const PRECIP_TYPES = { RAIN: 'rain', SNOW: 'snow', ICE: 'ice', RAIN_AND_SNOW: 'rain & snow' };

  // percent: chance right now; amount: what fell in the last hour (mm or in)
  function renderPrecip({ percent, type, amount, unit }) {
    if (!els.precipValue || !Number.isFinite(percent)) return;
    els.precipValue.textContent = `${Math.round(percent)}%`;
    let sub = `Chance of ${PRECIP_TYPES[type] || 'rain'}`;
    if (Number.isFinite(amount) && amount > 0) {
      const inches = /INCH/.test(unit || '');
      sub += ` · ${amount.toFixed(inches ? 2 : 1)} ${inches ? 'in' : 'mm'} last hour`;
    }
    els.precipSub.textContent = sub;
  }

  /* ---------------- Rendering ---------------- */
  function render({ type, text, windKmh, location, night, timeZone, iconUrl, muted }) {
    const kind = classify(type || text);

    const img = new Image();
    img.alt = '';
    img.src = iconUrl || iconFor(kind, night);
    // If the API's icon fails to load, fall back to the matching one from our map
    img.onerror = () => { if (img.src !== iconFor(kind, night)) img.src = iconFor(kind, night); };
    els.icon.replaceChildren(img);

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

  const PREVIEW_PRECIP = { clear: 0, partly: 10, cloudy: 30, rain: 80, storm: 90, snow: 70, fog: 20 };

  function renderDemo(message) {
    const preview = new URLSearchParams(window.location.search).get('weather');
    if (preview in PREVIEW_PRECIP) {
      renderPrecip({ percent: PREVIEW_PRECIP[preview], type: preview === 'snow' ? 'SNOW' : 'RAIN' });
    }
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

    const fixedName = String(CONFIG.locationName || '').trim();
    const [now, name] = await Promise.all([
      fetchJson(url),
      fixedName || placeName(coords).catch((err) => {
        console.warn('Place name lookup failed (is the Geocoding API enabled for this key?):', err);
        return '';
      }),
    ]);

    const condition = now.weatherCondition || {};
    const speed = now.wind && now.wind.speed;
    let windKmh = speed ? Number(speed.value) : NaN;
    if (speed && /MILES/.test(speed.unit || '')) windKmh *= 1.609;

    const precip = now.precipitation || {};
    const probability = precip.probability || {};
    const qpf = precip.qpf || {};
    renderPrecip({
      percent: Number(probability.percent),
      type: probability.type,
      amount: Number(qpf.quantity),
      unit: qpf.unit,
    });

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
