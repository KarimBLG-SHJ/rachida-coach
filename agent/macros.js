// macros.js — Calculates Rachida's daily macro targets
// Recalculates every morning using her latest weight

import db from '../db/connection.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profile = JSON.parse(readFileSync(join(__dirname, '../data/profile.json'), 'utf-8'));

/**
 * Get Rachida's most recent weight
 * Falls back to profile weight if no log exists
 */
function getLatestWeight() {
  const row = db.prepare(`
    SELECT weight_kg FROM weight_log 
    ORDER BY date DESC, id DESC 
    LIMIT 1
  `).get();
  return row ? row.weight_kg : profile.weight_kg;
}

/**
 * Mifflin-St Jeor BMR formula for women
 * Most accurate for women aged 40-55
 */
function calculateBMR(weight_kg, height_cm, age) {
  return (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161;
}

/**
 * Total Daily Energy Expenditure
 * Sedentary with light walking = 1.2 multiplier
 */
function calculateTDEE(bmr) {
  return bmr * 1.2;
}

/**
 * Calculate daily calorie target with safe deficit
 * -400 kcal/day = ~0.5 kg/week loss (1g fat = 7.7 kcal)
 * Minimum 1200 kcal for safety — never go below
 */
function calculateCalorieTarget(tdee) {
  const deficit = 400;
  const minimum = 1200;
  return Math.max(tdee - deficit, minimum);
}

/**
 * Split calories into macros
 * 
 * Protein: 1.6g/kg — preserves muscle during weight loss (critical at 48)
 * Fat: 25% of total calories — hormonal balance, satiety
 * Carbs: remainder — energy for walking and daily function
 */
function calculateMacros(weight_kg, caloriesTarget) {
  const protein_g = Math.round(1.6 * weight_kg);
  const protein_kcal = protein_g * 4;

  const fat_kcal = Math.round(caloriesTarget * 0.25);
  const fat_g = Math.round(fat_kcal / 9);

  const carbs_kcal = Math.round(caloriesTarget - protein_kcal - fat_kcal);
  const carbs_g = Math.round(carbs_kcal / 4);

  return { protein_g, fat_g, carbs_g, protein_kcal, fat_kcal, carbs_kcal };
}

/**
 * Check if today is Ramadan (simple date range check)
 * Update these dates each year
 */
function isRamadan() {
  const today = new Date();
  // Ramadan 2026: approximate dates — update each year
  const ramadanStart = new Date('2026-02-17');
  const ramadanEnd = new Date('2026-03-19');
  return today >= ramadanStart && today <= ramadanEnd;
}

/**
 * Main function — calculate and save today's targets
 */
export function calculateDailyTargets() {
  const today = new Date().toISOString().split('T')[0];
  const weight_kg = getLatestWeight();
  const { height_cm, age } = profile;

  const bmr = Math.round(calculateBMR(weight_kg, height_cm, age));
  const tdee = Math.round(calculateTDEE(bmr));
  const caloriesTarget = Math.round(calculateCalorieTarget(tdee));
  const macros = calculateMacros(weight_kg, caloriesTarget);
  const ramadan = isRamadan();

  const targets = {
    date: today,
    weight_used_kg: weight_kg,
    bmr,
    tdee,
    calories_target: caloriesTarget,
    protein_target_g: macros.protein_g,
    fat_target_g: macros.fat_g,
    carbs_target_g: macros.carbs_g,
    is_ramadan: ramadan ? 1 : 0
  };

  // Save to database
  db.prepare(`
    INSERT OR REPLACE INTO daily_targets 
    (date, weight_used_kg, bmr, tdee, calories_target, protein_target_g, fat_target_g, carbs_target_g, is_ramadan)
    VALUES (@date, @weight_used_kg, @bmr, @tdee, @calories_target, @protein_target_g, @fat_target_g, @carbs_target_g, @is_ramadan)
  `).run(targets);

  return {
    ...targets,
    macros,
    ramadan,
    explanation: buildExplanation(bmr, tdee, caloriesTarget, macros, weight_kg, ramadan)
  };
}

/**
 * Human-readable explanation of the macros
 * Rachida should understand why these numbers are set
 */
function buildExplanation(bmr, tdee, calories, macros, weight, ramadan) {
  return {
    bmr_note: `Ton corps brûle ${bmr} kcal au repos (respiration, cœur, organes).`,
    tdee_note: `Avec ton activité quotidienne, tu brûles ${tdee} kcal par jour.`,
    deficit_note: `On enlève 400 kcal. Tu arriveras à 0.5 kg de perte par semaine — sans te priver.`,
    protein_note: `${macros.protein_g}g de protéines : c'est essentiel pour garder ton muscle. À 48 ans, le muscle se perd vite. Les protéines le préservent.`,
    fat_note: `${macros.fat_g}g de lipides : ton corps en a besoin pour les hormones et la satiété. Les bons gras (huile d'olive, œufs, poisson) sont tes amis.`,
    carbs_note: `${macros.carbs_g}g de glucides : c'est ton énergie pour marcher et travailler. Privilégie le riz complet, le pain pita, les légumineuses.`,
    ramadan_note: ramadan ? `C'est le Ramadan. Les mêmes calories — réparties sur Suhoor et Iftar.` : null
  };
}

/**
 * Get today's targets from DB (or calculate if not yet done)
 */
export function getTodayTargets() {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare('SELECT * FROM daily_targets WHERE date = ?').get(today);
  if (row) return row;
  return calculateDailyTargets();
}

/**
 * Get today's consumed macros from meal log
 */
export function getTodayConsumed() {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(calories), 0) as calories,
      COALESCE(SUM(protein_g), 0) as protein_g,
      COALESCE(SUM(fat_g), 0) as fat_g,
      COALESCE(SUM(carbs_g), 0) as carbs_g
    FROM meal_log 
    WHERE date = ?
  `).get(today);
  return row;
}

/**
 * Get remaining calories and macros for the day
 */
export function getRemainingToday() {
  const targets = getTodayTargets();
  const consumed = getTodayConsumed();

  return {
    calories: Math.round(targets.calories_target - consumed.calories),
    protein_g: Math.round(targets.protein_target_g - consumed.protein_g),
    fat_g: Math.round(targets.fat_target_g - consumed.fat_g),
    carbs_g: Math.round(targets.carbs_target_g - consumed.carbs_g),
    targets,
    consumed
  };
}
