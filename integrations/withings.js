// withings.js — Withings API integration (OAuth2)
// Fetches weight, body fat %, BMI from Withings smart scale
//
// SETUP REQUIRED:
// 1. Create app at https://developer.withings.com
// 2. Set WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET in .env
// 3. Run: node index.js setup-withings (to complete OAuth flow)
//
// Once authorized, tokens are stored locally and refreshed automatically.

import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db/connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WITHINGS_API = 'https://wbsapi.withings.net';
const WITHINGS_AUTH = 'https://account.withings.com/oauth2_user/authorize2';
const WITHINGS_TOKEN = 'https://wbsapi.withings.net/v2/oauth2';

// ─────────────────────────────────────────────
// TOKEN MANAGEMENT — stored in SQLite (survives redeploys)
// ─────────────────────────────────────────────

function loadTokens() {
  const row = db.prepare("SELECT value FROM coach_memory WHERE key = 'withings_tokens'").get();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function saveTokens(tokens) {
  db.prepare(`
    INSERT INTO coach_memory (key, value, category, updated_at)
    VALUES ('withings_tokens', ?, 'system', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `).run(JSON.stringify(tokens), JSON.stringify(tokens));
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error('No Withings refresh token. Run setup-withings first.');
  }

  const response = await axios.post(WITHINGS_TOKEN, new URLSearchParams({
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: process.env.WITHINGS_CLIENT_ID,
    client_secret: process.env.WITHINGS_CLIENT_SECRET,
    refresh_token: tokens.refresh_token
  }));

  if (response.data.status !== 0) {
    throw new Error(`Withings token refresh failed: ${response.data.error}`);
  }

  const newTokens = {
    access_token: response.data.body.access_token,
    refresh_token: response.data.body.refresh_token,
    expires_at: Date.now() + (response.data.body.expires_in * 1000)
  };

  saveTokens(newTokens);
  return newTokens.access_token;
}

/**
 * Get a valid access token (refresh if expired)
 */
async function getAccessToken() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Withings not configured. Run setup-withings.');

  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  return refreshAccessToken();
}

// ─────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────

/**
 * Fetch latest weight measurement from Withings
 * Gets ALL body composition data from the scale:
 * weight, fat%, fat mass, muscle%, bone mass, hydration%, BMI, visceral fat
 */
export async function getLatestWeight() {
  try {
    const token = await getAccessToken();

    // Type IDs: 1=weight, 5=fat_free_mass, 6=fat_ratio, 8=fat_mass_weight,
    // 11=heart_rate, 76=muscle_mass, 77=hydration, 88=bone_mass,
    // 91=pulse_wave_velocity, 122=visceral_fat
    const response = await axios.post(`${WITHINGS_API}/measure`, new URLSearchParams({
      action: 'getmeas',
      meastype: '1,5,6,8,11,76,77,88,122',
      category: 1,
      lastupdate: Math.floor(Date.now() / 1000) - 86400 * 30 // last 30 days
    }), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.data.status !== 0) {
      throw new Error(`Withings API error: ${JSON.stringify(response.data)}`);
    }

    const groups = response.data.body.measuregrps;
    if (!groups || groups.length === 0) return null;

    // Most recent measurement group
    const latest = groups[0];
    const date = new Date(latest.date * 1000).toISOString().split('T')[0];
    const time = new Date(latest.date * 1000).toTimeString().split(' ')[0];

    const measures = {};
    for (const m of latest.measures) {
      const value = m.value * Math.pow(10, m.unit);
      switch (m.type) {
        case 1:   measures.weight_kg = Math.round(value * 10) / 10; break;
        case 5:   measures.fat_free_mass_kg = Math.round(value * 10) / 10; break;
        case 6:   measures.fat_percent = Math.round(value * 10) / 10; break;
        case 8:   measures.fat_mass_kg = Math.round(value * 10) / 10; break;
        case 11:  measures.heart_rate = Math.round(value); break;
        case 76:  measures.muscle_mass_kg = Math.round(value * 10) / 10; break;
        case 77:  measures.hydration_percent = Math.round(value * 10) / 10; break;
        case 88:  measures.bone_mass_kg = Math.round(value * 100) / 100; break;
        case 122: measures.visceral_fat = Math.round(value); break;
      }
    }

    console.log(`[Withings] Data: ${JSON.stringify(measures)}`);
    return { ...measures, date, time, source: 'withings' };

  } catch (error) {
    console.error('[Withings] Error:', error.message);
    return null;
  }
}

/**
 * Fetch activity data (steps, calories, distance) from Withings
 */
export async function getActivity(days = 7) {
  try {
    const token = await getAccessToken();
    const startdate = new Date(Date.now() - 86400000 * days).toISOString().split('T')[0];
    const enddate = new Date().toISOString().split('T')[0];

    const response = await axios.post(`${WITHINGS_API}/v2/measure`, new URLSearchParams({
      action: 'getactivity',
      startdateymd: startdate,
      enddateymd: enddate
    }), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.data.status !== 0) {
      return null;
    }

    const activities = response.data.body.activities || [];
    return activities.map(a => ({
      date: a.date,
      steps: a.steps || 0,
      distance_m: a.distance || 0,
      active_calories: a.calories || 0,
      total_calories: a.totalcalories || 0,
      soft_activity_min: a.soft || 0,
      moderate_activity_min: a.moderate || 0,
      intense_activity_min: a.intense || 0
    }));
  } catch (error) {
    console.error('[Withings Activity] Error:', error.message);
    return null;
  }
}

