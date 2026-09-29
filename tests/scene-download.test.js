import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadScene, describeLoadError } from '../src/scene-download.js';

test('rejects a cached header-only 206 response, retries, and returns a complete local Blob', async () => {
  const calls = [];
  const result = await downloadScene('https://example.test/3dGS/scene.ply?v=version', {
    expectedBytes: 8, retryDelayMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? new Response('1234', { status: 206 }) : new Response('12345678');
    },
  });
  assert.equal(await result.text(), '12345678');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].url, calls[1].url);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).pathname, '/3dGS/scene.ply');
    assert.equal(new URL(url).searchParams.get('v'), 'version');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers, undefined);
  }
});

test('never passes a truncated HTTP 200 body to the decoder', async () => {
  let attempts = 0;
  await assert.rejects(downloadScene('https://example.test/scene.ply', {
    expectedBytes: 12, retryDelayMs: 0,
    fetchImpl: async () => { attempts++; return new Response('short'); },
  }), /下载不完整/);
  assert.equal(attempts, 3);
});

test('abort cancels download without retrying an obsolete scene', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(downloadScene('https://example.test/scene.ply', {
    signal: controller.signal, retryDelayMs: 0,
    fetchImpl: async () => { attempts++; controller.abort(); throw new Error('aborted'); },
  }), { name: 'AbortError' });
  assert.equal(attempts, 1);
});

test('worker string errors and unknown errors produce useful messages', () => {
  assert.equal(describeLoadError('Expected 8324819 splats, got 1163'), 'Expected 8324819 splats, got 1163');
  assert.equal(describeLoadError(new Error('network failed')), 'network failed');
  assert.match(describeLoadError(undefined), /重试/);
});
