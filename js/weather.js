// js/weather.js
// =====================================================
// Uses Open-Meteo API
//
// Works on any element with:
//   Geocoding: geocoding-api.open-meteo.com  (name → lat/lon)
//   Forecast:  api.open-meteo.com            (lat/lon → weather)
//
// DOM targets: #weatherTemp, #weatherDesc

const WMO = {
  0:  'Clear Sky',
  1:  'Mostly Clear',
  2:  'Partly Cloudy',
  3:  'Overcast',
  45: 'Foggy',
  48: 'Foggy',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Heavy Drizzle',
  61: 'Light Rain',
  63: 'Rainy',
  65: 'Heavy Rain',
  71: 'Light Snow',
  73: 'Snowy',
  75: 'Heavy Snow',
  80: 'Light Showers',
  81: 'Rain Showers',
  82: 'Heavy Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const PH_FALLBACK  = { lat: 12.8797, lon: 121.7740 };

async function geocode(query) {
  const res  = await fetch(`${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
  const data = await res.json();
  const r    = data.results?.[0];
  return r ? { lat: r.latitude, lon: r.longitude } : null;
}

async function resolveCoords(municipality, province) {
  if (municipality && province) {
    const coords = await geocode(`${municipality}, ${province}, Philippines`);
    if (coords) return coords;
  }
  if (province) {
    const coords = await geocode(`${province}, Philippines`);
    if (coords) return coords;
  }
  return PH_FALLBACK;
}

export async function loadWeather(municipality, province) {
  const cacheKey = `weather:${municipality}:${province}`;

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { applyWeather(JSON.parse(cached)); return; }

    const { lat, lon } = await resolveCoords(municipality, province);

    const res  = await fetch(
      `${FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weathercode` +
      `&temperature_unit=celsius&timezone=Asia%2FManila`
    );
    const data = await res.json();

    const result = {
      temp: Math.round(data.current.temperature_2m),
      desc: WMO[data.current.weathercode] ?? 'Weather',
    };

    sessionStorage.setItem(cacheKey, JSON.stringify(result));
    applyWeather(result);

  } catch {
    // Network error — keep the '—°' placeholder
  }
}

function applyWeather({ temp, desc }) {
  const tEl = document.getElementById('weatherTemp');
  const dEl = document.getElementById('weatherDesc');
  if (tEl) tEl.textContent = `${temp}°`;
  if (dEl) dEl.textContent = desc;
}