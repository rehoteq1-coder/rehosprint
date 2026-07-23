// ============================================================
// RehoSprint — School Registration Logic (register.html)
// Public page, no login required. Signs in anonymously so the
// event-lookup read and school-registration write are permitted
// by Firebase's "auth != null" rules.
// ============================================================

(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");

  if (!eventId) {
    document.body.innerHTML = `<div class="stage"><p class="p-status-text">Missing registration link. Please use the exact link provided by the tournament organizers.</p></div>`;
    return;
  }

  auth.signInAnonymously().then(init).catch((err) => {
    console.error(err);
    $("event-info").innerHTML = `<p class="muted">Couldn't connect. Check your internet connection and refresh.</p>`;
  });

  let eventData = null;

  async function init() {
    const snap = await db.ref(`events/${eventId}`).get();
    if (!snap.exists()) {
      $("event-info").innerHTML = `<p class="muted">This registration link is no longer valid.</p>`;
      return;
    }
    eventData = snap.val();
    $("event-info").innerHTML = `
      <div class="ev-name">${escapeHtml(eventData.name)}</div>
      <div class="ev-meta">Registration open \u00b7 \u20a65,000 fee per school</div>
    `;
    const payInfo = eventData.config && eventData.config.payment_instructions;
    $("payment-instructions").textContent = payInfo || "Pay to the account provided by the organizers, then enter your payment reference below.";
  }

  $("form-register-school").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("reg-error");
    errorEl.textContent = "";

    const schoolName = $("school-name").value.trim();
    const contactPerson = $("contact-person").value.trim();
    const contactPhone = $("contact-phone").value.trim();
    const paymentRef = $("payment-ref").value.trim();

    if (!schoolName || !contactPerson || !contactPhone || !paymentRef) {
      errorEl.textContent = "Please fill in every field before submitting.";
      return;
    }

    try {
      await db.ref(`events/${eventId}/schools`).push({
        schoolName, contactPerson, contactPhone, paymentRef,
        status: "pending",
        registeredAt: firebase.database.ServerValue.TIMESTAMP
      });
      $("form-register-school").classList.remove("active");
      $("form-register-school").style.display = "none";
      $("reg-success").classList.remove("hidden");
      $("reg-success").classList.add("active");
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Something went wrong submitting your registration. Please try again.";
    }
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();
