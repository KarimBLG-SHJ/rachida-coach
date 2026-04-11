// smart-schedule.js — Adaptive reminder engine
//
// The rule: never ask Rachida for something we already have.
// Before every reminder, check what data exists.
// Only interrupt her if something is actually missing and actually matters today.

import db from '../db/connection.js';
import cron from 'node-cron';
import chalk from 'chalk';
import { notify } from './notifications.js';
import { isNearPrayer } from '../integrations/prayer-times.js';
import { listMedications } from '../commands/medications.js';
import { syncWeight, isConfigured as isWithingsConfigured } from '../integrations/withings.js';
import { autoImportCSV as autoImportAppleHealth } from '../integrations/apple-health.js';

// ─────────────────────────────────────────────
// DATA FRESHNESS CHECK
// Core function. Answers: "what does Rachida still need to do today?"
// ─────────────────────────────────────────────

export function whatIsMissing() {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const hour = now.getHours();
  const missing = [];

  // ── WEIGHT ────────────────────────────────────
  // Ask only if: no weight logged today AND it's morning (before 10am)
  // If Withings is synced automatically → this will never trigger
  const weightToday = db.prepare(
    'SELECT id FROM weight_log WHERE date = ? LIMIT 1'
  ).get(today);

  if (!weightToday && hour < 10) {
    const daysSinceLastWeight = getDaysSince(
      'SELECT MAX(date) as d FROM weight_log'
    );
    missing.push({
      type: 'weight',
      priority: daysSinceLastWeight > 3 ? 'high' : 'low',
      message: daysSinceLastWeight > 3
        ? `Tu n'as pas pesé depuis ${daysSinceLastWeight} jours. Pèse-toi maintenant pour que je suive ta progression.`
        : `Pesée du matin — avant de manger, après les toilettes. 1 minute.`,
      command: null
    });
  }

  // ── MEALS ─────────────────────────────────────
  // Lunch: ask only at 12:30 if lunch not logged yet
  // Dinner: ask only at 19:00 if dinner not logged yet
  // Never ask twice for the same meal
  if (hour >= 12 && hour < 15) {
    const lunchLogged = db.prepare(
      "SELECT id FROM meal_log WHERE date = ? AND meal_type = 'lunch' LIMIT 1"
    ).get(today);
    if (!lunchLogged) {
      missing.push({
        type: 'meal_lunch',
        priority: 'medium',
        message: `Déjeuner — dis-moi ce que tu as mangé. Même rapide : "poulet riz salade".`,
        command: '/repas lunch'
      });
    }
  }

  if (hour >= 19 && hour < 22) {
    const dinnerLogged = db.prepare(
      "SELECT id FROM meal_log WHERE date = ? AND meal_type = 'dinner' LIMIT 1"
    ).get(today);
    if (!dinnerLogged) {
      const consumed = db.prepare(
        "SELECT COALESCE(SUM(calories),0) as cal FROM meal_log WHERE date = ?"
      ).get(today);
      const target = db.prepare(
        'SELECT calories_target FROM daily_targets WHERE date = ?'
      ).get(today);

      const remaining = target
        ? Math.round(target.calories_target - consumed.cal)
        : 600;

      missing.push({
        type: 'meal_dinner',
        priority: 'medium',
        message: `Il te reste environ ${remaining} kcal pour ce soir. Qu'est-ce que tu as mangé ?`,
        command: '/repas dinner'
      });
    }
  }

  // ── MEASUREMENTS ─────────────────────────────
  // Ask ONCE A MONTH — only on the 1st, only if 28+ days since last
  // Never interrupt a normal day for this
  const dayOfMonth = now.getDate();
  if (dayOfMonth === 1) {
    const daysSinceMeasure = getDaysSince(
      'SELECT MAX(date) as d FROM measurements'
    );
    if (daysSinceMeasure === null || daysSinceMeasure >= 28) {
      missing.push({
        type: 'measurements',
        priority: 'low',
        message: `C'est le 1er du mois — 5 minutes pour tes mensurations ?\nLance : node index.js mensuration`,
        command: 'mensuration'
      });
    }
    // If less than 28 days → skip silently. She did it recently.
  }

  // ── PROGRESS PHOTO ───────────────────────────
  // Same logic — once a month, only on the 1st, only if 28+ days
  if (dayOfMonth === 1) {
    const daysSincePhoto = getDaysSince(
      'SELECT MAX(date) as d FROM progress_photos'
    );
    if (daysSincePhoto === null || daysSincePhoto >= 28) {
      missing.push({
        type: 'photo',
        priority: 'low',
        message: `Photo de progression du mois !\nMême fond, même heure, même tenue qu'avant.\nLance : node index.js photo <chemin>`,
        command: 'photo'
      });
    }
  }

  // ── BLOOD WORK ───────────────────────────────
  // Remind every 3 months — only in January, April, July, October
  const month = now.getMonth() + 1; // 1-12
  const isQuarterStart = [1, 4, 7, 10].includes(month) && dayOfMonth <= 7;
  if (isQuarterStart) {
    const daysSinceBloodwork = getDaysSince(
      'SELECT MAX(test_date) as d FROM bloodwork'
    );
    if (daysSinceBloodwork === null || daysSinceBloodwork >= 80) {
      missing.push({
        type: 'bloodwork',
        priority: 'low',
        message: buildBloodworkReminder(daysSinceBloodwork),
        command: null
      });
    }
  }

  return missing;
}

