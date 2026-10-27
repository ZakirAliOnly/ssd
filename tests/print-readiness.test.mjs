import test from 'node:test';
import assert from 'node:assert/strict';
import { tsLoader } from './helpers/load-ts.mjs';
const { withPrintTimeout } = tsLoader()('lib/printReadiness.ts');

test('a stalled print request releases with a retryable timeout', async () => {
  await assert.rejects(withPrintTimeout(new Promise(() => {}), 5), /timed out.*try again/);
});

test('successful print preparation preserves its result', async () => {
  assert.equal(await withPrintTimeout(Promise.resolve('ready'), 100), 'ready');
});

test('preparation failures propagate instead of opening print with stale data', async () => {
  const error = new Error('Could not refresh balance');
  await assert.rejects(withPrintTimeout(Promise.reject(error), 100), error);
});
