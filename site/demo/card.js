// ?v=after: the same card after a small, easy-to-miss change (a new price, a button 3 px
// lower and a shade darker): what a pixel diff is for.
if (new URLSearchParams(location.search).get('v') === 'after') document.documentElement.classList.add('after');
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.classList.contains('after')) document.getElementById('price').textContent = '$14';
});
