import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sign, verify } from './integrity.mjs';

function getAllowlistPath(baseDir) {
  return join(baseDir, 'allowlist.json');
}

export function loadAllowlist(baseDir) {
  const path = getAllowlistPath(baseDir);
  if (!existsSync(path)) return { addresses: [] };
  if (!verify(baseDir, 'allowlist.json')) {
    throw new Error('Integrity check failed for allowlist.json — file may have been tampered with.');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function saveAllowlist(baseDir, allowlist) {
  const path = getAllowlistPath(baseDir);
  writeFileSync(path, JSON.stringify(allowlist, null, 2) + '\n');
  sign(baseDir, 'allowlist.json');
}

export function addAddress(baseDir, address, label = '') {
  const allowlist = loadAllowlist(baseDir);
  const normalized = address.toLowerCase();

  const existing = allowlist.addresses.find(a => a.address.toLowerCase() === normalized);
  if (existing) {
    console.log(`⚠️  Address already in allowlist as "${existing.label}"`);
    return false;
  }

  allowlist.addresses.push({
    address: normalized,
    label,
    addedAt: new Date().toISOString(),
  });

  saveAllowlist(baseDir, allowlist);
  console.log(`✅ Added ${address} as "${label}"`);
  return true;
}

export function removeAddress(baseDir, address) {
  const allowlist = loadAllowlist(baseDir);
  const normalized = address.toLowerCase();
  const before = allowlist.addresses.length;

  allowlist.addresses = allowlist.addresses.filter(
    a => a.address.toLowerCase() !== normalized
  );

  if (allowlist.addresses.length === before) {
    console.log('⚠️  Address not found in allowlist');
    return false;
  }

  saveAllowlist(baseDir, allowlist);
  console.log(`✅ Removed ${address}`);
  return true;
}

export function isAllowed(baseDir, address) {
  const allowlist = loadAllowlist(baseDir);
  const normalized = address.toLowerCase();
  return allowlist.addresses.some(a => a.address.toLowerCase() === normalized);
}

export function listAddresses(baseDir) {
  const allowlist = loadAllowlist(baseDir);
  if (allowlist.addresses.length === 0) {
    console.log('No addresses in allowlist.');
    return [];
  }
  console.log('Trusted Addresses:');
  console.log('─'.repeat(60));
  for (const a of allowlist.addresses) {
    console.log(`  ${a.label || '(no label)'}`);
    console.log(`  ${a.address}`);
    console.log(`  Added: ${a.addedAt}`);
    console.log('');
  }
  return allowlist.addresses;
}
