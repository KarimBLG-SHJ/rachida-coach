// supplement-check.js — Supplement tracking and verification
// Checks timing, interactions, and blood work correlation

import db from '../db/connection.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const supplements = JSON.parse(
  readFileSync(join(__dirname, '../data/supplements.json'), 'utf-8')
);

/**
 * Get today's supplement schedule with status
 */
export function getTodaySchedule() {
  const today = new Date().toISOString().split('T')[0];
  const takenRows = db.prepare(
    'SELECT supplement_id, taken, taken_at FROM supplement_log WHERE date = ?'
  ).all(today);

  const takenMap = new Map(takenRows.map(r => [r.supplement_id, r]));

  return supplements.map(s => {
    const log = takenMap.get(s.id);
    return {
      ...s,
      taken: log?.taken === 1,
      taken_at: log?.taken_at || null
    };
  });
}

/**
 * Mark a supplement as taken
 */
export function markTaken(supplementId) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toTimeString().split(' ')[0];
  const supp = supplements.find(s => s.id === supplementId);
  if (!supp) return null;

  db.prepare(`
    INSERT INTO supplement_log (date, supplement_id, supplement_name, scheduled_time, taken, taken_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT DO NOTHING
  `).run(today, supplementId, supp.name, supp.reminder_time, now);

  return { name: supp.name, taken_at: now };
}

/**
 * Get which supplements are due right now
 * Based on current time vs scheduled time
 */
export function getDueNow() {
  const now = new Date();
  const currentHour = now.getHours();
  const today = now.toISOString().split('T')[0];

  const takenToday = new Set(
    db.prepare(
      'SELECT supplement_id FROM supplement_log WHERE date = ? AND taken = 1'
    ).all(today).map(r => r.supplement_id)
  );

  return supplements.filter(s => {
    if (takenToday.has(s.id)) return false;
    const [hour] = s.reminder_time.split(':').map(Number);
    // Due if we're within 1 hour of the scheduled time
    return Math.abs(currentHour - hour) <= 1;
  });
}

/**
 * Check supplements against latest blood work
 * Returns recommendations if blood levels suggest adjustment
 */
export function checkAgainstBloodwork() {
  const recommendations = [];

  for (const supp of supplements) {
    if (!supp.check_in_bloodwork) continue;

    const latest = db.prepare(`
      SELECT value, unit, reference_min, reference_max, status, test_date
      FROM bloodwork
      WHERE marker = ?
      ORDER BY test_date DESC LIMIT 1
    `).get(supp.check_in_bloodwork);

    if (!latest) continue;

    const optimal = supp.optimal_blood_level;
    if (!optimal) continue;

    if (latest.value < optimal.min) {
      recommendations.push({
        supplement: supp.name,
        marker: supp.check_in_bloodwork,
        current_value: `${latest.value} ${latest.unit || optimal.unit}`,
        optimal_range: `${optimal.min}–${optimal.max} ${optimal.unit}`,
        status: 'low',
        suggestion: `Ton ${supp.check_in_bloodwork} est bas (${latest.value}). Parle à ton médecin d'augmenter la dose de ${supp.name}.`,
        test_date: latest.test_date
      });
    } else if (latest.value > optimal.max) {
      recommendations.push({
        supplement: supp.name,
        marker: supp.check_in_bloodwork,
        current_value: `${latest.value} ${latest.unit || optimal.unit}`,
        optimal_range: `${optimal.min}–${optimal.max} ${optimal.unit}`,
        status: 'high',
        suggestion: `Ton ${supp.check_in_bloodwork} est élevé (${latest.value}). Tu pourrais réduire ${supp.name}. Vérifie avec ton médecin.`,
        test_date: latest.test_date
      });
    }
  }

  return recommendations;
}

/**
 * Get weekly supplement adherence
 */
export function getWeeklyAdherence() {
  const rows = db.prepare(`
    SELECT supplement_name, COUNT(*) as days_taken
    FROM supplement_log
    WHERE date >= date('now', '-7 days') AND taken = 1
    GROUP BY supplement_id
  `).all();

  return supplements.map(s => {
    const row = rows.find(r => r.supplement_name === s.name);
    return {
      name: s.name,
      days_taken: row?.days_taken || 0,
      out_of: 7,
      adherence_pct: Math.round(((row?.days_taken || 0) / 7) * 100)
    };
  });
}

/**
 * Format supplement schedule for display
 */
export function formatSchedule() {
  const schedule = getTodaySchedule();
  let output = '';

  const groups = {
    'Matin (avec petit-déjeuner)': schedule.filter(s => s.timing === 'morning_with_food'),
    'Déjeuner': schedule.filter(s => s.timing === 'lunch'),
    'Soir (avant sommeil)': schedule.filter(s => s.timing === 'evening_before_sleep')
  };

  for (const [label, supps] of Object.entries(groups)) {
    if (supps.length === 0) continue;
    output += `${label} :\n`;
    supps.forEach(s => {
      const status = s.taken ? '✅' : '⬜';
      output += `  ${status} ${s.name} (${s.dose})${s.taken_at ? ` — pris à ${s.taken_at}` : ''}\n`;
    });
  }

  return output;
}
