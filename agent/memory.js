// memory.js — Persistent memory for the coach
// Stores preferences, patterns, what works, what doesn't
// All stored in SQLite coach_memory table

import db from '../db/connection.js';

/**
 * Get a memory value by key
 */
export function get(key) {
  const row = db.prepare('SELECT value, category FROM coach_memory WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Set a memory value (upsert)
 */
export function set(key, value, category = 'general') {
  db.prepare(`
    INSERT INTO coach_memory (key, value, category, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, category = ?, updated_at = datetime('now')
  `).run(key, value, category, value, category);
}

/**
 * Delete a memory key
 */
export function remove(key) {
  db.prepare('DELETE FROM coach_memory WHERE key = ?').run(key);
}

/**
 * Get all memories in a category
 */
export function getByCategory(category) {
  return db.prepare('SELECT key, value FROM coach_memory WHERE category = ?').all(category);
}

/**
 * Get all memories (for coach context)
 */
export function getAll() {
  return db.prepare('SELECT key, value, category FROM coach_memory ORDER BY category').all();
}

/**
 * Build a context string for the AI coach
 * Returns a formatted summary of everything we remember about Rachida
 */
export function buildCoachContext() {
  const memories = getAll();
  if (memories.length === 0) return 'Aucune mémoire enregistrée.';

  const grouped = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push({ key: m.key, value: m.value });
  }

  let context = 'Ce que je sais sur Rachida :\n';

  if (grouped.preference) {
    context += '\nPréférences alimentaires :\n';
    grouped.preference.forEach(m => {
      if (m.value) context += `- ${m.key}: ${m.value}\n`;
    });
  }

  if (grouped.pattern) {
    context += '\nHabitudes observées :\n';
    grouped.pattern.forEach(m => {
      context += `- ${m.key}: ${m.value}\n`;
    });
  }

  if (grouped.achievement) {
    context += '\nProgression :\n';
    grouped.achievement.forEach(m => {
      context += `- ${m.key}: ${m.value}\n`;
    });
  }

  if (grouped.insight) {
    context += '\nObservations du coach :\n';
    grouped.insight.forEach(m => {
      context += `- ${m.key}: ${m.value}\n`;
    });
  }

  return context;
}

/**
 * Record a food preference automatically
 * Called after each meal log to track what she eats most
 */
export function recordFoodPreference(items) {
  const current = get('food_history') || '';
  const foods = items.map(i => i.name.toLowerCase()).join(', ');
  const updated = current ? `${current}, ${foods}` : foods;
  // Keep only the last 100 items
  const trimmed = updated.split(', ').slice(-100).join(', ');
  set('food_history', trimmed, 'preference');
}

/**
 * Record what worked or didn't work
 */
export function recordInsight(key, value) {
  set(key, value, 'insight');
}

/**
 * Update a food preference (like/dislike/allergy)
 */
export function updatePreference(type, value) {
  const validTypes = ['favorite_protein', 'favorite_carbs', 'favorite_vegetables',
                      'favorite_snacks', 'dislikes', 'allergies'];

  if (type === 'dislikes' || type === 'allergies') {
    const current = get(type) || '';
    const items = current ? current.split(', ').filter(Boolean) : [];
    if (!items.includes(value.toLowerCase())) {
      items.push(value.toLowerCase());
    }
    set(type, items.join(', '), 'preference');
    return { updated: true, type, value: items.join(', ') };
  }

  if (validTypes.includes(type)) {
    set(type, value, 'preference');
    return { updated: true, type, value };
  }

  // Generic preference
  set(type, value, 'preference');
  return { updated: true, type, value };
}

/**
 * Update Rachida's goal weight
 */
export function updateGoal(goalWeight) {
  set('goal_weight_kg', String(goalWeight), 'achievement');
  return { updated: true, goal_weight_kg: goalWeight };
}

/**
 * Store any free-form info Rachida shares about herself
 */
export function rememberInfo(key, value, category = 'general') {
  set(key, value, category);
  return { stored: true, key, value };
}

/**
 * Get the last 30 days of weight data for trend analysis
 */
export function getWeightHistory(days = 30) {
  return db.prepare(`
    SELECT date, weight_kg, fat_percent
    FROM weight_log
    WHERE date >= date('now', '-${days} days')
    ORDER BY date ASC
  `).all();
}

/**
 * Get meal patterns — what does she eat most?
 */
export function getMealPatterns() {
  const rows = db.prepare(`
    SELECT description, meal_type, calories, protein_g
    FROM meal_log
    WHERE date >= date('now', '-30 days')
    ORDER BY date DESC
  `).all();

  return {
    total_meals: rows.length,
    avg_calories: rows.length ? Math.round(rows.reduce((s, r) => s + r.calories, 0) / rows.length) : 0,
    avg_protein: rows.length ? Math.round(rows.reduce((s, r) => s + r.protein_g, 0) / rows.length) : 0,
    recent_meals: rows.slice(0, 10).map(r => r.description)
  };
}
