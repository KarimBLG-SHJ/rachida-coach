// env.js — Load environment variables before anything else
// Import this FIRST in any entry point (index.js, server.js, etc.)
// Solves the ESM + dotenv issue where process.env isn't populated

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '.env');

try {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z][A-Z_0-9]+)=(.+)$/);
    if (match) {
      process.env[match[1]] = match[2].trim();
    }
  }
} catch {
  // .env file not found — rely on system env vars
}
