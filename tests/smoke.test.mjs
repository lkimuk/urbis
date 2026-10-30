import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { observe } = require('../electron/smoke.cjs');

test('smoke observation captures startup errors and blocks network before checks run', () => {
  const webContents = new EventEmitter();
  let beforeRequest;
  webContents.session = {
    webRequest: {
      onBeforeRequest: (_filter, callback) => {
        beforeRequest = callback;
      },
    },
  };
  const observation = observe({ webContents });
  webContents.emit('console-message', { level: 'error', message: 'startup failure' });
  webContents.emit('console-message', { level: 'info', message: 'normal startup' });
  let blocked;
  beforeRequest({ url: 'https://example.invalid/startup' }, (result) => {
    blocked = result.cancel;
  });
  assert.equal(blocked, true);
  assert.deepEqual(observation.errors, ['startup failure']);
  assert.deepEqual(observation.networkRequests, ['https://example.invalid/startup']);
});
