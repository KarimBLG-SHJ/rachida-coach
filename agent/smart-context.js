// smart-context.js — The brain that decides what to ask each day
// 
// Rule: Never ask for something already tracked automatically.
// Rule: Never ask for something that isn't due yet.
// Rule: One ask at a time. Never stack requests.

import Database from 'better-sqlite3';

const db = new Database('./db/health.db');

// ─────────────────────────────────────────────
// WHAT IS DUE TODAY?
// Returns exactly what the app should ask/remind today
// ─────────────────────────────────────────────

export function getTodayContext() {
  const today = new Date().toISOString().split('T')[0];
  const dayOfMonth = new Date().getDate();
  const month = new Date().getMonth();

  return {
    weight:       shouldAskWeight(today),
    measurements: shouldAskMeasurements(today, dayOfMonth),
    photo:        shouldAskPhoto(today, dayOfMonth),
    bloodwork:    shouldAskBloodwork(today, month),
    mealLog:      getMealLogStatus(today),
    supplements:  getSupplementStatus(today),
  };
}

// ─────────────────────────────────────────────
// WEIGHT
// Only ask if:
// - No Withings auto-sync today AND
// - It's morning (before 10am) AND
// - No manual entry today
// ─────────────────────────────────────────────

function shouldAskWeight(today) {
  const hasWeightToday = db.prepare(`
    SELECT id FROM weight_log WHERE date = ? LIMIT 1
  `).get(today);

  if (hasWeightToday) {
    return { ask: false, reason: 'already_logged', value: hasWeightToday };
  }

  const hour = new Date().getHours();
  if (hour >= 10) {
    return { ask: false, reason: 'too_late_in_day' };
  }

  // Check how long since last weigh-in
  const lastWeight = db.prepare(`
    SELECT date, weight_kg FROM weight_log ORDER BY date DESC LIMIT 1
  `).get();

  const daysSinceLast = lastWeight
    ? Math.floor((new Date(today) - new Date(lastWeight.date)) / 86400000)
    : 999;

  // Don't nag if she weighed herself yesterday — just remind gently after 2+ days
  if (daysSinceLast === 1) {
    return { ask: false, reason: 'weighed_yesterday' };
  }

  if (daysSinceLast >= 2) {
    return {
      ask: true,
      priority: daysSinceLast >= 5 ? 'high' : 'low',
      message: daysSinceLast >= 5
        ? `Pas de pesée depuis ${daysSinceLast} jours. Pèse-toi ce matin pour suivre ta progression.`
        : `Tu n'as pas noté ton poids depuis 2 jours. Pensée rapide sur la balance ?`,
      last_date: lastWeight?.date,
      days_since: daysSinceLast
    };
  }

  return { ask: false, reason: 'no_data_yet' };
}

// ─────────────────────────────────────────────
// MEASUREMENTS
// Only ask:
// - Once per month (1st of month)
// - Or if 28+ days since last measurement
// Never ask mid-month
// ─────────────────────────────────────────────

function shouldAskMeasurements(today, dayOfMonth) {
  const lastMeasurement = db.prepare(`
    SELECT date FROM measurements ORDER BY date DESC LIMIT 1
  `).get();

  if (!lastMeasurement) {
    // First time ever — ask once (not on day 1 necessarily)
    return {
      ask: true,
      priority: 'medium',
      message: 'Tu n\'as jamais enregistré tes mensurations. C\'est important pour voir la vraie progression (le poids ne dit pas tout).',
      first_time: true
    };
  }

  const daysSinceLast = Math.floor(
    (new Date(today) - new Date(lastMeasurement.date)) / 86400000
  );

  // Only ask if 28+ days have passed AND it's the 1st of the month
  // This means she gets ONE reminder per month, not multiple
  if (dayOfMonth === 1 && daysSinceLast >= 25) {
    return {
      ask: true,
      priority: 'low',
      message: `C'est le 1er du mois — moment de prendre tes mensurations.\nDernière fois : ${lastMeasurement.date} (il y a ${daysSinceLast} jours).\nLance : /mensuration`,
      days_since: daysSinceLast
    };
  }

  if (daysSinceLast >= 45) {
    // More than 6 weeks — remind even if not 1st of month
    return {
      ask: true,
      priority: 'medium',
      message: `Tu n'as pas pris tes mensurations depuis ${daysSinceLast} jours. Lance /mensuration quand tu as 5 minutes.`,
      days_since: daysSinceLast
    };
  }

  return {
    ask: false,
    reason: 'not_due',
    next_due: `~${28 - daysSinceLast} jours`,
    days_since: daysSinceLast
  };
}

// ─────────────────────────────────────────────
// PROGRESS PHOTO
// Only ask:
// - Once per month (1st of month)
// - Or if 30+ days since last photo
// ─────────────────────────────────────────────

function shouldAskPhoto(today, dayOfMonth) {
  const lastPhoto = db.prepare(`
    SELECT date FROM progress_photos ORDER BY date DESC LIMIT 1
  `).get();

  if (!lastPhoto) {
    return {
      ask: true,
      priority: 'low',
      message: 'Tu n\'as pas encore de photo de départ. Une photo de référence permet de voir les vrais changements que la balance ne montre pas.',
      first_time: true
    };
  }

  const daysSinceLast = Math.floor(
    (new Date(today) - new Date(lastPhoto.date)) / 86400000
  );

  if (dayOfMonth === 1 && daysSinceLast >= 25) {
    return {
      ask: true,
      priority: 'low',
      message: `Photo de progression du mois !\nDernière : ${lastPhoto.date}.\nLance : /photo`,
      days_since: daysSinceLast
    };
  }

  return {
    ask: false,
    reason: 'not_due',
    days_since: daysSinceLast,
    next_due: `~${30 - daysSinceLast} jours`
  };
}

