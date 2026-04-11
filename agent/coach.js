// coach.js — Main AI brain
// Handles meal logging, Q&A, morning brief generation
// Now with tool use for medications, preferences, memory

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db/connection.js';
import { getTodayTargets, getTodayConsumed, getRemainingToday } from './macros.js';
import { getPrayerTimes, getBestWalkWindow, formatPrayerSchedule } from '../integrations/prayer-times.js';
import { buildCoachContext, updatePreference, updateGoal, rememberInfo, recordFoodPreference } from './memory.js';
import { addMedication, removeMedication, updateMedication, listMedications, markMedicationTaken, getMedicationContext } from '../commands/medications.js';
import { formatSchedule as formatSupplements, markTaken as markSupplementTaken } from '../commands/supplement-check.js';
import { markMedicationTaken as markMedTaken } from '../commands/medications.js';
import { getWeatherSummary } from '../integrations/weather.js';
import { getDailyFact as getMotivationFact, getMicroObjective as getMotivationObjective } from './motivation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy-init Anthropic client
let _anthropic;
function getClient() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// Load system prompt from file
const systemPrompt = readFileSync(
  join(__dirname, 'prompts/system.md'),
  'utf-8'
);

// ─────────────────────────────────────────────
// CLAUDE TOOLS — what the coach can do during chat
// ─────────────────────────────────────────────

const COACH_TOOLS = [
  {
    name: 'save_medication',
    description: "Enregistrer un médicament que Rachida prend. Utilise cet outil quand elle dit qu'elle prend un médicament, un comprimé, ou une prescription. Ne JAMAIS recommander une dose — juste noter ce qu'elle dit.",
    input_schema: {
      type: 'object',
      properties: {
        name:       { type: 'string', description: "Nom du médicament (ex: Glucophage, Levothyrox)" },
        dose:       { type: 'string', description: "Dose si mentionnée (ex: 500mg, 50mcg)" },
        frequency:  { type: 'string', description: "Fréquence (daily, twice_daily, as_needed)" },
        timing:     { type: 'string', description: "Moment de prise (morning, evening, with_food, before_sleep)" },
        reason:     { type: 'string', description: "Raison si mentionnée (diabète, thyroïde, etc.)" }
      },
      required: ['name']
    }
  },
  {
    name: 'remove_medication',
    description: "Retirer un médicament que Rachida dit ne plus prendre. Utilise cet outil quand elle dit qu'elle arrête un médicament.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Nom du médicament à retirer" }
      },
      required: ['name']
    }
  },
  {
    name: 'update_preference',
    description: "Mettre à jour une préférence alimentaire de Rachida. Utilise quand elle dit qu'elle aime, déteste, est allergique à un aliment, ou préfère quelque chose.",
    input_schema: {
      type: 'object',
      properties: {
        type:  { type: 'string', description: "Type: dislikes, allergies, favorite_protein, favorite_carbs, favorite_vegetables, favorite_snacks" },
        value: { type: 'string', description: "L'aliment ou la préférence" }
      },
      required: ['type', 'value']
    }
  },
  {
    name: 'update_goal',
    description: "Mettre à jour l'objectif de poids de Rachida. Utilise quand elle dit 'je veux peser X kg' ou 'mon objectif c'est X'.",
    input_schema: {
      type: 'object',
      properties: {
        goal_weight_kg: { type: 'number', description: "Nouveau poids objectif en kg" }
      },
      required: ['goal_weight_kg']
    }
  },
  {
    name: 'remember',
    description: "Retenir une information importante que Rachida partage sur elle-même, sa vie, ses habitudes, son travail, sa famille. Tout ce qui peut être utile pour mieux la coacher.",
    input_schema: {
      type: 'object',
      properties: {
        key:      { type: 'string', description: "Clé courte pour retrouver l'info (ex: travail_horaires, enfants, sport_prefere)" },
        value:    { type: 'string', description: "L'information à retenir" },
        category: { type: 'string', description: "Catégorie: preference, pattern, insight, general" }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'log_weight',
    description: "Enregistrer le poids de Rachida quand elle le dit. Utilise quand elle dit 'je pèse X' ou 'ce matin X kg'.",
    input_schema: {
      type: 'object',
      properties: {
        weight_kg: { type: 'number', description: "Poids en kg" }
      },
      required: ['weight_kg']
    }
  },
  {
    name: 'mark_supplement_taken',
    description: "Marquer un complément comme pris. Utilise quand Rachida dit 'j'ai pris ma vitamine D', 'j'ai pris mon magnésium', etc.",
    input_schema: {
      type: 'object',
      properties: {
        supplement_id: { type: 'string', description: "ID du complément: vit_d3, omega3, magnesium, vit_b12" }
      },
      required: ['supplement_id']
    }
  },
  {
    name: 'mark_medication_taken',
    description: "Marquer un médicament comme pris. Utilise quand Rachida dit 'j'ai pris mon Glucophage', etc.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Nom du médicament" }
      },
      required: ['name']
    }
  }
];

