#!/usr/bin/env node
import { resolve } from 'path';
import { initConfig, loadConfig, saveConfig } from './config.mjs';
import { addAddress, removeAddress, listAddresses } from './allowlist.mjs';
import { requestSend, confirmSend, freeze, unfreeze, getStatus } from './guard.mjs';

const baseDir = process.env.AWG_DIR || resolve(process.cwd(), '.awg');
const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

import { existsSync, mkdirSync } from 'fs';

function ensureDir() {
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
}

async function main() {
  ensureDir();

  switch (cmd) {
    case 'init':
      initConfig(baseDir);
      break;

    case 'status': {
      const status = getStatus(baseDir);
      console.log('Wallet Guard Status');
      console.log('─'.repeat(40));
      console.log(`Frozen:          ${status.frozen ? '🛑 YES — ' + status.frozenReason : '✅ No'}`);
      console.log(`Daily spent:     $${status.dailyTotal}`);
      console.log(`Daily limit:     $${status.dailyMax}`);
      console.log(`Daily remaining: $${status.dailyRemaining}`);
      console.log(`Pending tx:      ${status.pendingConfirmation ? 'Yes' : 'No'}`);
      break;
    }

    case 'allowlist':
      switch (sub) {
        case 'add': {
          const addr = args[2];
          const labelIdx = args.indexOf('--label');
          const label = labelIdx >= 0 ? args[labelIdx + 1] : '';
          if (!addr) { console.error('Usage: awg allowlist add <address> --label "name"'); process.exit(1); }
          addAddress(baseDir, addr, label);
          break;
        }
        case 'remove': {
          const addr = args[2];
          if (!addr) { console.error('Usage: awg allowlist remove <address>'); process.exit(1); }
          removeAddress(baseDir, addr);
          break;
        }
        case 'list':
          listAddresses(baseDir);
          break;
        default:
          console.log('Usage: awg allowlist <add|remove|list>');
      }
      break;

    case 'send': {
      const amount = parseFloat(args[1]);
      const to = args[2];
      const token = args[3] || 'USDC';
      if (!amount || !to) { console.error('Usage: awg send <amount> <address> [token]'); process.exit(1); }
      const result = requestSend(baseDir, { to, amount, token });
      console.log(result.message || result.reason);
      break;
    }

    case 'confirm': {
      const code = args[1];
      if (!code) { console.error('Usage: awg confirm <code>'); process.exit(1); }
      const result = confirmSend(baseDir, code);
      console.log(result.message || result.reason);
      if (result.approved) {
        console.log('\nExecuting via awal...');
        const { execSync } = await import('child_process');
        try {
          const output = execSync(`npx awal send ${result.amount} ${result.to} --json`, { encoding: 'utf-8' });
          console.log(output);
        } catch (e) {
          console.error('Transaction failed:', e.message);
        }
      }
      break;
    }

    case 'freeze':
      freeze(baseDir, args[1] || 'manual');
      console.log('🛑 Wallet FROZEN.');
      break;

    case 'unfreeze':
      unfreeze(baseDir);
      console.log('✅ Wallet unfrozen.');
      break;

    case 'config': {
      const config = loadConfig(baseDir);
      if (sub === 'set' && args[2] && args[3]) {
        const keys = args[2].split('.');
        let obj = config;
        for (let i = 0; i < keys.length - 1; i++) {
          obj = obj[keys[i]];
        }
        const val = isNaN(args[3]) ? args[3] : Number(args[3]);
        obj[keys[keys.length - 1]] = val;
        saveConfig(baseDir, config);
        console.log(`✅ Set ${args[2]} = ${val}`);
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
      break;
    }

    default:
      console.log(`
🔒 Agentic Wallet Guard (awg)

Commands:
  init                          Initialize config
  status                        Show wallet guard status
  allowlist add <addr> --label  Add trusted address
  allowlist remove <addr>       Remove trusted address
  allowlist list                List trusted addresses
  send <amount> <addr> [token]  Request a guarded send
  confirm <code>                Confirm pending transaction
  freeze [reason]               Freeze wallet
  unfreeze                      Unfreeze wallet
  config                        Show config
  config set <key> <value>      Update config value
`);
  }
}

main().catch(console.error);
