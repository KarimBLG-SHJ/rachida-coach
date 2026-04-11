// weather.js — Weather for Sharjah UAE
// Uses Open-Meteo API (free, no API key needed)
// Used to recommend walk timing (avoid heat)

import axios from 'axios';

const SHARJAH_LAT = 25.3463;
const SHARJAH_LON = 55.4209;

let cache = { date: null, data: null };

/**
 * Fetch today's weather for Sharjah
 * Returns hourly temperature + apparent temperature
 */
export async function getWeather() {
  const today = new Date().toISOString().split('T')[0];

  if (cache.date === today && cache.data) {
    return cache.data;
  }

  try {
    const url = 'https://api.open-meteo.com/v1/forecast';
    const params = {
      latitude: SHARJAH_LAT,
      longitude: SHARJAH_LON,
      hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability',
      daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max',
      timezone: 'Asia/Dubai',
      forecast_days: 1
    };

    const response = await axios.get(url, { params });
    const { hourly, daily } = response.data;

    const data = {
      date: today,
      daily: {
        temp_max: daily.temperature_2m_max[0],
        temp_min: daily.temperature_2m_min[0],
        sunrise: daily.sunrise[0],
        sunset: daily.sunset[0],
        uv_max: daily.uv_index_max[0]
      },
      hourly: hourly.time.map((t, i) => ({
        hour: new Date(t).getHours(),
        temp: hourly.temperature_2m[i],
        feels_like: hourly.apparent_temperature[i],
        humidity: hourly.relative_humidity_2m[i],
        rain_chance: hourly.precipitation_probability[i]
      })),
      walkAdvice: getWalkAdvice(hourly)
    };

    cache = { date: today, data };
    return data;

  } catch (error) {
    console.error('[Weather] API error:', error.message);
    return getFallbackWeather();
  }
}

/**
 * Determine the best time for outdoor walking
 * In UAE: early morning or late afternoon/evening
 * Summer (May-Sep): above 40°C midday — only walk before 8am or after 6pm
 */
function getWalkAdvice(hourly) {
  const now = new Date().getHours();

  // Find comfortable hours (below 35°C and not raining)
  const comfortable = hourly.time
    .map((t, i) => ({
      hour: new Date(t).getHours(),
      temp: hourly.temperature_2m[i],
      rain: hourly.precipitation_probability[i]
    }))
    .filter(h => h.hour >= now && h.temp < 35 && h.rain < 30);

  if (comfortable.length === 0) {
    return {
      canWalkOutside: false,
      message: 'Trop chaud pour marcher dehors aujourd\'hui. Marche dans un centre commercial climatisé ou à la maison.',
      alternative: 'Marche intérieure — escaliers, couloirs, ou tapis de marche.'
    };
  }

  const best = comfortable[0];
  const isMorning = best.hour < 10;
  const isEvening = best.hour >= 17;

  return {
    canWalkOutside: true,
    bestHour: best.hour,
    temp: best.temp,
    message: isMorning
      ? `Marche tôt ce matin (vers ${best.hour}h) — ${best.temp}°C, agréable.`
      : isEvening
        ? `Marche ce soir (vers ${best.hour}h) — ${best.temp}°C, après la chaleur.`
        : `Possible de marcher vers ${best.hour}h — ${best.temp}°C.`,
    hydrationNote: best.temp > 30
      ? 'Emporte une bouteille d\'eau — 500ml minimum. L\'UAE déshydrate vite.'
      : null
  };
}

/**
 * Get a short weather summary for the morning brief
 */
export async function getWeatherSummary() {
  const weather = await getWeather();
  const { daily, walkAdvice } = weather;

  let summary = `${daily.temp_min}°C → ${daily.temp_max}°C`;
  if (daily.uv_max >= 8) {
    summary += ` | UV très fort (${daily.uv_max}) — crème solaire obligatoire`;
  }

  return {
    summary,
    walkAdvice: walkAdvice.message,
    canWalkOutside: walkAdvice.canWalkOutside,
    hydrationNote: walkAdvice.hydrationNote
  };
}

/**
 * Fallback if API is down (typical UAE weather)
 */
function getFallbackWeather() {
  const month = new Date().getMonth();
  const isSummer = month >= 4 && month <= 9; // May-October

  return {
    date: new Date().toISOString().split('T')[0],
    daily: {
      temp_max: isSummer ? 42 : 28,
      temp_min: isSummer ? 30 : 18,
      uv_max: isSummer ? 11 : 6
    },
    hourly: [],
    walkAdvice: {
      canWalkOutside: !isSummer,
      message: isSummer
        ? 'Été à Sharjah — marche uniquement tôt le matin (avant 8h) ou le soir (après 19h).'
        : 'Bonne saison pour marcher à Sharjah. Profites-en !',
      hydrationNote: 'Bois au moins 2.5L d\'eau par jour — l\'humidité de l\'UAE déshydrate vite.'
    }
  };
}
