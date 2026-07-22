// ============================================================
// RehoSprint — Central Display Logic (display.html)
// No login required — signs in anonymously to satisfy Firebase
// read rules (auth != null), then follows the event's active session.
// ============================================================

(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");

  let eventData = null;
  let activeSessionId = null;
  let sessionData = null;
  let lastQuestionId = null;
  let lastRevealedQuestionId = null;
  let stopTimer = null;
  let participantsMap = {};
  let schoolsMap = {};
  let drawBlocking = false;
  let renderedGroupNums = new Set();

  if (!eventId) {
    document.body.innerHTML = `<div class="d-panel active"><p class="d-question-text">Missing event link. Open this display using the URL provided in the admin console.</p></div>`;
    return;
  }

  auth.signInAnonymously().then(init).catch((err) => {
    console.error(err);
    document.body.innerHTML = `<div class="d-panel active"><p class="d-question-text">Couldn't connect. Check your internet connection.</p></div>`;
  });

  async function init() {
    const evSnap = await db.ref(`events/${eventId}`).get();
    if (!evSnap.exists()) {
      document.body.innerHTML = `<div class="d-panel active"><p class="d-question-text">Event not found.</p></div>`;
      return;
    }
    eventData = evSnap.val();
    $("d-event-name").textContent = eventData.name;
    $("d-pin").textContent = eventData.pin;

    db.ref(`events/${eventId}/participants`).on("value", (snap) => {
      participantsMap = snap.exists() ? snap.val() : {};
      $("d-joined-num").textContent = Object.keys(participantsMap).length;
    });

    db.ref(`events/${eventId}/schools`).on("value", (snap) => {
      schoolsMap = snap.exists() ? snap.val() : {};
    });

    db.ref(`events/${eventId}/draw`).on("value", (snap) => {
      const d = snap.val();
      if (d && d.status && d.status !== "complete") {
        drawBlocking = true;
        renderDrawUI(d);
      } else if (drawBlocking) {
        drawBlocking = false;
        renderedGroupNums = new Set();
        render();
      }
    });

    listenForActiveSession();
  }

  function renderDrawUI(d) {
    if (d.status === "shuffling") {
      const names = Object.values(schoolsMap)
        .filter(s => s.status === "activated")
        .map(s => s.schoolName);
      const track = $("draw-marquee-track");
      if (!track.dataset.built) {
        const doubled = [...names, ...names];
        track.innerHTML = doubled.map(n => `<span>${escapeHtml(n)}</span>`).join("");
        track.dataset.built = "1";
      }
      showPanel("d-draw-shuffling");
      return;
    }

    if (d.status === "revealing") {
      $("draw-reveal-progress").textContent = `${d.revealedGroups || 0} / ${d.numGroups} Groups`;
      const board = $("draw-groups-board");
      const revealed = d.revealedGroups || 0;
      for (let g = 1; g <= revealed; g++) {
        if (renderedGroupNums.has(g)) continue;
        renderedGroupNums.add(g);
        const schoolIds = (d.groups && d.groups[g]) || [];
        const card = document.createElement("div");
        card.className = "draw-group-card";
        card.innerHTML = `
          <div class="g-title">Group ${g}</div>
          ${schoolIds.map(id => `<div class="g-school">${escapeHtml((schoolsMap[id] && schoolsMap[id].schoolName) || "School")}</div>`).join("")}
        `;
        board.appendChild(card);
      }
      showPanel("d-draw-revealing");
      return;
    }
  }

  function listenForActiveSession() {
    db.ref(`events/${eventId}/sessions`).orderByChild("createdAt").limitToLast(1).on("value", (snap) => {
      if (!snap.exists()) { showPanel("d-waiting"); return; }
      let newId = null;
      snap.forEach(child => { newId = child.key; });
      if (newId !== activeSessionId) {
        if (activeSessionId) db.ref(`events/${eventId}/sessions/${activeSessionId}`).off();
        activeSessionId = newId;
        db.ref(`events/${eventId}/sessions/${activeSessionId}`).on("value", (s) => {
          sessionData = s.val();
          if (!sessionData) { showPanel("d-waiting"); return; }
          render();
        });
      }
    });
  }

  function showPanel(id) {
    document.querySelectorAll(".d-panel").forEach(p => p.classList.remove("active"));
    $(id).classList.add("active");
  }

  function render() {
    if (drawBlocking) return;
    const status = sessionData.status;
    const cq = sessionData.currentQuestion;

    if (status === RehoSprint.SESSION_STATUS.WAITING || !cq) {
      showPanel("d-waiting");
      return;
    }

    if (status === RehoSprint.SESSION_STATUS.LIVE) {
      if (cq.id !== lastQuestionId) {
        lastQuestionId = cq.id;
        renderLiveQuestion(cq);
      }
      watchAnsweredCount(cq);
      startTimer(cq);
      showPanel("d-live");
      return;
    }

    if (status === RehoSprint.SESSION_STATUS.REVEAL) {
      if (stopTimer) stopTimer();
      renderRevealQuestion(cq);
      if (lastRevealedQuestionId !== cq.id) {
        lastRevealedQuestionId = cq.id;
        renderFastestList(cq);
      }
      showPanel("d-reveal");
      return;
    }

    if (status === RehoSprint.SESSION_STATUS.ENDED) {
      if (stopTimer) stopTimer();
      renderLadder();
      showPanel("d-ended");
    }
  }

  function renderLiveQuestion(cq) {
    $("d-progress").textContent = `Question ${sessionData.currentIndex + 1} of ${sessionData.questionOrder.length}`;
    $("d-question-text").textContent = cq.text;
    const img = $("d-question-image");
    if (cq.imageUrl) { img.src = cq.imageUrl; img.classList.remove("hidden"); }
    else { img.classList.add("hidden"); }
    $("d-options").innerHTML = cq.options.map(opt => `<div>${escapeHtml(opt)}</div>`).join("");
  }

  function renderRevealQuestion(cq) {
    $("d-reveal-progress").textContent = `Question ${sessionData.currentIndex + 1} of ${sessionData.questionOrder.length}`;
    $("d-reveal-question-text").textContent = cq.text;
    $("d-reveal-options").innerHTML = cq.options.map((opt, i) => `
      <div class="${i === cq.correctIndex ? "correct" : ""}">${escapeHtml(opt)}</div>
    `).join("");
  }

  // Reveals participants who answered correctly, fastest first, with a
  // staggered "climb the ladder" animation — slowest appears first (bottom),
  // fastest appears last (top) for a countdown-style suspense build.
  async function renderFastestList(cq) {
    const listEl = $("d-fastest-list");
    listEl.innerHTML = "";

    const snap = await db.ref(`events/${eventId}/sessions/${activeSessionId}/answers/${cq.id}`).get();
    if (!snap.exists()) return;

    const answers = snap.val();
    const correctEntries = Object.entries(answers)
      .filter(([, a]) => a.correct)
      .map(([uid, a]) => ({ uid, ...a }))
      .sort((a, b) => a.answerTimeMs - b.answerTimeMs);

    if (!correctEntries.length) return;

    // Append slowest -> fastest. Container is column-reverse, so the last
    // element appended renders at the top: the fastest answer lands last.
    const appendOrder = [...correctEntries].reverse();

    appendOrder.forEach((entry, i) => {
      const rank = correctEntries.indexOf(entry) + 1;
      const name = (participantsMap[entry.uid] && participantsMap[entry.uid].name) || "Participant";
      const row = document.createElement("div");
      row.className = "d-fastest-row" + (rank === 1 ? " winner" : "");
      row.style.animationDelay = `${i * 0.4}s`;
      row.innerHTML = `
        <span class="d-fastest-rank">#${rank}</span>
        <span class="d-fastest-name">${escapeHtml(name)}</span>
        <span class="d-fastest-time">${(entry.answerTimeMs / 1000).toFixed(1)}s</span>
        <span class="d-fastest-points">+${entry.points}</span>
      `;
      listEl.appendChild(row);
    });
  }

  function watchAnsweredCount(cq) {
    db.ref(`events/${eventId}/sessions/${activeSessionId}/answers/${cq.id}`).on("value", (snap) => {
      const answered = snap.exists() ? Object.keys(snap.val()).length : 0;
      const total = Math.max(1, parseInt($("d-joined-num").textContent, 10) || 1);
      $("d-answered-num").textContent = answered;
      $("d-total-num").textContent = $("d-joined-num").textContent;
      $("d-answered-fill").style.width = `${Math.min(100, (answered / total) * 100)}%`;
    });
  }

  function startTimer(cq) {
    if (stopTimer) stopTimer();
    stopTimer = RehoSprint.startCountdown(cq.startedAt, cq.timeLimit, (sec) => {
      const el = $("d-timer");
      el.textContent = RehoSprint.formatTime(sec);
      el.classList.toggle("urgent", sec <= 5);
    }, () => {});
  }

  async function renderLadder() {
    const snap = await db.ref(`events/${eventId}/sessions/${activeSessionId}/scores`).get();
    const leaderboard = RehoSprint.buildLeaderboard(snap.val());
    const el = $("d-ladder");
    if (!leaderboard.length) {
      el.innerHTML = `<p class="d-question-text">No scores recorded this session.</p>`;
      return;
    }
    el.innerHTML = leaderboard.slice(0, 10).map(entry => `
      <div class="d-ladder-row">
        <span class="d-ladder-rank">#${entry.rank}</span>
        <span class="d-ladder-name">${escapeHtml(entry.name || "Participant")}</span>
        <span class="d-ladder-score">${entry.score} pts</span>
      </div>
    `).join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();
