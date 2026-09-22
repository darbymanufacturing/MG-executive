/**
 * Open-Meteo historical weather fetcher.
 * Free API — no key required.
 * Docs: https://open-meteo.com/en/docs/historical-weather-api
 */

const BASE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/**
 * WMO weather codes that indicate rain.
 * 51-67: drizzle / rain
 * 71-77: snow (counts as "bad weather")
 * 80-82: rain showers
 * 95-99: thunderstorms
 */
const RAINY_CODES = new Set([
  51, 53, 55, 56, 57,
  61, 63, 65, 66, 67,
  71, 73, 75, 77,
  80, 81, 82,
  85, 86,
  95, 96, 99,
]);

/** Precipitation threshold in mm to flag a day as rainy. */
const RAIN_MM_THRESHOLD = 1.0;

/** Recent-days endpoint: the archive lags ~5 days, the forecast API's past_days does not. */
const RECENT_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Map Open-Meteo's `daily` block into Omni weather days. One rule set for every
 * caller (the SPR panel, the daily Autopilot weather cron), so "rainy" means the
 * same thing everywhere.
 */
export function mapDailyWeather(daily) {
  if (!daily?.time) return [];
  const { time, precipitation_sum = [], weather_code = [], temperature_2m_mean = [] } = daily;
  return time.map((date, i) => {
    const rain = precipitation_sum[i] ?? 0;
    const code = weather_code[i] ?? 0;
    const temp = temperature_2m_mean[i] ?? null;
    return {
      date,
      isRainy: rain >= RAIN_MM_THRESHOLD || RAINY_CODES.has(code),
      totalRainMm: Math.round(rain * 10) / 10,
      weatherCode: code,
      temperature: temp !== null ? Math.round(temp * 10) / 10 : null,
    };
  });
}

/**
 * The last `pastDays` complete days of weather (yesterday back), for the daily
 * Autopilot job. Uses the forecast endpoint's `past_days`, because the archive
 * endpoint has no data for the most recent few days.
 */
export async function fetchRecentWeather({ lat, lon, pastDays = 7 }) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: 'precipitation_sum,weather_code,temperature_2m_mean',
    past_days: String(pastDays),
    forecast_days: '1',
    timezone: 'auto',
  });
  const res = await fetch(`${RECENT_URL}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Open-Meteo error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // Drop today (forecast_days=1 includes it and it is not complete yet).
  const today = new Date().toISOString().slice(0, 10);
  return mapDailyWeather(data?.daily).filter((d) => d.date < today);
}

/**
 * Fetch daily weather for a lat/lon and date range.
 *
 * @param {{ lat: number, lon: number, startDate: string, endDate: string }} opts
 * @returns {Promise<Array<{ date, isRainy, totalRainMm, weatherCode, temperature }>>}
 */
export async function fetchHistoricalWeather({ lat, lon, startDate, endDate }) {
  const params = new URLSearchParams({
    latitude:  lat,
    longitude: lon,
    start_date: startDate,
    end_date:   endDate,
    daily: 'precipitation_sum,weather_code,temperature_2m_mean',
    timezone: 'auto',
  });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(`${BASE_URL}?${params}`, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open-Meteo error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data?.daily?.time) throw new Error(data?.reason || 'Open-Meteo returned no daily data');
  return mapDailyWeather(data.daily);
}

/** Human-readable weather label for a WMO code. */
export function weatherCodeLabel(code) {
  if (code === 0)           return 'Clear';
  if (code <= 3)            return 'Cloudy';
  if (code <= 9)            return 'Fog';
  if (code <= 19)           return 'Drizzle';
  if (code <= 29)           return 'Rain';
  if (code <= 39)           return 'Snow';
  if (code <= 49)           return 'Fog';
  if (code <= 57)           return 'Drizzle';
  if (code <= 67)           return 'Rain';
  if (code <= 77)           return 'Snow';
  if (code <= 82)           return 'Showers';
  if (code <= 86)           return 'Snow showers';
  if (code <= 99)           return 'Thunderstorm';
  return 'Unknown';
}
