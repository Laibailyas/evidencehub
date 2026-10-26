// Apply saved theme before first paint. Default: dark (premium).
try {
  var theme = localStorage.getItem('plusquam_theme');
  if (theme === 'dark' || theme === null) {
    document.documentElement.classList.add('dark');
  }
} catch (error) {
  document.documentElement.classList.add('dark');
}
