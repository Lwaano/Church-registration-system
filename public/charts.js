// charts.js — the handful of chart forms the Overview tab needs, drawn as
// inline SVG. No charting library, no build step.
//
// House rules these follow (they're deliberate, not incidental):
//   * thin marks — bars capped at 20px, lines at 2px, dots with a 2px ring
//     in the surface colour so they stay legible where they overlap
//   * a 2px surface-coloured gap separates touching fills; nothing gets a
//     border drawn around it
//   * gridlines and axes are solid hairlines one step off the surface
//   * labels are selective — the endpoint and the bar tips, never a number
//     on every point — and always wear text tokens, never the series colour
//   * every chart has a table-view twin, so no value is reachable only by
//     hovering
//   * one y-scale per plot; there are no dual-axis charts here

(function () {
  'use strict';

  const BAR_H = 20;             // bar thickness (cap is 24)
  const BAR_R = 4;              // rounded data-end radius
  const CHAR_W = 6.6;           // rough advance width for label-fits-in-mark tests

  // Charts are drawn at the container's own pixel width, so one SVG unit is
  // one CSS pixel and the axis/label type renders at its true size. Drawing
  // at a fixed viewBox and letting the browser scale it down is what makes
  // labels in a narrow card illegible.
  function chartWidth(body) {
    return Math.max(260, Math.round(body.clientWidth || 640));
  }

  const esc = (s) => window.UI.escapeHTML(s);
  const fmt = (n) => window.UI.formatNumber(n);

  // ---- Shared helpers ------------------------------------------------------

  // Round a maximum up to a friendly axis top (10, 20, 50, 100, …).
  function niceMax(max) {
    if (max <= 4) return 4;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const steps = [1, 2, 2.5, 5, 10];
    for (const s of steps) {
      const candidate = s * pow;
      if (candidate >= max) return candidate;
    }
    return 10 * pow;
  }

  function ticks(max, count) {
    const out = [];
    for (let i = 0; i <= count; i++) out.push(Math.round((max / count) * i));
    return out;
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  // A horizontal bar: square where it meets the baseline, 4px rounded at the
  // data-end, so the reader can always see which end is the value.
  function hBarPath(x, y, w, h, r) {
    if (w <= 0.5) return '';
    const rr = Math.min(r, w, h / 2);
    return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr}` +
           ` V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`;
  }

  // ---- Tooltip -------------------------------------------------------------
  // One tooltip per chart body. Hit areas are always larger than the mark,
  // and keyboard focus shows exactly what hover shows.
  function attachTooltip(body) {
    let tip = body.querySelector('.chart-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tooltip';
      tip.setAttribute('role', 'status');
      body.appendChild(tip);
    }
    // The body element survives re-renders, so only ever bind its
    // mouseleave once — otherwise every redraw stacks another listener.
    if (!body.dataset.tipBound) {
      body.dataset.tipBound = '1';
      body.addEventListener('mouseleave', () => {
        const current = body.querySelector('.chart-tooltip');
        if (current) current.classList.remove('is-visible');
      });
    }
    return {
      show(html, anchorEl) {
        const bodyRect = body.getBoundingClientRect();
        const rect = anchorEl.getBoundingClientRect();
        tip.innerHTML = html;
        tip.style.left = (rect.left - bodyRect.left + rect.width / 2) + 'px';
        tip.style.top = (rect.top - bodyRect.top) + 'px';
        tip.classList.add('is-visible');
      },
      hide() { tip.classList.remove('is-visible'); },
    };
  }

  function wireHits(body, handler) {
    const tooltip = attachTooltip(body);
    body.querySelectorAll('[data-tip]').forEach((hit) => {
      const show = () => tooltip.show(hit.dataset.tip, hit);
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', tooltip.hide);
      hit.addEventListener('blur', tooltip.hide);
      if (handler) handler(hit, tooltip);
    });
  }

  // =========================================================================
  // Line + area — a single series over time, so no legend box: the card
  // title already says what is plotted.
  // =========================================================================
  function line(body, opts) {
    const points = opts.points || [];
    if (!points.length) {
      body.innerHTML = '<p class="panel-sub" style="margin:0;">No data yet.</p>';
      return;
    }

    const VB_W = chartWidth(body);
    const H = 250;
    const padL = 40, padR = 52, padT = 16, padB = 34;
    const plotW = VB_W - padL - padR;
    const plotH = H - padT - padB;

    const max = niceMax(Math.max(...points.map((p) => p.value), 1));
    const yTicks = ticks(max, 4);

    const x = (i) => padL + (points.length === 1 ? plotW / 2 : (plotW / (points.length - 1)) * i);
    const y = (v) => padT + plotH - (v / max) * plotH;

    const grid = yTicks.map((t) =>
      `<line class="grid-line" x1="${padL}" y1="${y(t)}" x2="${padL + plotW}" y2="${y(t)}" />` +
      `<text class="axis-text" x="${padL - 8}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`
    ).join('');

    const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
    const areaPath = `${linePath} L${x(points.length - 1)},${padT + plotH} L${x(0)},${padT + plotH} Z`;

    // Thin the axis labels to whatever the available width can hold without
    // them colliding, rather than assuming every other one always fits.
    const perLabel = 34;
    const stride = Math.max(1, Math.ceil((points.length * perLabel) / plotW));
    const xLabels = points.map((p, i) =>
      ((points.length - 1 - i) % stride === 0)
        ? `<text class="axis-text" x="${x(i)}" y="${padT + plotH + 18}" text-anchor="middle">${esc(p.label)}</text>`
        : ''
    ).join('');

    // Only the endpoint is directly labelled — the axis and the tooltip carry
    // the rest.
    const last = points[points.length - 1];
    const endLabel =
      `<text class="value-text" x="${x(points.length - 1) + 10}" y="${y(last.value) + 4}">${fmt(last.value)}</text>`;

    const bandW = plotW / points.length;
    const hits = points.map((p, i) => {
      const bx = padL + bandW * i;
      const tip = `<strong>${esc(p.fullLabel || p.label)}</strong>${fmt(p.value)} ${esc(opts.unit || '')}`;
      return `<g>
        <rect class="hover-band" x="${bx}" y="${padT}" width="${bandW}" height="${plotH}"
              tabindex="0" role="img" data-tip="${esc(tip)}"
              aria-label="${esc((p.fullLabel || p.label) + ': ' + p.value + ' ' + (opts.unit || ''))}" />
        <g class="hover-marker">
          <line class="crosshair" x1="${x(i)}" y1="${padT}" x2="${x(i)}" y2="${padT + plotH}" />
          <circle class="series-dot" cx="${x(i)}" cy="${y(p.value)}" r="5" />
        </g>
      </g>`;
    }).join('');

    body.innerHTML = `
      <svg viewBox="0 0 ${VB_W} ${H}" width="100%" role="img"
           aria-label="${esc(opts.ariaLabel || 'Line chart')}">
        ${grid}
        <line class="axis-line" x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" />
        <path class="series-area" d="${areaPath}" />
        <path class="series-line" d="${linePath}" />
        <circle class="series-dot" cx="${x(points.length - 1)}" cy="${y(last.value)}" r="4.5" />
        ${endLabel}
        ${xLabels}
        ${hits}
      </svg>`;

    wireHits(body);
  }

  // =========================================================================
  // Horizontal bars.
  //
  // `rows` may carry a per-row colour for an ORDERED scale (the partnership
  // tiers, which take a one-hue ordinal ramp so the order is visible in the
  // colour). Nominal categories — towns, say — pass no colour and every bar
  // takes slot 1, because bar length already encodes the value and spending
  // hue on it too would say nothing new.
  // =========================================================================
  function bars(body, opts) {
    const rows = opts.rows || [];
    if (!rows.length) {
      body.innerHTML = '<p class="panel-sub" style="margin:0;">No data yet.</p>';
      return;
    }

    const VB_W = chartWidth(body);
    // Never let the label gutter eat the plot on a narrow card.
    const gutter = Math.round(Math.min(opts.gutter || 120, VB_W * 0.38));
    const labelChars = Math.max(6, Math.floor((gutter - 14) / CHAR_W));
    const padR = 44, padT = 10, padB = 10;
    const band = 34;
    const H = padT + padB + rows.length * band;
    const plotW = VB_W - gutter - padR;
    const max = Math.max(...rows.map((r) => r.value), 1);

    const marks = rows.map((r, i) => {
      const y = padT + i * band + (band - BAR_H) / 2;
      const w = (r.value / max) * plotW;
      const fill = r.color || 'var(--series-1)';
      const tipEnd = gutter + w;

      // Keep the value outside the bar tip unless there's no room there.
      const valueW = String(fmt(r.value)).length * CHAR_W;
      const outside = tipEnd + 8 + valueW <= VB_W;
      const valueMark = outside
        ? `<text class="value-text" x="${tipEnd + 8}" y="${y + BAR_H / 2 + 4}">${fmt(r.value)}</text>`
        : `<text class="value-text-inset" x="${tipEnd - 8}" y="${y + BAR_H / 2 + 4}" text-anchor="end">${fmt(r.value)}</text>`;

      const tip = `<strong>${esc(r.label)}</strong>${fmt(r.value)} ${esc(opts.unit || '')}`;

      return `<g>
        <text class="label-text" x="${gutter - 10}" y="${y + BAR_H / 2 + 4}" text-anchor="end">${esc(truncate(r.label, labelChars))}</text>
        <rect class="bar-hit" x="0" y="${padT + i * band}" width="${VB_W}" height="${band}"
              tabindex="0" role="img" data-tip="${esc(tip)}"
              aria-label="${esc(r.label + ': ' + r.value + ' ' + (opts.unit || ''))}" />
        <path class="bar-mark" d="${hBarPath(gutter, y, w, BAR_H, BAR_R)}" fill="${fill}" />
        ${valueMark}
      </g>`;
    }).join('');

    body.innerHTML = `
      <svg viewBox="0 0 ${VB_W} ${H}" width="100%" role="img"
           aria-label="${esc(opts.ariaLabel || 'Bar chart')}">
        <line class="axis-line" x1="${gutter}" y1="${padT}" x2="${gutter}" y2="${H - padB}" />
        ${marks}
      </svg>`;

    wireHits(body);
  }

  // =========================================================================
  // A single stacked bar for part-to-whole. Segments are separated by a 2px
  // gap in the surface colour — never a stroke — and the whole bar is clipped
  // to one rounded rectangle.
  // =========================================================================
  function stacked(body, opts) {
    const segments = (opts.segments || []).filter((s) => s.value > 0);
    const total = segments.reduce((sum, s) => sum + s.value, 0);

    if (!total) {
      body.innerHTML = '<p class="panel-sub" style="margin:0;">No data yet.</p>';
      return;
    }

    const VB_W = chartWidth(body);
    const H = 44;
    const barH = 28;
    const y = (H - barH) / 2;
    const GAP = 2;
    const id = 'clip-' + String(opts.key || 'stack').replace(/\W/g, '');

    let cursor = 0;
    const marks = segments.map((s, i) => {
      const w = (s.value / total) * VB_W;
      const x = cursor;
      cursor += w;

      // Trim the drawn width so the surface shows through as a 2px gap.
      const drawnW = i < segments.length - 1 ? Math.max(0, w - GAP) : w;
      const pct = Math.round((s.value / total) * 100);
      const label = `${s.label} ${pct}%`;
      const fits = drawnW > label.length * CHAR_W + 20;

      const inset = fits
        ? `<text class="value-text-inset" x="${x + drawnW / 2}" y="${y + barH / 2 + 4}" text-anchor="middle">${esc(label)}</text>`
        : '';

      const tip = `<strong>${esc(s.label)}</strong>${fmt(s.value)} · ${pct}%`;

      return `<rect x="${x}" y="${y}" width="${drawnW}" height="${barH}" fill="${s.color}" clip-path="url(#${id})" />
              ${inset}
              <rect class="bar-hit" x="${x}" y="0" width="${w}" height="${H}"
                    tabindex="0" role="img" data-tip="${esc(tip)}"
                    aria-label="${esc(s.label + ': ' + s.value + ', ' + pct + ' percent')}" />`;
    }).join('');

    body.innerHTML = `
      <svg viewBox="0 0 ${VB_W} ${H}" width="100%" role="img"
           aria-label="${esc(opts.ariaLabel || 'Stacked bar')}">
        <defs><clipPath id="${id}"><rect x="0" y="${y}" width="${VB_W}" height="${barH}" rx="6" /></clipPath></defs>
        ${marks}
      </svg>`;

    wireHits(body);
  }

  // =========================================================================
  // Sparkline for a stat tile — de-emphasised, no axes, no labels.
  // =========================================================================
  function sparkline(values) {
    const pts = values || [];
    if (pts.length < 2) return '';

    const W = 120, H = 28, pad = 2;
    const max = Math.max(...pts, 1);
    const x = (i) => pad + ((W - pad * 2) / (pts.length - 1)) * i;
    const yy = (v) => H - pad - (v / max) * (H - pad * 2);

    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${yy(v)}`).join(' ');
    const lastX = x(pts.length - 1);
    const lastY = yy(pts[pts.length - 1]);

    return `<svg class="stat-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
        <path d="${d}" fill="none" stroke="var(--axis)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="var(--series-1)" stroke="var(--chart-surface)" stroke-width="2" />
      </svg>`;
  }

  // =========================================================================
  // Legend + table twin
  // =========================================================================
  function legend(items) {
    if (!items || items.length < 2) return ''; // one series needs no legend box
    return `<div class="chart-legend">${items.map((i) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${i.color}"></span>${esc(i.label)}</span>`
    ).join('')}</div>`;
  }

  function table(headers, rows) {
    return `<table class="chart-table">
        <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) =>
          `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
  }

  window.Charts = { line, bars, stacked, sparkline, legend, table };
})();
