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
 * Returns: { weight_kg, fat_percent, muscle_percent, bone_mass_kg, date }
 */
export async function getLatestWeight() {
  try {
    const token = await getAccessToken();

    const response = await axios.post(`${WITHINGS_API}/measure`, new URLSearchParams({
      action: 'getmeas',
      meastype: '1,6,8,88', // weight, fat%, muscle%, bone mass
      category: 1, // real measures only
      lastupdate: Math.floor(Date.now() / 1000) - 86400 * 7 // last 7 days
    }), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.data.status !== 0) {
      throw new Error(`Withings API error: ${response.data.error}`);
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
        case 1:  measures.weight_kg = Math.round(value * 10) / 10; break;
        case 6:  measures.fat_percent = Math.round(value * 10) / 10; break;
        case 8:  measures.muscle_percent = Math.round(value * 10) / 10; break;
        case 88: measures.bone_mass_kg = Math.round(value * 100) / 100; break;
      }
    }

    return { ...measures, date, time, source: 'withings' };

  } catch (error) {
    console.error('[Withings] Error:', error.message);
    return null;
  }
}

/**
 * Sync latest weight to database
 * Call this on a schedule (morning) or on demand
 */
export async function syncWeight() {
  const data = await getLatestWeight();
  if (!data || !data.weight_kg) return null;

  // Check if we already have this measurement
  const existing = db.prepare(
    'SELECT id FROM weight_log WHERE date = ? AND source = ? LIMIT 1'
  ).get(data.date, 'withings');

  if (existing) return null; // Already synced

  db.prepare(`
    INSERT INTO weight_log (date, time, weight_kg, fat_percent, muscle_percent, bone_mass_kg, source)
    VALUES (?, ?, ?, ?, ?, ?, 'withings')
  `).run(data.date, data.time, data.weight_kg, data.fat_percent, data.muscle_percent, data.bone_mass_kg);

  console.log(`[Withings] Synced: ${data.weight_kg} kg on ${data.date}`);
  return data;
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
