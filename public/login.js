// login.js — handles the sign-in form
const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;

  const data = Object.fromEntries(new FormData(form).entries());

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    errorBox.textContent = body.error || 'Could not sign in. Please try again.';
    errorBox.hidden = false;
    return;
  }

  window.location.href = '/app.html';
});