// ─────────────────────────────────────────────
// TOOL EXECUTION
// ─────────────────────────────────────────────

function executeTool(toolName, input) {
  switch (toolName) {
    case 'save_medication': {
      const result = addMedication(input);
      return JSON.stringify(result);
    }
    case 'remove_medication': {
      const result = removeMedication(input.name);
      return JSON.stringify(result);
    }
    case 'update_preference': {
      const result = updatePreference(input.type, input.value);
      return JSON.stringify(result);
    }
    case 'update_goal': {
      const result = updateGoal(input.goal_weight_kg);
      return JSON.stringify(result);
    }
    case 'remember': {
      const result = rememberInfo(input.key, input.value, input.category || 'general');
      return JSON.stringify(result);
    }
    case 'log_weight': {
      const today = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0];
      db.prepare(`
        INSERT INTO weight_log (date, time, weight_kg, source)
        VALUES (?, ?, ?, 'manual')
      `).run(today, time, input.weight_kg);
      return JSON.stringify({ logged: true, weight_kg: input.weight_kg, date: today });
    }
    case 'mark_supplement_taken': {
      const result = markSupplementTaken(input.supplement_id);
      return JSON.stringify(result);
    }
    case 'mark_medication_taken': {
      const result = markMedTaken(input.name);
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: 'unknown_tool' });
  }
}

// ─────────────────────────────────────────────
// BUILD RICH CONTEXT for every chat message
// ─────────────────────────────────────────────

function buildChatContext() {
  const targets = getTodayTargets();
  const consumed = getTodayConsumed();
  const memory = buildCoachContext();
  const meds = getMedicationContext();
  const supplements = formatSupplements();
  const today = new Date().toLocaleDateString('fr-FR');

  return `
CONTEXTE DU JOUR (${today}) :
- Calories : ${consumed.calories}/${targets.calories_target} kcal
- Protéines : ${consumed.protein_g}/${targets.protein_target_g}g
- Lipides : ${consumed.fat_g}/${targets.fat_target_g}g
- Glucides : ${consumed.carbs_g}/${targets.carbs_target_g}g

MÉDICAMENTS DE RACHIDA :
${meds}

COMPLÉMENTS :
${supplements}

MÉMOIRE (ce que je sais sur Rachida) :
${memory}
`.trim();
}

// ─────────────────────────────────────────────
// MEAL LOGGING
// ─────────────────────────────────────────────

