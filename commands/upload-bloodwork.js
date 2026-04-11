// upload-bloodwork.js — Analyze blood test PDF with Claude Vision
// Extracts all values, compares to female 45-55 norms, 
// links to supplements, saves to history

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { basename, extname, join } from 'path';
import Database from 'better-sqlite3';
import chalk from 'chalk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const db = new Database('./db/health.db');

// Ensure storage folders exist
const BLOODWORK_DIR = './data/bloodwork';
if (!existsSync(BLOODWORK_DIR)) mkdirSync(BLOODWORK_DIR, { recursive: true });

// ─────────────────────────────────────────────
// REFERENCE RANGES — Women 45–55
// ─────────────────────────────────────────────
const REFERENCE_RANGES = {
  // Vitamins
  vitamin_d:    { min: 30,   max: 80,    unit: 'ng/mL',  label: 'Vitamine D',        critical_low: 20 },
  b12:          { min: 400,  max: 900,   unit: 'pg/mL',  label: 'Vitamine B12',      critical_low: 200 },
  ferritin:     { min: 12,   max: 150,   unit: 'ng/mL',  label: 'Fer (Ferritine)',   critical_low: 8 },
  iron:         { min: 60,   max: 170,   unit: 'µg/dL',  label: 'Fer sérique',       critical_low: 40 },
  folate:       { min: 5,    max: 20,    unit: 'ng/mL',  label: 'Folate (B9)',       critical_low: 3 },

  // Metabolic
  glucose:      { min: 70,   max: 99,    unit: 'mg/dL',  label: 'Glycémie à jeun',  critical_high: 126 },
  hba1c:        { min: 0,    max: 5.7,   unit: '%',      label: 'HbA1c',            critical_high: 6.5 },
  insulin:      { min: 2,    max: 20,    unit: 'µU/mL',  label: 'Insuline',          critical_high: 25 },

  // Lipids
  total_cholesterol: { min: 0, max: 200, unit: 'mg/dL', label: 'Cholestérol total', critical_high: 240 },
  ldl:          { min: 0,    max: 130,   unit: 'mg/dL',  label: 'LDL (mauvais cholestérol)', critical_high: 160 },
  hdl:          { min: 50,   max: 200,   unit: 'mg/dL',  label: 'HDL (bon cholestérol)',     critical_low: 40 },
  triglycerides:{ min: 0,    max: 150,   unit: 'mg/dL',  label: 'Triglycérides',    critical_high: 200 },

  // Thyroid (important for weight at 48)
  tsh:          { min: 0.4,  max: 4.0,   unit: 'mIU/L',  label: 'TSH (Thyroïde)',   critical_high: 10 },
  t4_free:      { min: 0.8,  max: 1.8,   unit: 'ng/dL',  label: 'T4 Libre',         critical_low: 0.5 },

  // Hormones (perimenopause relevant)
  estradiol:    { min: 15,   max: 350,   unit: 'pg/mL',  label: 'Estradiol',         critical_low: 10 },

  // Inflammation
  crp:          { min: 0,    max: 5,     unit: 'mg/L',   label: 'CRP (Inflammation)',critical_high: 10 },

  // Kidney / Liver
  creatinine:   { min: 0.5,  max: 1.1,   unit: 'mg/dL',  label: 'Créatinine (Reins)', critical_high: 1.5 },
  alt:          { min: 0,    max: 35,    unit: 'U/L',    label: 'ALT (Foie)',        critical_high: 70 },

  // Minerals
  magnesium:    { min: 1.7,  max: 2.4,   unit: 'mg/dL',  label: 'Magnésium',         critical_low: 1.2 },
  calcium:      { min: 8.5,  max: 10.5,  unit: 'mg/dL',  label: 'Calcium',           critical_low: 7.5 },
};

// ─────────────────────────────────────────────
// MAIN: Upload and analyze a blood test PDF
// ─────────────────────────────────────────────

