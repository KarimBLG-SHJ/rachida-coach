// daily-report.js — Generates a visual HTML daily report
// Opens in the default browser

import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getTodayTargets, getTodayConsumed } from '../agent/macros.js';
import { listMedications } from '../commands/medications.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database('./db/health.db');

export function generateDailyReport() {
  const today = new Date().toISOString().split('T')[0];
  const targets = getTodayTargets();
  const consumed = getTodayConsumed();

  const meals = db.prepare(`
    SELECT meal_type, description, calories, protein_g, fat_g, carbs_g, time
    FROM meal_log WHERE date = ? ORDER BY time ASC
  `).all(today);

  const weight = db.prepare(
    'SELECT weight_kg, fat_percent FROM weight_log WHERE date = ? ORDER BY id DESC LIMIT 1'
  ).get(today);

  const weightHistory = db.prepare(`
    SELECT date, weight_kg FROM weight_log
    WHERE date >= date('now', '-14 days')
    ORDER BY date ASC
  `).all();

  const activity = db.prepare(
    'SELECT steps, active_calories, exercise_minutes FROM activity_log WHERE date = ? LIMIT 1'
  ).get(today);

  const meds = listMedications();
  const supplements = JSON.parse(readFileSync(join(__dirname, '../data/supplements.json'), 'utf-8'));

  const calPct = Math.min(Math.round((consumed.calories / targets.calories_target) * 100), 100);
  const protPct = Math.min(Math.round((consumed.protein_g / targets.protein_target_g) * 100), 100);
  const fatPct = Math.min(Math.round((consumed.fat_g / targets.fat_target_g) * 100), 100);
  const carbsPct = Math.min(Math.round((consumed.carbs_g / targets.carbs_target_g) * 100), 100);

  const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][new Date().getDay()];
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const weightChartData = weightHistory.map(w => `{x:'${w.date.slice(5)}',y:${w.weight_kg}}`).join(',');

  const mealRows = meals.map(m => {
    const typeEmoji = { breakfast: '🌅', lunch: '🍽️', dinner: '🌙', snack: '🫐' }[m.meal_type] || '🍴';
    const typeName = { breakfast: 'Petit-déj', lunch: 'Déjeuner', dinner: 'Dîner', snack: 'Collation' }[m.meal_type] || m.meal_type;
    return `<tr>
      <td>${typeEmoji} ${typeName}</td>
      <td>${m.description}</td>
      <td class="num">${Math.round(m.calories)}</td>
      <td class="num">${Math.round(m.protein_g)}g</td>
      <td class="num">${Math.round(m.fat_g)}g</td>
      <td class="num">${Math.round(m.carbs_g)}g</td>
    </tr>`;
  }).join('\n');

  const medSection = meds.length > 0
    ? meds.map(m => `<li>${m.name}${m.dose ? ` — ${m.dose}` : ''}${m.timing ? ` (${m.timing})` : ''}</li>`).join('\n')
    : '<li class="empty">Aucun médicament enregistré</li>';

  const suppSection = supplements.map(s =>
    `<li>${s.name} — ${s.dose} (${s.timing === 'morning_with_food' ? 'matin' : s.timing === 'lunch' ? 'midi' : 'soir'})</li>`
  ).join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rachida — ${dayName} ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f7f4; color: #2d2d2d; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #1a1a1a; }
  .date { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
  .card { background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card h2 { font-size: 1rem; color: #666; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .weight-big { font-size: 2.5rem; font-weight: 700; color: #1a1a1a; }
  .weight-big span { font-size: 1rem; color: #888; font-weight: 400; }
  .progress-bar { background: #eee; border-radius: 8px; height: 28px; overflow: hidden; margin: 8px 0; position: relative; }
  .progress-fill { height: 100%; border-radius: 8px; transition: width 0.5s ease; display: flex; align-items: center; padding-left: 10px; font-size: 0.8rem; color: white; font-weight: 600; }
  .cal-fill { background: linear-gradient(90deg, #4CAF50, #66BB6A); }
  .prot-fill { background: linear-gradient(90deg, #2196F3, #42A5F5); }
  .fat-fill { background: linear-gradient(90deg, #FF9800, #FFB74D); }
  .carbs-fill { background: linear-gradient(90deg, #9C27B0, #BA68C8); }
  .over { background: linear-gradient(90deg, #f44336, #e57373) !important; }
  .macro-label { display: flex; justify-content: space-between; font-size: 0.85rem; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: #888; font-weight: 500; padding: 8px 4px; border-bottom: 1px solid #eee; }
  td { padding: 8px 4px; border-bottom: 1px solid #f5f5f5; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  ul { list-style: none; }
  ul li { padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 0.9rem; }
  ul li:last-child { border: none; }
  ul li.empty { color: #aaa; font-style: italic; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .stat { text-align: center; }
  .stat-value { font-size: 1.8rem; font-weight: 700; }
  .stat-label { font-size: 0.8rem; color: #888; }
  canvas { max-height: 200px; }
  .footer { text-align: center; color: #aaa; font-size: 0.75rem; margin-top: 24px; padding: 16px; }
</style>
</head>
<body>
  <h1>Bonjour Rachida</h1>
  <div class="date">${dayName} ${dateStr}</div>

  ${weight ? `
  <div class="card">
    <h2>⚖️ Poids</h2>
    <div class="weight-big">${weight.weight_kg} <span>kg</span></div>
    ${weight.fat_percent ? `<div style="color:#888;font-size:0.85rem;margin-top:4px">Graisse : ${weight.fat_percent}%</div>` : ''}
    ${weightHistory.length > 2 ? `<canvas id="weightChart" height="150"></canvas>` : ''}
  </div>` : ''}

  <div class="card">
    <h2>🎯 Macros du jour</h2>
    <div class="macro-label"><span>Calories</span><span>${Math.round(consumed.calories)} / ${targets.calories_target} kcal</span></div>
    <div class="progress-bar"><div class="progress-fill cal-fill ${calPct > 100 ? 'over' : ''}" style="width:${Math.min(calPct, 100)}%">${calPct}%</div></div>

    <div class="macro-label"><span>Protéines</span><span>${Math.round(consumed.protein_g)} / ${targets.protein_target_g}g</span></div>
    <div class="progress-bar"><div class="progress-fill prot-fill" style="width:${Math.min(protPct, 100)}%">${protPct}%</div></div>

    <div class="macro-label"><span>Lipides</span><span>${Math.round(consumed.fat_g)} / ${targets.fat_target_g}g</span></div>
    <div class="progress-bar"><div class="progress-fill fat-fill" style="width:${Math.min(fatPct, 100)}%">${fatPct}%</div></div>

    <div class="macro-label"><span>Glucides</span><span>${Math.round(consumed.carbs_g)} / ${targets.carbs_target_g}g</span></div>
    <div class="progress-bar"><div class="progress-fill carbs-fill" style="width:${Math.min(carbsPct, 100)}%">${carbsPct}%</div></div>
  </div>

  ${meals.length > 0 ? `
  <div class="card">
    <h2>🍽️ Repas d'aujourd'hui</h2>
    <table>
      <tr><th>Repas</th><th>Description</th><th class="num">Kcal</th><th class="num">Prot</th><th class="num">Lip</th><th class="num">Gluc</th></tr>
      ${mealRows}
    </table>
  </div>` : `
  <div class="card">
    <h2>🍽️ Repas</h2>
    <p style="color:#aaa">Aucun repas enregistré aujourd'hui</p>
  </div>`}

  ${activity ? `
  <div class="card">
    <h2>🚶‍♀️ Activité</h2>
    <div class="grid">
      <div class="stat"><div class="stat-value">${activity.steps?.toLocaleString('fr-FR') || '—'}</div><div class="stat-label">pas</div></div>
      <div class="stat"><div class="stat-value">${activity.active_calories ? Math.round(activity.active_calories) : '—'}</div><div class="stat-label">kcal actives</div></div>
      <div class="stat"><div class="stat-value">${activity.exercise_minutes || '—'}</div><div class="stat-label">min exercice</div></div>
    </div>
  </div>` : ''}

  <div class="grid">
    <div class="card">
      <h2>💊 Médicaments</h2>
      <ul>${medSection}</ul>
    </div>
    <div class="card">
      <h2>💊 Compléments</h2>
      <ul>${suppSection}</ul>
    </div>
  </div>

  <div class="footer">Rachida Health Coach — généré le ${new Date().toLocaleString('fr-FR')}</div>

  ${weightHistory.length > 2 ? `
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <script>
    new Chart(document.getElementById('weightChart'), {
      type: 'line',
      data: {
        datasets: [{
          label: 'Poids (kg)',
          data: [${weightChartData}],
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76,175,80,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { type: 'category' },
          y: { beginAtZero: false }
        },
        plugins: { legend: { display: false } }
      }
    });
  </script>` : ''}
</body>
</html>`;

  const outputPath = join(__dirname, 'daily-report.html');
  writeFileSync(outputPath, html);
  return outputPath;
}