/**
 * Sync activity data to database
 */
export async function syncActivity(days = 7) {
  const activities = await getActivity(days);
  if (!activities || activities.length === 0) return null;

  // Today in Dubai — skip any partial day data
  const todayDubai = new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  let count = 0, skipped = 0;
  for (const a of activities) {
    // Skip today (partial data) and any future date
    if (a.date >= todayDubai) { skipped++; continue; }

    // Skip empty days (no steps at all = probably a day she didn't wear the watch/scale)
    if (!a.steps || a.steps < 100) { skipped++; continue; }

    // If we already have better data for this date (from any source), don't overwrite
    const best = db.prepare(
      'SELECT steps FROM activity_log WHERE date = ? ORDER BY steps DESC LIMIT 1'
    ).get(a.date);

    if (best && best.steps >= a.steps) { skipped++; continue; }

    // Replace any existing Withings row for this date, keep other sources
    db.prepare("DELETE FROM activity_log WHERE date = ? AND source = 'withings'").run(a.date);
    db.prepare(`
      INSERT INTO activity_log (date, steps, active_calories, total_calories, exercise_minutes, distance_km, source)
      VALUES (?, ?, ?, ?, ?, ?, 'withings')
    `).run(a.date, a.steps, a.active_calories, a.total_calories,
      a.moderate_activity_min + a.intense_activity_min,
      Math.round(a.distance_m / 10) / 100,
    );
    count++;
  }

  console.log(`[Withings] Activity synced: ${count} jours (${skipped} ignorés)`);
  return { synced: count, skipped, activities };
}

/**
 * Sync latest weight to database
 * Call this on a schedule (morning) or on demand
 */
/**
 * Sync ALL weight measurements from the last 30 days
 */
export async function syncWeight() {
  try {
    const token = await getAccessToken();

    const response = await axios.post(`${WITHINGS_API}/measure`, new URLSearchParams({
      action: 'getmeas',
      meastype: '1,5,6,8,11,76,77,88,122',
      category: 1,
      lastupdate: Math.floor(Date.now() / 1000) - 86400 * 30
    }), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.data.status !== 0) {
      console.error('[Withings] API error:', JSON.stringify(response.data));
      return null;
    }

    const groups = response.data.body.measuregrps;
    if (!groups || groups.length === 0) return null;

    let synced = 0;
    let latest = null;

    for (const grp of groups) {
      const date = new Date(grp.date * 1000).toISOString().split('T')[0];
      const time = new Date(grp.date * 1000).toTimeString().split(' ')[0];

      // Check if already synced
      const existing = db.prepare(
        'SELECT id FROM weight_log WHERE date = ? AND source = ? LIMIT 1'
      ).get(date, 'withings');
      if (existing) continue;

      const measures = {};
      for (const m of grp.measures) {
        const value = m.value * Math.pow(10, m.unit);
        switch (m.type) {
          case 1:   measures.weight_kg = Math.round(value * 10) / 10; break;
          case 6:   measures.fat_percent = Math.round(value * 10) / 10; break;
          case 8:   measures.fat_mass_kg = Math.round(value * 10) / 10; break;
          case 76:  measures.muscle_mass_kg = Math.round(value * 10) / 10; break;
          case 77:  measures.hydration_percent = Math.round(value * 10) / 10; break;
          case 88:  measures.bone_mass_kg = Math.round(value * 100) / 100; break;
          case 122: measures.visceral_fat = Math.round(value); break;
        }
      }

      if (!measures.weight_kg) continue;

      db.prepare(`
        INSERT INTO weight_log (date, time, weight_kg, fat_percent, muscle_percent, bone_mass_kg, hydration_percent, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'withings')
      `).run(date, time, measures.weight_kg, measures.fat_percent || null,
        measures.muscle_mass_kg || null, measures.bone_mass_kg || null, measures.hydration_percent || null);

      synced++;
      if (!latest) latest = { ...measures, date, time, source: 'withings' };
    }

    console.log(`[Withings] Synced ${synced} weight measurements`);
    return latest;
  } catch (error) {
    console.error('[Withings] Sync error:', error.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// OAUTH SETUP FLOW
// ─────────────────────────────────────────────

/**
 * Generate the authorization URL for initial setup
 */
export function getAuthorizationURL() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WITHINGS_CLIENT_ID,
    redirect_uri: process.env.WITHINGS_REDIRECT_URI || 'https://rachida-coach-production.up.railway.app/api/withings/callback',
    scope: 'user.metrics,user.activity',
    state: 'rachida-coach'
  });

  return `${WITHINGS_AUTH}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(code) {
  const response = await axios.post(WITHINGS_TOKEN, new URLSearchParams({
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: process.env.WITHINGS_CLIENT_ID,
    client_secret: process.env.WITHINGS_CLIENT_SECRET,
    code,
    redirect_uri: process.env.WITHINGS_REDIRECT_URI || 'http://localhost:3000/callback'
  }));

  if (response.data.status !== 0) {
    throw new Error(`Withings auth failed: ${response.data.error}`);
  }

  const tokens = {
    access_token: response.data.body.access_token,
    refresh_token: response.data.body.refresh_token,
    expires_at: Date.now() + (response.data.body.expires_in * 1000)
  };

  saveTokens(tokens);
  return tokens;
}

/**
 * Check if Withings is configured and working
 */
export function isConfigured() {
  return !!(
    process.env.WITHINGS_CLIENT_ID &&
    process.env.WITHINGS_CLIENT_SECRET &&
    loadTokens()
  );
}