export async function logMeal(description, mealType = 'lunch', imageBase64 = null) {
  const targets = getTodayTargets();
  const consumed = getTodayConsumed();
  const remaining = getRemainingToday();

  const prompt = `
${imageBase64 ? 'Rachida a pris une photo de son repas. Identifie TOUS les aliments visibles sur la photo.' : `Rachida vient de manger : "${description}"`}
${description && imageBase64 ? `Elle ajoute : "${description}"` : ''}

Contexte de sa journée :
- Objectif calories : ${targets.calories_target} kcal
- Déjà consommé : ${consumed.calories} kcal
- Protéines restantes : ${remaining.protein_g}g
- Glucides restants : ${remaining.carbs_g}g
- Type de repas : ${mealType}

Fais exactement ceci :

1. Identifie chaque aliment
2. Estime la portion en grammes (taille normale pour une femme adulte)
3. Calcule les calories et macros pour chaque aliment
4. Additionne le total
5. Montre le reste de la journée
6. Propose ce qu'elle peut manger au prochain repas pour rester dans ses objectifs
7. Si quelque chose semble potentiellement non-halal, signale-le clairement

Réponds UNIQUEMENT avec du JSON dans ce format exact :
{
  "items": [
    {
      "name": "Nom de l'aliment",
      "quantity_g": 150,
      "calories": 248,
      "protein_g": 46,
      "fat_g": 6,
      "carbs_g": 0,
      "fiber_g": 2,
      "is_halal": true,
      "halal_note": null,
      "micros": {
        "iron_mg": 1.2,
        "zinc_mg": 0.8,
        "calcium_mg": 15,
        "magnesium_mg": 12,
        "potassium_mg": 200,
        "vit_a_mcg": 0,
        "vit_c_mg": 0,
        "vit_d_ui": 0,
        "vit_b12_mcg": 0.5,
        "vit_b9_mcg": 10,
        "selenium_mcg": 15
      }
    }
  ],
  "totals": {
    "calories": 523,
    "protein_g": 52,
    "fat_g": 6,
    "carbs_g": 60,
    "fiber_g": 5,
    "iron_mg": 2.5,
    "zinc_mg": 1.5,
    "calcium_mg": 50,
    "magnesium_mg": 30,
    "potassium_mg": 400,
    "vit_a_mcg": 100,
    "vit_c_mg": 15,
    "vit_d_ui": 0,
    "vit_b12_mcg": 1.0,
    "vit_b9_mcg": 25,
    "selenium_mcg": 20
  },
  "day_remaining": {
    "calories": ${remaining.calories},
    "protein_g": ${remaining.protein_g},
    "fat_g": ${remaining.fat_g},
    "carbs_g": ${remaining.carbs_g}
  },
  "next_meal_suggestion": "Description du repas suggéré",
  "next_meal_why": "Explication courte (2 phrases max) du pourquoi"
}
`;

  // Build message content — text only or image + text
  const messageContent = [];
  if (imageBase64) {
    const mediaType = imageBase64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    messageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 }
    });
  }
  messageContent.push({ type: 'text', text: prompt });

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: messageContent }]
  });

  const rawText = response.content[0].text.replace(/```json|```/g, '').trim();
  const data = JSON.parse(rawText);

  // Save to database
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().split(' ')[0];
  const mealDescription = imageBase64 ? (description || 'Photo de repas — ' + data.items.map(i => i.name).join(', ')) : description;

  const t = data.totals;
  db.prepare(`
    INSERT INTO meal_log (date, time, meal_type, description, calories, protein_g, fat_g, carbs_g, fiber_g, is_halal,
      iron_mg, zinc_mg, calcium_mg, magnesium_mg, potassium_mg, vit_a_mcg, vit_c_mg, vit_d_ui, vit_b12_mcg, vit_b9_mcg, selenium_mcg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    today, time, mealType, mealDescription,
    t.calories, t.protein_g, t.fat_g, t.carbs_g, t.fiber_g || 0,
    data.items.every(i => i.is_halal) ? 1 : 0,
    t.iron_mg || 0, t.zinc_mg || 0, t.calcium_mg || 0, t.magnesium_mg || 0, t.potassium_mg || 0,
    t.vit_a_mcg || 0, t.vit_c_mg || 0, t.vit_d_ui || 0, t.vit_b12_mcg || 0, t.vit_b9_mcg || 0, t.selenium_mcg || 0
  );

  // Record food preferences in memory
  recordFoodPreference(data.items);

  return formatMealResponse(data, mealType, targets, consumed);
}

function formatMealResponse(data, mealType, targets, consumed) {
  const mealEmoji = { breakfast: '🌅', lunch: '🍽️', dinner: '🌙', snack: '🫐' };
  const mealName = { breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', dinner: 'Dîner', snack: 'Collation' };

  let output = `\n${mealEmoji[mealType] || '🍽️'} ${mealName[mealType] || mealType} enregistré\n\n`;

  data.items.forEach(item => {
    const halalFlag = !item.is_halal ? ' ⚠️ VÉRIFIER HALAL' : '';
    output += `${item.name.padEnd(25)} (${item.quantity_g}g)   ${String(item.calories).padStart(4)} kcal | P: ${item.protein_g}g | L: ${item.fat_g}g | G: ${item.carbs_g}g${halalFlag}\n`;
  });

  output += `${'─'.repeat(75)}\n`;
  output += `Total repas${' '.repeat(15)}     ${String(data.totals.calories).padStart(4)} kcal | P: ${data.totals.protein_g}g | L: ${data.totals.fat_g}g | G: ${data.totals.carbs_g}g\n`;

  const newConsumed = {
    calories: consumed.calories + data.totals.calories,
    protein_g: consumed.protein_g + data.totals.protein_g
  };

  output += `\n📊 Aujourd'hui (cumulé)\n`;
  output += `Consommé : ${Math.round(newConsumed.calories)} kcal / ${targets.calories_target} kcal\n`;
  output += `Protéines : ${Math.round(newConsumed.protein_g)}g / ${targets.protein_target_g}g ${newConsumed.protein_g >= targets.protein_target_g * 0.8 ? '✅' : '⚠️'}\n`;

  const remainingCal = Math.round(targets.calories_target - newConsumed.calories);
  if (remainingCal > 0) {
    output += `\nIl te reste ${remainingCal} kcal pour ce soir.\n`;
  } else {
    output += `\n⚠️ Tu as atteint ton objectif calorique pour aujourd'hui.\n`;
  }

  if (data.next_meal_suggestion) {
    output += `\n💡 Prochain repas : ${data.next_meal_suggestion}\n`;
    output += `   Pourquoi : ${data.next_meal_why}\n`;
  }

  return output;
}

