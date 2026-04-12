#!/usr/bin/env node
// index.js — Rachida Health Coach v2.0

import './env.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import chalk from 'chalk';
import db from './db/connection.js';
import { runMigrations } from './db/migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { startSmartScheduler } from './reminders/smart-schedule.js';
import { logMeal, generateMorningBrief, chat } from './agent/coach.js';
import { calculateDailyTargets, getTodayConsumed, getTodayTargets } from './agent/macros.js';
import { analyzeBloodwork, getBloodworkHistory } from './commands/upload-bloodwork.js';
import { uploadProgressPhoto, getMeasurementHistory } from './commands/upload-photo.js';
import { runMeasurementWizard } from './commands/log-measurements.js';
import { whatIsMissing, getDaySummaryContext } from './reminders/smart-schedule.js';
import { listMedications, formatMedicationSchedule } from './commands/medications.js';
import { generateDailyReport } from './ui/daily-report.js';
import { startWebUI } from './ui/server.js';


const args = process.argv.slice(2);
const command = args[0];

async function main() {
  // Run DB migrations before anything else
  runMigrations();

  switch (command) {

    case undefined:
    case 'chat':
      await startChat();
      break;

    case 'brief':
      console.log(await generateMorningBrief());
      break;

    case 'semaine':
    case 'week':
      await showWeeklyReview();
      break;

    case 'web':
      calculateDailyTargets();
      startWebUI();
      startSmartScheduler();
      break;

    case 'daemon':
      console.log(chalk.green('🧠 Smart reminders running — Dubai timezone'));
      calculateDailyTargets();
      startSmartScheduler();
      process.stdin.resume();
      break;

    case 'medicaments':
    case 'med':
      showMedications();
      break;

    case 'rapport': {
      const reportPath = generateDailyReport();
      console.log(chalk.green(`📊 Rapport généré : ${reportPath}`));
      const { default: openUrl } = await import('open');
      await openUrl(reportPath);
      break;
    }

    case 'mensuration':
      await runMeasurementWizard();
      break;

    case 'photo':
      if (!args[1]) {
        console.log(chalk.red('Usage: node index.js photo <chemin_image> [--analyser] [--comparer]'));
        break;
      }
      await uploadProgressPhoto(args[1], {
        analyzePosture: args.includes('--analyser'),
        compareWithPrevious: args.includes('--comparer')
      });
      break;

    case 'analyse-sang':
      if (!args[1]) {
        console.log(chalk.red('Usage: node index.js analyse-sang <chemin_pdf>'));
        break;
      }
      await analyzeBloodwork(args[1]);
      break;

    case 'historique':
      showHistorique(args[1]);
      break;

    case 'setup':
      await runSetup();
      break;

    default:
      showHelp();
  }
}

// ── CHAT ──────────────────────────────────────

