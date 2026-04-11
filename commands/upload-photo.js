// upload-photo.js — Visual progress tracking
// Handles: progress photos + body measurements
// Photos are stored locally, NEVER sent to any cloud
// Claude Vision analyzes posture and visible changes

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import Database from 'better-sqlite3';
import chalk from 'chalk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const db = new Database('./db/health.db');

// Storage folders
const PHOTOS_DIR = './data/photos';
const MEASUREMENTS_DIR = './data/measurements';
[PHOTOS_DIR, MEASUREMENTS_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// Supported image formats
const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];

// ─────────────────────────────────────────────
// PHOTO UPLOAD
// ─────────────────────────────────────────────

/**
 * Save and optionally analyze a progress photo
 * Photos are NEVER sent anywhere — stored locally only
 * Claude Vision only used if user explicitly requests analysis
 */
export async function uploadProgressPhoto(imagePath, options = {}) {
  const {
    analyzePosture = false,   // Use Claude Vision to analyze posture
    compareWithPrevious = false,
    notes = ''
  } = options;

  if (!existsSync(imagePath)) {
    throw new Error(`Image introuvable : ${imagePath}`);
  }

  const ext = extname(imagePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext) && ext !== '.heic') {
    throw new Error(`Format non supporté. Formats acceptés : JPG, PNG, WEBP, HEIC`);
  }

  // Archive photo with timestamp
  const date = new Date().toISOString().split('T')[0];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const storedFilename = `${timestamp}${ext}`;
  const storedPath = join(PHOTOS_DIR, storedFilename);
  copyFileSync(imagePath, storedPath);

  // Save metadata to database
  const photoId = db.prepare(`
    INSERT INTO progress_photos (date, filename, filepath, notes, analyzed)
    VALUES (?, ?, ?, ?, 0)
  `).run(date, storedFilename, storedPath, notes).lastInsertRowid;

  console.log(chalk.green(`\n✅ Photo sauvegardée — ${date}`));
  console.log(chalk.gray(`   Stockée localement : ${storedPath}`));
  console.log(chalk.gray(`   Cette photo ne quitte jamais ton Mac.\n`));

  let analysis = null;

  // Only analyze visually if explicitly requested
  if (analyzePosture) {
    analysis = await analyzePhoto(imagePath, date, compareWithPrevious);
    db.prepare('UPDATE progress_photos SET analyzed = 1 WHERE id = ?').run(photoId);
  }

  // Show photo timeline
  const timeline = getPhotoTimeline();
  console.log(timeline);

  return { photoId, storedPath, analysis };
}

/**
 * Use Claude Vision to analyze posture and visible progress
 * Sensitive — focuses on health indicators, not appearance
 */
async function analyzePhoto(imagePath, date, compareWithPrevious) {
  console.log(chalk.cyan('🔍 Analyse posturale en cours...\n'));

  const ext = extname(imagePath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : 
                    ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  // Get previous photo for comparison if requested
  let previousContext = '';
  if (compareWithPrevious) {
    const prevPhoto = db.prepare(`
      SELECT filepath, date FROM progress_photos 
      ORDER BY date DESC LIMIT 1 OFFSET 1
    `).get();
    if (prevPhoto) {
      previousContext = `Une photo précédente existe du ${prevPhoto.date}.`;
    }
  }

  const prompt = `Tu es le coach de santé de Rachida (48 ans, objectif perte de poids).
Tu la tutoies, tu es bienveillant, tu utilises des petits noms (ma belle, habibti).

Cette photo est une photo de suivi de progression.
${previousContext}

Analyse UNIQUEMENT ces points de santé (pas d'esthétique, pas de jugement):
1. Posture (dos, épaules, alignement)
2. Si tu vois des changements vs la photo précédente, dis-le
3. Un encouragement basé sur ce que tu vois

Règles absolues :
- Jamais de commentaire négatif sur le corps
- Focus santé et posture — jamais l'apparence
- Court, chaleureux, bienveillant
- Maximum 100 mots
- En français`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Image }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const analysis = response.content[0].text;
  
  // Save analysis to DB
  db.prepare(`
    UPDATE progress_photos SET analysis = ? WHERE date = ? ORDER BY id DESC LIMIT 1
  `).run(analysis, date);

  console.log(chalk.cyan('\n📷 Analyse de ta photo :\n'));
  console.log(chalk.white(analysis));
  console.log('');

  return analysis;
}

// ─────────────────────────────────────────────
// MEASUREMENTS
// ─────────────────────────────────────────────

/**
 * Log body measurements
 * All in cm and kg
 */
