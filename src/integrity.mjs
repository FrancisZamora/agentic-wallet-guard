import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHmac, timingSafeEqual } from 'crypto';

const SIGNATURES_FILE = '.signatures';
const TRACKED_FILES = ['config.json', 'allowlist.json', 'state.json'];

function getSecret() {
  return process.env.AWG_INTEGRITY_SECRET || null;
}

function getSignaturesPath(baseDir) {
  return join(baseDir, SIGNATURES_FILE);
}

function loadSignatures(baseDir) {
  const path = getSignaturesPath(baseDir);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveSignatures(baseDir, sigs) {
  writeFileSync(getSignaturesPath(baseDir), JSON.stringify(sigs, null, 2) + '\n');
}

export function sign(baseDir, filename) {
  const secret = getSecret();
  if (!secret) return null;

  const filePath = join(baseDir, filename);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8');
  const hmac = createHmac('sha256', secret).update(content).digest('hex');

  const sigs = loadSignatures(baseDir);
  sigs[filename] = hmac;
  saveSignatures(baseDir, sigs);

  return hmac;
}

export function verify(baseDir, filename) {
  const secret = getSecret();
  if (!secret) return true;

  const filePath = join(baseDir, filename);
  if (!existsSync(filePath)) return true;

  const sigs = loadSignatures(baseDir);
  if (!sigs[filename]) return false;

  const content = readFileSync(filePath, 'utf-8');
  const expected = createHmac('sha256', secret).update(content).digest();
  const stored = Buffer.from(sigs[filename], 'hex');

  if (expected.length !== stored.length) return false;
  return timingSafeEqual(expected, stored);
}

export function signAll(baseDir) {
  const results = {};
  for (const f of TRACKED_FILES) {
    results[f] = sign(baseDir, f);
  }
  return results;
}

export function verifyAll(baseDir) {
  const results = {};
  for (const f of TRACKED_FILES) {
    results[f] = verify(baseDir, f);
  }
  return results;
}
