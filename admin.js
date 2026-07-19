// ============================================================
// RehoSprint — Admin Console Logic (admin.html)
// ============================================================
// FIRST-TIME SETUP (Boss T):
// 1. Firebase Console > Authentication > Users > Add user
//    (create your own admin email + password here)
// 2. Copy the User UID shown after creation
// 3. Firebase Console > Realtime Database > add a node:
//      admins/{that-uid} = true
// Only UIDs listed under /admins can access this console.
// ============================================================

(() => {
  // Reuses the same Cloudflare Worker already deployed for lesson-ai.html —
  // no separate Worker needed. It accepts { prompt } and returns text in
  // one of several provider response shapes, handled below.
  const AI_GENERATE_ENDPOINT = "https://lesson-ai.rehoteq.workers.dev";

  let currentUser = null;
  let activeEventId = null;
  let activeEventData = null;
  let questionBank = {}; // { questionId: {...} }
  let aiDraftQuestions = []; // generated-but-not-yet-saved questions
  let stopTimer = null;
  let liveListeners = [];

  const $ = (id) => document.getElementById(id);

  // ----------------------------------------------------------
  // AUTH
  // ----------------------------------------------------------
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      $("admin-login-view").classList.remove("hidden");
      $("admin-dashboard").classList.add("hidden");
      return;
    }
    const adminSnap = await db.ref(`admins/${user.uid}`).get();
    if (!adminSnap.exists()) {
      alert("This account isn't authorized as a RehoSprint host. Contact the platform owner to be granted access.");
      await auth.signOut();
      return;
    }
    currentUser = user;
    $("admin-whoami").textContent = user.email;
    $("admin-login-view").classList.add("hidden");
    $("admin-dashboard").classList.remove("hidden");
    loadEvents();
  });

  $("admin-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("admin-login-error");
    errorEl.textContent = "";
    try {
      await auth.signInWithEmailAndPassword($("admin-email").value.trim(), $("admin-password").value);
    } catch (err) {
      errorEl.textContent = "Login failed. Check your email and password.";
    }
  });

  $("btn-logout").addEventListener("click", () => auth.signOut());

  // ----------------------------------------------------------
  // NAV
  // ----------------------------------------------------------
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      $(`view-${btn.dataset.view}`).classList.add("active");
    });
  });

  function unlockEventTabs() {
    document.querySelectorAll(".nav-btn").forEach(b => b.disabled = false);
  }

  // ----------------------------------------------------------
  // EVENTS
  // ----------------------------------------------------------
  function generatePin() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return `SPR-${code}`;
  }

  $("form-create-event").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("create-event-error");
    errorEl.textContent = "";

    const name = $("ev-name").value.trim();
    const joinMode = $("ev-join-mode").value;
    const basePoints = parseInt($("ev-base-points").value, 10);
    const maxBonus = parseInt($("ev-max-bonus").value, 10);
    const timer = parseInt($("ev-timer").value, 10);
    const pin = generatePin();

    try {
      const eventRef = db.ref("events").push();
      const eventId = eventRef.key;
      await eventRef.set({
        name,
        hostUid: currentUser.uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        pin,
        config: {
          join_mode: joinMode,
          base_points: basePoints,
          max_bonus: maxBonus,
          timer_seconds: timer
        }
      });
      await db.ref(`eventPins/${pin}`).set(eventId);
      $("form-create-event").reset();
      $("ev-base-points").value = 10;
      $("ev-max-bonus").value = 5;
      $("ev-timer").value = 20;
      loadEvents();
      selectEvent(eventId);
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Couldn't create the event. Check your connection and try again.";
    }
  });

  async function loadEvents() {
    const snap = await db.ref("events").orderByChild("hostUid").equalTo(currentUser.uid).get();
    const listEl = $("events-list");
    listEl.innerHTML = "";
    if (!snap.exists()) {
      listEl.innerHTML = `<p class="muted">No events yet — create one to get started.</p>`;
      return;
    }
    const events = [];
    snap.forEach(child => events.push({ id: child.key, ...child.val() }));
    events.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    events.forEach(ev => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <div class="list-item-main">
          <div class="list-item-title">${escapeHtml(ev.name)}</div>
          <div class="list-item-sub">${ev.pin} · ${RehoSprint.joinModeLabel(ev.config?.join_mode)}</div>
        </div>
        <button class="btn-small">Manage</button>
      `;
      row.querySelector("button").addEventListener("click", () => selectEvent(ev.id));
      listEl.appendChild(row);
    });
  }

  async function selectEvent(eventId) {
    activeEventId = eventId;
    const snap = await db.ref(`events/${eventId}`).get();
    activeEventData = snap.val();
    $("active-event-name").textContent = activeEventData.name;
    $("active-event-pin").textContent = activeEventData.pin;
    $("active-event-name-2").textContent = activeEventData.name;
    $("active-event-pin-2").textContent = activeEventData.pin;
    unlockEventTabs();
    loadQuestions();
    resetSessionView();
    setupDisplayLinks(eventId);
    document.querySelector('.nav-btn[data-view="questions"]').click();
  }

  // ----------------------------------------------------------
  // DISPLAY LINK
  // ----------------------------------------------------------
  function setupDisplayLinks(eventId) {
    const displayUrl = `${window.location.origin}${window.location.pathname.replace("admin.html", "")}display.html?event=${eventId}`;
    [$("link-open-display"), $("link-open-display-2")].forEach(a => { if (a) a.href = displayUrl; });

    [$("btn-copy-display-link"), $("btn-copy-display-link-2")].forEach(btn => {
      if (!btn) return;
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(displayUrl);
          const original = btn.textContent;
          btn.textContent = "✅ Copied!";
          setTimeout(() => { btn.textContent = original; }, 1800);
        } catch (err) {
          prompt("Copy this link manually:", displayUrl);
        }
      };
    });
  }

  // ----------------------------------------------------------
  // QUESTIONS
  // ----------------------------------------------------------
  $("form-add-question").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("add-question-error");
    errorEl.textContent = "";
    if (!activeEventId) { errorEl.textContent = "Select an event first."; return; }

    const options = Array.from(document.querySelectorAll(".q-option")).map(i => i.value.trim());
    const correctIndex = parseInt(document.querySelector('input[name="q-correct"]:checked').value, 10);
    const text = $("q-text").value.trim();
    const imageUrl = $("q-image").value.trim();
    const timeLimit = $("q-timer").value ? parseInt($("q-timer").value, 10) : null;

    try {
      await db.ref(`events/${activeEventId}/questions`).push({
        text, options, correctIndex,
        imageUrl: imageUrl || null,
        timeLimit: timeLimit || null
      });
      $("form-add-question").reset();
      document.querySelector('input[name="q-correct"][value="0"]').checked = true;
      loadQuestions();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Couldn't add the question. Try again.";
    }
  });

  $("csv-upload").addEventListener("change", async (e) => {
    const errorEl = $("csv-error");
    errorEl.textContent = "";
    const file = e.target.files[0];
    if (!file || !activeEventId) return;

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      const header = rows[0].map(h => h.trim().toLowerCase());
      const idx = {
        question: header.indexOf("question"),
        a: header.indexOf("optiona"),
        b: header.indexOf("optionb"),
        c: header.indexOf("optionc"),
        d: header.indexOf("optiond"),
        correct: header.indexOf("correct"),
        image: header.indexOf("imageurl"),
        time: header.indexOf("timelimit")
      };
      if ([idx.question, idx.a, idx.b, idx.c, idx.d, idx.correct].some(i => i === -1)) {
        errorEl.textContent = "CSV missing required columns. Need: question, optionA, optionB, optionC, optionD, correct.";
        return;
      }

      const updates = {};
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every(c => !c || !c.trim())) continue;
        const options = [row[idx.a], row[idx.b], row[idx.c], row[idx.d]].map(s => (s || "").trim());
        const correctLetter = (row[idx.correct] || "A").trim().toUpperCase();
        const correctIndex = "ABCD".indexOf(correctLetter);
        const newRef = db.ref(`events/${activeEventId}/questions`).push();
        updates[newRef.key] = {
          text: (row[idx.question] || "").trim(),
          options,
          correctIndex: correctIndex === -1 ? 0 : correctIndex,
          imageUrl: idx.image !== -1 ? (row[idx.image] || "").trim() || null : null,
          timeLimit: idx.time !== -1 && row[idx.time] ? parseInt(row[idx.time], 10) : null
        };
      }
      await db.ref(`events/${activeEventId}/questions`).update(updates);
      $("csv-upload").value = "";
      loadQuestions();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Couldn't parse that CSV. Check the format and try again.";
    }
  });

  // Minimal CSV parser — handles quoted fields with embedded commas
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
          if (c === "\r" && text[i + 1] === "\n") i++;
        } else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  async function loadQuestions() {
    const snap = await db.ref(`events/${activeEventId}/questions`).get();
    questionBank = snap.exists() ? snap.val() : {};
    const listEl = $("questions-list");
    const ids = Object.keys(questionBank);
    $("question-count").textContent = ids.length;
    listEl.innerHTML = "";
    if (!ids.length) {
      listEl.innerHTML = `<p class="muted">No questions yet.</p>`;
      renderSessionPicker();
      return;
    }
    ids.forEach(qid => {
      const q = questionBank[qid];
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <div class="list-item-main">
          <div class="list-item-title">${escapeHtml(q.text)}</div>
          <div class="list-item-sub">Correct: ${escapeHtml(q.options[q.correctIndex] || "")}${q.imageUrl ? " · has image" : ""}</div>
        </div>
        <button class="btn-small danger">Delete</button>
      `;
      row.querySelector("button").addEventListener("click", async () => {
        if (!confirm("Delete this question?")) return;
        await db.ref(`events/${activeEventId}/questions/${qid}`).remove();
        loadQuestions();
      });
      listEl.appendChild(row);
    });
    renderSessionPicker();
  }

  // ----------------------------------------------------------
  // AI QUESTION GENERATION
  // ----------------------------------------------------------
  $("form-ai-generate").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("ai-generate-error");
    errorEl.textContent = "";
    if (!activeEventId) { errorEl.textContent = "Select an event first."; return; }

    const btn = $("btn-ai-generate");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="ai-spinner"></span>Generating...`;

    const payload = {
      subject: $("ai-subject").value.trim(),
      topic: $("ai-topic").value.trim(),
      level: $("ai-level").value,
      difficulty: $("ai-difficulty").value,
      count: Math.max(1, Math.min(20, parseInt($("ai-count").value, 10) || 5))
    };

    const prompt = `Generate ${payload.count} multiple-choice quiz questions for a ${payload.level} audience, ${payload.difficulty} difficulty, on the subject "${payload.subject}"${payload.topic ? `, focused specifically on the topic "${payload.topic}"` : ""}.