// ─────────────────────────────────────────────
// SEDENTARY ALERT — smarter version
// Only fires if we have evidence she's been sitting
// Uses Apple Watch step data if available
// ─────────────────────────────────────────────

export function shouldSendSedentaryAlert(alertsSentToday) {
  if (alertsSentToday >= 4) return false;

  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();

  // Only during work hours
  if (hour < 9 || hour > 18) return false;

  // Check if she logged steps recently (Apple Watch sync)
  const recentActivity = db.prepare(`
    SELECT steps FROM activity_log
    WHERE date = ?
    ORDER BY rowid DESC LIMIT 1
  `).get(today);

  // If we have Apple Watch data and steps are already high → don't bother her
  if (recentActivity && recentActivity.steps > 8000) return false;

  return true;
}

// ─────────────────────────────────────────────
// DAILY SUMMARY CHECK
// Has she had a good day? Adapt the evening message.
// ─────────────────────────────────────────────

export function getDaySummaryContext() {
  const today = new Date().toISOString().split('T')[0];

  const meals = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(calories),0) as cal,
           COALESCE(SUM(protein_g),0) as protein
    FROM meal_log WHERE date = ?
  `).get(today);

  const target = db.prepare(
    'SELECT calories_target, protein_target_g FROM daily_targets WHERE date = ?'
  ).get(today);

  const weight = db.prepare(
    'SELECT weight_kg FROM weight_log WHERE date = ? LIMIT 1'
  ).get(today);

  const activity = db.prepare(
    'SELECT steps FROM activity_log WHERE date = ? LIMIT 1'
  ).get(today);

  const results = {
    meals_logged: meals.count,
    calories_consumed: Math.round(meals.cal),
    calories_target: target?.calories_target || 1650,
    protein_consumed: Math.round(meals.protein),
    protein_target: target?.protein_target_g || 120,
    weight_logged: !!weight,
    steps: activity?.steps || 0,
  };

  // Score the day (for motivational message)
  let score = 0;
  if (results.weight_logged) score += 1;
  if (results.meals_logged >= 2) score += 1;
  if (results.calories_consumed <= results.calories_target) score += 1;
  if (results.protein_consumed >= results.protein_target * 0.8) score += 1;
  if (results.steps >= 7000) score += 1;

  results.day_score = score; // 0-5
  results.day_quality = score >= 4 ? 'excellent' : score >= 2 ? 'bien' : 'passable';

  return results;
}

// ─────────────────────────────────────────────
// MAIN SCHEDULER — using smart checks
// ─────────────────────────────────────────────

let sedentaryAlertsToday = 0;
let lastAlertDate = '';

export function startSmartScheduler() {
  console.log(chalk.green('🧠 Smart scheduler started — reminders adapt to real data'));

  // ── STARTUP: Sync external data ──────────────
  // Withings: auto-sync weight if configured
  if (isWithingsConfigured()) {
    syncWeight().then(data => {
      if (data) console.log(chalk.green(`⚖️ Withings sync: ${data.weight_kg} kg`));
    }).catch(() => {});
  }

  // Apple Health: auto-import CSV files dropped in data/apple-health/
  autoImportAppleHealth();

  // ── 7:10 AM — Daily Withings sync ────────────
  cron.schedule('10 7 * * *', async () => {
    if (!isWithingsConfigured()) return;
    try {
      const data = await syncWeight();
      if (data) console.log(`[Withings] Synced: ${data.weight_kg} kg`);
    } catch {}
  }, { timezone: 'Asia/Dubai' });

  // ── 7:00 AM — Daily Apple Health CSV check ───
  cron.schedule('0 7 * * *', () => {
    autoImportAppleHealth();
  }, { timezone: 'Asia/Dubai' });

  // Reset daily counter at midnight
  cron.schedule('0 0 * * *', () => {
    sedentaryAlertsToday = 0;
    lastAlertDate = new Date().toISOString().split('T')[0];
  }, { timezone: 'Asia/Dubai' });

  // ── 7:15 AM — Morning check ───────────────────
  cron.schedule('15 7 * * *', async () => {
    const missing = whatIsMissing();
    const weightMissing = missing.find(m => m.type === 'weight');
    if (!weightMissing) return; // Already have weight → silent

    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    notify('⚖️ Pesée du matin', weightMissing.message);
  }, { timezone: 'Asia/Dubai' });

  // ── 7:30 AM — Morning brief (always) ─────────
  cron.schedule('30 7 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    notify('🌅 Ton brief du jour', 'Ouvre le coach pour ton plan du jour — macros, prières, objectif.');
  }, { timezone: 'Asia/Dubai' });

  // ── 8:00 AM — Supplements ─────────────────────
  cron.schedule('0 8 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    notify('💊 Compléments du matin', 'Vitamine D3 + B12 avec ton petit-déjeuner.\nPourquoi maintenant ? Ils s\'absorbent mieux avec de la nourriture.');
  }, { timezone: 'Asia/Dubai' });

  // ── 8:05 AM — Medication reminders ─────────────
  cron.schedule('5 8 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const meds = listMedications();
    const morningMeds = meds.filter(m =>
      m.timing === 'morning' || m.timing === 'morning_with_food' || m.timing === 'with_food'
    );

    if (morningMeds.length > 0) {
      const names = morningMeds.map(m => `${m.name}${m.dose ? ` (${m.dose})` : ''}`).join(', ');
      notify('💊 Médicaments du matin', `N'oublie pas : ${names}\nAvec ton petit-déjeuner.`);
    }
  }, { timezone: 'Asia/Dubai' });

  // ── 9:00 PM — Evening medication reminders ────
  cron.schedule('5 21 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const meds = listMedications();
    const eveningMeds = meds.filter(m =>
      m.timing === 'evening' || m.timing === 'before_sleep'
    );

    if (eveningMeds.length > 0) {
      const names = eveningMeds.map(m => `${m.name}${m.dose ? ` (${m.dose})` : ''}`).join(', ');
      notify('💊 Médicaments du soir', `N'oublie pas : ${names}`);
    }
  }, { timezone: 'Asia/Dubai' });

  // ── 12:30 PM — Lunch check ─────────────────────
  cron.schedule('30 12 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const missing = whatIsMissing();
    const lunchMissing = missing.find(m => m.type === 'meal_lunch');
    if (!lunchMissing) return; // Already logged → no notification

    notify('🍽️ Déjeuner', lunchMissing.message);
  }, { timezone: 'Asia/Dubai' });

  // ── 1:15 PM — Lunch follow-up (one time only) ─
  cron.schedule('15 13 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const today = new Date().toISOString().split('T')[0];
    const lunchLogged = db.prepare(
      "SELECT id FROM meal_log WHERE date = ? AND meal_type = 'lunch' LIMIT 1"
    ).get(today);

    if (!lunchLogged) {
      notify(
        '🍽️ Déjeuner — tu n\'as pas encore noté',
        'Même vite fait — "sandwich jambon" et je calcule tout.\nÇa m\'aide à te proposer un bon dîner ce soir.'
      );
    }
    // If already logged → nothing. Never send twice.
  }, { timezone: 'Asia/Dubai' });

  // ── 1:00 PM — Omega-3 ─────────────────────────
  cron.schedule('0 13 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;
    notify('💊 Oméga-3', 'Avec ton déjeuner (1000mg).\nIls s\'absorbent mieux avec des graisses alimentaires.');
  }, { timezone: 'Asia/Dubai' });

  // ── WORK HOURS — Sedentary alerts (smart) ─────
  // Check every 90 minutes. Only send if conditions met.
  ['0 10', '30 11', '0 14', '30 15', '0 17'].forEach(time => {
    cron.schedule(`${time} * * 1-6`, async () => {
      const blocked = await isNearPrayer();
      if (blocked.blocked) return;

      if (!shouldSendSedentaryAlert(sedentaryAlertsToday)) return;

      sedentaryAlertsToday++;
      notify(
        '🚶‍♀️ Pause mouvement',
        `5 minutes de marche maintenant.\nÇa relance ton métabolisme et réduit le stress.\n(${sedentaryAlertsToday}/4 aujourd'hui)`
      );
    }, { timezone: 'Asia/Dubai' });
  });

  // ── 7:00 PM — Dinner check ────────────────────
  cron.schedule('0 19 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const missing = whatIsMissing();
    const dinnerMissing = missing.find(m => m.type === 'meal_dinner');
    if (!dinnerMissing) return;

    notify('🌙 Dîner', dinnerMissing.message);
  }, { timezone: 'Asia/Dubai' });

  // ── 8:15 PM — Dinner follow-up (one time only) ─
  cron.schedule('15 20 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const today = new Date().toISOString().split('T')[0];
    const dinnerLogged = db.prepare(
      "SELECT id FROM meal_log WHERE date = ? AND meal_type = 'dinner' LIMIT 1"
    ).get(today);

    if (!dinnerLogged) {
      notify('🌙 Dîner — dernier rappel', 'C\'est le dernier rappel du soir.\nNote ton repas pour que je calcule ta journée complète.');
    }
  }, { timezone: 'Asia/Dubai' });

  // ── 9:00 PM — Magnesium ───────────────────────
  cron.schedule('0 21 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;
    notify('💊 Magnésium', 'Avant de dormir (300mg).\nIl détend les muscles et améliore ton sommeil — et mieux dormir = moins de fringales demain.');
  }, { timezone: 'Asia/Dubai' });

  // ── 9:30 PM — Daily summary ───────────────────
  cron.schedule('30 21 * * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const ctx = getDaySummaryContext();
    const messages = {
      excellent: `Excellente journée Rachida 🌟 ${ctx.meals_logged} repas notés, ${ctx.calories_consumed} kcal. Ouvre le coach pour ton bilan.`,
      bien: `Bonne journée ! Tu peux voir ton bilan dans le coach.`,
      passable: `La journée est passée. Ouvre le coach pour voir et repartir bien demain.`
    };

    notify('📊 Bilan de ta journée', messages[ctx.day_quality]);
  }, { timezone: 'Asia/Dubai' });

  // ── 1ST OF MONTH — Measurements + Photo ───────
  cron.schedule('0 8 1 * *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const missing = whatIsMissing();

    const measureMissing = missing.find(m => m.type === 'measurements');
    const photoMissing = missing.find(m => m.type === 'photo');

    // Only notify if actually missing
    if (measureMissing) {
      notify('📏 Mensurations du mois', measureMissing.message);
    }

    // 30 min gap before photo reminder
    setTimeout(async () => {
      if (photoMissing) {
        notify('📷 Photo du mois', photoMissing.message);
      }
    }, 30 * 60 * 1000);
  }, { timezone: 'Asia/Dubai' });

  // ── QUARTERLY — Blood work ─────────────────────
  cron.schedule('0 9 1 1,4,7,10 *', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    const missing = whatIsMissing();
    const bloodMissing = missing.find(m => m.type === 'bloodwork');
    if (bloodMissing) {
      notify('🩸 Bilan sanguin', bloodMissing.message);
    }
  }, { timezone: 'Asia/Dubai' });

  // ── SUNDAY 10AM — Weekly review ───────────────
  cron.schedule('0 10 * * 0', async () => {
    const blocked = await isNearPrayer();
    if (blocked.blocked) return;

    notify('📈 Bilan de la semaine', 'Lance le coach pour voir ta semaine — poids, calories, progrès et 1 objectif pour la semaine prochaine.');
  }, { timezone: 'Asia/Dubai' });

  console.log(chalk.gray('   Smart reminders adapt based on what data exists.'));
  console.log(chalk.gray('   No reminder fires if data is already there.'));
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getDaysSince(query) {
  const row = db.prepare(query).get();
  if (!row || !row.d) return null;
  const last = new Date(row.d);
  const today = new Date();
  return Math.floor((today - last) / (1000 * 60 * 60 * 24));
}

function buildBloodworkReminder(daysSince) {
  const base = `Ton bilan sanguin trimestriel — c'est le bon moment.\n`;
  const last = daysSince ? `Dernier bilan : il y a ${daysSince} jours.\n` : `Aucun bilan enregistré encore.\n`;
  const markers = `\nMarqueurs à demander :\nVitamine D, B12, Fer (ferritine), Thyroïde (TSH), Glycémie à jeun, HbA1c, Cholestérol (LDL/HDL), CRP.\n\nApporte les résultats et uploade le PDF dans le coach.`;
  return base + last + markers;
}
