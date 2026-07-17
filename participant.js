// ============================================================
// RehoSprint — Participant Screen Logic (participant.html)
// ============================================================

(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");

  let eventData = null;
  let currentUser = null;
  let activeSessionId = null;
  let sessionData = null;
  let lastRenderedQuestionId = null;
  let lastRenderedStatus = null;
  let hasAnsweredCurrent = false;
  let stopTimer = null;

  if (!eventId) {
    document.body.innerHTML = `<div class="p-stage"><p class="p-status-text">Missing event link. Please join again from the RehoSprint home page.</p></div>`;
    return;
  }

  // ----------------------------------------------------------
  // AUTH GATE
  // ----------------------------------------------------------
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    currentUser = user;

    const evSnap = await db.ref(`events/${eventId}`).get();
    if (!evSnap.exists()) {
      document.body.innerHTML = `<div class="p-stage"><p class="p-status-text">This event no longer exists.</p></div>`;
      return;
    }
    eventData = evSnap.val();
    $("p-event-name").textContent = eventData.name;
    $("p-participant-name").textContent = `Playing as ${user.displayName || user.email}`;

    listenForActiveSession();
  });

  // ----------------------------------------------------------
  // FIND & FOLLOW THE ACTIVE SESSION
  // ----------------------------------------------------------
  function listenForActiveSession() {
    const sessionsRef = db.ref(`events/${eventId}/sessions`).orderByChild("createdAt").limitToLast(1);
    sessionsRef.on("value", (snap) => {
      if (!snap.exists()) {
        showPanel("p-waiting");
        return;
      }
      let newSessionId = null;
      snap.forEach(child => { newSessionId = child.key; });

      if (newSessionId !== activeSessionId) {
        if (activeSessionId) db.ref(`events/${eventId}/sessions/${activeSessionId}`).off();
        activeSessionId = newSessionId;
        watchSession(activeSessionId);
      }
    });
  }

  function watchSession(sessionId) {
    db.ref(`events/${eventId}/sessions/${sessionId}`).on("value", (snap) => {
      sessionData = snap.val();
      if (!sessionData) { showPanel("p-waiting"); return; }
      handleSessionUpdate();
    });
  }

  // ----------------------------------------------------------
  // RENDER BASED ON STATUS
  // ----------------------------------------------------------
  function handleSessionUpdate() {
    const status = sessionData.status;
    const cq = sessionData.currentQuestion;

    if (status === RehoSprint.SESSION_STATUS.WAITING || !cq) {
      showPanel("p-waiting");
      return;
    }

    if (status === RehoSprint.SESSION_STATUS.LIVE) {
      if (cq.id !== lastRenderedQuestionId) {
        lastRenderedQuestionId = cq.id;
        hasAnsweredCurrent = false;
        renderQuestion(cq);
        checkExistingAnswer(cq);
      }
      showPanel("p-live");
      startPersonalTimer(cq);
      lastRenderedStatus = status;
      return;
    }

    if (status === RehoSprint.SESSION_STATUS.REVEAL) {
      if (lastRenderedStatus !== "reveal" || cq.id !== lastRenderedQuestionId) {
        lastRenderedQuestionId = cq.id;
      }
      renderReveal(cq);
      showPanel("p-reveal");
      lastRenderedStatus = status;
      return;
    }

    if (status === RehoSprint.SESSION_STATUS.ENDED) {
      renderFinal();
      showPanel("p-ended");
      lastRenderedStatus = status;
    }
  }

  function showPanel(id) {
    document.querySelectorAll(".p-panel").forEach(p => p.classList.remove("active"));
    $(id).classList.add("active");
  }

  // ----------------------------------------------------------
  // LIVE QUESTION
  // ----------------------------------------------------------
  function renderQuestion(cq) {
    $("p-progress").textContent = `Question ${sessionData.currentIndex + 1} of ${sessionData.questionOrder.length}`;
    $("p-question-text").textContent = cq.text;

    const img = $("p-question-image");
    if (cq.imageUrl) { img.src = cq.imageUrl; img.classList.remove("hidden"); }
    else { img.classList.add("hidden"); }

    const optionsEl = $("p-options");
    optionsEl.innerHTML = "";
    $("p-locked-msg").classList.add("hidden");
    optionsEl.classList.remove("hidden");

    cq.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "p-option-btn";
      btn.textContent = opt;
      btn.addEventListener("click", () => submitAnswer(cq, i, btn));
      optionsEl.appendChild(btn);
    });
  }

  async function checkExistingAnswer(cq) {
    const snap = await db.ref(`events/${eventId}/sessions/${activeSessionId}/answers/${cq.id}/${currentUser.uid}`).get();
    if (snap.exists()) {
      hasAnsweredCurrent = true;
      lockOptions(snap.val().selectedIndex);
    }
  }

  function lockOptions(selectedIndex) {
    const buttons = Array.from(document.querySelectorAll(".p-option-btn"));
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === selectedIndex) btn.classList.add("selected");
    });
    $("p-locked-msg").classList.remove("hidden");
  }

  async function submitAnswer(cq, selectedIndex, btnEl) {
    if (hasAnsweredCurrent) return;
    hasAnsweredCurrent = true;
    lockOptions(selectedIndex);

    const answerTimeMs = Date.now() - cq.startedAt;
    const correct = selectedIndex === cq.correctIndex;
    const points = correct ? RehoSprint.calculateScore({
      basePoints: eventData.config.base_points,
      bonusEnabled: !!sessionData.bonusEnabled,
      maxBonus: eventData.config.max_bonus,
      timeLimitMs: cq.timeLimit * 1000,
      answerTimeMs
    }) : 0;

    const now = Date.now();
    const updates = {};
    updates[`events/${eventId}/sessions/${activeSessionId}/answers/${cq.id}/${currentUser.uid}`] = {
      selectedIndex, correct, points, answerTimeMs, answeredAt: now
    };
    await db.ref().update(updates);

    // Accumulate score for this participant in this session
    const scoreRef = db.ref(`events/${eventId}/sessions/${activeSessionId}/scores/${currentUser.uid}`);
    await scoreRef.transaction((current) => {
      const prevScore = (current && current.score) || 0;
      return {
        name: currentUser.displayName || currentUser.email,
        score: prevScore + points,
        lastAnswerTime: now
      };
    });
  }

  // ----------------------------------------------------------
  // TIMER
  // ----------------------------------------------------------
  function startPersonalTimer(cq) {
    if (stopTimer) stopTimer();
    stopTimer = RehoSprint.startCountdown(cq.startedAt, cq.timeLimit, (sec) => {
      const el = $("p-timer");
      el.textContent = sec;
      el.classList.toggle("urgent", sec <= 5);
    }, () => {
      $("p-timer").textContent = "0";
    });
  }

  // ----------------------------------------------------------
  // REVEAL
  // ----------------------------------------------------------
  async function renderReveal(cq) {
    if (stopTimer) stopTimer();
    const snap = await db.ref(`events/${eventId}/sessions/${activeSessionId}/answers/${cq.id}/${currentUser.uid}`).get();
    const iconEl = $("p-result-icon");
    const textEl = $("p-result-text");
    const pointsEl = $("p-result-points");

    if (!snap.exists()) {
      iconEl.textContent = "⏱️";
      textEl.textContent = "No answer submitted";
      textEl.className = "p-result-text";
      pointsEl.textContent = "";
      return;
    }
    const answer = snap.val();
    if (answer.correct) {
      iconEl.textContent = "✅";
      textEl.textContent = "Correct!";
      textEl.className = "p-result-text correct";
      pointsEl.textContent = `+${answer.points} points`;
    } else {
      iconEl.textContent = "❌";
      textEl.textContent = "Not quite";
      textEl.className = "p-result-text wrong";
      pointsEl.textContent = "+0 points";
    }
  }

  // ----------------------------------------------------------
  // SESSION ENDED
  // ----------------------------------------------------------
  async function renderFinal() {
    const snap = await db.ref(`events/${eventId}/sessions/${activeSessionId}/scores`).get();
    const leaderboard = RehoSprint.buildLeaderboard(snap.val());
    const mine = leaderboard.find(e => e.participantId === currentUser.uid);

    $("p-rank-badge").textContent = mine ? `#${mine.rank}` : "—";
    $("p-final-score").textContent = `${mine ? mine.score : 0} pts`;

    const listEl = $("p-leaderboard");
    listEl.innerHTML = leaderboard.slice(0, 5).map(entry => `
      <div class="leaderboard-row">
        <span class="leaderboard-rank">#${entry.rank}</span>
        <span class="leaderboard-name">${escapeHtml(entry.name || "Participant")}${entry.participantId === currentUser.uid ? " (you)" : ""}</span>
        <span class="leaderboard-score">${entry.score} pts</span>
      </div>
    `).join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();