export async function logMeasurements(measurements) {
  const date = new Date().toISOString().split('T')[0];

  const {
    weight_kg,
    waist_cm,      // Tour de taille (nombril)
    hips_cm,       // Tour de hanches
    chest_cm,      // Tour de poitrine
    thigh_cm,      // Tour de cuisse (gauche)
    arm_cm,        // Tour de bras (gauche)
    neck_cm,       // Tour de cou (pour calcul % graisse)
    notes = ''
  } = measurements;

  // Calculate waist-to-hip ratio (health indicator)
  let waistHipRatio = null;
  let waistHipStatus = null;
  if (waist_cm && hips_cm) {
    waistHipRatio = (waist_cm / hips_cm).toFixed(2);
    // For women: < 0.80 = good, 0.80-0.85 = moderate risk, > 0.85 = high risk
    waistHipStatus = waistHipRatio < 0.80 ? 'bon' : waistHipRatio < 0.85 ? 'modéré' : 'à améliorer';
  }

  // Calculate body fat % using US Navy formula (if neck + waist available)
  let bodyFatPercent = null;
  if (waist_cm && neck_cm && measurements.height_cm) {
    const height = measurements.height_cm || 165; // Rachida's height
    // US Navy formula for women: 163.205 × log10(waist + hips - neck) - 97.684 × log10(height) - 78.387
    if (hips_cm) {
      bodyFatPercent = (
        163.205 * Math.log10(waist_cm + hips_cm - neck_cm) -
        97.684 * Math.log10(height) -
        78.387
      ).toFixed(1);
    }
  }

  // Save to database
  db.prepare(`
    INSERT INTO measurements 
    (date, weight_kg, waist_cm, hips_cm, chest_cm, thigh_cm, arm_cm, neck_cm, 
     waist_hip_ratio, body_fat_percent, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, weight_kg || null, waist_cm || null, hips_cm || null,
    chest_cm || null, thigh_cm || null, arm_cm || null, neck_cm || null,
    waistHipRatio, bodyFatPercent, notes
  );

  // Generate report
  const report = await generateMeasurementReport(measurements, date, waistHipRatio, waistHipStatus, bodyFatPercent);
  console.log(report);

  return { date, waistHipRatio, waistHipStatus, bodyFatPercent };
}

/**
 * Generate measurement report with trend comparison
 */
async function generateMeasurementReport(current, date, whr, whrStatus, bodyFat) {
  const previous = db.prepare(`
    SELECT * FROM measurements ORDER BY date DESC LIMIT 1 OFFSET 1
  `).get();

  let report = `\n${'═'.repeat(55)}\n`;
  report += `📏 MENSURATIONS — ${date}\n`;
  report += `${'═'.repeat(55)}\n\n`;

  // Current measurements table
  const metrics = [
    { label: 'Poids',           value: current.weight_kg, unit: 'kg',  key: 'weight_kg' },
    { label: 'Tour de taille',  value: current.waist_cm,  unit: 'cm',  key: 'waist_cm' },
    { label: 'Tour de hanches', value: current.hips_cm,   unit: 'cm',  key: 'hips_cm' },
    { label: 'Tour de poitrine',value: current.chest_cm,  unit: 'cm',  key: 'chest_cm' },
    { label: 'Tour de cuisse',  value: current.thigh_cm,  unit: 'cm',  key: 'thigh_cm' },
    { label: 'Tour de bras',    value: current.arm_cm,    unit: 'cm',  key: 'arm_cm' },
  ];

  metrics.forEach(metric => {
    if (!metric.value) return;

    let trend = '';
    if (previous && previous[metric.key]) {
      const diff = metric.value - previous[metric.key];
      const diffStr = Math.abs(diff).toFixed(1);
      // For waist/hips/thigh — lower is progress
      const isProgress = (metric.key === 'weight_kg' || metric.key !== 'chest_cm')
        ? diff < 0 : diff > 0;
      trend = diff === 0 ? ' (stable)' :
              isProgress ? chalk.green(` (-${diffStr} ${metric.unit} ✅)`) :
                           chalk.yellow(` (+${diffStr} ${metric.unit})`);
    }

    report += `${metric.label.padEnd(20)} : ${metric.value} ${metric.unit}${trend}\n`;
  });

  // Health indicators
  report += `\n📊 INDICATEURS SANTÉ\n`;
  report += `${'─'.repeat(40)}\n`;

  if (whr) {
    const whrIcon = whrStatus === 'bon' ? '✅' : whrStatus === 'modéré' ? '⚠️' : '🔴';
    report += `Rapport taille/hanches : ${whr} — ${whrIcon} ${whrStatus}\n`;
    report += chalk.gray(`   (Pour une femme, < 0.80 = risque cardiovasculaire faible)\n`);
  }

  if (bodyFat) {
    // Reference: women 48 years: 28-35% normal, 35%+ high
    const bfStatus = bodyFat < 28 ? '✅ Très bien' : bodyFat < 35 ? '✅ Normal' : '⚠️ À améliorer';
    report += `% Graisse corporelle (estimé) : ${bodyFat}% — ${bfStatus}\n`;
    report += chalk.gray(`   (Estimation mathématique — moins précis que Withings)\n`);
  }

  // AI coaching note on measurements
  const aiNote = await getMeasurementInsight(current, previous, whr, bodyFat);
  report += `\n💬 Note du coach\n`;
  report += aiNote;
  report += `\n\n${'═'.repeat(55)}\n`;

  return report;
}

async function getMeasurementInsight(current, previous, whr, bodyFat) {
  const context = `
Tu es le coach de Rachida (48 ans, objectif perte de poids). Tu la tutoies, tu es bienveillant.

Ses mensurations d'aujourd'hui : ${JSON.stringify(current)}
${previous ? `Mensurations précédentes : ${JSON.stringify(previous)}` : 'Premières mensurations — bravo d\'avoir commencé !'}
Rapport taille/hanches : ${whr || 'non calculé'}
% graisse estimé : ${bodyFat || 'non calculé'}

En 2-3 phrases courtes :
1. Ce que ça veut dire pour sa perte de gras (le poids c'est pas tout, les cm comptent plus)
2. Ce qui est encourageant
3. UN truc à viser pour le mois prochain

Court, simple, bienveillant. Pas de jargon.
`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{ role: 'user', content: context }]
  });

  return response.content[0].text;
}

// ─────────────────────────────────────────────
// PHOTO TIMELINE
// ─────────────────────────────────────────────

export function getPhotoTimeline() {
  const photos = db.prepare(`
    SELECT date, filename, notes, analyzed
    FROM progress_photos
    ORDER BY date DESC
    LIMIT 10
  `).all();

  if (photos.length === 0) return '';

  let output = `\n📷 TES PHOTOS DE PROGRESSION (${photos.length} photos)\n`;
  output += `${'─'.repeat(40)}\n`;
  photos.forEach((p, i) => {
    const analyzed = p.analyzed ? ' 🔍 analysée' : '';
    const note = p.notes ? ` — ${p.notes}` : '';
    output += `  ${i + 1}. ${p.date}${note}${analyzed}\n`;
  });
  output += `\nStockées localement dans : ./data/photos/\n`;

  return output;
}

// ─────────────────────────────────────────────
// MEASUREMENT HISTORY
// ─────────────────────────────────────────────

export function getMeasurementHistory() {
  const rows = db.prepare(`
    SELECT * FROM measurements ORDER BY date ASC
  `).all();

  if (rows.length === 0) {
    return 'Aucune mensuration enregistrée pour l\'instant.';
  }

  let output = `\n📏 HISTORIQUE MENSURATIONS\n`;
  output += `${'─'.repeat(55)}\n`;
  output += `${'Date'.padEnd(12)} ${'Poids'.padEnd(8)} ${'Taille'.padEnd(9)} ${'Hanches'.padEnd(10)} ${'T/H'.padEnd(6)} ${'%Graisse'}\n`;
  output += `${'─'.repeat(55)}\n`;

  rows.forEach(row => {
    const whr = row.waist_hip_ratio || '—';
    const bf = row.body_fat_percent ? `${row.body_fat_percent}%` : '—';
    output += `${row.date.padEnd(12)} ${(row.weight_kg + 'kg').padEnd(8)} ${((row.waist_cm || '—') + 'cm').padEnd(9)} ${((row.hips_cm || '—') + 'cm').padEnd(10)} ${String(whr).padEnd(6)} ${bf}\n`;
  });

  // Progress summary
  if (rows.length >= 2) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    output += `${'─'.repeat(55)}\n`;
    if (first.weight_kg && last.weight_kg) {
      const weightLost = (first.weight_kg - last.weight_kg).toFixed(1);
      output += `📉 Poids perdu depuis le début : ${weightLost} kg\n`;
    }
    if (first.waist_cm && last.waist_cm) {
      const waistLost = (first.waist_cm - last.waist_cm).toFixed(1);
      output += `📏 Tour de taille réduit : ${waistLost} cm\n`;
    }
  }

  return output;
}
