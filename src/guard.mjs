import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomInt } from 'crypto';
import { loadConfig } from './config.mjs';
import { isAllowed } from './allowlist.mjs';
import { sign, verify } from './integrity.mjs';

const MAX_CONFIRM_ATTEMPTS = 3;

function getStatePath(baseDir) {
  return join(baseDir, 'state.json');
}

function getLogPath(baseDir) {
  return join(baseDir, 'transactions.log');
}

function loadState(baseDir) {
  const path = getStatePath(baseDir);
  if (!existsSync(path)) {
    return {
      frozen: false,
      frozenAt: null,
      dailyTotal: 0,
      dailyDate: new Date().toISOString().slice(0, 10),
      lastTransaction: null,
      pendingConfirmation: null,
      recentRequests: [],
    };
  }
  if (!verify(baseDir, 'state.json')) {
    throw new Error('Integrity check failed for state.json — file may have been tampered with.');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveState(baseDir, state) {
  writeFileSync(getStatePath(baseDir), JSON.stringify(state, null, 2) + '\n');
  sign(baseDir, 'state.json');
}

function logTransaction(baseDir, entry) {
  const path = getLogPath(baseDir);
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  writeFileSync(path, existing + line);
}

export function freeze(baseDir, reason = 'manual') {
  const state = loadState(baseDir);
  state.frozen = true;
  state.frozenAt = new Date().toISOString();
  state.frozenReason = reason;
  saveState(baseDir, state);
  logTransaction(baseDir, { action: 'freeze', reason });
  return { frozen: true, reason };
}

export function unfreeze(baseDir) {
  const state = loadState(baseDir);
  state.frozen = false;
  state.frozenAt = null;
  state.frozenReason = null;
  saveState(baseDir, state);
  logTransaction(baseDir, { action: 'unfreeze' });
  return { frozen: false };
}

export function getStatus(baseDir) {
  const state = loadState(baseDir);
  const config = loadConfig(baseDir);
  const today = new Date().toISOString().slice(0, 10);

  if (state.dailyDate !== today) {
    state.dailyTotal = 0;
    state.dailyDate = today;
    saveState(baseDir, state);
  }

  return {
    frozen: state.frozen,
    frozenReason: state.frozenReason,
    dailyTotal: state.dailyTotal,
    dailyMax: config.limits.dailyMax,
    dailyRemaining: config.limits.dailyMax - state.dailyTotal,
    pendingConfirmation: state.pendingConfirmation ? true : false,
  };
}

export function requestSend(baseDir, { to, amount, token = 'USDC', sender = null }) {
  const config = loadConfig(baseDir);
  const state = loadState(baseDir);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily total if new day
  if (state.dailyDate !== today) {
    state.dailyTotal = 0;
    state.dailyDate = today;
  }

  // Check frozen
  if (state.frozen) {
    logTransaction(baseDir, { action: 'rejected', reason: 'wallet_frozen', to, amount, token });
    return { approved: false, reason: '🛑 Wallet is FROZEN. Unfreeze before sending.' };
  }

  // Check sender authorization
  if (config.authorizedSenders.length > 0 && sender) {
    const authorized = config.authorizedSenders.some(
      s => s.platform === sender.platform && s.id === sender.id
    );
    if (!authorized) {
      logTransaction(baseDir, { action: 'rejected', reason: 'unauthorized_sender', sender, to, amount });
      return { approved: false, reason: '🚫 Unauthorized sender.' };
    }
  }

  // Check allowlist
  if (!isAllowed(baseDir, to)) {
    logTransaction(baseDir, { action: 'rejected', reason: 'address_not_allowlisted', to, amount });
    return {
      approved: false,
      reason: `🚫 Address not in allowlist. Add it first:\n  awg allowlist add ${to} --label "description"`,
    };
  }

  // Check per-transaction limit
  if (amount > config.limits.perTransaction) {
    logTransaction(baseDir, { action: 'rejected', reason: 'over_per_tx_limit', to, amount });
    return {
      approved: false,
      reason: `🚫 Amount $${amount} exceeds per-transaction limit of $${config.limits.perTransaction}.`,
    };
  }

  // Check daily limit
  if (state.dailyTotal + amount > config.limits.dailyMax) {
    logTransaction(baseDir, { action: 'rejected', reason: 'over_daily_limit', to, amount });
    return {
      approved: false,
      reason: `🚫 Would exceed daily limit. Spent: $${state.dailyTotal}/$${config.limits.dailyMax}.`,
    };
  }

  // Check cooldown
  if (state.lastTransaction) {
    const elapsed = (now - new Date(state.lastTransaction).getTime()) / 1000;
    if (elapsed < config.cooldown.betweenTransactions) {
      const wait = Math.ceil(config.cooldown.betweenTransactions - elapsed);
      return { approved: false, reason: `⏱️ Cooldown active. Wait ${wait}s.` };
    }
  }

  // Check for rapid requests (anomaly detection)
  state.recentRequests = (state.recentRequests || []).filter(
    ts => (now - ts) / 1000 < config.freezeOnAnomalies.windowSeconds
  );
  state.recentRequests.push(now);

  if (state.recentRequests.length >= config.freezeOnAnomalies.rapidRequests) {
    state.frozen = true;
    state.frozenAt = new Date().toISOString();
    state.frozenReason = 'anomaly_rapid_requests';
    saveState(baseDir, state);
    logTransaction(baseDir, { action: 'auto_freeze', reason: 'rapid_requests', count: state.recentRequests.length });
    return { approved: false, reason: '🛑 WALLET AUTO-FROZEN: Too many rapid requests detected.' };
  }

  // Generate confirmation code
  const code = String(randomInt(100000, 999999));
  state.pendingConfirmation = {
    code,
    to,
    amount,
    token,
    sender,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(now + config.confirmation.codeExpiry * 1000).toISOString(),
  };
  saveState(baseDir, state);

  logTransaction(baseDir, { action: 'confirmation_requested', to, amount, token });

  return {
    approved: false,
    needsConfirmation: true,
    message: `🔐 Confirm send of $${amount} ${token} to ${to}\n\nConfirmation code: **${code}**\n\nReply with this code to approve. Expires in ${config.confirmation.codeExpiry / 60} minutes.`,
  };
}

export function confirmSend(baseDir, code, sender = null) {
  const state = loadState(baseDir);
  const now = Date.now();

  if (!state.pendingConfirmation) {
    return { approved: false, reason: 'No pending transaction to confirm.' };
  }

  const pending = state.pendingConfirmation;

  // Check expiry
  if (now > new Date(pending.expiresAt).getTime()) {
    state.pendingConfirmation = null;
    saveState(baseDir, state);
    logTransaction(baseDir, { action: 'confirmation_expired', to: pending.to, amount: pending.amount });
    return { approved: false, reason: '⏰ Confirmation code expired. Request a new transaction.' };
  }

  // Verify sender matches the original requester
  if (pending.sender && sender) {
    if (pending.sender.platform !== sender.platform || pending.sender.id !== sender.id) {
      logTransaction(baseDir, { action: 'sender_mismatch', to: pending.to, amount: pending.amount });
      return { approved: false, reason: '🚫 Sender mismatch. Only the original requester can confirm.' };
    }
  }

  // Check code
  if (code !== pending.code) {
    pending.attempts = (pending.attempts || 0) + 1;

    // Brute force protection: auto-cancel after MAX_CONFIRM_ATTEMPTS wrong codes
    if (pending.attempts >= MAX_CONFIRM_ATTEMPTS) {
      state.pendingConfirmation = null;
      saveState(baseDir, state);
      logTransaction(baseDir, {
        action: 'brute_force_cancel',
        to: pending.to,
        amount: pending.amount,
        attempts: pending.attempts,
      });
      return {
        approved: false,
        reason: '🛑 Transaction auto-cancelled: too many wrong confirmation codes.',
      };
    }

    saveState(baseDir, state);
    const remaining = MAX_CONFIRM_ATTEMPTS - pending.attempts;
    logTransaction(baseDir, { action: 'wrong_code', to: pending.to, amount: pending.amount });
    return { approved: false, reason: `❌ Wrong confirmation code. ${remaining} attempt(s) remaining.` };
  }

  // Approved!
  state.dailyTotal += pending.amount;
  state.lastTransaction = new Date().toISOString();
  const tx = { to: pending.to, amount: pending.amount, token: pending.token };
  state.pendingConfirmation = null;
  saveState(baseDir, state);

  logTransaction(baseDir, {
    action: 'approved',
    to: tx.to,
    amount: tx.amount,
    token: tx.token,
  });

  return {
    approved: true,
    to: tx.to,
    amount: tx.amount,
    token: tx.token,
    message: `✅ Approved! Sending $${tx.amount} ${tx.token} to ${tx.to}`,
  };
}
