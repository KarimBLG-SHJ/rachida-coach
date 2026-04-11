// notifications.js — Mac desktop notifications
import notifier from 'node-notifier';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try PNG first, fallback to SVG
const iconPng = join(__dirname, '../assets/icon.png');
const iconSvg = join(__dirname, '../assets/icon.svg');
const icon = existsSync(iconPng) ? iconPng : existsSync(iconSvg) ? iconSvg : undefined;

export function notify(title, message) {
  notifier.notify({
    title,
    message,
    icon,
    sound: false,
    timeout: 10,
    appID: 'Rachida Health Coach'
  });
}

export function notifyUrgent(title, message) {
  notifier.notify({
    title,
    message,
    icon,
    sound: true,
    timeout: 20,
    appID: 'Rachida Health Coach'
  });
}
