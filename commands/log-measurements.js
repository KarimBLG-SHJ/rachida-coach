// log-measurements.js — Interactive measurement logging
// Called via: node index.js mensuration
// Walks Rachida through each measurement with guidance

import { createInterface } from 'readline';
import chalk from 'chalk';
import { logMeasurements, getMeasurementHistory } from './upload-photo.js';

/**
 * Interactive guided measurement session
 * Each field has instructions on HOW to measure correctly
 */
export async function runMeasurementWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question) => new Promise(resolve => rl.question(question, resolve));

  console.log(chalk.cyan('\n' + '═'.repeat(55)));
  console.log(chalk.cyan('  📏 MENSURATIONS — Rachida'));
  console.log(chalk.cyan('═'.repeat(55)));
  console.log(chalk.gray('\nMesure une fois par mois, le matin, avant de manger.'));
  console.log(chalk.gray('Utilise toujours le même mètre-ruban.\n'));

  const measurements = {};

  // Poids
  const poids = await ask(chalk.yellow('⚖️  Poids ce matin (kg) : '));
  if (poids) measurements.weight_kg = parseFloat(poids);

  // Tour de taille
  console.log(chalk.gray('\n📌 Tour de taille : place le mètre au niveau du nombril.'));
  console.log(chalk.gray('   Expire doucement. Mesure sans rentrer le ventre.'));
  const taille = await ask(chalk.yellow('📏 Tour de taille (cm) : '));
  if (taille) measurements.waist_cm = parseFloat(taille);

  // Tour de hanches
  console.log(chalk.gray('\n📌 Tour de hanches : endroit le plus large, fesses comprises.'));
  const hanches = await ask(chalk.yellow('📏 Tour de hanches (cm) : '));
  if (hanches) measurements.hips_cm = parseFloat(hanches);

  // Tour de poitrine
  console.log(chalk.gray('\n📌 Tour de poitrine : mètre sur la partie la plus large.'));
  const poitrine = await ask(chalk.yellow('📏 Tour de poitrine (cm) [optionnel, Entrée pour passer] : '));
  if (poitrine) measurements.chest_cm = parseFloat(poitrine);

  // Tour de cuisse
  console.log(chalk.gray('\n📌 Tour de cuisse : milieu de la cuisse gauche, jambe détendue.'));
  const cuisse = await ask(chalk.yellow('📏 Tour de cuisse gauche (cm) [optionnel] : '));
  if (cuisse) measurements.thigh_cm = parseFloat(cuisse);

  // Tour de bras
  const bras = await ask(chalk.yellow('📏 Tour de bras gauche (cm) [optionnel] : '));
  if (bras) measurements.arm_cm = parseFloat(bras);

  // Tour de cou (pour calcul % graisse)
  console.log(chalk.gray('\n📌 Tour de cou : juste en dessous du larynx (pomme d\'Adam).'));
  const cou = await ask(chalk.yellow('📏 Tour de cou (cm) [optionnel, améliore le calcul % graisse] : '));
  if (cou) measurements.neck_cm = parseFloat(cou);

  // Notes
  const notes = await ask(chalk.yellow('\n💬 Note personnelle (optionnel, ex: "période de stress", "Ramadan") : '));
  if (notes) measurements.notes = notes;

  rl.close();

  // Height for body fat calculation
  measurements.height_cm = 165; // Rachida's height

  console.log(chalk.cyan('\nEnregistrement et analyse en cours...\n'));
  await logMeasurements(measurements);

  // Show history
  const history = getMeasurementHistory();
  if (history) console.log(history);
}
