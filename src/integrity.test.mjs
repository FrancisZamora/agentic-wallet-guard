import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sign, verify, signAll, verifyAll } from './integrity.mjs';

let baseDir;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'awg-integrity-'));
  process.env.AWG_INTEGRITY_SECRET = 'test-secret-key-123';
});

afterEach(() => {
  delete process.env.AWG_INTEGRITY_SECRET;
  rmSync(baseDir, { recursive: true, force: true });
});

describe('sign', () => {
  it('should generate an HMAC signature for a file', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    const hmac = sign(baseDir, 'config.json');
    assert.ok(hmac);
    assert.equal(typeof hmac, 'string');
    assert.equal(hmac.length, 64); // SHA-256 hex = 64 chars
  });

  it('should store signature in .signatures file', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    sign(baseDir, 'config.json');
    const sigs = JSON.parse(readFileSync(join(baseDir, '.signatures'), 'utf-8'));
    assert.ok(sigs['config.json']);
  });

  it('should return null if no secret is set', () => {
    delete process.env.AWG_INTEGRITY_SECRET;
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    const result = sign(baseDir, 'config.json');
    assert.equal(result, null);
  });

  it('should return null if file does not exist', () => {
    const result = sign(baseDir, 'nonexistent.json');
    assert.equal(result, null);
  });
});

describe('verify', () => {
  it('should verify a correctly signed file', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    sign(baseDir, 'config.json');
    assert.equal(verify(baseDir, 'config.json'), true);
  });

  it('should fail verification if file was tampered with', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    sign(baseDir, 'config.json');
    // Tamper with the file
    writeFileSync(join(baseDir, 'config.json'), '{"test": false}\n');
    assert.equal(verify(baseDir, 'config.json'), false);
  });

  it('should fail if no signature exists', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    assert.equal(verify(baseDir, 'config.json'), false);
  });

  it('should pass if no secret is set (skips check)', () => {
    delete process.env.AWG_INTEGRITY_SECRET;
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    assert.equal(verify(baseDir, 'config.json'), true);
  });

  it('should pass for non-existent file', () => {
    assert.equal(verify(baseDir, 'nonexistent.json'), true);
  });

  it('should fail if signature was tampered with', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');
    sign(baseDir, 'config.json');
    // Tamper with the signature
    const sigs = JSON.parse(readFileSync(join(baseDir, '.signatures'), 'utf-8'));
    sigs['config.json'] = 'a'.repeat(64);
    writeFileSync(join(baseDir, '.signatures'), JSON.stringify(sigs));
    assert.equal(verify(baseDir, 'config.json'), false);
  });
});

describe('signAll / verifyAll', () => {
  it('should sign all tracked files', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"a":1}\n');
    writeFileSync(join(baseDir, 'allowlist.json'), '{"b":2}\n');
    writeFileSync(join(baseDir, 'state.json'), '{"c":3}\n');

    const results = signAll(baseDir);
    assert.ok(results['config.json']);
    assert.ok(results['allowlist.json']);
    assert.ok(results['state.json']);
  });

  it('should verify all tracked files', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"a":1}\n');
    writeFileSync(join(baseDir, 'allowlist.json'), '{"b":2}\n');
    writeFileSync(join(baseDir, 'state.json'), '{"c":3}\n');
    signAll(baseDir);

    const results = verifyAll(baseDir);
    assert.equal(results['config.json'], true);
    assert.equal(results['allowlist.json'], true);
    assert.equal(results['state.json'], true);
  });

  it('should detect tampering in verifyAll', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"a":1}\n');
    writeFileSync(join(baseDir, 'allowlist.json'), '{"b":2}\n');
    writeFileSync(join(baseDir, 'state.json'), '{"c":3}\n');
    signAll(baseDir);

    // Tamper with one file
    writeFileSync(join(baseDir, 'allowlist.json'), '{"b":999}\n');

    const results = verifyAll(baseDir);
    assert.equal(results['config.json'], true);
    assert.equal(results['allowlist.json'], false);
    assert.equal(results['state.json'], true);
  });
});

describe('different secrets produce different signatures', () => {
  it('should produce different HMACs for different secrets', () => {
    writeFileSync(join(baseDir, 'config.json'), '{"test": true}\n');

    process.env.AWG_INTEGRITY_SECRET = 'secret-A';
    const hmacA = sign(baseDir, 'config.json');

    process.env.AWG_INTEGRITY_SECRET = 'secret-B';
    const hmacB = sign(baseDir, 'config.json');

    assert.notEqual(hmacA, hmacB);
  });
});
