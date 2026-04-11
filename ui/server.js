// server.js — Web UI server for Rachida Health Coach
// Serves the chat interface + dashboard
// API endpoints for chat, meals, medications, etc.

import '../env.js';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { logMeal, generateMorningBrief, chat } from '../agent/coach.js';
import { getTodayTargets, getTodayConsumed } from '../agent/macros.js';
import { listMedications, addMedication, formatMedicationSchedule } from '../commands/medications.js';
import { formatSchedule as formatSupplements } from '../commands/supplement-check.js';
import { buildCoachContext } from '../agent/memory.js';
import { getDaySummaryContext } from '../reminders/smart-schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database('./db/health.db');

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Chat history per session
let chatHistory = [];

// ── API: Chat with coach ────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    console.log('[Chat] key present:', !!process.env.ANTHROPIC_API_KEY, '| msg:', message.substring(0, 30));

    // Detect meal in free text (but NOT supplements/medications)
    const msg = message.toLowerCase();
    const mealWords = ['mangé', 'bu', 'déjeuner', 'dîner', 'petit-déj', 'snack', 'collation', 'repas', "j'ai eu"];
    const notMealWords = ['vitamine', 'magnésium', 'oméga', 'complément', 'médicament', 'comprimé', 'glucophage', 'pris ma', 'pris mon'];
    const looksLikeMeal = mealWords.some(w => msg.includes(w)) && !notMealWords.some(w => msg.includes(w));

    let response;
    if (looksLikeMeal) {
      const hour = new Date().getHours();
      const mealType = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
      response = await logMeal(message, mealType);
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
  res.json(getDashboardData());
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
function getDashboardData() {
  const targets = getTodayTargets();
  const consumed = getTodayConsumed();
  const today = new Date().toISOString().split('T')[0];

  const meals = db.prepare(
    'SELECT meal_type, description, calories, protein_g, fat_g, carbs_g, time FROM meal_log WHERE date = ? ORDER BY time ASC'
  ).all(today);

  const weight = db.prepare(
    'SELECT weight_kg, fat_percent FROM weight_log WHERE date = ? ORDER BY id DESC LIMIT 1'
  ).get(today);

  const weightHistory = db.prepare(
    "SELECT date, weight_kg FROM weight_log WHERE date >= date('now', '-14 days') ORDER BY date ASC"
  ).all();

  const meds = listMedications();

  return {
    date: today,
    targets,
    consumed,
    meals,
    weight,
    weightHistory,
    medications: meds,
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
