import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKey } from '../src/keys.mjs';

const pick = ({ key, code, keyCode, text, modifiers }) => ({ key, code, keyCode, text, modifiers });

describe('parseKey', () => {
  it('characters', () => {
    assert.deepEqual(pick(parseKey('a')), { key: 'a', code: 'KeyA', keyCode: 65, text: 'a', modifiers: 0 });
    assert.deepEqual(pick(parseKey('A')), { key: 'A', code: 'KeyA', keyCode: 65, text: 'A', modifiers: 0 });
    assert.deepEqual(pick(parseKey('7')), { key: '7', code: 'Digit7', keyCode: 55, text: '7', modifiers: 0 });
    assert.deepEqual(pick(parseKey('@')), { key: '@', code: 'Digit2', keyCode: 50, text: '@', modifiers: 0 });
    assert.deepEqual(pick(parseKey('?')), { key: '?', code: 'Slash', keyCode: 191, text: '?', modifiers: 0 });
    assert.deepEqual(pick(parseKey('仮')), { key: '仮', code: '', keyCode: 0, text: '仮', modifiers: 0 });
    assert.deepEqual(pick(parseKey('+')), { key: '+', code: 'Equal', keyCode: 187, text: '+', modifiers: 0 });
  });

  it('names, in any case, and aliases', () => {
    assert.deepEqual(pick(parseKey('Enter')), { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', modifiers: 0 });
    assert.equal(parseKey('enter').key, 'Enter');
    assert.equal(parseKey('Esc').key, 'Escape');
    assert.equal(parseKey('up').key, 'ArrowUp');
    assert.deepEqual(pick(parseKey('Space')), { key: ' ', code: 'Space', keyCode: 32, text: ' ', modifiers: 0 });
    assert.deepEqual(pick(parseKey('F5')), { key: 'F5', code: 'F5', keyCode: 116, text: undefined, modifiers: 0 });
    assert.equal(parseKey('Tab').text, undefined);
    assert.equal(parseKey('PageDown').keyCode, 34);
  });

  it('combinations: modifiers in the name, and as options', () => {
    const k = parseKey('Ctrl+Shift+z');
    assert.equal(k.key, 'z');
    assert.equal(k.modifiers, 2 | 8);
    assert.equal(k.text, undefined); // a shortcut types nothing
    assert.deepEqual(k.modifierKeys.map((m) => m.key), ['Control', 'Shift']);
    assert.equal(parseKey('Shift+Tab').modifiers, 8);
    assert.equal(parseKey('Tab', { shift: true }).modifiers, 8);
    assert.equal(parseKey('Cmd+a').modifiers, 4);
    assert.equal(parseKey('Shift+a').text, 'a'); // Shift alone still types
    const plus = parseKey('Ctrl++');
    assert.equal(plus.key, '+');
    assert.equal(plus.modifiers, 2);
  });

  it('Mod is Cmd on macOS and Ctrl elsewhere; macOS editing shortcuts carry their command', () => {
    assert.equal(parseKey('Mod+a', {}, 'linux').modifiers, 2);
    assert.equal(parseKey('Mod+a', {}, 'win32').modifiers, 2);
    assert.equal(parseKey('Mod+a', {}, 'darwin').modifiers, 4);
    assert.deepEqual(parseKey('Mod+a', {}, 'darwin').commands, ['selectAll']);
    assert.deepEqual(parseKey('Meta+Shift+z', {}, 'darwin').commands, ['redo']);
    assert.deepEqual(parseKey('Cmd+v', {}, 'darwin').commands, ['paste']);
    assert.equal(parseKey('Mod+a', {}, 'linux').commands, undefined); // Ctrl+A works by itself there
    assert.equal(parseKey('Ctrl+Meta+a', {}, 'darwin').commands, undefined);
  });

  it('unknown names are errors', () => {
    assert.throws(() => parseKey('Entr'), /unknown key "Entr"/);
    assert.throws(() => parseKey('Hyper+a'), /unknown key "Hyper\+a"/);
    assert.throws(() => parseKey(''), /a key name/);
    assert.throws(() => parseKey(5), /a key name/);
  });
});
