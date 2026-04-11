// medications.js — Medication tracking for Rachida
// The coach NEVER recommends or changes doses.
// It only records what Rachida tells it and reminds her.

import Database from 'better-sqlite3';

const db = new Database('./db/health.db');

/**
 * Add a new medication
 */
export function addMedication({ name, dose, frequency, timing, reason, prescriber }) {
  // Check if already exists (active or inactive)
  const existing = db.prepare(
    'SELECT id, active FROM medications WHERE LOWER(name) = LOWER(?) LIMIT 1'
  ).get(name);

  if (existing && existing.active) {
    return { added: false, reason: 'already_exists', name };
  }

  if (existing && !existing.active) {
    // Reactivate
    db.prepare(
      'UPDATE medications SET active = 1, dose = ?, frequency = ?, timing = ?, reason = ?, prescriber = ? WHERE id = ?'
    ).run(dose, frequency, timing, reason, prescriber, existing.id);
    return { added: true, reactivated: true, id: existing.id, name };
  }

  const result = db.prepare(`
    INSERT INTO medications (name, dose, frequency, timing, reason, prescriber)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, dose || null, frequency || 'daily', timing || null, reason || null, prescriber || null);

  return { added: true, id: result.lastInsertRowid, name, dose, timing };
}

/**
 * Remove (deactivate) a medication
 */
export function removeMedication(name) {
  const result = db.prepare(
    'UPDATE medications SET active = 0 WHERE LOWER(name) = LOWER(?) AND active = 1'
  ).run(name);

  return { removed: result.changes > 0, name };
}

/**
 * Update a medication's details
 */
export function updateMedication(name, updates) {
  const med = db.prepare(
    'SELECT id FROM medications WHERE LOWER(name) = LOWER(?) AND active = 1 LIMIT 1'
  ).get(name);

  if (!med) return { updated: false, reason: 'not_found' };

  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (['dose', 'frequency', 'timing', 'reason', 'prescriber'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return { updated: false, reason: 'no_valid_fields' };

  values.push(med.id);
  db.prepare(`UPDATE medications SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { updated: true, name, changes: updates };
}

/**
 * List all active medications
 */
export function listMedications() {
  return db.prepare(
    'SELECT * FROM medications WHERE active = 1 ORDER BY timing, name'
  ).all();
}

/**
 * Mark a medication as taken today
 */
export function markMedicationTaken(name) {
  const med = db.prepare(
    'SELECT id, name FROM medications WHERE LOWER(name) = LOWER(?) AND active = 1 LIMIT 1'
  ).get(name);

  if (!med) return { taken: false, reason: 'not_found' };

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toTimeString().split(' ')[0];

  db.prepare(`
    INSERT INTO medication_log (date, medication_id, medication_name, taken, taken_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(today, med.id, med.name, now);

  return { taken: true, name: med.name, time: now };
}

/**
 * Get today's medication schedule with status
 */
export function getTodayMedicationSchedule() {
  const today = new Date().toISOString().split('T')[0];
  const meds = listMedications();

  const takenRows = db.prepare(
    'SELECT medication_id, taken_at FROM medication_log WHERE date = ? AND taken = 1'
  ).all(today);

  const takenMap = new Map(takenRows.map(r => [r.medication_id, r.taken_at]));

  return meds.map(m => ({
    ...m,
    taken_today: takenMap.has(m.id),
    taken_at: takenMap.get(m.id) || null
  }));
}

/**
 * Format medication schedule for display
 */
export function formatMedicationSchedule() {
  const meds = getTodayMedicationSchedule();
  if (meds.length === 0) return null;

  const groups = {};
  for (const m of meds) {
    const key = m.timing || 'non précisé';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }

  const timingLabels = {
    morning: 'Matin',
    morning_with_food: 'Matin (avec repas)',
    evening: 'Soir',
    before_sleep: 'Avant sommeil',
    with_food: 'Avec un repas',
    twice_daily: '2 fois par jour',
    'non précisé': 'Horaire non précisé'
  };

  let output = '';
  for (const [timing, meds] of Object.entries(groups)) {
    output += `${timingLabels[timing] || timing} :\n`;
    for (const m of meds) {
      const status = m.taken_today ? '✅' : '⬜';
      const dose = m.dose ? ` (${m.dose})` : '';
      const takenAt = m.taken_at ? ` — pris à ${m.taken_at}` : '';
      output += `  ${status} ${m.name}${dose}${takenAt}\n`;
    }
  }

  return output;
}

/**
 * Get medication context for the AI coach
 */
export function getMedicationContext() {
  const meds = listMedications();
  if (meds.length === 0) return 'Aucun médicament déclaré.';

  return meds.map(m => {
    let line = `- ${m.name}`;
    if (m.dose) line += ` ${m.dose}`;
    if (m.frequency) line += ` (${m.frequency})`;
    if (m.timing) line += ` — ${m.timing}`;
    if (m.reason) line += ` — pour : ${m.reason}`;
    return line;
  }).join('\n');
}

/**
 * Weekly medication adherence
 */
export function getWeeklyAdherence() {
  const meds = listMedications();
  const rows = db.prepare(`
    SELECT medication_name, COUNT(*) as days_taken
    FROM medication_log
    WHERE date >= date('now', '-7 days') AND taken = 1
    GROUP BY medication_id
  `).all();

  return meds.map(m => {
    const row = rows.find(r => r.medication_name === m.name);
    return {
      name: m.name,
      days_taken: row?.days_taken || 0,
      out_of: 7,
      adherence_pct: Math.round(((row?.days_taken || 0) / 7) * 100)
    };
  });
}
