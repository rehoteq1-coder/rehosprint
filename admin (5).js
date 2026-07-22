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
    const minSchools = parseInt($("ev-min-schools").value, 10);
    const maxSchools = parseInt($("ev-max-schools").value, 10);
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
          timer_seconds: timer,
          min_schools: minSchools,
          max_schools: maxSchools
        }
      });
      await db.ref(`eventPins/${pin}`).set(eventId);
      $("form-create-event").reset();
      $("ev-base-points").value = 10;
      $("ev-max-bonus").value = 5;
      $("ev-timer").value = 20;
      $("ev-min-schools").value = 16;
      $("ev-max-schools").value = 64;
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
    $("active-event-name-schools").textContent = activeEventData.name;
    $("active-event-pin-schools").textContent = activeEventData.pin;
    $("active-event-name-draw").textContent = activeEventData.name;
    $("active-event-pin-draw").textContent = activeEventData.pin;
    unlockEventTabs();
    loadQuestions();
    resetSessionView();
    setupDisplayLinks(eventId);
    setupRegistrationLink(eventId);
    watchSchools(eventId);
    watchDraw(eventId);
    document.querySelector('.nav-btn[data-view="questions"]').click();
  }

  // ----------------------------------------------------------
  // DISPLAY LINK
  // ----------------------------------------------------------
  function setupDisplayLinks(eventId) {
    const displayUrl = `${window.location.origin}${window.location.pathname.replace("admin.html", "")}display.html?event=${eventId}`;
    [$("link-open-display"), $("link-open-display-2"), $("link-open-display-3")].forEach(a => { if (a) a.href = displayUrl; });

    [$("btn-copy-display-link"), $("btn-copy-display-link-2"), $("btn-copy-display-link-3")].forEach(btn => {
      if (!btn) return;
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(displayUrl);
          const original = btn.textContent;
          btn.textContent = "\u2705 Copied!";
          setTimeout(() => { btn.textContent = original; }, 1800);
        } catch (err) {
          prompt("Copy this link manually:", displayUrl);
        }
      };
    });
  }

  // ----------------------------------------------------------
  // SCHOOLS (registration / activation)
  // ----------------------------------------------------------
  function setupRegistrationLink(eventId) {
    const regUrl = `${window.location.origin}${window.location.pathname.replace("admin.html", "")}register.html?event=${eventId}`;
    $("link-open-register").href = regUrl;
    $("btn-copy-register-link").onclick = async () => {
      try {
        await navigator.clipboard.writeText(regUrl);
        const btn = $("btn-copy-register-link");
        const original = btn.textContent;
        btn.textContent = "\u2705 Copied!";
        setTimeout(() => { btn.textContent = original; }, 1800);
      } catch (err) {
        prompt("Copy this link manually:", regUrl);
      }
    };
  }

  let schoolsData = {};
  let currentFilter = "pending";

  function watchSchools(eventId) {
    db.ref(`events/${eventId}/schools`).on("value", (snap) => {
      schoolsData = snap.exists() ? snap.val() : {};
      renderSchoolsSummary();
      renderSchoolsList();
      computeAndRenderPlanPreview();
      if (drawData) renderDrawUI();
    });
  }

  function renderSchoolsSummary() {
    const all = Object.values(schoolsData);
    const activated = all.filter(s => s.status === "activated").length;
    const pending = all.filter(s => s.status === "pending").length;
    $("stat-activated-schools").textContent = activated;
    $("stat-pending-schools").textContent = pending;
    $("stat-total-schools").textContent = all.length;

    const min = activeEventData && activeEventData.config && activeEventData.config.min_schools;
    const max = activeEventData && activeEventData.config && activeEventData.config.max_schools;
    const noteEl = $("schools-target-note");
    if (!min && !max) { noteEl.textContent = ""; return; }

    if (max && activated >= max) {
      noteEl.textContent = `\u2713 Maximum reached (${activated}/${max}) \u2014 consider closing registration.`;
      noteEl.style.color = "#3DFFB0";
    } else if (min && activated < min) {
      noteEl.textContent = `Need at least ${min} activated schools to run the draw \u2014 currently ${activated}/${min}.`;
      noteEl.style.color = "#FFD35C";
    } else {
      noteEl.textContent = `${activated} activated \u00b7 minimum ${min || "\u2014"} \u00b7 maximum ${max || "\u2014"}. Ready to run the draw whenever you close registration.`;
      noteEl.style.color = "";
    }
  }

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderSchoolsList();
    });
  });

  function renderSchoolsList() {
    const listEl = $("schools-list");
    let entries = Object.entries(schoolsData);
    if (currentFilter !== "all") {
      entries = entries.filter(([, s]) => s.status === currentFilter);
    }
    entries.sort((a, b) => (a[1].registeredAt || 0) - (b[1].registeredAt || 0));

    if (!entries.length) {
      listEl.innerHTML = `<p class="muted">No schools in this category yet.</p>`;
      return;
    }

    listEl.innerHTML = entries.map(([id, s]) => `
      <div class="school-row" data-id="${id}">
        <div class="school-row-main">
          <div class="school-row-name">${escapeHtml(s.schoolName)}</div>
          <div class="school-row-meta">${escapeHtml(s.contactPerson)} \u00b7 ${escapeHtml(s.contactPhone)} \u00b7 Ref: ${escapeHtml(s.paymentRef)}</div>
        </div>
        <span class="status-pill ${s.status}">${s.status}</span>
        <div class="school-row-actions">
          ${s.status !== "activated" ? `<button class="btn-small activate-btn">Activate</button>` : ""}
          ${s.status !== "rejected" ? `<button class="btn-small danger reject-btn">Reject</button>` : ""}
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll(".activate-btn").forEach(btn => {
      btn.addEventListener("click", (e) => updateSchoolStatus(e.target.closest(".school-row").dataset.id, "activated"));
    });
    listEl.querySelectorAll(".reject-btn").forEach(btn => {
      btn.addEventListener("click", (e) => updateSchoolStatus(e.target.closest(".school-row").dataset.id, "rejected"));
    });
  }

  async function updateSchoolStatus(schoolId, status) {
    if (!activeEventId) return;
    await db.ref(`events/${activeEventId}/schools/${schoolId}/status`).set(status);
  }

  // ----------------------------------------------------------
  // DRAW
  // ----------------------------------------------------------
  let drawData = null;

  function watchDraw(eventId) {
    db.ref(`events/${eventId}/draw`).on("value", (snap) => {
      drawData = snap.exists() ? snap.val() : null;
      renderDrawUI();
    });
  }

  function computeAndRenderPlanPreview() {
    const activated = Object.values(schoolsData).filter(s => s.status === "activated");
    const n = activated.length;
    $("draw-activated-count").textContent = n;
    const plan = RehoSprint.computeGroupPlan(n);
    const min = activeEventData && activeEventData.config && activeEventData.config.min_schools;

    if (!plan.numGroups) {
      $("draw-plan-summary").textContent = "Not enough activated schools yet to plan groups.";
      $("btn-run-draw").disabled = true;
      return;
    }
    const regular = plan.numGroups - plan.groupsWithExtra;
    let summary = plan.groupsWithExtra > 0
      ? `${plan.numGroups} groups \u2014 ${regular} groups of ${plan.baseSize}, ${plan.groupsWithExtra} groups of ${plan.baseSize + 1}.`
      : `${plan.numGroups} groups of ${plan.baseSize} schools each.`;
    if (min && n < min) {
      summary += ` \u26A0\uFE0F Below your minimum of ${min} \u2014 you can still run the draw, but consider waiting for more registrations.`;
    }
    $("draw-plan-summary").textContent = summary;
    $("btn-run-draw").disabled = false;
  }

  $("btn-run-draw").addEventListener("click", async () => {
    const errorEl = $("draw-run-error");
    errorEl.textContent = "";
    const activatedEntries = Object.entries(schoolsData).filter(([, s]) => s.status === "activated");
    const n = activatedEntries.length;
    const plan = RehoSprint.computeGroupPlan(n);
    if (!plan.numGroups) { errorEl.textContent = "Not enough activated schools."; return; }

    if (!confirm(`Run the live draw now for ${n} activated schools, forming ${plan.numGroups} groups? This should only be done once, live on the day of flag-off.`)) return;

    // Fisher-Yates shuffle for a genuinely fair, unbiased draw
    const shuffled = [...activatedEntries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const groups = {};
    let idx = 0;
    plan.groupSizes.forEach((size, gi) => {
      const groupNum = gi + 1;
      groups[groupNum] = shuffled.slice(idx, idx + size).map(([id]) => id);
      idx += size;
    });

    try {
      await db.ref(`events/${activeEventId}/draw`).set({
        status: "shuffling",
        numGroups: plan.numGroups,
        groupSizes: plan.groupSizes,
        groups,
        revealedGroups: 0,
        totalSchools: n,
        startedAt: firebase.database.ServerValue.TIMESTAMP
      });
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Couldn't save the draw. Check your connection and try again.";
    }
  });

  $("btn-start-reveal").addEventListener("click", async () => {
    await db.ref(`events/${activeEventId}/draw`).update({ status: "revealing", revealedGroups: 1 });
  });

  $("btn-reveal-next-group").addEventListener("click", async () => {
    if (!drawData) return;
    const next = Math.min(drawData.numGroups, (drawData.revealedGroups || 0) + 1);
    const updates = { revealedGroups: next };
    if (next >= drawData.numGroups) updates.status = "complete";
    await db.ref(`events/${activeEventId}/draw`).update(updates);
  });

  $("btn-reset-draw").addEventListener("click", async () => {
    if (!confirm("Reset the draw? This clears all group assignments and cannot be undone.")) return;
    await db.ref(`events/${activeEventId}/draw`).remove();
  });

  function renderDrawUI() {
    if (!drawData) {
      $("draw-setup-card").classList.remove("hidden");
      $("draw-progress-card").classList.add("hidden");
      $("draw-groups-card").classList.add("hidden");
      return;
    }
    $("draw-setup-card").classList.add("hidden");
    $("draw-progress-card").classList.remove("hidden");
    $("draw-groups-card").classList.remove("hidden");

    const statusLabels = {
      shuffling: "\uD83C\uDFB2 Shuffling on the display \u2014 press Start Reveal when the crowd is ready.",
      revealing: `\uD83D\uDCE3 Revealing groups: ${drawData.revealedGroups || 0} of ${drawData.numGroups} shown.`,
      complete: "\u2705 Draw complete \u2014 all groups revealed."
    };
    $("draw-status-text").textContent = statusLabels[drawData.status] || "";

    $("btn-start-reveal").classList.toggle("hidden", drawData.status !== "shuffling");
    $("btn-reveal-next-group").classList.toggle("hidden", drawData.status !== "revealing");

    const revealedCount = drawData.revealedGroups || 0;
    const listEl = $("draw-groups-list");
    const rows = [];
    for (let g = 1; g <= revealedCount; g++) {
      const schoolIds = drawData.groups[g] || [];
      const names = schoolIds.map(id => (schoolsData[id] && schoolsData[id].schoolName) || "Unknown School").join(", ");
      rows.push(`<div class="draw-group-row"><span class="g-num">Group ${g}</span><span class="g-schools">${escapeHtml(names)}</span></div>`);
    }
    listEl.innerHTML = rows.length ? rows.join("") : `<p class="muted">No groups revealed yet.</p>`;
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

  $("ai-subject-select").addEventListener("change", (e) => {
    const customInput = $("ai-subject-custom");
    if (e.target.value === "__other__") {
      customInput.classList.remove("hidden");
      customInput.required = true;
      customInput.focus();
    } else {
      customInput.classList.add("hidden");
      customInput.required = false;
      customInput.value = "";
    }
  });

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

    const selectedSubject = $("ai-subject-select").value;
    const subject = selectedSubject === "__other__" ? $("ai-subject-custom").value.trim() : selectedSubject;
    if (!subject) { errorEl.textContent = "Please select or enter a subject."; btn.disabled = false; btn.textContent = originalLabel; return; }

    const payload = {
      subject,
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
    $("ai-subject-custom").classList.add("hidden");
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
