// measurement-reminders.js — Monthly measurement and photo reminders
// Add this to scheduler.js

import cron from 'node-cron';
import { notify } from './notifications.js';
import { isNearPrayer } from '../integrations/prayer-times.js';
import Database from 'better-sqlite3';

const db = new Database('./db/health.db');

export function startMeasurementReminders() {

  // ── MONTHLY: Measurement reminder ─────────────
  // Every 1st of the month at 8:00 AM
  cron.schedule('0 8 1 * *', async () => {
    const check = await isNearPrayer();
    if (check.blocked) return;

    // Check when last measurement was done
    const last = db.prepare(`
      SELECT date FROM measurements ORDER BY date DESC LIMIT 1
    `).get();

    notify(
      '📏 Mensurations mensuelles',
      `C'est le 1er du mois — moment de prendre tes mensurations.\n` +
      `${last ? `Dernière fois : ${last.date}` : 'Premières mensurations !'}\n\n` +
      `Lance : node index.js mensuration`
    );
  }, { timezone: 'Asia/Dubai' });

  // ── MONTHLY: Progress photo reminder ──────────
  // Every 1st of the month at 8:30 AM
  cron.schedule('30 8 1 * *', async () => {
    const check = await isNearPrayer();
    if (check.blocked) return;

    const lastPhoto = db.prepare(`
      SELECT date FROM progress_photos ORDER BY date DESC LIMIT 1
    `).get();

    notify(
      '📷 Photo de progression mensuelle',
      `N'oublie pas ta photo du mois !\n` +
      `${lastPhoto ? `Dernière photo : ${lastPhoto.date}` : 'Première photo !'}\n\n` +
      `Lance : node index.js photo /chemin/vers/photo.jpg\n\n` +
      `💡 Conseil : même fond, même heure, même tenue, chaque mois.`
    );
  }, { timezone: 'Asia/Dubai' });

  // ── QUARTERLY: Blood work reminder ────────────
  // Every 3 months (1st Jan, Apr, Jul, Oct) at 9 AM
  cron.schedule('0 9 1 1,4,7,10 *', async () => {
    const check = await isNearPrayer();
    if (check.blocked) return;

    const lastBloodwork = db.prepare(`
      SELECT MAX(test_date) as date FROM bloodwork
    `).get();

    notify(
      '🩸 Bilan sanguin trimestriel',
      `C'est le moment de faire ta prise de sang trimestrielle.\n` +
      `${lastBloodwork?.date ? `Dernier bilan : ${lastBloodwork.date}` : 'Aucun bilan enregistré encore.'}\n\n` +
      `Marqueurs clés à demander : Vitamine D, B12, Fer, Thyroïde (TSH), Glycémie, Cholestérol.`
    );
  }, { timezone: 'Asia/Dubai' });
}
