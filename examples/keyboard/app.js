// A to-do list you can use without a mouse. window.app is there for the check to read.
const app = { tasks: [], keys: 0, composing: false };
const input = document.getElementById('new');
const list = document.getElementById('list');
const history = [];

function render(focus) {
  list.replaceChildren(
    ...app.tasks.map((task, i) => {
      const li = document.createElement('li');
      li.className = task.done ? 'done' : '';
      li.innerHTML = '<label><input type="checkbox"><span></span></label><button class="remove">×</button>';
      li.querySelector('span').textContent = task.text;
      const box = li.querySelector('input');
      box.checked = task.done;
      box.addEventListener('change', () => change(() => (task.done = box.checked), `#list li:nth-child(${i + 1}) input`));
      const remove = li.querySelector('button');
      remove.setAttribute('aria-label', `Remove ${task.text}`);
      remove.addEventListener('click', () => change(() => app.tasks.splice(i, 1), app.tasks.length > 1 ? `#list li:nth-child(${Math.min(i + 1, app.tasks.length - 1)}) input` : '#new'));
      return li;
    }),
  );
  if (focus) document.querySelector(focus)?.focus();
}

// Every change can be undone: keep a copy of the list from before it.
function change(edit, focus) {
  history.push(JSON.stringify(app.tasks));
  edit();
  render(focus);
}

document.getElementById('add').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  change(() => app.tasks.push({ text, done: false }));
  input.value = '';
});

// Ctrl+Z (Cmd+Z on a Mac) undoes the last change to the list, except in the text field,
// where it undoes typing, as it does everywhere.
document.addEventListener('keydown', (e) => {
  if (e.target === input || e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
  e.preventDefault();
  if (history.length) {
    app.tasks = JSON.parse(history.pop());
    render();
  }
});

// What the check reads: key presses in the field, and whether an input method is composing.
input.addEventListener('keydown', () => app.keys++);
input.addEventListener('compositionstart', () => (app.composing = true));
input.addEventListener('compositionend', () => (app.composing = false));

window.app = app;
