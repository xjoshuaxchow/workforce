import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('Startup port conflict exits without announcing success or starting the worker', {timeout: 15000}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: new URL('../../', import.meta.url),
    env: {...process.env, DATABASE_URL: url.toString(), PORT: String(blocker.address().port), HOST: '127.0.0.1', MESSAGING_MODE: 'mock'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => stdout += x);
  child.stderr.on('data', x => stderr += x);
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 1, stderr);
    assert.match(stderr, /EADDRINUSE/);
    assert.doesNotMatch(stdout, /server.started/);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise(resolve => blocker.close(resolve));
  }
});
