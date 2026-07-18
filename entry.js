// ============================================================
// RehoSprint — Entry Page Logic (index.html)
// Handles: event PIN lookup -> login / self-registration -> redirect to participant.html
// ============================================================

(() => {
  const tabs = document.querySelectorAll(".tab");
  const forms = {
    join: document.getElementById("form-join"),
    login: document.getElementById("form-login"),
    register: document.getElementById("form-register")
  };

  function switchTab(name) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    Object.entries(forms).forEach(([key, form]) => form.classList.toggle("active", key === name));
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // ----------------------------------------------------------
  // STEP 1: Resolve event PIN -> eventId
  // Requires a lookup index at eventPins/{PIN}: eventId
  // (admin.js writes this when an event is created)
  // ----------------------------------------------------------
  let resolvedEventId = sessionStorage.getItem("rehosprint_eventId") || null;

  forms.join.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = document.getElementById("event-pin").value.trim().toUpperCase();
    if (!pin) return;

    try {
      const snap = await db.ref(`eventPins/${pin}`).get();
      if (!snap.exists()) {
        alert("We couldn't find an event with that PIN. Check the code and try again.");
        return;
      }
      resolvedEventId = snap.val();
      sessionStorage.setItem("rehosprint_eventId", resolvedEventId);
      sessionStorage.setItem("rehosprint_eventPin", pin);
      switchTab("login");
    } catch (err) {
      console.error(err);
      alert("Something went wrong looking up that event. Check your connection and try again.");
    }
  });

  // ----------------------------------------------------------
  // STEP 2a: Log in (existing participant)
  // ----------------------------------------------------------
  forms.login.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = "";

    if (!resolvedEventId) {
      errorEl.textContent = "Please join an event with your PIN first.";
      switchTab("join");
      return;
    }

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      await ensureParticipantRecord(cred.user, resolvedEventId);
      goToParticipant(resolvedEventId);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
    }
  });

  // ----------------------------------------------------------
  // STEP 2b: Register (new participant)
  // ----------------------------------------------------------
  forms.register.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("register-error");
    errorEl.textContent = "";

    if (!resolvedEventId) {
      errorEl.textContent = "Please join an event with your PIN first.";
      switchTab("join");
      return;
    }

    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      await ensureParticipantRecord(cred.user, resolvedEventId, name);
      goToParticipant(resolvedEventId);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
    }
  });

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  async function ensureParticipantRecord(user, eventId, name) {
    const ref = db.ref(`events/${eventId}/participants/${user.uid}`);
    const snap = await ref.get();
    if (!snap.exists()) {
      await ref.set({
        name: name || user.displayName || "Participant",
        email: user.email,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
      });
    }
  }

  function goToParticipant(eventId) {
    window.location.href = `participant.html?event=${eventId}`;
  }

  function friendlyAuthError(err) {
    const code = err && err.code;
    const map = {
      "auth/user-not-found": "No account found with that email/phone. Try registering instead.",
      "auth/wrong-password": "Incorrect password. Try again.",
      "auth/email-already-in-use": "That email/phone is already registered. Try logging in instead.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/weak-password": "Password should be at least 6 characters."
    };
    return map[code] || "Something went wrong. Please try again.";
  }

  // If we already have an event from a previous step this session, skip straight to login
  if (resolvedEventId) switchTab("login");
})();
