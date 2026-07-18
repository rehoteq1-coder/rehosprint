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

  return {
    calculateScore,
    startCountdown,
    buildLeaderboard,
    JOIN_MODES,
    joinModeLabel,
    SESSION_STATUS,
    generateId,
    formatTime
  };
})();

// Expose globally
window.RehoSprint = RehoSprint;
