// partner-registration.js — handles the public Kingdom Partnership form

const form = document.getElementById('partnerForm');
const formError = document.getElementById('formError');
const formSection = document.getElementById('formSection');
const thankYouSection = document.getElementById('thankYouSection');

const paymentOtherRadio = document.getElementById('paymentOtherRadio');
const paymentOtherText = document.getElementById('paymentOtherText');

// Enable the "Other" text field only when that payment method is chosen
form.querySelectorAll('input[name="payment_method"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isOther = paymentOtherRadio.checked;
    paymentOtherText.disabled = !isOther;
    if (!isOther) paymentOtherText.value = '';
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const data = Object.fromEntries(new FormData(form).entries());
  data.declaration_agreed = form.elements['declaration_agreed'].checked;

  const res = await fetch('/api/partners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    formError.textContent = (body.errors && body.errors.join(' ')) || 'Something went wrong. Please try again.';
    formError.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  formSection.hidden = true;
  thankYouSection.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
