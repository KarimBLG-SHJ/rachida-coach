// db/migrate.js — Run migrations safely on startup
// Adds columns that may be missing from older databases
// Called from index.js after DB init

import db from './connection.js';

const EXTRA_COLUMNS = [
  // Vitamins not in original schema
  'vit_e_mg REAL DEFAULT 0',
  'vit_b1_mg REAL DEFAULT 0',
  'vit_b6_mg REAL DEFAULT 0',
  // Metadata columns for meal editing
  'confidence TEXT',
  'notes TEXT',
  // Friendly name for display (clean food names from Claude)
  'meal_name TEXT',
];

export function runMigrations() {
  const existing = db.pragma('table_info(meal_log)').map(col => col.name);

  let added = 0;
  for (const colDef of EXTRA_COLUMNS) {
    const colName = colDef.split(' ')[0];
    if (!existing.includes(colName)) {
      db.exec(`ALTER TABLE meal_log ADD COLUMN ${colDef}`);
      console.log(`[migrate] Added column: ${colName}`);
      added++;
    }
  }

  if (added === 0) {
    console.log('[migrate] Schema up to date.');
  } else {
    console.log(`[migrate] ${added} column(s) added.`);
  }
}
