// log-meal.js — Standalone meal logging command
// Usage: node commands/log-meal.js "poulet grillé avec du riz et salade"
// Or imported and called from index.js

import { logMeal } from '../agent/coach.js';

const args = process.argv.slice(2);

if (args.length > 0) {
  const description = args.join(' ');
  const hour = new Date().getHours();
  const mealType = hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';

  console.log(`Analyse de : "${description}" (${mealType})...\n`);

  logMeal(description, mealType)
    .then(result => {
      console.log(result);
    })
    .catch(err => {
      console.error('Erreur :', err.message);
      process.exit(1);
    });
}

export { logMeal };
