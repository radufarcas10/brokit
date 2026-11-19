import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkMatcher, describeMatcher, mismatch } from '../src/expect.mjs';

describe('mismatch', () => {
  it('truthy by default', () => {
    assert.equal(mismatch(1, {}), null);
    assert.equal(mismatch('x', {}), null);
    assert.match(mismatch(0, {}), /expected something truthy, got 0/);
    assert.match(mismatch(null, {}), /got null/);
  });

  it('equals compares JSON by content', () => {
    assert.equal(mismatch({ a: [1, { b: 2 }] }, { equals: { a: [1, { b: 2 }] } }), null);
    assert.equal(mismatch(null, { equals: null }), null);
    assert.match(mismatch({ a: 1 }, { equals: { a: 1, b: 2 } }), /expected \{"a":1,"b":2\}, got \{"a":1\}/);
    assert.match(mismatch([1, 2], { equals: { 0: 1, 1: 2 } }), /expected/);
    assert.match(mismatch('1', { equals: 1 }), /expected 1, got "1"/);
  });

  it('near, within', () => {
    assert.equal(mismatch(59.4, { near: 59 }), null);
    assert.match(mismatch(59.6, { near: 59 }), /expected 59 ± 0.5, got 59.6/);
    assert.equal(mismatch(62, { near: 59, within: 3 }), null);
    assert.match(mismatch('59', { near: 59 }), /expected a number near 59/);
  });

  it('matches, includes', () => {
    assert.equal(mismatch('Signed in as ana', { matches: '^Signed in as \\w+$' }), null);
    assert.match(mismatch('Signed out', { matches: 'in as' }), /expected a match for \/in as\//);
    assert.equal(mismatch('hello world', { includes: 'lo w' }), null);
    assert.equal(mismatch(['a', { b: 1 }], { includes: { b: 1 } }), null);
    assert.match(mismatch(['a'], { includes: 'b' }), /expected a list with "b"/);
    assert.match(mismatch(5, { includes: 'b' }), /a string or a list/);
  });

  it('atLeast, atMost', () => {
    assert.equal(mismatch(3, { atLeast: 3 }), null);
    assert.equal(mismatch(3, { atLeast: 1, atMost: 3 }), null);
    assert.match(mismatch(4, { atLeast: 1, atMost: 3 }), /expected ≥ 1 and ≤ 3, got 4/);
    assert.match(mismatch('4', { atMost: 3 }), /expected a number ≤ 3/);
  });
});

describe('checkMatcher', () => {
  it('one kind of matcher at a time, well formed', () => {
    checkMatcher({ near: 1, within: 2 });
    checkMatcher({ atLeast: 1, atMost: 2 });
    assert.throws(() => checkMatcher({ equals: 1, matches: 'a' }), /one of/);
    assert.throws(() => checkMatcher({ equals: 1, atLeast: 2 }), /one of/);
    assert.throws(() => checkMatcher({ within: 2 }), /within goes with near/);
    assert.throws(() => checkMatcher({ near: '1' }), /near: a number/);
    assert.throws(() => checkMatcher({ near: 1, within: -1 }), /within: a number ≥ 0/);
    assert.throws(() => checkMatcher({ matches: '(' }), /matches: Invalid regular expression/);
    assert.throws(() => checkMatcher({ matches: 5 }), /as a string/);
  });
});

describe('describeMatcher', () => {
  it('reads well', () => {
    assert.equal(describeMatcher({ equals: 'a' }), 'equals "a"');
    assert.equal(describeMatcher({ near: 59 }), 'near 59 ± 0.5');
    assert.equal(describeMatcher({ atLeast: 1, atMost: 3 }), '≥ 1 and ≤ 3');
    assert.equal(describeMatcher({}), 'truthy');
  });
});
