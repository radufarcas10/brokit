const form = document.getElementById('form');
const email = document.getElementById('email');
const error = document.getElementById('email-error');
const welcome = document.getElementById('welcome');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const address = email.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) {
    error.textContent = 'Enter a valid email, like ana@example.com';
    email.setAttribute('aria-invalid', 'true');
    email.focus();
    return;
  }
  error.textContent = '';
  email.removeAttribute('aria-invalid');
  welcome.querySelector('h2').textContent = `Welcome, ${name.split(' ')[0] || 'friend'}`;
  welcome.querySelector('p').textContent = `We sent a link to ${address}.`;
  form.hidden = true;
  welcome.hidden = false;
});
