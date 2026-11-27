// The examples in examples/ work as their READMEs say: each one's command, run in a fresh
// copy of its folder, passes, and passes again once its baselines exist.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runExample } from '../site/build.mjs';
import { EXAMPLES } from '../site/lib/examples.mjs';
import { findChrome } from '../src/chrome.mjs';

describe('examples', { skip: findChrome() ? false : 'no Chrome on this computer' }, () => {
  for (const example of EXAMPLES) {
    it(`${example.dir}: ${example.command}`, async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'brokit-example-'));
      try {
        const first = await runExample(example, tmp);
        assert.equal(first.code, 0, `first run:\n${first.stdout}${first.stderr}`);
        // Again, in the same folder: now against the baselines the first run wrote.
        const again = await runExample({ ...example, reuse: true }, tmp);
        assert.equal(again.code, 0, `second run:\n${again.stdout}${again.stderr}`);
        for (const shot of Object.keys(example.shots ?? {})) assert.ok(again.files.includes(shot), `${shot} was made`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
