// connection.js — Single database connection for the entire app
// Uses DB_PATH env var (set to /data/health.db on Railway with volume)
// Falls back to ./db/health.db for local development

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || join(__dirname, 'health.db');

// Ensure directory exists
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Auto-init schema on first run
const schemaPath = join(__dirname, 'schema.sql');
if (existsSync(schemaPath)) {
  db.exec(readFileSync(schemaPath, 'utf-8'));
}

export default db;