// ─────────────────────────────────────────────
// MORNING BRIEF
// ─────────────────────────────────────────────

export async function generateMorningBrief() {
  const targets = getTodayTargets();
  const prayerSchedule = await formatPrayerSchedule();
  const bestWalk = await getBestWalkWindow();
  const latestWeight = getLatestWeight();
  const weightTrend = getWeightTrend();
  const pedagogicalFact = getDailyFact();
  const supplements = getSupplementSchedule();
  const meds = getMedicationScheduleForBrief();

  const today = new Date();
  const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][today.getDay()];
  const dateStr = today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  let brief = `\n${'═'.repeat(60)}\n`;
  brief += `🌅 BONJOUR RACHIDA — ${dayName} ${dateStr}\n`;
  brief += `${'═'.repeat(60)}\n\n`;

  // Weight section
  brief += `⚖️ POIDS\n`;
  if (latestWeight) {
    brief += `Ce matin : ${latestWeight.weight_kg} kg\n`;
    if (weightTrend) brief += weightTrend;
  } else {
    brief += `N'oublie pas de te peser ce matin !\n`;
  }

  const startWeight = 75;
  const goalWeight = 62;
  if (latestWeight) {
    const lost = startWeight - latestWeight.weight_kg;
    const remaining = latestWeight.weight_kg - goalWeight;
    if (lost > 0) {
      brief += `Perdu : ${lost.toFixed(1)} kg ✅  |  Objectif dans : ${remaining.toFixed(1)} kg\n`;
    }
  }

  // Macro targets
  brief += `\n🎯 TES MACROS D'AUJOURD'HUI\n`;
  brief += `Calories  : ${targets.calories_target} kcal\n`;
  brief += `Protéines : ${targets.protein_target_g}g  (priorité — rassasie + préserve le muscle)\n`;
  brief += `Lipides   : ${targets.fat_target_g}g\n`;
  brief += `Glucides  : ${targets.carbs_target_g}g\n`;

  // Prayer times
  brief += `\n🕌 PRIÈRES AUJOURD'HUI (Sharjah)\n`;
  brief += `${prayerSchedule}\n`;

  // Weather
  try {
    const weather = await getWeatherSummary();
    brief += `\n🌡️ MÉTÉO SHARJAH\n`;
    brief += `${weather.summary}\n`;
    brief += `${weather.walkAdvice}\n`;
    if (weather.hydrationNote) brief += `${weather.hydrationNote}\n`;
  } catch {
    if (bestWalk) {
      brief += `\n🚶‍♀️ MEILLEUR MOMENT POUR MARCHER\n`;
      brief += `${bestWalk.label} — ${bestWalk.note}\n`;
    }
  }

  // Medications
  if (meds) {
    brief += `\n💊 MÉDICAMENTS\n`;
    brief += meds;
  }

  // Supplements
  brief += `\n💊 COMPLÉMENTS\n`;
  brief += supplements;

  // Pedagogical fact
  brief += `\n💡 LE SAVIEZ-VOUS ?\n`;
  brief += `${pedagogicalFact}\n`;

  const microObjective = getMicroObjective();
  brief += `\n🎯 TON OBJECTIF D'AUJOURD'HUI\n`;
  brief += `${microObjective}\n`;

  brief += `\n${'═'.repeat(60)}\n`;
  return brief;
}

