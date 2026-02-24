import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { requestSend, confirmSend, freeze, unfreeze, getStatus } from './guard.mjs';
import { addAddress } from './allowlist.mjs';
import { saveConfig, DEFAULT_CONFIG } from './config.mjs';

let baseDir;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'awg-test-'));
  // Write a config with fast cooldown for testing
  const config = {
    ...DEFAULT_CONFIG,
    cooldown: { betweenTransactions: 0, afterRejection: 0 },
    freezeOnAnomalies: { rapidRequests: 100, windowSeconds: 1 },
  };
  saveConfig(baseDir, config);
  // Add a test address to allowlist
  addAddress(baseDir, '0xABCD', 'Test');
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('requestSend', () => {
  it('should return a confirmation code for valid request', () => {
    const result = requestSend(baseDir, { to: '0xABCD', amount: 10 });
    assert.equal(result.approved, false);
    assert.equal(result.needsConfirmation, true);
    assert.ok(result.message.includes('Confirmation code'));
  });

  it('should reject when wallet is frozen', () => {
    freeze(baseDir);
    const result = requestSend(baseDir, { to: '0xABCD', amount: 10 });
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('FROZEN'));
  });

  it('should reject address not in allowlist', () => {
    const result = requestSend(baseDir, { to: '0xNOTALLOWED', amount: 10 });
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('not in allowlist'));
  });

  it('should reject amount over per-transaction limit', () => {
    const result = requestSend(baseDir, { to: '0xABCD', amount: 999 });
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('per-transaction limit'));
  });

  it('should reject amount over daily limit', () => {
    // Make a valid send to eat up daily budget
    const r1 = requestSend(baseDir, { to: '0xABCD', amount: 40 });
    const code1 = r1.message.match(/\*\*(\d{6})\*\*/)[1];
    confirmSend(baseDir, code1);

    const r2 = requestSend(baseDir, { to: '0xABCD', amount: 40 });
    const code2 = r2.message.match(/\*\*(\d{6})\*\*/)[1];
    confirmSend(baseDir, code2);

    const r3 = requestSend(baseDir, { to: '0xABCD', amount: 40 });
    const code3 = r3.message.match(/\*\*(\d{6})\*\*/)[1];
    confirmSend(baseDir, code3);

    const r4 = requestSend(baseDir, { to: '0xABCD', amount: 40 });
    const code4 = r4.message.match(/\*\*(\d{6})\*\*/)[1];
    confirmSend(baseDir, code4);

    const r5 = requestSend(baseDir, { to: '0xABCD', amount: 40 });
    const code5 = r5.message.match(/\*\*(\d{6})\*\*/)[1];
    confirmSend(baseDir, code5);

    // Now at $200, next should fail
    const result = requestSend(baseDir, { to: '0xABCD', amount: 10 });
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('daily limit'));
  });

  it('should reject unauthorized sender', () => {
    const config = {
      ...DEFAULT_CONFIG,
      cooldown: { betweenTransactions: 0, afterRejection: 0 },
      freezeOnAnomalies: { rapidRequests: 100, windowSeconds: 1 },
      authorizedSenders: [{ platform: 'imessage', id: '+1234' }],
    };
    saveConfig(baseDir, config);

    const result = requestSend(baseDir, {
      to: '0xABCD',
      amount: 10,
      sender: { platform: 'imessage', id: '+9999' },
    });
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('Unauthorized'));
  });

  it('should store sender in pending confirmation', () => {
    const sender = { platform: 'imessage', id: '+1234' };
    requestSend(baseDir, { to: '0xABCD', amount: 10, sender });
    const state = JSON.parse(readFileSync(join(baseDir, 'state.json'), 'utf-8'));
    assert.deepStrictEqual(state.pendingConfirmation.sender, sender);
  });
});

describe('confirmSend', () => {
  it('should approve with correct code', () => {
    const req = requestSend(baseDir, { to: '0xABCD', amount: 5 });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];
    const result = confirmSend(baseDir, code);
    assert.equal(result.approved, true);
    assert.equal(result.to, '0xABCD');
    assert.equal(result.amount, 5);
  });

  it('should reject wrong code', () => {
    requestSend(baseDir, { to: '0xABCD', amount: 5 });
    const result = confirmSend(baseDir, '000000');
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('Wrong confirmation code'));
  });

  it('should return error when no pending transaction', () => {
    const result = confirmSend(baseDir, '123456');
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('No pending'));
  });
});

