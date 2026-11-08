import assert from 'node:assert/strict';
import test from 'node:test';
import { decideSectionAction, isExactName, isSettled, isWorkdayHost } from './workdayRules.js';

test('only Workday hosts are handled', () => {
  assert.equal(isWorkdayHost('acme.wd5.myworkdayjobs.com'), true);
  assert.equal(isWorkdayHost('acme.myworkdaysite.com'), true);
  assert.equal(isWorkdayHost('docs.google.com'), false);
  assert.equal(isWorkdayHost('myworkdayjobs.com.evil.example'), false);
});

test('Add matches exactly, never "Add Another"', () => {
  assert.equal(isExactName('Add', 'Add'), true);
  assert.equal(isExactName('  Add \n', 'Add'), true);
  assert.equal(isExactName('Add Another', 'Add'), false);
  assert.equal(isExactName('add', 'Add'), false);
});

test('existing entry is never duplicated', () => {
  assert.equal(decideSectionAction({ hasEntry: true, hasAddButton: true }), 'exists');
  assert.equal(decideSectionAction({ hasEntry: false, hasAddButton: true }), 'add');
  assert.equal(decideSectionAction({ hasEntry: false, hasAddButton: false }), 'none');
});

test('settled requires fields, stable count, not busy and a quiet DOM', () => {
  const base = { fieldCount: 4, previousFieldCount: 4, busy: false, lastMutationAt: 0, now: 1000, quietMs: 400 };
  assert.equal(isSettled(base), true);
  assert.equal(isSettled({ ...base, fieldCount: 0, previousFieldCount: 0 }), false);
  assert.equal(isSettled({ ...base, previousFieldCount: 3 }), false);
  assert.equal(isSettled({ ...base, busy: true }), false);
  assert.equal(isSettled({ ...base, lastMutationAt: 800 }), false);
});