export async function analyzeBloodwork(pdfPath) {
  if (!existsSync(pdfPath)) {
    throw new Error(`Fichier introuvable : ${pdfPath}`);
  }

  console.log(chalk.cyan('\n🩸 Analyse de la prise de sang en cours...\n'));

  // Read and encode PDF
  const pdfBuffer = readFileSync(pdfPath);
  const base64PDF = pdfBuffer.toString('base64');

  // Archive the file
  const filename = basename(pdfPath);
  const date = new Date().toISOString().split('T')[0];
  const archivePath = join(BLOODWORK_DIR, `${date}_${filename}`);
  copyFileSync(pdfPath, archivePath);

  // Extract all values from PDF using Claude
  const extractionResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64PDF
          }
        },
        {
          type: 'text',
          text: `Extrait TOUS les marqueurs biologiques de ce rapport sanguin.

Pour chaque valeur trouvée, retourne un JSON avec exactement ce format :
{
  "test_date": "YYYY-MM-DD",
  "markers": [
    {
      "label": "Nom affiché dans le rapport",
      "key": "clé_normalisée_en_anglais",
      "value": 42.5,
      "unit": "ng/mL",
      "reference_range_raw": "30-80 ng/mL"
    }
  ]
}

Clés normalisées à utiliser si tu reconnais le marqueur :
vitamin_d, b12, ferritin, iron, folate, glucose, hba1c, insulin, 
total_cholesterol, ldl, hdl, triglycerides, tsh, t4_free, estradiol,
crp, creatinine, alt, magnesium, calcium

Si tu ne reconnais pas le marqueur, utilise un slug en minuscules sans espaces.
Retourne UNIQUEMENT du JSON valide, rien d'autre.`
        }
      ]
    }]
  });

  const rawText = extractionResponse.content[0].text.replace(/```json|```/g, '').trim();
  const extracted = JSON.parse(rawText);

  // Classify each marker (normal / low / high / critical)
  const classified = classifyMarkers(extracted.markers);

  // Save to database
  const testDate = extracted.test_date || date;
  saveToDatabase(testDate, classified, filename);

  // Generate the analysis report
  const report = await generateReport(classified, testDate);

  console.log(report);
  return { classified, report };
}

// ─────────────────────────────────────────────
// CLASSIFY: Compare to reference ranges
// ─────────────────────────────────────────────

function classifyMarkers(markers) {
  return markers.map(marker => {
    const ref = REFERENCE_RANGES[marker.key];
    let status = 'unknown';
    let is_critical = false;

    if (ref) {
      if (marker.value < ref.min) {
        status = 'low';
        if (ref.critical_low && marker.value < ref.critical_low) is_critical = true;
      } else if (marker.value > ref.max) {
        status = 'high';
        if (ref.critical_high && marker.value > ref.critical_high) is_critical = true;
      } else {
        status = 'normal';
      }
    }

    return {
      ...marker,
      ref,
      status,
      is_critical,
      display_label: ref ? ref.label : marker.label
    };
  });
}

// ─────────────────────────────────────────────
// SAVE: Store results in SQLite
// ─────────────────────────────────────────────

