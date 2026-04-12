// server.js — Web UI server for Rachida Health Coach
// Serves the chat interface + dashboard
// API endpoints for chat, meals, medications, etc.

import '../env.js';
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db/connection.js';
import { logMeal, generateMorningBrief, chat } from '../agent/coach.js';
import { getTodayTargets, getTodayConsumed } from '../agent/macros.js';
import { listMedications, addMedication, formatMedicationSchedule } from '../commands/medications.js';
import { formatSchedule as formatSupplements } from '../commands/supplement-check.js';
import { buildCoachContext } from '../agent/memory.js';
import { getDaySummaryContext } from '../reminders/smart-schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(join(__dirname, 'public')));

// Chat history per session
let chatHistory = [];

// Increase body limit for image uploads (15MB)
app.use('/api/meal-photo', express.json({ limit: '15mb' }));

// ── API: Meal photo analysis ────────────────
app.post('/api/meal-photo', async (req, res) => {
  try {
    const { image, message } = req.body;
    if (!image) return res.status(400).json({ error: 'image required' });

    console.log('[Photo] Analyzing meal photo...');
    const hour = new Date().getHours();
    const mealType = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';

    // Strip data URL prefix if present
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const response = await logMeal(message || '', mealType, base64);

    res.json({ response, dashboard: getDashboardData() });
  } catch (err) {
    console.error('[Photo error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── API: Chat with coach ────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    console.log('[Chat] key present:', !!process.env.ANTHROPIC_API_KEY, '| msg:', message.substring(0, 30));

    // Detect meal in free text (but NOT supplements/medications)
    const msg = message.toLowerCase();
    const mealWords = ['mangé', 'bu', 'déjeuner', 'dîner', 'petit-déj', 'snack', 'collation', 'repas', "j'ai eu", 'ce soir', 'ce midi', 'ce matin', 'petit déj'];
    const notMealWords = ['vitamine', 'magnésium', 'oméga', 'complément', 'médicament', 'comprimé', 'glucophage', 'pris ma', 'pris mon', 'combien de calories', 'idée', 'propose', 'suggestion'];
    const looksLikeMeal = mealWords.some(w => msg.includes(w)) && !notMealWords.some(w => msg.includes(w));

    let response;
    if (looksLikeMeal) {
      // Detect meal type from keywords first, then fallback to time
      let mealType;
      if (msg.includes('petit-déj') || msg.includes('petit déj') || msg.includes('ce matin')) mealType = 'breakfast';
      else if (msg.includes('déjeuner') || msg.includes('ce midi') || msg.includes('midi')) mealType = 'lunch';
      else if (msg.includes('dîner') || msg.includes('ce soir') || msg.includes('soir') || msg.includes('repas du soir')) mealType = 'dinner';
      else if (msg.includes('snack') || msg.includes('collation') || msg.includes('goûter')) mealType = 'snack';
      else {
        const hour = new Date().getHours();
        mealType = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
      }
      response = await logMeal(message, mealType);
      // Keep meal in chat history so coach remembers
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: 'Repas enregistré : ' + message });
      if (chatHistory.length > 20) chatHistory.splice(0, 2);
    } else {
      response = await chat(message, chatHistory);
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: response });
      if (chatHistory.length > 20) chatHistory.splice(0, 2);
    }

    res.json({ response, dashboard: getDashboardData() });
  } catch (err) {
    console.error('[Chat error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── API: Get dashboard data ─────────────────
app.get('/api/dashboard', (req, res) => {
  res.json(getDashboardData(req.query.date));
});

// ── API: Toggle supplement taken ─────────────
app.post('/api/supplement/toggle', (req, res) => {
  try {
    const { supplement_id } = req.body;
    if (!supplement_id) return res.status(400).json({ error: 'supplement_id required' });

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toTimeString().split(' ')[0];

    // Check if already taken today
    const existing = db.prepare(
      'SELECT id, taken FROM supplement_log WHERE date = ? AND supplement_id = ? LIMIT 1'
    ).get(today, supplement_id);

    if (existing && existing.taken) {
      // Untoggle
      db.prepare('DELETE FROM supplement_log WHERE id = ?').run(existing.id);
      res.json({ toggled: true, taken: false, supplement_id });
    } else {
      // Get supplement name
      const supps = JSON.parse(readFileSync(join(__dirname, '../data/supplements.json'), 'utf-8'));
      const supp = supps.find(s => s.id === supplement_id);
      const name = supp?.name || supplement_id;

      db.prepare(`
        INSERT INTO supplement_log (date, supplement_id, supplement_name, scheduled_time, taken, taken_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(today, supplement_id, name, supp?.reminder_time || null, now);
      res.json({ toggled: true, taken: true, taken_at: now, supplement_id });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Meal history ───────────────────────
app.get('/api/meals', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const meals = db.prepare(
    'SELECT * FROM meal_log WHERE date = ? ORDER BY time ASC'
  ).all(date);
  res.json({ date, meals });
});

// ── API: Delete meal ────────────────────────
app.delete('/api/meal/last', (req, res) => {
  const last = db.prepare('SELECT id FROM meal_log ORDER BY id DESC LIMIT 1').get();
  if (last) {
    db.prepare('DELETE FROM meal_log WHERE id = ?').run(last.id);
    res.json({ deleted: true, id: last.id });
  } else {
    res.json({ deleted: false });
  }
});

app.delete('/api/meal/:id', (req, res) => {
  const result = db.prepare('DELETE FROM meal_log WHERE id = ?').run(req.params.id);
  res.json({ deleted: result.changes > 0, id: req.params.id });
});

// ── API: Get days with meals (for calendar) ─
app.get('/api/meal-days', (req, res) => {
  const days = db.prepare(`
    SELECT date, COUNT(*) as count, ROUND(SUM(calories)) as total_cal
    FROM meal_log
    WHERE date >= date('now', '-30 days')
    GROUP BY date ORDER BY date DESC
  `).all();
  res.json({ days });
});

// ── API: Today's micronutrients ─────────────
app.get('/api/micros', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(iron_mg), 0) as iron_mg,
      COALESCE(SUM(zinc_mg), 0) as zinc_mg,
      COALESCE(SUM(calcium_mg), 0) as calcium_mg,
      COALESCE(SUM(magnesium_mg), 0) as magnesium_mg,
      COALESCE(SUM(potassium_mg), 0) as potassium_mg,
      COALESCE(SUM(vit_a_mcg), 0) as vit_a_mcg,
      COALESCE(SUM(vit_c_mg), 0) as vit_c_mg,
      COALESCE(SUM(vit_d_ui), 0) as vit_d_ui,
      COALESCE(SUM(vit_b12_mcg), 0) as vit_b12_mcg,
      COALESCE(SUM(vit_b9_mcg), 0) as vit_b9_mcg,
      COALESCE(SUM(selenium_mcg), 0) as selenium_mcg
    FROM meal_log WHERE date = ?
  `).get(date);

  // Add nutrients from supplements taken today
  const suppNutrients = {
    fer:        { iron_mg: 14 },
    moringa:    { iron_mg: 2, vit_a_mcg: 380, vit_c_mg: 17, calcium_mg: 185, potassium_mg: 337 },
    vit_b12:    { vit_b12_mcg: 1000 },
    vit_c:      { vit_c_mg: 1000 },
    vit_d:      { vit_d_ui: 5000 },
    omega3:     {},
    magnesium:  { magnesium_mg: 200 },
    chrome:     {},
    astaxanthin:{},
    berberine:  {},
    glucomannan:{},
    kafein:     {}
  };

  const takenSupps = db.prepare(
    'SELECT supplement_id FROM supplement_log WHERE date = ? AND taken = 1'
  ).all(date);

  for (const s of takenSupps) {
    const nutrients = suppNutrients[s.supplement_id];
    if (nutrients) {
      for (const [key, value] of Object.entries(nutrients)) {
        if (row[key] !== undefined) row[key] += value;
      }
    }
  }

  // RDA for women 45-55
  const rda = {
    iron_mg: { value: 18, unit: 'mg' },
    zinc_mg: { value: 8, unit: 'mg' },
    calcium_mg: { value: 1000, unit: 'mg' },
    magnesium_mg: { value: 320, unit: 'mg' },
    potassium_mg: { value: 2600, unit: 'mg' },
    vit_a_mcg: { value: 700, unit: 'mcg' },
    vit_c_mg: { value: 75, unit: 'mg' },
    vit_d_ui: { value: 600, unit: 'UI' },
    vit_b12_mcg: { value: 2.4, unit: 'mcg' },
    vit_b9_mcg: { value: 400, unit: 'mcg' },
    selenium_mcg: { value: 55, unit: 'mcg' }
  };

  res.json({ date, consumed: row, rda });
});

// ── API: Get yesterday's activity (fallback) ──
app.get('/api/activity/yesterday', (req, res) => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const data = db.prepare(
    'SELECT steps, active_calories, exercise_minutes, distance_km, date FROM activity_log WHERE date = ? LIMIT 1'
  ).get(yesterday);
  res.json({ data, date: yesterday });
});

// ── API: Receive Apple Health data (from iOS Shortcut) ──
app.post('/api/activity', (req, res) => {
  try {
    const { steps, active_calories, exercise_minutes, resting_heart_rate, date } = req.body;
    const today = date || new Date().toISOString().split('T')[0];

    db.prepare(`
      INSERT OR REPLACE INTO activity_log (date, steps, active_calories, exercise_minutes, resting_heart_rate, source)
      VALUES (?, ?, ?, ?, ?, 'apple_watch_shortcut')
    `).run(today, steps || 0, active_calories || 0, exercise_minutes || 0, resting_heart_rate || null);

    console.log(`[Activity] ${today}: ${steps} pas, ${active_calories} kcal, ${exercise_minutes} min`);
    res.json({ saved: true, date: today, steps, active_calories, exercise_minutes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Withings OAuth ──────────────────────
import { getAuthorizationURL, exchangeCode, syncWeight, syncActivity, getLatestWeight } from '../integrations/withings.js';

// Start OAuth flow — redirects to Withings
app.get('/api/withings/connect', (req, res) => {
  const url = getAuthorizationURL();
  res.redirect(url);
});

// OAuth callback — receives code, exchanges for tokens
app.get('/api/withings/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.send('<html><body><h2>OK</h2></body></html>');
  }

  try {
    console.log('[Withings] OAuth code received, exchanging...');
    await exchangeCode(code);
    console.log('[Withings] Tokens saved! Syncing weight...');

    const data = await syncWeight();
    const weightMsg = data ? `Poids synced: ${data.weight_kg} kg` : 'Pas de pesée récente';

    res.send(`<html><body style="font-family:system-ui;text-align:center;padding:40px">
      <h2>✅ Withings connecté !</h2>
      <p>${weightMsg}</p>
      <p>Tu peux fermer cette page et retourner au coach.</p>
    </body></html>`);
  } catch (err) {
    console.error('[Withings] OAuth error:', err.message);
    res.send(`<html><body style="font-family:system-ui;text-align:center;padding:40px">
      <h2>❌ Erreur</h2><p>${err.message}</p>
    </body></html>`);
  }
});

// Manual sync trigger — weight + activity (30 days)
app.get('/api/withings/sync', async (req, res) => {
  try {
    const weight = await syncWeight();
    const activity = await syncActivity(30);
    res.json({ synced: true, weight, activity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Proactive message (what's missing?) ──
app.get('/api/proactive', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();

  // Check what meals are logged today
  const meals = db.prepare(
    'SELECT meal_type FROM meal_log WHERE date = ? GROUP BY meal_type'
  ).all(today);
  const logged = new Set(meals.map(m => m.meal_type));

  // Check supplements
  const suppsTaken = db.prepare(
    'SELECT COUNT(*) as count FROM supplement_log WHERE date = ? AND taken = 1'
  ).get(today);

  // Build proactive message
  let message = 'Salut Rachida ! 😊 ';

  // Morning (before 10am) — ask about breakfast
  if (hour < 10) {
    if (!logged.has('breakfast')) {
      message += "Tu as pris ton petit-déj ? Dis-moi ce que tu as mangé pour que je note 🍳";
    } else if (suppsTaken.count === 0) {
      message += "T'as mangé, bien ! N'oublie pas tes compléments du matin 💊";
    } else {
      message += "Bonne matinée ma belle ! Tout est noté ✅";
    }
  }
  // Midday (10am-2pm) — ask about lunch
  else if (hour >= 10 && hour < 14) {
    if (!logged.has('lunch')) {
      message += "C'est l'heure du déj ! Dis-moi ce que tu manges ou prends ton plat en photo 📸";
    } else {
      message += "Ton déjeuner est noté. Comment tu te sens cet après-midi ?";
    }
  }
  // Afternoon (2pm-6pm) — check protein status
  else if (hour >= 14 && hour < 18) {
    const consumed = db.prepare(
      'SELECT COALESCE(SUM(protein_g),0) as prot FROM meal_log WHERE date = ?'
    ).get(today);
    if (consumed.prot < 60) {
      message += "Tes protéines sont basses pour l'instant. Un snack riche en protéines ? Yaourt grec, œuf dur, amandes 🥜";
    } else if (!logged.has('lunch')) {
      message += "T'as pas noté ton déjeuner — tu as mangé quoi ce midi ?";
    } else {
      message += "L'après-midi avance bien. Besoin d'un conseil ?";
    }
  }
  // Evening (6pm-9pm) — ask about dinner
  else if (hour >= 18 && hour < 21) {
    if (!logged.has('dinner')) {
      message += "C'est le soir — qu'est-ce que tu manges ? Dis-moi ou prends en photo 📸";
    } else {
      message += "Ton dîner est noté. Pense à ton magnésium avant de dormir 🌙";
    }
  }
  // Night (after 9pm)
  else {
    const totalMeals = meals.length;
    if (totalMeals === 0) {
      message += "Tu n'as rien noté aujourd'hui. C'est pas grave, on recommence demain 💪";
    } else {
      message += "Bonne soirée ma belle. N'oublie pas ton magnésium avant de dormir 🌙";
    }
  }

  res.json({ message });
});

// ── API: Morning brief ──────────────────────
app.get('/api/brief', async (req, res) => {
  try {
    const brief = await generateMorningBrief();
    res.json({ brief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Weekly review ──────────────────────
app.get('/api/weekly', async (req, res) => {
  try {
    const prompt = buildWeeklyPrompt();
    const response = await chat(prompt);
    res.json({ review: response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildWeeklyPrompt() {
  const meals = db.prepare(`
    SELECT date, COALESCE(SUM(calories),0) as cal, COALESCE(SUM(protein_g),0) as protein, COUNT(*) as count
    FROM meal_log WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date ASC
  `).all();

  const weights = db.prepare(
    "SELECT date, weight_kg FROM weight_log WHERE date >= date('now', '-7 days') ORDER BY date ASC"
  ).all();

  const target = db.prepare('SELECT calories_target, protein_target_g FROM daily_targets ORDER BY date DESC LIMIT 1').get();

  return `Fais le bilan de ma semaine :\n\nRepas :\n${meals.map(r => `${r.date}: ${Math.round(r.cal)} kcal, ${Math.round(r.protein)}g prot (${r.count} repas)`).join('\n') || 'Aucune donnée'}\n\nPoids :\n${weights.map(w => `${w.date}: ${w.weight_kg} kg`).join('\n') || 'Pas de pesée'}\n\nObjectif : ${target?.calories_target || 1256} kcal/jour, ${target?.protein_target_g || 120}g protéines`;
}

// ── Dashboard data builder ──────────────────
function getDashboardData(dateParam) {
  const today = dateParam || new Date().toISOString().split('T')[0];
  const targets = getTodayTargets();
  const consumed = dateParam
    ? (() => {
        const row = db.prepare(`
          SELECT
            COALESCE(SUM(calories), 0) as calories,
            COALESCE(SUM(protein_g), 0) as protein_g,
            COALESCE(SUM(fat_g), 0) as fat_g,
            COALESCE(SUM(carbs_g), 0) as carbs_g
          FROM meal_log WHERE date = ?
        `).get(dateParam);
        return row;
      })()
    : getTodayConsumed();

  const meals = db.prepare(
    'SELECT meal_type, description, calories, protein_g, fat_g, carbs_g, time FROM meal_log WHERE date = ? ORDER BY time ASC'
  ).all(today);

  const weight = db.prepare(
    'SELECT weight_kg, fat_percent, muscle_percent, bone_mass_kg, hydration_percent FROM weight_log ORDER BY date DESC, id DESC LIMIT 1'
  ).get();

  const weightHistory = db.prepare(
    "SELECT date, weight_kg FROM weight_log WHERE date >= date('now', '-30 days') ORDER BY date ASC"
  ).all();

  const meds = listMedications();

  // Supplements with today's taken status
  const supps = JSON.parse(readFileSync(join(__dirname, '../data/supplements.json'), 'utf-8'));
  const takenToday = db.prepare(
    'SELECT supplement_id, taken_at FROM supplement_log WHERE date = ? AND taken = 1'
  ).all(today);
  const takenMap = new Map(takenToday.map(r => [r.supplement_id, r.taken_at]));

  const supplements = supps.map(s => ({
    id: s.id,
    name: s.name,
    dose: s.dose,
    timing: s.timing,
    reminder_time: s.reminder_time,
    taken: takenMap.has(s.id),
    taken_at: takenMap.get(s.id) || null
  }));

  // Activity data (Withings / Apple Watch)
  const todayActivity = db.prepare(
    'SELECT steps, active_calories, exercise_minutes, distance_km FROM activity_log WHERE date = ? LIMIT 1'
  ).get(today);

  const weekActivity = db.prepare(`
    SELECT date, steps, active_calories FROM activity_log
    WHERE date >= date('now', '-30 days') ORDER BY date ASC
  `).all();

  return {
    date: today,
    targets,
    consumed,
    meals,
    weight,
    weightHistory,
    medications: meds,
    supplements,
    activity: todayActivity,
    weekActivity,
    calPct: Math.min(Math.round((consumed.calories / targets.calories_target) * 100), 150),
    protPct: Math.min(Math.round((consumed.protein_g / targets.protein_target_g) * 100), 150),
    fatPct: Math.min(Math.round((consumed.fat_g / targets.fat_target_g) * 100), 150),
    carbsPct: Math.min(Math.round((consumed.carbs_g / targets.carbs_target_g) * 100), 150),
  };
}

// ── Start server ────────────────────────────
export function startWebUI(port) {
  const p = port || process.env.PORT || 3000;
  app.listen(p, '0.0.0.0', () => {
    console.log(`🌐 Rachida Health Coach — http://localhost:${p}`);
  });
}
