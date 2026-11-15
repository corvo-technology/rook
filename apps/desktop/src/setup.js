(() => {
  const bridge = window.corvoSetup;
  const strings = window.SETUP_STRINGS;
  let locale = "en";
  /** The text for `key` in the chosen language; `{url}` style values are filled from `values`. */
  function t(key, values) {
    let text = (strings[locale] ?? strings.en)[key] ?? strings.en[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {}))
      text = text.replace(`{${name}}`, value);
    return text;
  }
  function applyLocale(code) {
    locale = strings[code] ? code : "en";
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
    document.title = t("title");
    for (const node of document.querySelectorAll("[data-i18n]")) {
      node.textContent = t(node.dataset.i18n);
    }
    for (const node of document.querySelectorAll("[data-i18n-aria]")) {
      node.setAttribute("aria-label", t(node.dataset.i18nAria));
    }
    for (const node of document.querySelectorAll("[data-i18n-title]")) {
      node.setAttribute("title", t(node.dataset.i18nTitle));
    }
  }
  document.documentElement.dataset.platform = bridge?.platform ?? "browser";

  const form = document.getElementById("setup");
  const serverUrl = document.getElementById("server-url");
  const panelNew = document.getElementById("panel-new");
  const panelExisting = document.getElementById("panel-existing");
  const stackSection = document.getElementById("stack");
  const stackPhase = document.getElementById("stack-phase");
  const stackOutput = document.getElementById("stack-output");
  const stackDetails = document.getElementById("stack-details");
  const stackProgress = document.getElementById("stack-progress");
  const stackProgressFill = document.getElementById("stack-progress-fill");
  const status = document.getElementById("status");
  const checkButton = document.getElementById("check");
  const continueButton = document.getElementById("continue");
  const quitButton = document.getElementById("quit");

  const STACK_POLL_MS = 1000;
  const PHASE_KEYS = {
    preparing: "preparing",
    starting: "starting",
    "waiting-healthy": "almost",
    ready: "ready",
  };
  const TERMINAL_PHASES = new Set(["idle", "ready", "failed"]);
  const PHASE_PROGRESS = {
    preparing: 0.15,
    starting: 0.55,
    "waiting-healthy": 0.9,
    ready: 1,
  };

  let defaultLocalUrl = "";
  let cloudUrl = "";
  let stackPolling = false;
  let lastStack = null;
  let lastProgress = 0;
  let detailsOpen = false;
  /** Set when a failure opened the output; a retry closes it again, a person's own click does not. */
  let detailsOpenedByFailure = false;
  /** Resolves the poll wait early when the main process pushes a new state. */
  let wakePoll = null;
  /** Only a press of Continue moves on; a start found already running waits for the person. */
  let continuePressed = false;

  function selectedMode() {
    const checked = form.querySelector('input[name="mode"]:checked');
    return checked === null ? "cloud" : checked.value;
  }

  function setStatus(message, tone) {
    status.textContent = message;
    if (tone === undefined) status.removeAttribute("data-tone");
    else status.setAttribute("data-tone", tone);
  }

  function setBusy(busy) {
    checkButton.disabled = busy;
    continueButton.disabled = busy;
  }

  /** A save in flight cannot be cancelled, so the choice it commits must not change under it. */
  function lockMode(locked) {
    for (const input of form.querySelectorAll('input[name="mode"]')) input.disabled = locked;
  }

  function syncPanels() {
    const mode = selectedMode();
    panelNew.hidden = mode !== "new";
    panelExisting.hidden = mode !== "existing";
    checkButton.hidden = mode !== "existing";
    if (mode !== "new") continueButton.textContent = t("continue");
    setStatus("");
  }

  function progressFor(stack) {
    return PHASE_PROGRESS[stack.phase] ?? 0;
  }

  function renderProgress(stack) {
    const running = stack.phase in PHASE_PROGRESS;
    stackProgress.hidden = !running;
    if (!running) {
      lastProgress = 0;
      stackProgressFill.style.width = "0%";
      return;
    }
    // A retry restarts at its phase; otherwise the bar only ever moves forward.
    lastProgress =
      stack.phase === "preparing" ? progressFor(stack) : Math.max(lastProgress, progressFor(stack));
    const percent = (lastProgress * 100).toFixed(1);
    stackProgressFill.style.width = `${percent}%`;
    stackProgress.setAttribute("aria-valuenow", percent);
  }

  function renderDetails(stack) {
    // A new attempt clears the output, so drop an expansion the person did not ask for.
    if (stack.phase === "preparing" && detailsOpenedByFailure) {
      detailsOpen = false;
      detailsOpenedByFailure = false;
    }
    const hasOutput = stack.output.length > 0;
    // A failure asks the person to read the output, so open it for them.
    if (stack.phase === "failed" && hasOutput && !detailsOpen) {
      detailsOpen = true;
      detailsOpenedByFailure = true;
    }
    stackDetails.hidden = !hasOutput;
    stackDetails.setAttribute("aria-expanded", String(detailsOpen && hasOutput));
    stackOutput.hidden = !(detailsOpen && hasOutput);
    if (!stackOutput.hidden) {
      stackOutput.textContent = stack.output.join("\n");
      stackOutput.scrollTop = stackOutput.scrollHeight;
    }
  }

  function renderStack(stack) {
    lastStack = stack;
    const { phase } = stack;
    stackSection.hidden = phase === "idle";
    if (phase === "idle") {
      continueButton.textContent = t("continue");
      return;
    }
    const failed = phase === "failed";
    stackPhase.textContent = (failed ? stack.message : t(PHASE_KEYS[phase] ?? "preparing")) ?? "";
    if (failed) stackPhase.setAttribute("data-tone", "error");
    else if (phase === "ready") stackPhase.setAttribute("data-tone", "ok");
    else stackPhase.removeAttribute("data-tone");

    renderProgress(stack);
    renderDetails(stack);

    if (phase === "failed") continueButton.textContent = t("retry");
    else continueButton.textContent = t("continue");
    setBusy(!TERMINAL_PHASES.has(phase));
  }

  async function save(mode, url) {
    setBusy(true);
    lockMode(true);
    setStatus(t("connecting"));
    try {
      const saved = await bridge.save({ mode, serverUrl: url });
      if (!saved.ok) setStatus(saved.error ?? t("saveFailed"), "error");
    } catch {
      setStatus(t("saveFailed"), "error");
    } finally {
      lockMode(false);
      setBusy(false);
      continuePressed = false;
    }
  }

  /** Wakes on the next pushed state, and on the timer if a push is ever missed. */
  function waitForStackChange() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (wakePoll === finish) wakePoll = null;
        resolve();
      };
      wakePoll = finish;
      setTimeout(finish, STACK_POLL_MS);
    });
  }

  /**
   * Follows a start already in flight until it settles. Leaving "This computer"
   * ends the follow so the stack becoming ready never saves over that choice.
   */
  async function followStack() {
    if (stackPolling) return;
    stackPolling = true;
    try {
      while (true) {
        const stack = await bridge.stack.state();
        if (stack === null) throw new Error("Setup is not active");
        // Checked after the await: a mode change during it hands the form to the change
        // handler, and a save it started must stay busy and must not be re-rendered over.
        if (selectedMode() !== "new") return;
        renderStack(stack);
        if (TERMINAL_PHASES.has(stack.phase)) {
          if (stack.phase === "ready" && selectedMode() === "new" && continuePressed) {
            const current = await bridge.state();
            if (selectedMode() !== "new") return;
            defaultLocalUrl = current.defaultLocalUrl;
            await save("new", defaultLocalUrl);
          }
          return;
        }
        await waitForStackChange();
      }
    } catch {
      setStatus(t("followFailed"), "error");
      setBusy(false);
    } finally {
      stackPolling = false;
    }
  }

  async function runStack() {
    continuePressed = true;
    setStatus("");
    setBusy(true);
    try {
      // A queued start still reads `idle`; leave the panel as it is and let the follow render it.
      const started = await bridge.stack.start();
      if (started !== null && started.phase !== "idle") renderStack(started);
    } catch {
      setStatus(t("startFailed"), "error");
      setBusy(false);
      return;
    }
    await followStack();
  }

  async function check() {
    const value = serverUrl.value;
    if (value.trim() === "") {
      setStatus(t("enterAddress"), "error");
      return null;
    }

    setBusy(true);
    setStatus(t("checking"));
    try {
      const result = await bridge.test(value);
      if (result.ok) {
        serverUrl.value = result.url;
        setStatus(t("answered", { url: result.url }), "ok");
      } else {
        setStatus(result.error ?? t("connectFailed"), "error");
      }
      return result;
    } catch {
      setStatus(t("connectFailed"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "mode") {
      syncPanels();
      // Unlock Continue/Check immediately; followStack exits on its next poll.
      if (selectedMode() !== "new") setBusy(false);
    }
  });

  checkButton.addEventListener("click", () => {
    void check();
  });

  stackDetails.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    detailsOpenedByFailure = false;
    if (lastStack !== null) renderDetails(lastStack);
  });

  quitButton.addEventListener("click", () => {
    if (bridge === undefined) {
      window.close();
      return;
    }
    void bridge.quit();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = selectedMode();
    if (mode === "new") void runStack();
    // Cloud is an existing server at a fixed address.
    else void save("existing", mode === "cloud" ? cloudUrl : serverUrl.value);
  });

  /** Pushed state keeps progress moving even when the OS throttles this window's timers. */
  function watchStack() {
    bridge.stack.onChange(() => {
      wakePoll?.();
      // A follow that ended on an error restarts here instead of leaving the panel frozen;
      // hold the controls until it has rendered the state it is restarting on.
      if (!stackPolling && selectedMode() === "new") {
        setBusy(true);
        void followStack();
      }
    });
  }

  const languageStep = document.getElementById("step-language");
  const setupStep = document.getElementById("step-setup");
  const languageForm = document.getElementById("language-form");
  const languageList = languageForm.querySelector(".languages");

  const changeLanguage = document.getElementById("change-language");

  function showStep(step) {
    languageStep.hidden = step !== "language";
    setupStep.hidden = step !== "setup";
    changeLanguage.hidden = step !== "setup";
  }

  function buildLanguageList(selected) {
    for (const [code, name] of Object.entries(window.SETUP_LANGUAGES)) {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "language";
      input.value = code;
      input.checked = code === selected;
      const title = document.createElement("span");
      title.className = "choice-title";
      title.textContent = name;
      label.append(input, title);
      languageList.append(label);
    }
    languageList.querySelector("input:checked")?.scrollIntoView({ block: "center" });
  }

  changeLanguage.addEventListener("click", () => {
    // The list holds a hidden legend too, so look for the choices themselves.
    if (languageList.querySelector(".choice") === null) buildLanguageList(locale);
    showStep("language");
  });
  languageForm.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "language") {
      // The window switches to the language as it is picked, so the choice is understood.
      applyLocale(event.target.value);
    }
  });
  languageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void bridge.setLocale(locale);
    showStep("setup");
    syncPanels();
    if (lastStack !== null) renderStack(lastStack);
    continueButton.focus();
  });

  async function init() {
    if (bridge === undefined) {
      showStep("setup");
      setStatus("Setup bridge unavailable.", "error");
      setBusy(true);
      return;
    }

    watchStack();
    // Continue needs the Cloud address and any saved choice before it can submit.
    setBusy(true);
    try {
      const state = await bridge.state();
      if (state === null) throw new Error("Setup is not active");
      // The window follows the system language; the Language button changes it.
      applyLocale(state.locale.saved ?? state.locale.suggested);
      showStep("setup");
      defaultLocalUrl = state.defaultLocalUrl;
      cloudUrl = state.cloudUrl;
      if (state.saved !== null) {
        const savedCloud = state.saved.mode === "existing" && state.saved.serverUrl === cloudUrl;
        const mode = savedCloud ? "cloud" : state.saved.mode;
        const modeInput = document.querySelector(`input[name="mode"][value="${mode}"]`);
        if (modeInput !== null) modeInput.checked = true;
        if (mode === "existing") serverUrl.value = state.saved.serverUrl;
      }
      // A relaunch with the stack down starts it before this window opens; show that
      // attempt instead of the saved mode, and follow it while it is still running.
      const stack = await bridge.stack.state();
      const attached = stack !== null && stack.phase !== "idle";
      if (attached) document.getElementById("mode-new").checked = true;
      syncPanels();
      setBusy(false);
      if (state.error) setStatus(state.error, "error");
      if (attached) {
        renderStack(stack);
        if (!TERMINAL_PHASES.has(stack.phase)) void followStack();
      } else if (selectedMode() === "existing") {
        serverUrl.focus();
      } else {
        continueButton.focus();
      }
    } catch {
      showStep("setup");
      setStatus(t("setupFailed"), "error");
      setBusy(true);
    }
  }

  void init();
})();