function saveToDatabase(testDate, markers, filename) {
  const insert = db.prepare(`
    INSERT INTO bloodwork (test_date, marker, value, unit, reference_min, reference_max, status, note, pdf_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((markers) => {
    for (const m of markers) {
      insert.run(
        testDate,
        m.key,
        m.value,
        m.unit,
        m.ref?.min ?? null,
        m.ref?.max ?? null,
        m.status,
        null,
        filename
      );
    }
  });

  insertMany(markers);
}

// ─────────────────────────────────────────────
// REPORT: Generate plain-French analysis
// ─────────────────────────────────────────────

async function generateReport(markers, testDate) {
  const supplements = JSON.parse(readFileSync('./data/supplements.json', 'utf-8'));

  const abnormal = markers.filter(m => m.status !== 'normal' && m.status !== 'unknown');
  const critical = markers.filter(m => m.is_critical);
  const normal = markers.filter(m => m.status === 'normal');

  // Build context for Claude analysis
  const markerContext = markers.map(m => {
    const statusLabel = { normal: '✅ Normal', low: '⬇️ Bas', high: '⬆️ Élevé', unknown: '❓ Non classé' }[m.status] || '❓';
    const criticalFlag = m.is_critical ? ' ⚠️ CONSULTER MÉDECIN' : '';
    return `${m.display_label} : ${m.value} ${m.unit || ''} — ${statusLabel}${criticalFlag}`;
  }).join('\n');

  const suppContext = supplements.map(s =>
    `${s.name} (${s.dose}) — prise ${s.timing}`
  ).join('\n');

  const prompt = `
Tu es le coach de santé de Rachida (48 ans, 75 kg, objectif perte de poids).
Tu la tutoies, tu es bienveillant, tu utilises des petits noms (ma belle, habibti).
Tu parles court et simple.

Voici ses résultats de prise de sang du ${testDate} :

${markerContext}

Ses compléments actuels :
${suppContext}

Génère un rapport en français structuré ainsi :

1. CE QUI VA BIEN 👍 (encourage-la sur les valeurs normales, 2-3 lignes)
2. CE QU'ON SURVEILLE (valeurs anormales — explique simplement ce que ça veut dire pour elle)
3. IMPACT SUR SES OBJECTIFS — relie les résultats à :
   - Sa perte de gras (est-ce qu'un résultat freine ou aide ?)
   - Ses cheveux (fer, B12, zinc — ça impacte direct)
   - Son sommeil (magnésium, thyroïde)
   - Sa faim (glycémie, insuline, vitamine D)
4. UNE SEULE ACTION à faire maintenant (la plus importante)

Règles :
- Français, court, simple — pas de jargon sans explication
- Si une valeur est critique → "Montre ce résultat à ton médecin, ma belle. C'est important."
- Jamais de médicament recommandé
- Maximum 300 mots — elle est occupée
`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  const analysis = response.content[0].text;

  // Build full formatted report
  let report = `\n${'═'.repeat(60)}\n`;
  report += `🩸 ANALYSE PRISE DE SANG — ${testDate}\n`;
  report += `${'═'.repeat(60)}\n\n`;

  // Summary table
  report += `📋 RÉSUMÉ DES VALEURS\n`;
  report += `${'─'.repeat(50)}\n`;

  if (critical.length > 0) {
    report += chalk.red(`\n⚠️  VALEURS À MONTRER AU MÉDECIN :\n`);
    critical.forEach(m => {
      report += chalk.red(`   • ${m.display_label} : ${m.value} ${m.unit || ''}\n`);
    });
  }

  if (abnormal.filter(m => !m.is_critical).length > 0) {
    report += `\n📊 Valeurs hors normes :\n`;
    abnormal.filter(m => !m.is_critical).forEach(m => {
      const arrow = m.status === 'low' ? '⬇️ Bas' : '⬆️ Élevé';
      report += `   • ${m.display_label} : ${m.value} ${m.unit || ''} — ${arrow} (norme : ${m.ref?.min}–${m.ref?.max} ${m.ref?.unit || ''})\n`;
    });
  }

  report += `\n✅ Valeurs normales : ${normal.length} marqueurs dans les normes\n`;

  report += `\n${'─'.repeat(50)}\n`;
  report += `\n💬 ANALYSE DU COACH\n\n`;
  report += analysis;
  report += `\n\n${'═'.repeat(60)}\n`;

  return report;
}

// ─────────────────────────────────────────────
// HISTORY: Compare with previous results
// ─────────────────────────────────────────────

export function getBloodworkHistory(marker) {
  const rows = db.prepare(`
    SELECT test_date, value, unit, status
    FROM bloodwork
    WHERE marker = ?
    ORDER BY test_date ASC
  `).all(marker);

  if (rows.length === 0) return null;

  const ref = REFERENCE_RANGES[marker];
  const label = ref?.label || marker;

  let output = `\n📈 Historique — ${label}\n`;
  rows.forEach(row => {
    const statusIcon = { normal: '✅', low: '⬇️', high: '⬆️' }[row.status] || '❓';
    output += `  ${row.test_date} : ${row.value} ${row.unit || ''} ${statusIcon}\n`;
  });

  if (rows.length >= 2) {
    const first = rows[0].value;
    const last = rows[rows.length - 1].value;
    const trend = last > first ? '⬆️ augmentation' : last < first ? '⬇️ diminution' : '➡️ stable';
    output += `  Tendance : ${trend}\n`;
  }

  return output;
}