Return ONLY a valid JSON array, with no markdown formatting, no code fences, and no preamble or explanation text. Each element must have exactly this shape:
{"text": "question text here", "options": ["option A", "option B", "option C", "option D"], "correctIndex": 0}

Rules:
- correctIndex is 0-based (0 = first option, 3 = last option)
- Exactly 4 options per question
- Only one option should be correct
- Questions must be clear, curriculum-appropriate, and unambiguous
- Vary which option position (0-3) is correct across the set — do not always put the answer first`;

    try {
      const res = await fetch(AI_GENERATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      const rawResponseText = await res.text();
      let data;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        throw new Error("Worker returned an invalid response: " + rawResponseText.substring(0, 100));
      }
      if (data.error) throw new Error(data.error.message || data.error || "API error");

      // Handle multiple possible provider response shapes (same pattern as lesson-ai.html)
      let text = "";
      if (data.choices && data.choices[0] && data.choices[0].message) {
        text = data.choices[0].message.content;
      } else if (data.candidates && data.candidates[0]) {
        text = data.candidates[0].content.parts[0].text;
      } else if (data.content && data.content[0]) {
        text = data.content[0].text;
      } else {
        throw new Error("Empty response from AI. Please try again.");
      }

      text = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error("Couldn't parse the AI's response as question data. Try again.");
      }

      aiDraftQuestions = parsed.map(q => ({
        text: q.text || "",
        options: Array.isArray(q.options) && q.options.length === 4 ? q.options : ["", "", "", ""],
        correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0
      }));
      renderAIReview();
    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message || "Couldn't generate questions. Try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  function renderAIReview() {
    const wrap = $("ai-review-wrap");
    const listEl = $("ai-review-list");
    if (!aiDraftQuestions.length) { wrap.classList.add("hidden"); return; }

    listEl.innerHTML = aiDraftQuestions.map((q, qi) => `
      <div class="ai-review-item" data-index="${qi}">
        <div class="ai-review-item-header">
          <input type="checkbox" class="ai-keep" checked>
          <input type="text" class="ai-text" value="${escapeAttr(q.text)}">
        </div>
        <div class="ai-review-options">
          ${q.options.map((opt, oi) => `
            <div class="option-row">
              <input type="radio" name="ai-correct-${qi}" value="${oi}" ${oi === q.correctIndex ? "checked" : ""}>
              <input type="text" class="ai-option" value="${escapeAttr(opt)}">
            </div>
          `).join("")}
        </div>
      </div>
    `).join("");
    wrap.classList.remove("hidden");
  }

  $("btn-ai-add-selected").addEventListener("click", async () => {
    if (!activeEventId) return;
    const items = Array.from(document.querySelectorAll(".ai-review-item"));
    const updates = {};
    let addedCount = 0;

    items.forEach(item => {
      const keep = item.querySelector(".ai-keep").checked;
      if (!keep) return;
      const text = item.querySelector(".ai-text").value.trim();
      const optionInputs = Array.from(item.querySelectorAll(".ai-option"));
      const options = optionInputs.map(i => i.value.trim());
      const qi = item.dataset.index;
      const correctIndex = parseInt(item.querySelector(`input[name="ai-correct-${qi}"]:checked`).value, 10);
      if (!text || options.some(o => !o)) return;

      const newRef = db.ref(`events/${activeEventId}/questions`).push();
      updates[newRef.key] = { text, options, correctIndex, imageUrl: null, timeLimit: null };
      addedCount++;
    });

    if (!addedCount) { alert("No questions selected to add."); return; }

    await db.ref(`events/${activeEventId}/questions`).update(updates);
    aiDraftQuestions = [];
    $("ai-review-wrap").classList.add("hidden");
    $("form-ai-generate").reset();
    $("ai-difficulty").value = "medium";
    $("ai-count").value = 5;
    loadQuestions();
  });

  function escapeAttr(str) {
    return (str || "").replace(/"/g, "&quot;");
  }

  // ----------------------------------------------------------
  // SESSIONS
  // ----------------------------------------------------------
  function renderSessionPicker() {
    const picker = $("session-question-picker");
    const ids = Object.keys(questionBank);
    if (!ids.length) {
      picker.innerHTML = `<p class="muted">Add questions first.</p>`;
      return;
    }
    picker.innerHTML = ids.map(qid => `
      <label class="picker-row">
        <input type="checkbox" value="${qid}" checked>
        ${escapeHtml(questionBank[qid].text)}
      </label>
    `).join("");
  }

  function resetSessionView() {
    $("session-setup").classList.remove("hidden");
    $("session-live").classList.add("hidden");
    $("session-ended").classList.add("hidden");
    if (stopTimer) { stopTimer(); stopTimer = null; }
    detachLiveListeners();
  }

  let activeSessionId = null;
  let sessionData = null;

  $("btn-start-session").addEventListener("click", async () => {
    const errorEl = $("session-setup-error");
    errorEl.textContent = "";
    const checked = Array.from(document.querySelectorAll("#session-question-picker input:checked")).map(i => i.value);
    if (!checked.length) { errorEl.textContent = "Select at least one question."; return; }

    const bonusEnabled = $("session-bonus-toggle").checked;
    const sessionRef = db.ref(`events/${activeEventId}/sessions`).push();
    activeSessionId = sessionRef.key;
    sessionData = {
      status: RehoSprint.SESSION_STATUS.WAITING,
      questionOrder: checked,
      currentIndex: -1,
      bonusEnabled,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    await sessionRef.set(sessionData);

    $("session-setup").classList.add("hidden");
    $("session-live").classList.remove("hidden");
    attachLiveListeners();
    updateProgressLabel();
  });

  $("btn-next-question").addEventListener("click", async () => {
    if (!sessionData) return;
    const nextIndex = sessionData.currentIndex + 1;
    if (nextIndex >= sessionData.questionOrder.length) {
      alert("No more questions in this session. End the session to see final results.");
      return;
    }
    const qid = sessionData.questionOrder[nextIndex];
    const q = questionBank[qid];
    const timeLimit = q.timeLimit || activeEventData.config.timer_seconds;

    const currentQuestion = {
      id: qid,
      text: q.text,
      options: q.options,
      correctIndex: q.correctIndex,
      imageUrl: q.imageUrl || null,
      timeLimit,
      startedAt: Date.now()
    };

    await db.ref(`events/${activeEventId}/sessions/${activeSessionId}`).update({
      currentIndex: nextIndex,
      currentQuestion,
      status: RehoSprint.SESSION_STATUS.LIVE
    });
  });

  $("btn-reveal").addEventListener("click", async () => {
    await db.ref(`events/${activeEventId}/sessions/${activeSessionId}`).update({
      status: RehoSprint.SESSION_STATUS.REVEAL
    });
  });

  $("btn-end-session").addEventListener("click", async () => {
    if (!confirm("End this session? Final leaderboard will be shown.")) return;
    await db.ref(`events/${activeEventId}/sessions/${activeSessionId}`).update({
      status: RehoSprint.SESSION_STATUS.ENDED
    });
    const scoresSnap = await db.ref(`events/${activeEventId}/sessions/${activeSessionId}/scores`).get();
    const leaderboard = RehoSprint.buildLeaderboard(scoresSnap.val());
    renderFinalLeaderboard(leaderboard);
    $("session-live").classList.add("hidden");
    $("session-ended").classList.remove("hidden");
    detachLiveListeners();
    if (stopTimer) { stopTimer(); stopTimer = null; }
  });

  $("btn-new-session").addEventListener("click", () => {
    activeSessionId = null;
    sessionData = null;
    $("session-ended").classList.add("hidden");
    $("session-setup").classList.remove("hidden");
    renderSessionPicker();
  });

  function attachLiveListeners() {
    const sessionRef = db.ref(`events/${activeEventId}/sessions/${activeSessionId}`);
    const cb = sessionRef.on("value", (snap) => {
      sessionData = snap.val();
      if (!sessionData) return;
      renderLiveState();
    });
    liveListeners.push({ ref: sessionRef, cb });

    const participantsRef = db.ref(`events/${activeEventId}/participants`);
    const pcb = participantsRef.on("value", (snap) => {
      $("stat-total").textContent = snap.exists() ? Object.keys(snap.val()).length : 0;
    });
    liveListeners.push({ ref: participantsRef, cb: pcb });
  }

  function detachLiveListeners() {
    liveListeners.forEach(({ ref, cb }) => ref.off("value", cb));
    liveListeners = [];
  }

  function renderLiveState() {
    const badge = $("session-status-badge");
    badge.textContent = sessionData.status.toUpperCase();
    badge.className = "status-badge " + (sessionData.status === "live" ? "live" : sessionData.status === "reveal" ? "reveal" : "");

    updateProgressLabel();

    const cq = sessionData.currentQuestion;
    if (!cq) {
      $("current-q-text").textContent = "Press \u201cStart / Next Question\u201d to begin.";
      $("current-q-options").innerHTML = "";
      $("stat-answered").textContent = "0";
      $("stat-time").textContent = "--";
      return;
    }

    $("current-q-text").textContent = cq.text;
    $("current-q-options").innerHTML = cq.options.map((opt, i) => `
      <div class="${sessionData.status === 'reveal' && i === cq.correctIndex ? 'correct' : ''}">${escapeHtml(opt)}</div>
    `).join("");

    // Answered count for current question
    db.ref(`events/${activeEventId}/sessions/${activeSessionId}/answers/${cq.id}`).get().then(snap => {
      $("stat-answered").textContent = snap.exists() ? Object.keys(snap.val()).length : 0;
    });

    if (stopTimer) stopTimer();
    if (sessionData.status === "live") {
      stopTimer = RehoSprint.startCountdown(cq.startedAt, cq.timeLimit, (sec) => {
        $("stat-time").textContent = RehoSprint.formatTime(sec);
      }, () => {
        $("stat-time").textContent = "0:00";
      });
    } else {
      $("stat-time").textContent = "--";
    }
  }

  function updateProgressLabel() {
    if (!sessionData) return;
    const total = sessionData.questionOrder.length;
    const current = sessionData.currentIndex + 1;
    $("session-question-progress").textContent = current > 0 ? `Question ${current} of ${total}` : `${total} questions in this session`;
  }

  function renderFinalLeaderboard(leaderboard) {
    const el = $("final-leaderboard");
    if (!leaderboard.length) {
      el.innerHTML = `<p class="muted">No answers were recorded this session.</p>`;
      return;
    }
    el.innerHTML = leaderboard.map(entry => `
      <div class="leaderboard-row">
        <span class="leaderboard-rank">#${entry.rank}</span>
        <span class="leaderboard-name">${escapeHtml(entry.name || "Participant")}</span>
        <span class="leaderboard-score">${entry.score || 0} pts</span>
      </div>
    `).join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();
