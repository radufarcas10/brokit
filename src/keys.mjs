// Keys as the DevTools Protocol wants them: the key, its physical code, its Windows key
// code (which pages still read as event.keyCode) and the text it types (US layout).
//
// A key is written as a character ("a", "A", "é", "仮"), a name ("Enter", "ArrowUp",
// "F5"; any case; also Esc, Del, Up, Down, Left, Right, Space, Return), or a combination
// with modifiers ("Ctrl+Enter", "Shift+Tab", "Ctrl+Shift+Z", "Meta+a"). "Mod" is the
// platform's shortcut key: Cmd on macOS, Ctrl elsewhere, so "Mod+a" selects all anywhere.

const NAMED = {
  Backspace: ['Backspace', 8],
  Tab: ['Tab', 9],
  Enter: ['Enter', 13, '\r'],
  Shift: ['ShiftLeft', 16],
  Control: ['ControlLeft', 17],
  Alt: ['AltLeft', 18],
  Pause: ['Pause', 19],
  CapsLock: ['CapsLock', 20],
  Escape: ['Escape', 27],
  ' ': ['Space', 32, ' '],
  PageUp: ['PageUp', 33],
  PageDown: ['PageDown', 34],
  End: ['End', 35],
  Home: ['Home', 36],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowUp: ['ArrowUp', 38],
  ArrowRight: ['ArrowRight', 39],
  ArrowDown: ['ArrowDown', 40],
  Insert: ['Insert', 45],
  Delete: ['Delete', 46],
  Meta: ['MetaLeft', 91],
  ContextMenu: ['ContextMenu', 93],
};
for (let n = 1; n <= 12; n++) NAMED[`F${n}`] = [`F${n}`, 111 + n];

const ALIASES = { esc: 'Escape', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: ' ', return: 'Enter' };
const BY_LOWER = Object.fromEntries(Object.keys(NAMED).map((k) => [k.toLowerCase(), k]));

// Punctuation on a US keyboard: the key's code and key code, unshifted then shifted.
const PUNCTUATION = [
  ['Semicolon', 186, ';', ':'],
  ['Equal', 187, '=', '+'],
  ['Comma', 188, ',', '<'],
  ['Minus', 189, '-', '_'],
  ['Period', 190, '.', '>'],
  ['Slash', 191, '/', '?'],
  ['Backquote', 192, '`', '~'],
  ['BracketLeft', 219, '[', '{'],
  ['Backslash', 220, '\\', '|'],
  ['BracketRight', 221, ']', '}'],
  ['Quote', 222, "'", '"'],
];
const SHIFTED_DIGITS = ')!@#$%^&*(';

const MODIFIERS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
// The modifier keys themselves, pressed before the key and released after it.
const MODIFIER_KEYS = [
  [1, 'Alt'],
  [2, 'Control'],
  [4, 'Meta'],
  [8, 'Shift'],
];

/**
 * A key, with any modifiers from its name and from `mods` ({shift, ctrl, alt, meta}).
 * Returns { key, code, keyCode, text, modifiers, modifierKeys } (modifierKeys: the
 * modifier keys to hold, each with the same fields). Throws on a name it doesn't know.
 */
export function parseKey(spec, mods = {}, platform = process.platform) {
  if (typeof spec !== 'string' || !spec) throw new Error('key: a key name like "Enter" or a character like "a"');
  let modifiers = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.meta ? 4 : 0) | (mods.shift ? 8 : 0);
  let name = spec;
  const bit = (m) => (m.toLowerCase() === 'mod' ? (platform === 'darwin' ? 4 : 2) : MODIFIERS[m.toLowerCase()]);
  // "Ctrl+Shift+Z": modifiers before the last "+" (so "Ctrl++" is Ctrl and "+").
  const combo = /^((?:[a-z]+\+)+)(.+)$/i.exec(spec);
  if (combo && combo[1].split('+').slice(0, -1).every(bit)) {
    for (const m of combo[1].split('+').slice(0, -1)) modifiers |= bit(m);
    name = combo[2];
  }
  const base = describe(name);
  // A key types its text unless Ctrl, Alt or Meta is held (then it's a shortcut).
  const text = modifiers & 7 ? undefined : base.text;
  const modifierKeys = MODIFIER_KEYS.filter(([bit]) => modifiers & bit).map(([, key]) => ({ ...describe(key), text: undefined }));
  // On macOS, Cmd+A, C, X, V and Z edit through the app's menu, which synthetic keys never
  // reach; Chrome takes the editing command along with the key instead.
  let commands;
  if (platform === 'darwin' && (modifiers & 7) === 4) {
    const command = MAC_COMMANDS[base.key.toLowerCase()];
    if (command) commands = [command === 'undo' && modifiers & 8 ? 'redo' : command];
  }
  return { key: base.key, code: base.code, keyCode: base.keyCode, text, modifiers, modifierKeys, ...(commands ? { commands } : {}) };
}

const MAC_COMMANDS = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo' };

function describe(name) {
  const named = NAMED[name] ? name : BY_LOWER[name.toLowerCase()] ?? ALIASES[name.toLowerCase()];
  if (named) {
    const [code, keyCode, text] = NAMED[named];
    return { key: named, code, keyCode, text };
  }
  if ([...name].length !== 1) throw new Error(`key: unknown key ${JSON.stringify(name)} (a character, or a name like Enter, Tab, ArrowUp, F5, Ctrl+Enter)`);
  if (/^[a-z]$/i.test(name)) return { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name };
  if (/^\d$/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  const shiftedDigit = SHIFTED_DIGITS.indexOf(name);
  if (shiftedDigit >= 0) return { key: name, code: `Digit${shiftedDigit}`, keyCode: 48 + shiftedDigit, text: name };
  const p = PUNCTUATION.find((row) => row[2] === name || row[3] === name);
  if (p) return { key: name, code: p[0], keyCode: p[1], text: name };
  // Any other character: what an input method or another layout would type.
  return { key: name, code: '', keyCode: 0, text: name };
}