async function startChat() {
  console.clear();
  console.log(chalk.cyan('═'.repeat(55)));
  console.log(chalk.cyan('  💬 Rachida Health Coach'));
  console.log(chalk.cyan('═'.repeat(55)));

  // Show what's missing today on startup
  const missing = whatIsMissing();
  if (missing.length > 0) {
    console.log(chalk.yellow('\n📋 À faire aujourd\'hui :'));
    missing.forEach(m => console.log(chalk.yellow(`  • ${m.message.split('\n')[0]}`)));
  }

  console.log(chalk.gray('\nCommandes : /brief /repas /jour /semaine /medicaments /quitter\n'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history = [];

  const ask = () => {
    rl.question(chalk.yellow('Rachida → '), async (input) => {
      const msg = input.trim();
      if (!msg) { ask(); return; }

      if (msg === '/quitter') {
        console.log(chalk.green('\nÀ demain Rachida ! 👋\n'));
        rl.close(); return;
      }

      if (msg === '/brief') {
        console.log(chalk.cyan(await generateMorningBrief()));
        ask(); return;
      }

      if (msg === '/jour') {
        showDaySummary();
        ask(); return;
      }

      if (msg === '/medicaments' || msg === '/med') {
        showMedications();
        ask(); return;
      }

      if (msg === '/semaine') {
        await showWeeklyReview();
        ask(); return;
      }

      // Detect meal in free text
      if (msg.startsWith('/repas')) {
        const parts = msg.split(' ');
        const mealType = parts[1] || 'lunch';
        const desc = parts.slice(2).join(' ');
        if (desc) {
          console.log(chalk.gray('Analyse...'));
          console.log(chalk.green(await logMeal(desc, mealType)));
        } else {
          rl.question(chalk.yellow("Qu'est-ce que tu as mangé ? → "), async (d) => {
            console.log(chalk.gray('Analyse...'));
            console.log(chalk.green(await logMeal(d, mealType)));
            ask();
          }); return;
        }
        ask(); return;
      }

      // Free text — detect if it's a meal description
      const mealWords = ['mangé', 'bu', 'déjeuner', 'dîner', 'petit-déj', 'snack', 'collation', 'repas', 'j\'ai eu'];
      const looksLikeMeal = mealWords.some(w => msg.toLowerCase().includes(w));

      if (looksLikeMeal) {
        const hour = new Date().getHours();
        const mealType = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
        console.log(chalk.gray('Analyse du repas...'));
        console.log(chalk.green(await logMeal(msg, mealType)));
        ask(); return;
      }

      // General question
      try {
        const response = await chat(msg, history);
        console.log(chalk.green('\nCoach → ' + response + '\n'));
        history.push({ role: 'user', content: msg });
        history.push({ role: 'assistant', content: response });
        if (history.length > 20) history.splice(0, 2);
      } catch (e) {
        console.error(chalk.red('Erreur :', e.message));
      }

      ask();
    });
  };

  ask();
}

// ── MEDICATIONS ──────────────────────────────

function showMedications() {
  const meds = listMedications();
  if (meds.length === 0) {
    console.log(chalk.yellow('\nAucun médicament enregistré.'));
    console.log(chalk.gray('Dis au coach : "je prends du Glucophage 500mg le matin" et il le notera.\n'));
    return;
  }

  console.log(chalk.cyan('\n💊 TES MÉDICAMENTS'));
  const schedule = formatMedicationSchedule();
  console.log(schedule);
  console.log(chalk.gray('Pour ajouter/retirer un médicament, dis-le simplement au coach.\n'));
}

// ── DAY SUMMARY ───────────────────────────────

function showDaySummary() {
  const ctx = getDaySummaryContext();
  const today = new Date().toLocaleDateString('fr-FR');

  console.log(chalk.cyan(`\n📊 AUJOURD'HUI — ${today}`));
  console.log(`Repas notés : ${ctx.meals_logged}`);
  console.log(`Calories : ${ctx.calories_consumed} / ${ctx.calories_target} kcal`);
  console.log(`Protéines : ${ctx.protein_consumed}g / ${ctx.protein_target}g`);
  console.log(`Pas : ${ctx.steps || 'non disponible'}`);

  const pct = Math.round((ctx.calories_consumed / ctx.calories_target) * 100);
  const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
  console.log(`\nProgress : [${bar}] ${pct}%\n`);
}

// ── WEEKLY REVIEW ─────────────────────────────

async function showWeeklyReview() {
  const meals = db.prepare(`
    SELECT date,
      COALESCE(SUM(calories),0) as cal,
      COALESCE(SUM(protein_g),0) as protein,
      COUNT(*) as meal_count
    FROM meal_log
    WHERE date >= date('now', '-7 days')
    GROUP BY date ORDER BY date ASC
  `).all();

  const weights = db.prepare(`
    SELECT date, weight_kg FROM weight_log
    WHERE date >= date('now', '-7 days')
    ORDER BY date ASC
  `).all();

  const activity = db.prepare(`
    SELECT date, steps, active_calories, exercise_minutes
    FROM activity_log
    WHERE date >= date('now', '-7 days')
    ORDER BY date ASC
  `).all();

  const supplements = db.prepare(`
    SELECT supplement_name, COUNT(*) as days_taken
    FROM supplement_log
    WHERE date >= date('now', '-7 days') AND taken = 1
    GROUP BY supplement_id
  `).all();

  const target = db.prepare(`
    SELECT calories_target, protein_target_g FROM daily_targets
    ORDER BY date DESC LIMIT 1
  `).get();

  const prompt = `
Bilan de la semaine de Rachida :

REPAS ET CALORIES PAR JOUR :
${meals.map(r => `${r.date} : ${Math.round(r.cal)} kcal, ${Math.round(r.protein)}g protéines (${r.meal_count} repas notés)`).join('\n') || 'Aucune donnée'}

OBJECTIF QUOTIDIEN : ${target?.calories_target || '~1250'} kcal, ${target?.protein_target_g || '120'}g protéines

POIDS :
${weights.map(w => `${w.date} : ${w.weight_kg} kg`).join('\n') || 'Non enregistré'}

ACTIVITÉ :
${activity.map(a => `${a.date} : ${a.steps} pas, ${a.active_calories} kcal actives, ${a.exercise_minutes} min exercice`).join('\n') || 'Non disponible'}

COMPLÉMENTS (pris cette semaine) :
${supplements.map(s => `${s.supplement_name} : ${s.days_taken}/7 jours`).join('\n') || 'Non suivi'}

Génère le bilan hebdomadaire selon ce format EXACT :

1. CE QUI A BIEN MARCHÉ cette semaine (1-2 points, basé sur les données réelles)
2. TENDANCE DU POIDS (cette semaine vs début de semaine — rassurer si stable)
3. CALORIES MOYENNES vs objectif (${target?.calories_target || '~1250'} kcal)
4. UN SEUL POINT À AMÉLIORER la semaine prochaine (spécifique et faisable)
5. OBJECTIF DE LA SEMAINE PROCHAINE en 1 phrase simple
6. ENCOURAGEMENT basé sur les données réelles

Court, chaleureux, pédagogique. En français. Pas de slogans vides.
`;

  const response = await chat(prompt);
  console.log(chalk.cyan('\n' + '═'.repeat(55)));
  console.log(chalk.cyan('  📈 BILAN DE LA SEMAINE'));
  console.log(chalk.cyan('═'.repeat(55)));
  console.log(chalk.green(response));
}

// ── HISTORIQUE ────────────────────────────────

function showHistorique(type) {
  if (!type || type === 'mensurations') {
    console.log(getMeasurementHistory());
  }
  if (!type || type === 'sang') {
    const markers = ['vitamin_d', 'b12', 'glucose', 'tsh', 'ferritin'];
    markers.forEach(m => {
      const h = getBloodworkHistory(m);
      if (h) console.log(h);
    });
  }
}

// ── SETUP ─────────────────────────────────────

async function runSetup() {
  console.log(chalk.cyan('\n🚀 Setup — Rachida Health Coach\n'));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(chalk.red('❌ ANTHROPIC_API_KEY manquant dans .env'));
  } else {
    console.log(chalk.green('✅ Anthropic API key trouvée'));
  }

  try {
    console.log(chalk.green('✅ Base de données initialisée (via db/connection.js)'));
  } catch (e) {
    console.error(chalk.red('❌ DB :', e.message));
  }

  try {
    const targets = calculateDailyTargets();
    console.log(chalk.green(`✅ Macros calculées : ${targets.calories_target} kcal/jour`));
  } catch (e) {
    console.error(chalk.red('❌ Macros :', e.message));
  }

  try {
    const { formatPrayerSchedule } = await import('./integrations/prayer-times.js');
    const schedule = await formatPrayerSchedule();
    console.log(chalk.green('✅ Prières Sharjah'));
    console.log(chalk.gray('   ' + schedule));
  } catch (e) {
    console.error(chalk.red('❌ Prières :', e.message));
  }

  // Create assets folder for icon
  const { mkdirSync, existsSync } = await import('fs');
  if (!existsSync('./assets')) mkdirSync('./assets');

  console.log(chalk.cyan('\n✨ Setup terminé. Lance : npm start\n'));
  console.log(chalk.gray('Pour les rappels automatiques : node index.js daemon &\n'));
}

// ── HELP ──────────────────────────────────────

function showHelp() {
  console.log(`
${chalk.cyan('Rachida Health Coach')}

${chalk.bold('Commandes :')}
  npm start                              Chat avec le coach
  npm run brief                          Brief du matin
  npm run semaine                        Bilan de la semaine
  npm run setup                          Configuration initiale
  node index.js daemon                   Rappels automatiques

  node index.js web                        Interface web avec chat (http://localhost:3000)
  node index.js rapport                   Rapport visuel du jour (HTML)
  node index.js medicaments              Voir les médicaments en cours
  node index.js mensuration             Saisir les mensurations du mois
  node index.js photo ./photo.jpg       Uploader une photo
  node index.js photo ./photo.jpg --analyser    + analyse posturale
  node index.js analyse-sang ./bilan.pdf        Analyser prise de sang
  node index.js historique              Voir tout l'historique
  node index.js historique sang         Historique prises de sang
  node index.js historique mensurations Historique mensurations
  `);
}

main().catch(console.error);
