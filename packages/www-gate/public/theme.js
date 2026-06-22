(function () {
  const storageKey = 'wwwGateTheme';
  const root = document.documentElement;

  function readTheme() {
    const saved = localStorage.getItem(storageKey);
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    const button = document.querySelector('[data-theme-toggle]');
    const label = document.querySelector('[data-theme-label]');
    if (label) {
      label.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
    if (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }

  function toggleTheme() {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(storageKey, next);
    applyTheme(next);
  }

  function bindThemeToggle() {
    const button = document.querySelector('[data-theme-toggle]');
    if (button && button.dataset.themeBound !== 'true') {
      button.dataset.themeBound = 'true';
      button.addEventListener('click', toggleTheme);
    }
    applyTheme(readTheme());
  }

  applyTheme(readTheme());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindThemeToggle, { once: true });
  } else {
    bindThemeToggle();
  }
})();
