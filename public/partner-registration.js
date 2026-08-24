// partner-registration.js — drives the public Kingdom Partnership wizard.
//
// The form is one <form> split across five .wizard-step sections. Only the
// active step is shown; the payload posted to /api/partners is exactly the
// same shape the single-page version used to send.

(function () {
  'use strict';

  const form = document.getElementById('partnerForm');
  const formError = document.getElementById('formError');
  const thankYouSection = document.getElementById('thankYouSection');
  const wizardProgress = document.getElementById('wizardProgress');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const stepLabels = document.querySelectorAll('#wizardSteps li');
  const steps = Array.from(form.querySelectorAll('.wizard-step'));
  const reviewList = document.getElementById('reviewList');
  const savedNote = document.getElementById('savedNote');
  const submitBtn = document.getElementById('submitBtn');

  const paymentOtherRadio = document.getElementById('paymentOtherRadio');
  const paymentOtherText = document.getElementById('paymentOtherText');

  const DRAFT_KEY = 'ecl-partner-draft';
  let current = 0;

  // =========================================================================
  // Step navigation
  // =========================================================================
  function showStep(index) {
    current = Math.max(0, Math.min(steps.length - 1, index));

    steps.forEach((s, i) => s.classList.toggle('active', i === current));

    stepLabels.forEach((li, i) => {
      li.classList.toggle('is-current', i === current);
      li.classList.toggle('is-done', i < current);
    });

    const pct = Math.round((current / (steps.length - 1)) * 100);
    progressFill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(pct));

    if (current === steps.length - 1) buildReview();

    // Put the reader at the top of the new step, below the sticky bar.
    const behavior = window.UI.reduceMotion.matches ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  }

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-next]')) {
      if (validateStep(current)) showStep(current + 1);
    } else if (e.target.closest('[data-back]')) {
      formError.hidden = true;
      showStep(current - 1);
    }
  });

  // Let a step label jump backwards to a step already completed.
  stepLabels.forEach((li, i) => {
    li.addEventListener('click', () => {
      if (i < current) showStep(i);
    });
  });

  // =========================================================================
  // Validation
  // =========================================================================
  const EMAIL_RE = /^\S+@\S+\.\S+$/;

  function setHint(name, message) {
    const hint = form.querySelector(`[data-hint-for="${name}"]`);
    if (hint) hint.textContent = message || '';
    const input = form.elements[name];
    if (input && input.closest) {
      const field = input.closest('.field');
      if (field) field.classList.toggle('has-error', !!message);
    }
  }

  function validateField(input) {
    const rule = input.dataset.validate;
    const value = (input.value || '').trim();

    if (rule === 'required' && !value) {
      setHint(input.name, input.name === 'signature'
        ? 'Please type your name as your signature.'
        : 'This field is required.');
      return false;
    }
    if (rule === 'email' && value && !EMAIL_RE.test(value)) {
      setHint(input.name, 'That email address looks incomplete.');
      return false;
    }
    setHint(input.name, '');
    return true;
  }

  function validateStep(index) {
    const step = steps[index];
    let ok = true;
    let firstBad = null;

    step.querySelectorAll('[data-validate]').forEach((input) => {
      if (!validateField(input)) {
        ok = false;
        if (!firstBad) firstBad = input;
      }
    });

    // The declaration checkbox lives on the last step only.
    if (index === steps.length - 1) {
      const agreed = form.elements['declaration_agreed'].checked;
      setHint('declaration_agreed', agreed ? '' : 'Please confirm the declaration to submit.');
      if (!agreed) {
        ok = false;
        if (!firstBad) firstBad = form.elements['declaration_agreed'];
      }
    }

    if (!ok && firstBad) {
      firstBad.focus({ preventScroll: true });
      firstBad.scrollIntoView({
        block: 'center',
        behavior: window.UI.reduceMotion.matches ? 'auto' : 'smooth',
      });
    }
    return ok;
  }

  // Clear a field's error as soon as the visitor fixes it.
  form.querySelectorAll('[data-validate]').forEach((input) => {
    input.addEventListener('blur', () => validateField(input));
    input.addEventListener('input', () => {
      if (input.closest('.field').classList.contains('has-error')) validateField(input);
    });
  });

  form.elements['declaration_agreed'].addEventListener('change', (e) => {
    if (e.target.checked) setHint('declaration_agreed', '');
  });

  // =========================================================================
  // Review summary on the final step
  // =========================================================================
  function buildReview() {
    const v = (name) => {
      const el = form.elements[name];
      return el && el.value ? el.value.trim() : '';
    };
    const chosen = (name) => {
      const el = form.querySelector(`input[name="${name}"]:checked`);
      return el ? el.value : '';
    };

    const method = chosen('payment_method');
    const rows = [
      ['Full name', v('full_name')],
      ['Town/City', v('town_city')],
      ['Phone', v('phone')],
      ['Email', v('email')],
      ['Partnership level', chosen('partnership_category')],
      ['Monthly amount', v('monthly_amount') ? 'K' + v('monthly_amount') : ''],
      ['Payment method', method === 'Other' ? `Other: ${v('payment_method_other')}` : method],
    ].filter(([, value]) => value);

    reviewList.innerHTML = rows
      .map(([label, value]) =>
        `<li><span>${window.UI.escapeHTML(label)}</span><span>${window.UI.escapeHTML(value)}</span></li>`)
      .join('');
  }

  // =========================================================================
  // "Other" payment method
  // =========================================================================
  form.querySelectorAll('input[name="payment_method"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isOther = paymentOtherRadio.checked;
      paymentOtherText.disabled = !isOther;
      if (!isOther) paymentOtherText.value = '';
      else paymentOtherText.focus();
    });
  });

  // =========================================================================
  // Character counters
  // =========================================================================
  form.querySelectorAll('[data-counter]').forEach((box) => {
    const out = form.querySelector(`[data-count-for="${box.name}"]`);
    if (!out) return;
    const update = () => {
      const used = box.value.length;
      out.textContent = used ? `${used} / ${box.maxLength} characters` : '';
    };
    box.addEventListener('input', update);
    update();
  });

  // =========================================================================
  // Draft autosave
  //
  // Kept in this browser only — it never leaves the device and is cleared the
  // moment the registration is submitted successfully.
  // =========================================================================
  function collect() {
    const data = {};
    new FormData(form).forEach((value, key) => { data[key] = value; });
    data.declaration_agreed = form.elements['declaration_agreed'].checked;
    return data;
  }

  let saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const draft = collect();
        delete draft.declaration_agreed; // always re-confirmed deliberately
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        savedNote.textContent = 'Your progress is saved on this device.';
      } catch {
        // Storage blocked — the form still works, it just won't be remembered.
      }
    }, 400);
  }

  function restoreDraft() {
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch {
      return;
    }
    if (!draft) return;

    Object.entries(draft).forEach(([key, value]) => {
      if (!value) return;
      const field = form.elements[key];
      if (!field) return;

      if (field instanceof RadioNodeList || (field.length && !field.tagName)) {
        Array.from(field).forEach((r) => { if (r.value === value) r.checked = true; });
      } else if (field.type === 'checkbox') {
        field.checked = !!value;
      } else {
        field.value = value;
      }
    });

    if (paymentOtherRadio.checked) paymentOtherText.disabled = false;
    savedNote.textContent = 'We restored the details you entered earlier.';
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }

  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);

  // =========================================================================
  // Submit
  // =========================================================================
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;

    if (!validateStep(current)) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Submitting…';

    let res;
    try {
      res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect()),
      });
    } catch {
      formError.textContent = 'We could not reach the server. Please check your connection and try again.';
      formError.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit registration';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      formError.textContent = (body.errors && body.errors.join(' ')) || body.error
        || 'Something went wrong. Please try again.';
      formError.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit registration';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    clearDraft();
    form.hidden = true;
    wizardProgress.hidden = true;
    thankYouSection.hidden = false;
    window.scrollTo({ top: 0, behavior: window.UI.reduceMotion.matches ? 'auto' : 'smooth' });
  });

  // ---- Init ---------------------------------------------------------------
  restoreDraft();
  showStep(0);
})();
