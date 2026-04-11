// apple-health.js — Parse Apple Health export XML
//
// Apple Health data can be exported from:
// iPhone → Health app → Profile icon → Export All Health Data
//
// This produces a ZIP with export.xml inside.
// This module parses that XML and extracts:
// - Steps, active calories, exercise minutes
// - Resting heart rate
// - Sleep analysis
//
// For automatic sync: use iOS Shortcuts to export daily CSV
// and drop it into data/apple-health/

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db/connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEALTH_DIR = join(__dirname, '../data/apple-health');

// ─────────────────────────────────────────────
// XML PARSER (lightweight — no dependency needed)
// Apple Health XML uses <Record> elements
// ─────────────────────────────────────────────

/**
 * Parse Apple Health export.xml and extract daily summaries
 * @param {string} xmlPath - Path to export.xml
 * @param {number} days - How many days back to parse (default 30)
 */
export function parseExport(xmlPath, days = 30) {
  if (!existsSync(xmlPath)) {
    throw new Error(`File not found: ${xmlPath}`);
  }

  const xml = readFileSync(xmlPath, 'utf-8');
  const cutoffDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  const dailyData = {};

  // Extract step count records
  const stepRegex = /<Record type="HKQuantityTypeIdentifierStepCount"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
  let match;
  while ((match = stepRegex.exec(xml)) !== null) {
    const date = match[1].substring(0, 10);
    if (date < cutoffDate) continue;
    if (!dailyData[date]) dailyData[date] = { steps: 0, active_cal: 0, exercise_min: 0, rhr: null };
    dailyData[date].steps += parseInt(match[2]);
  }

  // Extract active calories
  const calRegex = /<Record type="HKQuantityTypeIdentifierActiveEnergyBurned"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
  while ((match = calRegex.exec(xml)) !== null) {
    const date = match[1].substring(0, 10);
    if (date < cutoffDate) continue;
    if (!dailyData[date]) dailyData[date] = { steps: 0, active_cal: 0, exercise_min: 0, rhr: null };
    dailyData[date].active_cal += parseFloat(match[2]);
  }

  // Extract exercise minutes
  const exerciseRegex = /<Record type="HKQuantityTypeIdentifierAppleExerciseTime"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
  while ((match = exerciseRegex.exec(xml)) !== null) {
    const date = match[1].substring(0, 10);
    if (date < cutoffDate) continue;
    if (!dailyData[date]) dailyData[date] = { steps: 0, active_cal: 0, exercise_min: 0, rhr: null };
    dailyData[date].exercise_min += parseFloat(match[2]);
  }

  // Extract resting heart rate
  const rhrRegex = /<Record type="HKQuantityTypeIdentifierRestingHeartRate"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"/g;
  while ((match = rhrRegex.exec(xml)) !== null) {
    const date = match[1].substring(0, 10);
    if (date < cutoffDate) continue;
    if (!dailyData[date]) dailyData[date] = { steps: 0, active_cal: 0, exercise_min: 0, rhr: null };
    dailyData[date].rhr = parseInt(match[2]);
  }

  return dailyData;
}

/**
 * Import parsed data into SQLite
 */
export function importToDatabase(dailyData) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO activity_log
    (date, steps, active_calories, exercise_minutes, resting_heart_rate, source)
    VALUES (?, ?, ?, ?, ?, 'apple_watch')
  `);

  const insert = db.transaction((data) => {
    let count = 0;
    for (const [date, d] of Object.entries(data)) {
      stmt.run(date, d.steps, Math.round(d.active_cal), Math.round(d.exercise_min), d.rhr);
      count++;
    }
    return count;
  });

  return insert(dailyData);
}

/**
 * Full import: parse XML + save to DB
 */
export function importAppleHealth(xmlPath, days = 30) {
  console.log(`[Apple Health] Parsing ${xmlPath}...`);
  const data = parseExport(xmlPath, days);
  const count = importToDatabase(data);
  console.log(`[Apple Health] Imported ${count} days of data.`);
  return count;
}

/**
 * Parse a daily CSV file (from iOS Shortcuts automation)
 * Expected format: date,steps,active_cal,exercise_min,rhr
 */
export function parseDailyCSV(csvPath) {
  if (!existsSync(csvPath)) return null;

  const content = readFileSync(csvPath, 'utf-8').trim();
  const lines = content.split('\n').slice(1); // skip header

  for (const line of lines) {
    const [date, steps, active_cal, exercise_min, rhr] = line.split(',');
    if (!date) continue;

    db.prepare(`
      INSERT OR REPLACE INTO activity_log
      (date, steps, active_calories, exercise_minutes, resting_heart_rate, source)
      VALUES (?, ?, ?, ?, ?, 'apple_watch_csv')
    `).run(date.trim(), parseInt(steps), parseFloat(active_cal), parseInt(exercise_min), rhr ? parseInt(rhr) : null);
  }
}

/**
 * Auto-import any CSV files dropped in data/apple-health/
 */
export function autoImportCSV() {
  if (!existsSync(HEALTH_DIR)) return 0;

  const files = readdirSync(HEALTH_DIR).filter(f => f.endsWith('.csv'));
  let imported = 0;

  for (const file of files) {
    parseDailyCSV(join(HEALTH_DIR, file));
    imported++;
  }

  if (imported > 0) {
    console.log(`[Apple Health] Auto-imported ${imported} CSV file(s).`);
  }

  return imported;
}

/**
 * Get today's activity data (if available)
 */
export function getTodayActivity() {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare(
    'SELECT * FROM activity_log WHERE date = ? LIMIT 1'
  ).get(today);
}

/**
 * Get weekly activity summary
 */
export function getWeeklyActivity() {
  return db.prepare(`
    SELECT
      COUNT(*) as days_tracked,
      COALESCE(AVG(steps), 0) as avg_steps,
      COALESCE(AVG(active_calories), 0) as avg_active_cal,
      COALESCE(AVG(exercise_minutes), 0) as avg_exercise_min,
      COALESCE(MAX(steps), 0) as best_steps_day
    FROM activity_log
    WHERE date >= date('now', '-7 days')
  `).get();
}
