// ============================================================
// RehoSprint — Shared Engine
// Timer, scoring, leaderboard logic used across admin/display/participant
// ============================================================

const RehoSprint = (() => {

  // ----------------------------------------------------------
  // SCORING
  // ----------------------------------------------------------
  /**
   * Calculates score for a correct answer.
   * @param {number} basePoints - flat points for a correct answer (event config)
   * @param {boolean} bonusEnabled - whether speed bonus is active for this session
   * @param {number} maxBonus - max bonus points possible (event config)
   * @param {number} timeLimitMs - total time allowed for the question
   * @param {number} answerTimeMs - time taken by participant to answer
   * @returns {number} total points awarded
   */
  function calculateScore({ basePoints = 10, bonusEnabled = false, maxBonus = 5, timeLimitMs, answerTimeMs }) {
    if (!bonusEnabled) return basePoints;
    if (typeof timeLimitMs !== "number" || typeof answerTimeMs !== "number" || timeLimitMs <= 0) {
      return basePoints;
    }
    const fractionRemaining = Math.max(0, (timeLimitMs - answerTimeMs) / timeLimitMs);
    const bonus = Math.round(fractionRemaining * maxBonus);
    return basePoints + bonus;
  }

  // ----------------------------------------------------------
  // TIMER
  // ----------------------------------------------------------
  /**
   * Creates a countdown timer synced to a fixed startedAt server timestamp,
   * so every screen (display + all participants) shows the same countdown
   * regardless of local clock drift.
   *
   * @param {number} startedAt - epoch ms when the question went live (server time)
   * @param {number} durationSeconds - total countdown duration
   * @param {function} onTick - callback(secondsRemaining)
   * @param {function} onEnd - callback() fired once when timer hits 0
   * @returns {function} stop - call to clear the interval
   */
  function startCountdown(startedAt, durationSeconds, onTick, onEnd) {
    let ended = false;
    const intervalId = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = (durationSeconds * 1000) - elapsedMs;
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      onTick(remainingSec);
      if (remainingMs <= 0 && !ended) {
        ended = true;
        clearInterval(intervalId);
        onEnd();
      }
    }, 250);
    return () => clearInterval(intervalId);
  }

  // ----------------------------------------------------------
  // LEADERBOARD
  // ----------------------------------------------------------
  /**
   * Converts a scores object { participantId: { score, name, ... } }
   * into a sorted leaderboard array, highest score first.
   * Ties broken by earliest lastAnswerTime (rewards consistency).
   */
  function buildLeaderboard(scoresObj) {
    if (!scoresObj) return [];
    return Object.entries(scoresObj)
      .map(([participantId, data]) => ({ participantId, ...data }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.lastAnswerTime || Infinity) - (b.lastAnswerTime || Infinity);
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  // ----------------------------------------------------------
  // JOIN MODE HELPERS
  // ----------------------------------------------------------
  const JOIN_MODES = {
    LOCAL_WIFI: "local_wifi",
    SHARED_DEVICES: "shared_devices",
    REMOTE_ONLINE: "remote_online"
  };

  function joinModeLabel(mode) {
    switch (mode) {
      case JOIN_MODES.LOCAL_WIFI: return "Local WiFi (own devices)";
      case JOIN_MODES.SHARED_DEVICES: return "Shared/venue devices";
      case JOIN_MODES.REMOTE_ONLINE: return "Remote/Online";
      default: return "Unknown";
    }
  }

  // ----------------------------------------------------------
  // SESSION STATUS CONSTANTS
  // ----------------------------------------------------------
  const SESSION_STATUS = {
    WAITING: "waiting",
    LIVE: "live",
    REVEAL: "reveal",
    ENDED: "ended"
  };

  // ----------------------------------------------------------
  // UTILITIES
  // ----------------------------------------------------------
  function generateId(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // ----------------------------------------------------------
  // GROUP PLANNING (dynamic — works for any number of schools)
  // ----------------------------------------------------------
  /**
   * Given N activated schools, computes a fair group-stage plan:
   * - numGroups is a power of 2, so the knockout stage that follows
   *   (1 qualifier per group) starts at a clean Round of N.
   * - Groups are sized 3-4 on average (adjustable via targetGroupSize),
   *   split as evenly as possible — some groups get one extra school.
   * Mirrors the same math used for the 200-school example
   * (56 groups of 3 + 8 groups of 4), generalized to any N.
   */
  function computeGroupPlan(n, targetGroupSize = 3.5) {
    if (!n || n < 2) return { numGroups: 0, groupSizes: [], baseSize: 0, groupsWithExtra: 0 };
    let g = Math.pow(2, Math.round(Math.log2(Math.max(1, n / targetGroupSize))));
    g = Math.max(1, Math.min(g, Math.floor(n / 2) || 1));
    while (g > 1 && Math.floor(n / g) < 2) g = g / 2;
    const baseSize = Math.floor(n / g);
    const groupsWithExtra = n % g;
    const groupSizes = [];
    for (let i = 0; i < g; i++) groupSizes.push(i < groupsWithExtra ? baseSize + 1 : baseSize);
    return { numGroups: g, baseSize, groupsWithExtra, groupSizes };
  }

  return {
    calculateScore,
    startCountdown,
    buildLeaderboard,
    JOIN_MODES,
    joinModeLabel,
    SESSION_STATUS,
    generateId,
    formatTime,
    computeGroupPlan
  };
})();

// Expose globally
window.RehoSprint = RehoSprint;
