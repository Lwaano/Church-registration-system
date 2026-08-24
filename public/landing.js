// landing.js — live counters and the scripture rotator on the public
// landing page. Both are decorative: if either fails the page still reads
// perfectly well.

(function () {
  'use strict';

  // ---- Live counters -------------------------------------------------------
  // /api/public/stats returns aggregate counts only. There is nothing
  // identifying in the response, which is why it sits outside the login wall.
  const COUNTERS = [
    { id: 'statPartners', key: 'partners' },
    { id: 'statMembers', key: 'members' },
    { id: 'statTowns', key: 'towns' },
    { id: 'statNations', key: 'nations' },
  ];

  async function loadStats() {
    let stats;
    try {
      const res = await fetch('/api/public/stats');
      if (!res.ok) throw new Error('stats unavailable');
      stats = await res.json();
    } catch {
      // Hide the whole strip rather than leaving four em-dashes on screen.
      const strip = document.getElementById('heroStats');
      if (strip) strip.style.display = 'none';
      return;
    }

    COUNTERS.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const value = Number(stats[key]) || 0;
      // A "+" reads as "and growing" once the number is past a handful.
      window.UI.countUpOnView(el, value, { suffix: value >= 10 ? '+' : '' });
    });
  }

  // ---- Scripture rotator ---------------------------------------------------
  const SCRIPTURES = [
    {
      text: '“And God is able to make all grace abound toward you; that you, always having all sufficiency in all things, may abound to every good work.”',
      ref: '2 Corinthians 9:8',
    },
    {
      text: '“He which soweth bountifully shall reap also bountifully.”',
      ref: '2 Corinthians 9:6',
    },
    {
      text: '“Give, and it shall be given unto you; good measure, pressed down, shaken together, and running over, shall men give into your bosom.”',
      ref: 'Luke 6:38',
    },
    {
      text: '“But my God shall supply all your need according to his riches in glory by Christ Jesus.”',
      ref: 'Philippians 4:19',
    },
  ];

  const ROTATE_MS = 7000;

  function initRotator() {
    const rotator = document.getElementById('scriptureRotator');
    const textEl = document.getElementById('scriptureText');
    const refEl = document.getElementById('scriptureRef');
    const dotsEl = document.getElementById('scriptureDots');
    if (!rotator || !textEl || !refEl || !dotsEl) return;

    let index = 0;
    let timer = null;

    SCRIPTURES.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'scripture-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Scripture ${i + 1} of ${SCRIPTURES.length}`);
      dot.addEventListener('click', () => { show(i); restart(); });
      dotsEl.appendChild(dot);
    });

    const dots = Array.from(dotsEl.children);

    function paint(i) {
      textEl.textContent = SCRIPTURES[i].text;
      refEl.textContent = SCRIPTURES[i].ref;
      dots.forEach((d, n) => d.classList.toggle('active', n === i));
      index = i;
    }

    function show(i) {
      if (i === index) return;
      if (window.UI.reduceMotion.matches) {
        paint(i);
        return;
      }
      // Fade out, swap the text while it is invisible, fade back in.
      rotator.classList.add('scripture-fading');
      setTimeout(() => {
        paint(i);
        rotator.classList.remove('scripture-fading');
      }, 500);
    }

    function next() { show((index + 1) % SCRIPTURES.length); }

    function restart() {
      clearInterval(timer);
      timer = setInterval(next, ROTATE_MS);
    }

    restart();

    // Pause while the reader is hovering or tabbing through the quote.
    rotator.addEventListener('mouseenter', () => clearInterval(timer));
    rotator.addEventListener('mouseleave', restart);
    rotator.addEventListener('focusin', () => clearInterval(timer));
    rotator.addEventListener('focusout', restart);

    // Don't rotate in a background tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearInterval(timer);
      else restart();
    });
  }

  loadStats();
  initRotator();
})();