describe('brute force protection', () => {
  it('should auto-cancel after 3 wrong codes', () => {
    requestSend(baseDir, { to: '0xABCD', amount: 5 });

    const r1 = confirmSend(baseDir, '000001');
    assert.equal(r1.approved, false);
    assert.ok(r1.reason.includes('2 attempt(s) remaining'));

    const r2 = confirmSend(baseDir, '000002');
    assert.equal(r2.approved, false);
    assert.ok(r2.reason.includes('1 attempt(s) remaining'));

    const r3 = confirmSend(baseDir, '000003');
    assert.equal(r3.approved, false);
    assert.ok(r3.reason.includes('auto-cancelled'));

    // No more pending after cancellation
    const r4 = confirmSend(baseDir, '000004');
    assert.ok(r4.reason.includes('No pending'));
  });

  it('should log brute force cancellation', () => {
    requestSend(baseDir, { to: '0xABCD', amount: 5 });
    confirmSend(baseDir, '000001');
    confirmSend(baseDir, '000002');
    confirmSend(baseDir, '000003');

    const log = readFileSync(join(baseDir, 'transactions.log'), 'utf-8');
    assert.ok(log.includes('brute_force_cancel'));
  });

  it('should still accept correct code before max attempts', () => {
    const req = requestSend(baseDir, { to: '0xABCD', amount: 5 });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];

    confirmSend(baseDir, '000001'); // wrong 1
    confirmSend(baseDir, '000002'); // wrong 2
    const result = confirmSend(baseDir, code); // correct on attempt 3
    assert.equal(result.approved, true);
  });
});

describe('sender ID verification on confirm', () => {
  it('should reject if different sender tries to confirm', () => {
    const sender = { platform: 'imessage', id: '+1234' };
    const config = {
      ...DEFAULT_CONFIG,
      cooldown: { betweenTransactions: 0, afterRejection: 0 },
      freezeOnAnomalies: { rapidRequests: 100, windowSeconds: 1 },
      authorizedSenders: [sender, { platform: 'imessage', id: '+9999' }],
    };
    saveConfig(baseDir, config);

    const req = requestSend(baseDir, { to: '0xABCD', amount: 5, sender });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];

    const imposter = { platform: 'imessage', id: '+9999' };
    const result = confirmSend(baseDir, code, imposter);
    assert.equal(result.approved, false);
    assert.ok(result.reason.includes('Sender mismatch'));
  });

  it('should accept if same sender confirms', () => {
    const sender = { platform: 'imessage', id: '+1234' };
    const config = {
      ...DEFAULT_CONFIG,
      cooldown: { betweenTransactions: 0, afterRejection: 0 },
      freezeOnAnomalies: { rapidRequests: 100, windowSeconds: 1 },
      authorizedSenders: [sender],
    };
    saveConfig(baseDir, config);

    const req = requestSend(baseDir, { to: '0xABCD', amount: 5, sender });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];
    const result = confirmSend(baseDir, code, sender);
    assert.equal(result.approved, true);
  });

  it('should log sender mismatch', () => {
    const sender = { platform: 'imessage', id: '+1234' };
    const config = {
      ...DEFAULT_CONFIG,
      cooldown: { betweenTransactions: 0, afterRejection: 0 },
      freezeOnAnomalies: { rapidRequests: 100, windowSeconds: 1 },
      authorizedSenders: [sender, { platform: 'imessage', id: '+5555' }],
    };
    saveConfig(baseDir, config);

    const req = requestSend(baseDir, { to: '0xABCD', amount: 5, sender });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];
    confirmSend(baseDir, code, { platform: 'imessage', id: '+5555' });

    const log = readFileSync(join(baseDir, 'transactions.log'), 'utf-8');
    assert.ok(log.includes('sender_mismatch'));
  });
});

describe('confirmation codes must not appear in logs', () => {
  it('should never log the confirmation code', () => {
    const req = requestSend(baseDir, { to: '0xABCD', amount: 5 });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];

    // Try wrong codes and then correct
    confirmSend(baseDir, '000001');
    confirmSend(baseDir, code);

    const log = readFileSync(join(baseDir, 'transactions.log'), 'utf-8');
    assert.ok(!log.includes(code), 'Confirmation code should not appear in transaction log');
  });

  it('should not log code even on brute force cancel', () => {
    const req = requestSend(baseDir, { to: '0xABCD', amount: 5 });
    const code = req.message.match(/\*\*(\d{6})\*\*/)[1];

    confirmSend(baseDir, '000001');
    confirmSend(baseDir, '000002');
    confirmSend(baseDir, '000003');

    const log = readFileSync(join(baseDir, 'transactions.log'), 'utf-8');
    assert.ok(!log.includes(code), 'Confirmation code should not appear in log after brute force cancel');
  });
});

describe('freeze / unfreeze', () => {
  it('should freeze the wallet', () => {
    const result = freeze(baseDir, 'suspicious_activity');
    assert.equal(result.frozen, true);
    const status = getStatus(baseDir);
    assert.equal(status.frozen, true);
    assert.equal(status.frozenReason, 'suspicious_activity');
  });

  it('should unfreeze the wallet', () => {
    freeze(baseDir);
    const result = unfreeze(baseDir);
    assert.equal(result.frozen, false);
    const status = getStatus(baseDir);
    assert.equal(status.frozen, false);
  });
});

describe('getStatus', () => {
  it('should return correct status', () => {
    const status = getStatus(baseDir);
    assert.equal(status.frozen, false);
    assert.equal(status.dailyTotal, 0);
    assert.equal(status.dailyMax, 200);
    assert.equal(status.dailyRemaining, 200);
    assert.equal(status.pendingConfirmation, false);
  });

  it('should show pending confirmation', () => {
    requestSend(baseDir, { to: '0xABCD', amount: 5 });
    const status = getStatus(baseDir);
    assert.equal(status.pendingConfirmation, true);
  });
});
