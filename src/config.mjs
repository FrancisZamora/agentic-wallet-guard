import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sign, verify } from './integrity.mjs';

const DEFAULT_CONFIG = {
  version: 1,
  limits: {
    perTransaction: 50,      // Max USD per single transaction
    dailyMax: 200,           // Max USD per day
    highValueThreshold: 100, // Requires passphrase above this
  },
  cooldown: {
    betweenTransactions: 30, // Seconds between sends
    afterRejection: 300,     // Seconds after a rejected attempt
  },
  confirmation: {
    codeExpiry: 300,          // Seconds before code expires
    codeLength: 6,
    requiredForAllSends: true,
  },
  freezeOnAnomalies: {
    rapidRequests: 3,        // Freeze after N requests...
    windowSeconds: 60,       // ...within this window
  },
  authorizedSenders: [],     // e.g., [{ platform: "imessage", id: "+13053359828" }]
};

export function getConfigPath(baseDir) {
  return join(baseDir, 'config.json');
}

export function loadConfig(baseDir) {
  const path = getConfigPath(baseDir);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  if (!verify(baseDir, 'config.json')) {
    throw new Error('Integrity check failed for config.json — file may have been tampered with.');
  }
  const raw = readFileSync(path, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(baseDir, config) {
  const path = getConfigPath(baseDir);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  sign(baseDir, 'config.json');
}

export function initConfig(baseDir) {
  const path = getConfigPath(baseDir);
  if (existsSync(path)) {
    console.log('Config already exists at', path);
    return loadConfig(baseDir);
  }
  saveConfig(baseDir, DEFAULT_CONFIG);
  console.log('✅ Created config at', path);
  return DEFAULT_CONFIG;
}

export { DEFAULT_CONFIG };