// ─────────────────────────────────────────────
// BLOOD WORK
// Only remind quarterly (every ~90 days)
// Just a suggestion — never urgent
// ─────────────────────────────────────────────

function shouldAskBloodwork(today, month) {
  const lastBloodwork = db.prepare(`
    SELECT MAX(test_date) as date FROM bloodwork
  `).get();

  if (!lastBloodwork?.date) {
    // Never done — suggest once
    return {
      ask: true,
      priority: 'low',
      message: 'Aucune prise de sang enregistrée. Un bilan de départ (vitamine D, fer, thyroïde, glycémie) aide à personnaliser ton coaching.',
      first_time: true
    };
  }

  const daysSinceLast = Math.floor(
    (new Date(today) - new Date(lastBloodwork.date)) / 86400000
  );

  // Remind quarterly (90 days), only on 1st of quarter months (Jan, Apr, Jul, Oct)
  const isQuarterMonth = [0, 3, 6, 9].includes(month);
  const dueDate = new Date(today).getDate() === 1;

  if (isQuarterMonth && dueDate && daysSinceLast >= 80) {
    return {
      ask: true,
      priority: 'low',
      message: `Bilan sanguin trimestriel recommandé.\nDernier : ${lastBloodwork.date} (il y a ${daysSinceLast} jours).\nMarqueurs à demander : Vit D, B12, Fer, TSH, Glycémie, Cholestérol.`,
      days_since: daysSinceLast
    };
  }

  return {
    ask: false,
    reason: 'not_due',
    days_since: daysSinceLast
  };
}

// ─────────────────────────────────────────────
// MEAL LOG STATUS
// Returns what meals have/haven't been logged today
// ─────────────────────────────────────────────

function getMealLogStatus(today) {
  const meals = db.prepare(`
    SELECT meal_type, COUNT(*) as count
    FROM meal_log WHERE date = ?
    GROUP BY meal_type
  `).all(today);

  const logged = new Set(meals.map(m => m.meal_type));
  const hour = new Date().getHours();

  return {
    breakfast: logged.has('breakfast'),
    lunch: logged.has('lunch'),
    dinner: logged.has('dinner'),
    total_meals: meals.length,
    // What's missing based on time of day
    missing: getMissingMeals(logged, hour)
  };
}

function getMissingMeals(logged, hour) {
  const missing = [];
  if (hour >= 10 && !logged.has('breakfast')) missing.push('breakfast');
  if (hour >= 14 && !logged.has('lunch'))     missing.push('lunch');
  if (hour >= 21 && !logged.has('dinner'))    missing.push('dinner');
  return missing;
}

// ─────────────────────────────────────────────
// SUPPLEMENT STATUS
// ─────────────────────────────────────────────

function getSupplementStatus(today) {
  const taken = db.prepare(`
    SELECT supplement_id FROM supplement_log
    WHERE date = ? AND taken = 1
  `).all(today);

  return {
    taken_count: taken.length,
    taken_ids: taken.map(r => r.supplement_id)
  };
}

// ─────────────────────────────────────────────
// MORNING BRIEF FILTER
// Decides what to include in the morning brief
// Only includes what's relevant TODAY
// ─────────────────────────────────────────────

export function getMorningBriefItems() {
  const context = getTodayContext();
  const items = [];

  // Always include: macros, prayer times, meal reminder
  items.push({ type: 'macros', priority: 'always' });
  items.push({ type: 'prayer_times', priority: 'always' });
  items.push({ type: 'pedagogical_fact', priority: 'always' });
  items.push({ type: 'micro_objective', priority: 'always' });

  // Conditionally include weight
  if (context.weight.ask) {
    items.push({ type: 'weight_reminder', priority: context.weight.priority, data: context.weight });
  }

  // Monthly items — only if due (shown at bottom, low priority)
  if (context.measurements.ask) {
    items.push({ type: 'measurement_reminder', priority: 'low', data: context.measurements });
  }

  if (context.photo.ask) {
    items.push({ type: 'photo_reminder', priority: 'low', data: context.photo });
  }

  // Quarterly — only if 1st of quarter
  if (context.bloodwork.ask) {
    items.push({ type: 'bloodwork_reminder', priority: 'low', data: context.bloodwork });
  }

  return items;
}

// ─────────────────────────────────────────────
// SMART REMINDER DECISION
// Call this before sending any reminder
// Returns: { send: bool, reason: string }
// ─────────────────────────────────────────────

export function shouldSendReminder(type) {
  const context = getTodayContext();

  switch (type) {
    case 'weight':
      return { send: context.weight.ask, reason: context.weight.reason };

    case 'measurements':
      return { send: context.measurements.ask, data: context.measurements };

    case 'photo':
      return { send: context.photo.ask, data: context.photo };

    case 'bloodwork':
      return { send: context.bloodwork.ask, data: context.bloodwork };

    case 'meal_lunch':
      return { send: !context.mealLog.lunch, reason: context.mealLog.lunch ? 'already_logged' : 'not_logged' };

    case 'meal_dinner':
      return { send: !context.mealLog.dinner, reason: context.mealLog.dinner ? 'already_logged' : 'not_logged' };

    default:
      return { send: true };
  }
}
