# mc-lovin-no-kfc

## Frontend

Open `Frontend/index.html` in a browser (an internet connection is needed for the Three.js plant scene).

### Weather API key

1. Copy `Frontend/env.example.js` to `Frontend/env.js` (it is git-ignored).
2. Put your Weather Company (weather.com) key in `WEATHER_API_KEY`.
3. Set `WEATHER_LAT` / `WEATHER_LON` to the plant's location, or leave them `null` to use the browser's location.

Without a key the Weather card shows demo data.

### Previewing scene effects

- `index.html?weather=rain` (also `storm`, `cloudy`, `clear`, `fog`, `snow`) shows weather without an API key
- `index.html?hour=20` previews a time of day
- `index.html?state=sick` (or `withered`) previews a plant state
