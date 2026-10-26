import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldSkipDuplicateScan } from './scanCoalescer.js';

test('should skip duplicate scans while within cooldown', () => {
  assert.equal(shouldSkipDuplicateScan(1000, 1400, 500), true);
  assert.equal(shouldSkipDuplicateScan(1000, 1800, 500), false);
  assert.equal(shouldSkipDuplicateScan(null, 1000, 500), false);
});
