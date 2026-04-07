#!/usr/bin/env node
/**
 * Interactive menu for common pi-setup operations (API worker, D1, fleet dashboard, daemon).
 * Run from repo root: node scripts/pi-init.mjs   or   npm run init
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(ROOT, 'cloudflare', 'worker');
const FLEET_DASH = path.join(ROOT, 'dashboards', 'fleet');
function wranglerCli() {
  const js = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (existsSync(js)) return js;
  return null;
}

function run(bin, args, opts = {}) {
  const { cwd = ROOT, inherit = true } = opts;
  const r = spawnSync(bin, args, {
    cwd,
    stdio: inherit ? 'inherit' : 'pipe',
    shell: process.platform === 'win32' && bin.endsWith('.cmd'),
  });
  return r.status ?? 1;
}

function runWrangler(args, cwd) {
  const cli = wranglerCli();
  if (!cli) {
    output.write(
      'Wrangler not found. From the repo root run: npm install   (or bun install)\n'
    );
    return 1;
  }
  return run(process.execPath, [cli, ...args], { cwd });
}

function ensureFleetDeps() {
  if (!existsSync(path.join(FLEET_DASH, 'node_modules'))) {
    output.write('\nInstalling dashboard dependencies (first time)…\n');
    const pm = existsSync(path.join(FLEET_DASH, 'bun.lock')) ? 'bun' : 'npm';
    const install = pm === 'bun' ? ['install'] : ['install'];
    const st = run(pm, install, { cwd: FLEET_DASH });
    if (st !== 0) return false;
  }
  return true;
}

function fleetPmRun(script) {
  if (!ensureFleetDeps()) return 1;
  if (existsSync(path.join(FLEET_DASH, 'bun.lock'))) {
    return run('bun', ['run', script], { cwd: FLEET_DASH });
  }
  return run('npm', ['run', script], { cwd: FLEET_DASH });
}

const MENU = `
╔══════════════════════════════════════════════════════════════════╗
║  pi-setup — choose an action (repo root: ${path.basename(ROOT)})
╠══════════════════════════════════════════════════════════════════╣
║  API Worker (pi-setup-secrets)                                   ║
║   1   Deploy to Cloudflare          wrangler deploy             ║
║   2   Local dev server              wrangler dev  → :8787       ║
║   3   Set Worker secrets            (bootstrap + signing key)   ║
║  D1 database                                                     ║
║   4   Apply schema (remote)         schema.sql → pi-setup-db    ║
║   5   List D1 databases                                          ║
║  Fleet dashboard (SvelteKit)                                     ║
║   6   Run locally                   Vite → http://localhost:5173 ║
║   7   Build + deploy to Cloudflare Pages                         ║
║  Fleet daemon & CLI                                              ║
║   8   Run fleet daemon (foreground)                              ║
║   9   fleetctl status                                            ║
║  10   fleetctl diagnostics                                       ║
║  Enrollment                                                      ║
║  13   npm run enroll (admin: issue token | target: one-liner)    ║
║  Help                                                            ║
║  15   Print token generation (openssl)                           ║
║  16   Print paths to docs                                        ║
║   0   Exit                                                       ║
╚══════════════════════════════════════════════════════════════════╝
`;

async function main() {
  const rl = createInterface({ input, output });
  try {
    for (;;) {
      output.write(MENU);
      const raw = (await rl.question('Enter number: ')).trim();
      const choice = raw;

      if (choice === '0' || choice === '' || choice.toLowerCase() === 'q') {
        output.write('Bye.\n');
        break;
      }

      if (choice === '1') {
        output.write('\n→ Deploy API Worker…\n');
        runWrangler(['deploy'], WORKER);
      } else if (choice === '2') {
        output.write('\n→ wrangler dev (Ctrl+C to stop)…\n');
        runWrangler(['dev'], WORKER);
      } else if (choice === '3') {
        output.write('\n→ Set PI_SETUP_BOOTSTRAP_TOKEN (paste token, Enter)…\n');
        runWrangler(['secret', 'put', 'PI_SETUP_BOOTSTRAP_TOKEN'], WORKER);
        output.write('\n→ Set PI_SETUP_ENROLLMENT_SIGNING_KEY…\n');
        runWrangler(['secret', 'put', 'PI_SETUP_ENROLLMENT_SIGNING_KEY'], WORKER);
      } else if (choice === '4') {
        output.write('\n→ Apply D1 schema (remote)…\n');
        runWrangler(
          ['d1', 'execute', 'pi-setup-db', '--file=schema.sql', '--remote'],
          WORKER
        );
      } else if (choice === '5') {
        output.write('\n→ D1 list…\n');
        runWrangler(['d1', 'list'], WORKER);
      } else if (choice === '6') {
        output.write('\n→ Fleet dashboard dev server…\n');
        const st = fleetPmRun('dev');
        if (st !== 0) output.write('If install failed, run: cd dashboards/fleet && npm install\n');
      } else if (choice === '7') {
        output.write('\n→ Build + Cloudflare Pages deploy…\n');
        const st = fleetPmRun('deploy:cloudflare');
        if (st !== 0) {
          output.write(
            '\nTip: Create a Pages project first (dashboard or): wrangler pages project create pi-fleet-dashboard\n'
          );
        }
      } else if (choice === '8') {
        output.write('\n→ fleet-daemon (Ctrl+C to stop)…\n');
        run(process.execPath, [path.join(ROOT, 'scripts', 'fleet-daemon.mjs')], {
          cwd: ROOT,
        });
      } else if (choice === '9') {
        run(process.execPath, [path.join(ROOT, 'scripts', 'fleetctl.mjs'), 'status'], {
          cwd: ROOT,
        });
      } else if (choice === '10') {
        run(process.execPath, [path.join(ROOT, 'scripts', 'fleetctl.mjs'), 'diagnostics'], {
          cwd: ROOT,
        });
      } else if (choice === '13') {
        output.write('\n→ npm run enroll (reads .env.runtime / sync.json)…\n');
        run(process.execPath, [path.join(ROOT, 'scripts', 'pi-enroll.mjs')], { cwd: ROOT });
      } else if (choice === '15') {
        output.write(`
Generate secrets (run in a terminal, then wrangler secret put …):

  openssl rand -base64 32    # PI_SETUP_BOOTSTRAP_TOKEN
  openssl rand -base64 32    # PI_SETUP_ENROLLMENT_SIGNING_KEY (use a different value)

Or:  openssl rand -hex 32
`);
      } else if (choice === '16') {
        output.write(`
  ${path.join(ROOT, 'docs', 'SETUP.md')}     — start here (setup & dashboard)
  ${path.join(ROOT, 'docs', 'CLOUDFLARE.md')} — Worker API & deployment
  ${path.join(ROOT, 'docs', 'FLEET.md')}      — daemon & fleetctl
  ${path.join(ROOT, 'docs', 'SECRETS.md')}    — encrypt / enroll / sync
`);
      } else {
        output.write('Unknown option. Use 0–11, 13–16.\n');
      }

      await rl.question('\nPress Enter to continue…');
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
