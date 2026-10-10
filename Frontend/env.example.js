// Copy this file to env.js and fill in your values. env.js is git-ignored so your key stays out of the repo.
//
// Note: this is a browser-only page, so anyone who opens it can see this key in their dev tools.
// Before going public, move the weather request into the Backend and keep the key there.
window.ENV = {
  // The Weather Company (weather.com) API key
  WEATHER_API_KEY: '',

  // Where the plant is. Leave as null to use the browser's location instead (it will ask for permission).
  WEATHER_LAT: null, // e.g. 3.139
  WEATHER_LON: null, // e.g. 101.6869

  // 'm' = metric (°C, km/h), 'e' = imperial (°F, mph)
  WEATHER_UNITS: 'm',
};
