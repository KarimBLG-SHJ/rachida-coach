// scheduler.js — All reminders and cron jobs
// Rules:
// - Never send a reminder during prayer time (± 15 min buffer)
// - Never send more than 4 sedentary alerts per day
// - Quiet hours: 22:00 – 07:00

import cron from 'node-cron';
import { notify, notifyUrgent } from './notifications.js';
import { getPrayerTimes, isNearPrayer } from '../integrations/prayer-times.js';
import { calculateDailyTargets, getTodayConsumed, getTodayTargets } from '../agent/macros.js';
import Database from 'better-sqlite3';

const db = new Database('./db/health.db');
let sedentaryAlertsToday = 0;
let lastSedentaryDate = '';

// ─────────────────────────────────────────────
// UTILITY: Reset sedentary counter at midnight
// ─────────────────────────────────────────────
function checkResetSedentaryCounter() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastSedentaryDate) {
    sedentaryAlertsToday = 0;
    lastSedentaryDate = today;
  }
}

// ─────────────────────────────────────────────
// UTILITY: Log reminder to database
// ─────────────────────────────────────────────
function logReminder(type, message, sent, blockedByPrayer = null) {
  const now = new Date();
  db.prepare(`
    INSERT INTO reminder_log (date, time, reminder_type, message, was_sent, blocked_by_prayer)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    now.toISOString().split('T')[0],
    now.toTimeString().split(' ')[0],
    type,
    message,
    sent ? 1 : 0,
    blockedByPrayer
  );
}

// ─────────────────────────────────────────────
// UTILITY: Safe send — check prayer times first
// ─────────────────────────────────────────────
async function safeSend(type, title, message, urgency = 'normal') {
  const check = await isNearPrayer();
  if (check.blocked) {
    console.log(`[Reminder blocked] ${type} — near ${check.prayer} prayer`);
    logReminder(type, message, false, check.prayer);
    return false;
  }
  if (urgency === 'urgent') {
    notifyUrgent(title, message);
  } else {
    notify(title, message);
  }
  logReminder(type, message, true);
  return true;
}

// ─────────────────────────────────────────────
// ALL SCHEDULED REMINDERS
// ─────────────────────────────────────────────

export function startAllReminders() {
  console.log('⏰ Rachida Health Coach — reminders started');

  // ── MORNING: Weight reminder ──────────────────
  // 7:15 AM — weigh yourself before eating
  cron.schedule('15 7 * * *', async () => {
    await safeSend(
      'weight_morning',
      '⚖️ Pesée du matin',
      'Pèse-toi maintenant — avant de manger, après les toilettes.\nC\'est le seul moment de la journée où ton poids est fiable.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── MORNING: Recalculate macros for the day ───
  // 7:20 AM — run macro calculation silently
  cron.schedule('20 7 * * *', () => {
    calculateDailyTargets();
    console.log('[7:20] Daily macro targets calculated');
  }, { timezone: 'Asia/Dubai' });

  // ── MORNING: Morning brief ────────────────────
  // 7:30 AM — full daily brief
  cron.schedule('30 7 * * *', async () => {
    await safeSend(
      'morning_brief',
      '🌅 Bonjour Rachida — ton brief du jour',
      'Ton plan du jour est prêt. Ouvre l\'app pour voir tes macros, tes horaires de prière et ton objectif du jour.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── MORNING: Supplement reminder ──────────────
  // 8:00 AM — morning supplements with breakfast
  cron.schedule('0 8 * * *', async () => {
    await safeSend(
      'supplement_morning',
      '💊 Compléments du matin',
      'Avec ton petit-déjeuner :\n• Vitamine D3 (2000 IU)\n• Vitamine B12 (1000 mcg)\n\nPourquoi avec le repas ? Pour que ton corps les absorbe correctement.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── LUNCH: Meal log reminder ──────────────────
  // 12:30 PM — log lunch BEFORE eating (more accurate)
  cron.schedule('30 12 * * *', async () => {
    await safeSend(
      'meal_lunch_prompt',
      '🍽️ C\'est l\'heure du déjeuner',
      'Note ce que tu vas manger — avant de commencer.\nDis-moi juste : "poulet, riz, salade" et je calcule tout.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── LUNCH: Follow-up if no lunch logged ───────
  // 1:15 PM — check if lunch was logged
  cron.schedule('15 13 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const lunchLogged = db.prepare(`
      SELECT id FROM meal_log WHERE date = ? AND meal_type = 'lunch' LIMIT 1
    `).get(today);

    if (!lunchLogged) {
      await safeSend(
        'meal_lunch_followup',
        '🍽️ Ton déjeuner ?',
        'Tu n\'as pas encore noté ton repas du midi.\nMême vite fait : "j\'ai mangé un sandwich" — et je calcule le reste.'
      );
    }
  }, { timezone: 'Asia/Dubai' });

  // ── AFTERNOON: Supplement reminder ────────────
  // 1:00 PM — Omega-3 with lunch
  cron.schedule('0 13 * * *', async () => {
    await safeSend(
      'supplement_lunch',
      '💊 Oméga-3 avec le repas',
      'Prends ton Oméga-3 maintenant (1000mg).\nPourquoi avec le repas ? Les oméga-3 s\'absorbent mieux avec des graisses alimentaires.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── WORK HOURS: Sedentary alerts ──────────────
  // Every 90 minutes during work hours (9am–5:30pm)
  // Max 4 times per day, never during prayer
  const sedentaryTimes = ['0 9', '30 10', '0 12', '30 14', '0 16', '30 17'];
  sedentaryTimes.forEach(time => {
    cron.schedule(`${time} * * 1-6`, async () => {
      checkResetSedentaryCounter();
      if (sedentaryAlertsToday >= 4) return;

      sedentaryAlertsToday++;
      await safeSend(
        'sedentary_alert',
        '🚶‍♀️ Lève-toi 5 minutes',
        `Tu es assise depuis un moment.\nLève-toi, marche jusqu\'à la cuisine ou fais le tour du bureau.\nJuste 5 minutes — ça relance ton métabolisme et brûle 20 kcal.\n(Alerte ${sedentaryAlertsToday}/4 aujourd\'hui)`
      );
    }, { timezone: 'Asia/Dubai' });
  });

  // ── EVENING: Dinner reminder ──────────────────
  // 7:00 PM
  cron.schedule('0 19 * * *', async () => {
    const remaining = getRemainingForEvening();
    await safeSend(
      'meal_dinner_prompt',
      '🌙 Dîner — on vérifie tes macros',
      `Il te reste ${remaining.calories} kcal pour ce soir.\nProtéines restantes : ${remaining.protein_g}g.\nNote ton dîner pour finir la journée dans les objectifs.`
    );
  }, { timezone: 'Asia/Dubai' });

  // ── EVENING: Follow-up if no dinner logged ────
  // 8:15 PM
  cron.schedule('15 20 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const dinnerLogged = db.prepare(`
      SELECT id FROM meal_log WHERE date = ? AND meal_type = 'dinner' LIMIT 1
    `).get(today);

    if (!dinnerLogged) {
      await safeSend(
        'meal_dinner_followup',
        '🌙 Le dîner ?',
        'Rachida, tu n\'as pas encore noté ton dîner.\nDis-moi juste ce que tu as mangé — même vite fait.\nÇa complète ta journée et m\'aide à améliorer ton plan demain.'
      );
    }
  }, { timezone: 'Asia/Dubai' });

  // ── EVENING: Magnesium reminder ───────────────
  // 9:00 PM
  cron.schedule('0 21 * * *', async () => {
    await safeSend(
      'supplement_evening',
      '💊 Magnésium avant de dormir',
      'Prends ton Magnésium (300mg) maintenant.\nPourquoi le soir ? Il détend les muscles, améliore le sommeil — et un bon sommeil aide à maigrir.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── EVENING: Daily summary ────────────────────
  // 9:30 PM
  cron.schedule('30 21 * * *', async () => {
    await safeSend(
      'daily_summary',
      '📊 Résumé de ta journée',
      'Ta journée est presque finie. Ouvre l\'app pour voir ton bilan : calories, protéines, et comment tu progresses vers ton objectif.'
    );
  }, { timezone: 'Asia/Dubai' });

  // ── WEEKLY: Sunday review ─────────────────────
  // Every Sunday at 10:00 AM
  cron.schedule('0 10 * * 0', async () => {
    await safeSend(
      'weekly_review',
      '📈 Bilan de la semaine',
      'C\'est dimanche — le moment de regarder ta semaine.\nOuvre l\'app pour voir ta progression, ce qui a bien marché, et le plan pour la semaine prochaine.'
    );
  }, { timezone: 'Asia/Dubai' });

  console.log('✅ All reminders scheduled (Dubai timezone)');
}

// ─────────────────────────────────────────────
// HELPER: Get remaining calories for evening
// ─────────────────────────────────────────────
function getRemainingForEvening() {
  try {
    const { getRemainingToday } = await import('../agent/macros.js');
    return getRemainingToday();
  } catch {
    return { calories: 600, protein_g: 40 }; // fallback
  }
}
