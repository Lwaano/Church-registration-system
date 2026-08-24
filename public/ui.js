// ui.js — small shared behaviours used by every page.
// No framework, no build step. Loaded with `defer` on each page.
//
//   * theme toggle (light / dark), remembered in localStorage
//   * scroll reveals via IntersectionObserver
//   * count-up animation for figures
//   * number formatting
//
// Everything here degrades safely: if JS is off or an API call fails, the
// pages still render their static content.

(function () {
  'use strict';

  // ---- Reduced motion -----------------------------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- Theme --------------------------------------------------------------
  // The <head> of each page applies the stored theme before first paint, so
  // this only has to keep the toggle buttons in sync.
  const THEME_KEY = 'ecl-theme';

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null; // private mode / blocked storage
    }
  }

  function currentTheme() {
    const stamped = document.documentElement.getAttribute('data-theme');
    if (stamped) return stamped;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not being able to remember the choice is fine — it still applies now.
    }
    syncToggles();
  }

  function syncToggles() {
    const dark = currentTheme() === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.textContent = dark ? '☀ Light' : '☾ Dark';
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    });
  }

  function initTheme() {
    syncToggles();
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-toggle]');
      if (!btn) return;
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  // ---- Scroll reveals -----------------------------------------------------
  function initReveals() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    // Without IntersectionObserver (or with reduced motion) just show
    // everything immediately rather than leaving it invisible.
    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -5% 0px', threshold: 0.1 });

    items.forEach((el) => observer.observe(el));

    // Safety net: reading the page must never depend on an observer
    // callback arriving. Anything already scrolled into view gets revealed
    // outright, so a missed notification can't leave content invisible.
    function revealWhatIsOnScreen() {
      document.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('is-visible');
          observer.unobserve(el);
        }
      });
    }

    window.addEventListener('load', revealWhatIsOnScreen);
    setTimeout(revealWhatIsOnScreen, 1200);
  }

  // ---- Numbers ------------------------------------------------------------
  function formatNumber(n) {
    return Number(n || 0).toLocaleString();
  }

  // Animate an element's text from 0 up to `value`. Skips the animation
  // entirely for reduced-motion users and for zero.
  function countUp(el, value, options) {
    const opts = options || {};
    const target = Number(value) || 0;
    const suffix = opts.suffix || '';

    if (reduceMotion.matches || target === 0) {
      el.textContent = formatNumber(target) + suffix;
      return;
    }

    const duration = opts.duration || 1100;
    const start = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic, so it decelerates into the final figure
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatNumber(Math.round(target * eased)) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Run countUp only once the element has scrolled into view.
  function countUpOnView(el, value, options) {
    if (!('IntersectionObserver' in window)) {
      countUp(el, value, options);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        countUp(entry.target, value, options);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.3 });
    observer.observe(el);
  }

  // ---- Escaping -----------------------------------------------------------
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  window.UI = {
    applyTheme,
    currentTheme,
    storedTheme,
    formatNumber,
    countUp,
    countUpOnView,
    escapeHTML,
    reduceMotion,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initTheme(); initReveals(); });
  } else {
    initTheme();
    initReveals();
  }
})();
