// Runs before the page draws (not deferred): the theme this visitor chose here, if any,
// so a dark page never flashes light. Without a choice, the system's setting decides.
try {
  const theme = localStorage.getItem('brokit-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // No storage (a private window, blocked site data): the system's setting decides.
}