// ─────────────────────────────────────────────
// FREE CHAT — with tool use
// ─────────────────────────────────────────────

export async function chat(userMessage, history = []) {
  const context = buildChatContext();

  const messages = [
    ...history,
    { role: 'user', content: `${context}\n\nRachida dit : ${userMessage}` }
  ];

  let response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: systemPrompt,
    messages,
    tools: COACH_TOOLS
  });

  // Process tool calls in a loop until the model is done
  while (response.stop_reason === 'tool_use') {
    const assistantContent = response.content;
    const toolUseBlocks = assistantContent.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      const result = executeTool(toolUse.name, toolUse.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result
      });
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({ role: 'user', content: toolResults });

    response = await getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
      tools: COACH_TOOLS
    });
  }

  // Extract text response
  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n');
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getLatestWeight() {
  return db.prepare(`
    SELECT weight_kg FROM weight_log
    ORDER BY date DESC, id DESC LIMIT 1
  `).get();
}

function getWeightTrend() {
  const rows = db.prepare(`
    SELECT date, weight_kg FROM weight_log
    ORDER BY date DESC LIMIT 8
  `).all();

  if (rows.length < 2) return null;

  const latest = rows[0].weight_kg;
  const weekAgo = rows[Math.min(7, rows.length - 1)].weight_kg;
  const diff = latest - weekAgo;

  if (diff < -0.1) return `Cette semaine : -${Math.abs(diff).toFixed(1)} kg ✅ Tu es en train de progresser !\n`;
  if (diff > 0.3) return `Cette semaine : +${diff.toFixed(1)} kg — Analysons ce qui s'est passé.\n`;
  return `Cette semaine : stable (${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg) — Continue ainsi.\n`;
}

function getSupplementSchedule() {
  const supplements = JSON.parse(
    readFileSync(join(__dirname, '../data/supplements.json'), 'utf-8')
  );

  const schedule = {
    morning: supplements.filter(s => s.timing === 'morning_with_food'),
    lunch: supplements.filter(s => s.timing === 'lunch'),
    evening: supplements.filter(s => s.timing === 'evening_before_sleep')
  };

  let text = '';
  if (schedule.morning.length) text += `Matin (avec repas) : ${schedule.morning.map(s => s.name).join(', ')}\n`;
  if (schedule.lunch.length) text += `Déjeuner : ${schedule.lunch.map(s => s.name).join(', ')}\n`;
  if (schedule.evening.length) text += `Soir (avant sommeil) : ${schedule.evening.map(s => s.name).join(', ')}\n`;
  return text;
}

function getMedicationScheduleForBrief() {
  const meds = listMedications();
  if (meds.length === 0) return null;

  let text = '';
  for (const m of meds) {
    const dose = m.dose ? ` ${m.dose}` : '';
    const timing = m.timing ? ` — ${m.timing}` : '';
    text += `• ${m.name}${dose}${timing}\n`;
  }
  return text;
}

function getDailyFact() {
  return getMotivationFact().fact;
}

function getMicroObjective() {
  const obj = getMotivationObjective();
  return `${obj.objective}\n${obj.why}`;
}
