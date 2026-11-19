// brokit next to Playwright and Puppeteer, doing the same work (scenarios.mjs) in the same
// installed Chrome, each its usual way. Measured from outside, the same for every tool:
//   wall      from starting the tool's process to its end
//   CPU       user + system time of the tool and every Chrome process it started
//   memory    the peak of their summed resident memory
// CPU and memory are read from /proc every 20 ms over the whole process tree, so this
// runs on Linux. Each case runs `--runs` times (default 5), tools taking turns, and the
// median is reported with the range.
//
//   node bench/run.mjs [--runs 5] [--tools brokit,playwright,puppeteer] [--plans single,suite]
//
// Playwright and Puppeteer live in bench/tools/*/node_modules (npm install --ignore-scripts
// there); they are not brokit's dependencies. Results: printed, and (for a run of every
// tool and plan) saved as JSON in bench/results/.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, serve } from '../src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const RUNS = Number(opt('runs', '5'));
const TOOLS = opt('tools', 'brokit,playwright,puppeteer').split(',');
const PLANS = opt('plans', 'single,suite').split(',');
const CHROME = findChrome();
if (process.platform !== 'linux') throw new Error('the benchmark reads /proc: Linux only for now');
if (!CHROME) throw new Error('no Chrome found');
for (const t of TOOLS.filter((t) => t !== 'brokit')) {
  if (!existsSync(join(HERE, 'tools', t, 'node_modules'))) throw new Error(`install ${t} first: cd bench/tools/${t} && npm install --ignore-scripts`);
}

const TICK = 100; // clock ticks per second in /proc/*/stat (Linux's USER_HZ)
const PAGE = 4096;

/** Every process under `root` (itself included): pid -> { cpu (ticks), rss (bytes) }. */
function tree(root) {
  const procs = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      procs.set(Number(name), { ppid: Number(f[1]), cpu: Number(f[11]) + Number(f[12]), rss: Number(f[21]) * PAGE });
    } catch {}
  }
  const inside = new Map();
  const add = (pid) => {
    const p = procs.get(pid);
    if (!p || inside.has(pid)) return;
    inside.set(pid, p);
    for (const [child, c] of procs) if (c.ppid === pid) add(child);
  };
  add(root);
  return inside;
}

/** Run one tool on one plan; its timings and its measured cost. */
function measure(tool, base, plan) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [join(HERE, 'tools', tool, 'run.mjs'), base, plan], { env: { ...process.env, CHROME }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    // The last CPU seen for each process (they may end between samples), and the peak of
    // the summed memory.
    const cpu = new Map();
    let peak = 0;
    const sample = () => {
      const t = tree(child.pid);
      let rss = 0;
      for (const [pid, p] of t) {
        cpu.set(pid, Math.max(cpu.get(pid) ?? 0, p.cpu));
        rss += p.rss;
      }
      peak = Math.max(peak, rss);
    };
    const timer = setInterval(sample, 20);
    child.on('exit', (code) => {
      clearInterval(timer);
      const wall = performance.now() - start;
      if (code !== 0) return reject(new Error(`${tool} ${plan} failed (${code}):\n${err}${out}`));
      const r = JSON.parse(out.trim().split('\n').pop());
      let ticks = 0;
      for (const v of cpu.values()) ticks += v;
      resolve({ ...r, wall, cpu: (ticks / TICK) * 1000, memory: peak });
    });
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const server = await serve(join(HERE, '..', 'test', 'fixtures'));
const chromeVersion = await (async () => {
  const b = await launch({ chrome: CHROME });
  const v = await b.version();
  await b.close();
  return v;
})();
const results = {};
try {
  // A warm-up per tool (disk caches, Chrome's first start), not counted.
  for (const tool of TOOLS) await measure(tool, server.url, 'single');
  for (let run = 0; run < RUNS; run++) {
    for (const plan of PLANS) {
      // Tools take turns, in a different order each run.
      const order = TOOLS.map((t, i) => TOOLS[(i + run) % TOOLS.length]);
      for (const tool of order) {
        const r = await measure(tool, server.url, plan);
        ((results[tool] ??= { version: r.version })[plan] ??= []).push(r);
        process.stderr.write(`run ${run + 1}/${RUNS} ${plan.padEnd(6)} ${tool.padEnd(10)} ${(r.wall / 1000).toFixed(2)} s wall, ${(r.cpu / 1000).toFixed(2)} s CPU, ${(r.memory / 1e6).toFixed(0)} MB\n`);
      }
    }
  }
} finally {
  await server.close();
}

const summary = {};
for (const [tool, byPlan] of Object.entries(results)) {
  summary[tool] = { version: byPlan.version };
  for (const plan of PLANS) {
    const rs = byPlan[plan];
    const stat = (f) => ({ median: median(rs.map(f)), min: Math.min(...rs.map(f)), max: Math.max(...rs.map(f)) });
    summary[tool][plan] = { wall: stat((r) => r.wall), cpu: stat((r) => r.cpu), memory: stat((r) => r.memory), launch: stat((r) => r.launchMs), perScenario: stat((r) => r.scenarioMs.reduce((a, b) => a + b, 0) / r.scenarioMs.length) };
  }
}
const machine = { cpu: cpus()[0].model, cores: cpus().length, memoryGB: +(totalmem() / 1e9).toFixed(1), kernel: release(), node: process.version, chrome: chromeVersion };
const date = new Date().toISOString().slice(0, 10);
// Only a whole run is saved: a quick look at one tool or plan mustn't replace the results
// the README quotes.
const whole = ['brokit', 'playwright', 'puppeteer'].every((t) => TOOLS.includes(t)) && ['single', 'suite'].every((p) => PLANS.includes(p));
const file = whole ? join(HERE, 'results', `${date}-linux.json`) : null;
if (file) {
  mkdirSync(join(HERE, 'results'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ date, machine, runs: RUNS, summary, results }, null, 1)}\n`);
}

const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
const mb = (b) => `${Math.round(b / 1e6)} MB`;
const row = (tool, plan, x) => `| ${tool} ${summary[tool].version} | ${s(x.wall.median)} (${s(x.wall.min)}–${s(x.wall.max)}) | ${s(x.cpu.median)} | ${mb(x.memory.median)} | ${Math.round(x.launch.median)} ms | ${Math.round(x.perScenario.median)} ms |`;
console.log(`\n${machine.cpu}, ${machine.cores} threads, ${machine.memoryGB} GB, Linux ${machine.kernel}, Node ${machine.node}, ${machine.chrome}; median of ${RUNS} runs\n`);
for (const plan of PLANS) {
  console.log(plan === 'single' ? 'One check (start Chrome, a form, close):' : 'A suite of 20 checks in one Chrome (10 forms, 5 canvas, 5 phone):');
  console.log('| tool | wall (range) | CPU | peak memory | Chrome start | per check |');
  console.log('|---|---|---|---|---|---|');
  for (const tool of Object.keys(summary)) console.log(row(tool, plan, summary[tool][plan]));
  console.log('');
}
console.log(file ? `saved ${file}` : 'not saved (only a run of every tool and plan is)');
