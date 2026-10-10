# mc-lovin-no-kfc

## Frontend

Open `Frontend/index.html` in a browser (an internet connection is needed for the Three.js plant scene).

### Weather API key

The Weather card uses the [Google Maps Platform Weather API](https://developers.google.com/maps/documentation/weather/current-conditions).

1. In Google Cloud Console, enable the **Weather API** (and the **Geocoding API** for the place name) for your key.
2. Paste the key into `WEATHER_CONFIG.apiKey` near the bottom of `Frontend/index.html`.
3. Set `latitude` / `longitude` to the plant's location, or leave them `null` to use the browser's location.

The key is visible in the page source, so restrict it to your site's URL (HTTP referrer) in Google Cloud Console.
Without a key the Weather card shows demo data.

### Previewing scene effects

- `index.html?weather=rain` (also `storm`, `cloudy`, `clear`, `fog`, `snow`) shows weather without an API key
- `index.html?hour=20` previews a time of day
- `index.html?state=sick` (or `withered`) previews a plant state
