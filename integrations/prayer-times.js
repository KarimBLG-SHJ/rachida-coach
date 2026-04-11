// prayer-times.js — Prayer times for Sharjah UAE
// Uses Aladhan.com API (free, no API key needed)
// Blocks notifications during prayer windows

import axios from 'axios';

const PRAYER_BUFFER_MINUTES = 15;
const SHARJAH_CITY = 'Sharjah';
const SHARJAH_COUNTRY = 'AE';

// Cache prayer times for the day
let cache = { date: null, times: null };

/**
 * Fetch today's prayer times for Sharjah
 * Returns array of { name, time, timestamp }
 */
export async function getPrayerTimes() {
  const today = new Date().toISOString().split('T')[0];

  // Return from cache if same day
  if (cache.date === today && cache.times) {
    return cache.times;
  }

  try {
    const url = `https://api.aladhan.com/v1/timingsByCity`;
    const params = {
      city: SHARJAH_CITY,
      country: SHARJAH_COUNTRY,
      method: 4  // Umm Al-Qura University, Makkah (standard UAE)
    };

    const response = await axios.get(url, { params });
    const data = response.data.data.timings;

    const prayers = [
      { name: 'Fajr',    time: data.Fajr },
      { name: 'Dhuhr',   time: data.Dhuhr },
      { name: 'Asr',     time: data.Asr },
      { name: 'Maghrib', time: data.Maghrib },
      { name: 'Isha',    time: data.Isha }
    ];

    // Add best walk windows between prayers
    const walkWindows = [
      {
        label: 'Après Fajr',
        start: data.Fajr,
        end: data.Dhuhr,
        note: 'Tôt le matin — air frais, température basse'
      },
      {
        label: 'Après Asr',
        start: data.Asr,
        end: data.Maghrib,
        note: 'Idéal — soleil moins fort, avant Iftar ou dîner'
      },
      {
        label: 'Après Maghrib',
        start: data.Maghrib,
        end: data.Isha,
        note: 'Promenade du soir — digestion, détente'
      }
    ];

    cache = { date: today, times: prayers, walkWindows };
    return prayers;

  } catch (error) {
    console.error('[Prayer times] API error:', error.message);
    // Fallback to approximate UAE times if API fails
    return getFallbackTimes();
  }
}

/**
 * Get best walk window for today
 */
export async function getBestWalkWindow() {
  const today = new Date().toISOString().split('T')[0];
  if (!cache.date === today) await getPrayerTimes();
  return cache.walkWindows ? cache.walkWindows[1] : null; // Default to after Asr
}

/**
 * Check if current time is near a prayer time
 * Returns { blocked: bool, prayer: string | null }
 */
export async function isNearPrayer() {
  const prayers = await getPrayerTimes();
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTotal = currentHour * 60 + currentMin;

  for (const prayer of prayers) {
    const [hour, min] = prayer.time.split(':').map(Number);
    const prayerTotal = hour * 60 + min;
    const diff = Math.abs(currentTotal - prayerTotal);

    if (diff <= PRAYER_BUFFER_MINUTES) {
      return { blocked: true, prayer: prayer.name };
    }
  }

  return { blocked: false, prayer: null };
}

/**
 * Format prayer times as display string
 */
export async function formatPrayerSchedule() {
  const prayers = await getPrayerTimes();
  return prayers.map(p => `${p.name}: ${p.time}`).join('  •  ');
}

/**
 * Fallback times if API unavailable (approximate UAE times)
 */
function getFallbackTimes() {
  return [
    { name: 'Fajr',    time: '05:15' },
    { name: 'Dhuhr',   time: '12:20' },
    { name: 'Asr',     time: '15:40' },
    { name: 'Maghrib', time: '18:30' },
    { name: 'Isha',    time: '19:50' }
  ];
}
