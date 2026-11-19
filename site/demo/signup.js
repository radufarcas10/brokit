document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('email').value.split('@')[0];
  document.getElementById('greeting').textContent = `Welcome, ${name}`;
});
