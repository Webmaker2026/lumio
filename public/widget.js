(function () {
  "use strict";

  var scriptTag = document.currentScript;
  if (!scriptTag) {
    var scripts = document.querySelectorAll("script[data-client]");
    scriptTag = scripts[scripts.length - 1];
  }
  if (!scriptTag) return;

  var TENANT_ID = scriptTag.getAttribute("data-client");
  if (!TENANT_ID) {
    console.error("[Lumio] hiányzik a data-client attribútum a script tagen.");
    return;
  }

  var API_BASE;
  try {
    API_BASE = new URL(scriptTag.src).origin;
  } catch (e) {
    console.error("[Lumio] nem sikerült megállapítani a szerver címét.");
    return;
  }

  var SESSION_KEY = "lumio_conv_" + TENANT_ID;
  var REDUCE_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = {
    config: null,
    configPromise: null,
    conversationId: null,
    messages: [], // {role, content}
    panelOpen: false,
    sending: false,
    hintShown: false,
  };

  // --- perzisztencia (sessionStorage, nincs cookie) ---
  function loadSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      state.conversationId = data.conversationId || null;
      state.messages = Array.isArray(data.messages) ? data.messages : [];
    } catch (e) {
      // sessionStorage nem elerheto vagy sérült adat - uj beszelgetes indul
    }
  }

  function saveSession() {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ conversationId: state.conversationId, messages: state.messages })
      );
    } catch (e) {
      // storage megtelt vagy tiltva - a beszelgetes memoriaban megy tovabb
    }
  }

  function newConversationId() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // --- ikonok ---
  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SEND =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

  var CSS =
    ":host{all:initial;}" +
    "*{box-sizing:border-box;}" +
    ".lumio-root{position:fixed;bottom:20px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#2a2a28;}" +
    ".lumio-root.pos-right{right:20px;}" +
    ".lumio-root.pos-left{left:20px;}" +
    ".lumio-launcher{display:flex;align-items:center;gap:8px;height:56px;min-width:56px;padding:0 18px 0 15px;border:none;border-radius:28px;background:var(--lumio-accent,#33403c);color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:width .35s ease,padding .35s ease;overflow:hidden;white-space:nowrap;}" +
    ".lumio-launcher.icon-only{padding:0;width:56px;justify-content:center;}" +
    ".lumio-launcher:focus-visible{outline:2px solid #fff;outline-offset:2px;}" +
    ".lumio-launcher .lumio-label{opacity:1;transition:opacity .25s ease;}" +
    ".lumio-launcher.icon-only .lumio-label{opacity:0;width:0;overflow:hidden;}" +
    "@media (prefers-reduced-motion: reduce){.lumio-launcher{transition:none;}}" +
    ".lumio-panel{position:fixed;bottom:88px;width:380px;max-width:calc(100vw - 32px);height:min(600px,calc(100vh - 120px));background:#faf9f7;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.2);display:flex;flex-direction:column;overflow:hidden;border:1px solid #ece9e4;}" +
    ".lumio-root.pos-right .lumio-panel{right:0;}" +
    ".lumio-root.pos-left .lumio-panel{left:0;}" +
    ".lumio-panel[hidden]{display:none;}" +
    ".lumio-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff;border-bottom:1px solid #ece9e4;}" +
    ".lumio-header h2{margin:0;font-size:15px;font-weight:600;color:#1f1f1d;}" +
    ".lumio-header .lumio-sub{font-size:12.5px;color:#8a8a86;margin-top:2px;}" +
    ".lumio-close{border:none;background:transparent;cursor:pointer;color:#5a5a56;padding:6px;border-radius:8px;display:flex;}" +
    ".lumio-close:hover{background:#f1efeb;}" +
    ".lumio-close:focus-visible{outline:2px solid var(--lumio-accent,#33403c);outline-offset:1px;}" +
    ".lumio-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#faf9f7;}" +
    ".lumio-msg{max-width:85%;padding:9px 13px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;}" +
    ".lumio-msg.user{align-self:flex-end;background:#fff;border:1.5px solid var(--lumio-accent,#33403c);color:#232320;}" +
    ".lumio-msg.assistant{align-self:flex-start;background:#fff;border:1px solid #ece9e4;color:#232320;}" +
    ".lumio-msg.system{align-self:center;background:#f1efeb;color:#5a5a56;font-size:13.5px;text-align:center;border-radius:8px;}" +
    ".lumio-msg a{color:inherit;}" +
    ".lumio-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 13px;}" +
    ".lumio-typing span{width:6px;height:6px;border-radius:50%;background:#b7b3ac;animation:lumio-blink 1.1s infinite ease-in-out;}" +
    ".lumio-typing span:nth-child(2){animation-delay:.15s;}" +
    ".lumio-typing span:nth-child(3){animation-delay:.3s;}" +
    "@keyframes lumio-blink{0%,80%,100%{opacity:.25;}40%{opacity:1;}}" +
    "@media (prefers-reduced-motion: reduce){.lumio-typing span{animation:none;opacity:.7;}}" +
    ".lumio-suggested{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px;}" +
    ".lumio-chip{border:1px solid #ddd9d1;background:#fff;border-radius:16px;padding:6px 12px;font-size:13px;cursor:pointer;color:#3a3a36;}" +
    ".lumio-chip:hover{border-color:var(--lumio-accent,#33403c);}" +
    ".lumio-chip:focus-visible{outline:2px solid var(--lumio-accent,#33403c);outline-offset:1px;}" +
    ".lumio-consent{padding:8px 16px;font-size:12px;color:#7a7a76;display:flex;gap:6px;align-items:flex-start;border-top:1px solid #ece9e4;background:#fff;}" +
    ".lumio-consent a{color:#5a5a56;}" +
    ".lumio-consent input{margin-top:2px;}" +
    ".lumio-composer{display:flex;gap:8px;padding:12px;background:#fff;border-top:1px solid #ece9e4;}" +
    ".lumio-composer textarea{flex:1;resize:none;border:1.5px solid #ddd9d1;border-radius:10px;padding:9px 11px;font:inherit;color:#232320;max-height:100px;min-height:40px;}" +
    ".lumio-composer textarea:focus-visible{outline:2px solid var(--lumio-accent,#33403c);outline-offset:1px;border-color:var(--lumio-accent,#33403c);}" +
    ".lumio-send{border:none;background:var(--lumio-accent,#33403c);color:#fff;border-radius:10px;width:40px;height:40px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;}" +
    ".lumio-send:disabled{opacity:.5;cursor:default;}" +
    ".lumio-send:focus-visible{outline:2px solid var(--lumio-accent,#33403c);outline-offset:2px;}" +
    ".lumio-error-banner{padding:10px 16px;background:#fbeeee;color:#8a3a3a;font-size:13px;border-top:1px solid #f0d6d6;}" +
    ".lumio-error-banner a{color:#8a3a3a;font-weight:600;}" +
    "@media (max-width: 640px){.lumio-panel{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;max-width:100%;height:100%;border-radius:0;}.lumio-root.pos-right .lumio-panel,.lumio-root.pos-left .lumio-panel{right:0;left:0;}.lumio-root{bottom:16px;right:16px;left:auto;}}";

  var root, launcher, panel, messagesEl, composerForm, textarea, sendBtn, consentRow, consentCheckbox, errorBanner, suggestedRow, headerSub;
  var focusablesSelector = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

  function mount() {
    var host = document.createElement("div");
    host.style.all = "initial";
    document.body.appendChild(host);
    var shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    root = document.createElement("div");
    root.className = "lumio-root pos-right";
    shadow.appendChild(root);

    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "lumio-launcher icon-only";
    launcher.setAttribute("aria-label", "Chat megnyitása");
    launcher.innerHTML = ICON_CHAT + '<span class="lumio-label"></span>';
    root.appendChild(launcher);

    panel = document.createElement("div");
    panel.className = "lumio-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Chat ablak");
    panel.hidden = true;
    panel.innerHTML =
      '<div class="lumio-header">' +
      '<div><h2 id="lumio-title">Asszisztens</h2><div class="lumio-sub" id="lumio-sub"></div></div>' +
      '<button type="button" class="lumio-close" aria-label="Bezárás">' + ICON_CLOSE + "</button>" +
      "</div>" +
      '<div class="lumio-messages" role="log" aria-live="polite" aria-label="Beszélgetés"></div>' +
      '<div class="lumio-suggested"></div>' +
      '<div class="lumio-consent" hidden></div>' +
      '<form class="lumio-composer">' +
      '<textarea rows="1" placeholder="Írja ide üzenetét..." aria-label="Üzenet"></textarea>' +
      '<button type="submit" class="lumio-send" aria-label="Küldés">' + ICON_SEND + "</button>" +
      "</form>";
    root.appendChild(panel);

    messagesEl = panel.querySelector(".lumio-messages");
    suggestedRow = panel.querySelector(".lumio-suggested");
    consentRow = panel.querySelector(".lumio-consent");
    composerForm = panel.querySelector(".lumio-composer");
    textarea = panel.querySelector("textarea");
    sendBtn = panel.querySelector(".lumio-send");
    headerSub = panel.querySelector("#lumio-sub");

    launcher.addEventListener("click", onLauncherClick);
    panel.querySelector(".lumio-close").addEventListener("click", closePanel);
    composerForm.addEventListener("submit", onSubmit);
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        composerForm.requestSubmit ? composerForm.requestSubmit() : onSubmit(e);
      }
    });
    textarea.addEventListener("input", autoGrow);
    document.addEventListener("keydown", onGlobalKeydown);

    var scrollTriggered = false;
    window.addEventListener(
      "scroll",
      function () {
        if (scrollTriggered) return;
        scrollTriggered = true;
        ensureConfig().then(showLauncherHintOnce);
      },
      { passive: true, once: true }
    );
  }

  function autoGrow() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + "px";
  }

  function onGlobalKeydown(e) {
    if (e.key === "Escape" && state.panelOpen) {
      closePanel();
    }
    if (e.key === "Tab" && state.panelOpen) {
      trapFocus(e);
    }
  }

  function trapFocus(e) {
    var focusables = Array.prototype.slice.call(panel.querySelectorAll(focusablesSelector));
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = panel.shadowRoot ? panel.shadowRoot.activeElement : document.activeElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // --- launcher "signature" animacio: egyszer, elso gorgetes utan, felkinal-visszahuz ---
  function showLauncherHintOnce() {
    if (state.hintShown || REDUCE_MOTION || !state.config) return;
    state.hintShown = true;
    var label = state.config.theme && state.config.theme.launcherLabel;
    if (!label) return;
    launcher.querySelector(".lumio-label").textContent = label;
    launcher.classList.remove("icon-only");
    setTimeout(function () {
      if (!state.panelOpen) launcher.classList.add("icon-only");
    }, 2600);
  }

  function applyTheme(config) {
    var accent = (config.theme && config.theme.accent) || "#33403c";
    root.style.setProperty("--lumio-accent", accent);
    root.classList.remove("pos-left", "pos-right");
    root.classList.add(config.theme && config.theme.position === "left" ? "pos-left" : "pos-right");
    launcher.setAttribute("aria-label", (config.persona && config.persona.botName) || "Chat megnyitása");
    var title = panel.querySelector("#lumio-title");
    title.textContent = (config.persona && config.persona.botName) || "Asszisztens";
    headerSub.textContent = config.name || "";

    if (config.lead && config.lead.enabled && config.lead.privacyUrl) {
      consentRow.hidden = false;
      consentRow.innerHTML =
        '<input type="checkbox" id="lumio-consent-cb" />' +
        '<label for="lumio-consent-cb">Elérhetőségem megadásával elfogadom az <a href="' +
        encodeURI(config.lead.privacyUrl) +
        '" target="_blank" rel="noopener">adatkezelési tájékoztatót</a>.</label>';
      consentCheckbox = consentRow.querySelector("#lumio-consent-cb");
    }
  }

  // --- config lekerese (lazy - elso gorgetesre vagy kattintasra) ---
  function ensureConfig() {
    if (state.configPromise) return state.configPromise;
    var url = API_BASE + "/api/chat?tenantId=" + encodeURIComponent(TENANT_ID);
    state.configPromise = fetch(url, { method: "GET" })
      .then(function (res) {
        if (!res.ok) throw new Error("config_failed");
        return res.json();
      })
      .then(function (config) {
        state.config = config;
        applyTheme(config);
        return config;
      })
      .catch(function () {
        state.configPromise = null;
        return null;
      });
    return state.configPromise;
  }

  function onLauncherClick() {
    if (state.panelOpen) {
      closePanel();
      return;
    }
    openPanel();
  }

  function openPanel() {
    state.panelOpen = true;
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    ensureConfig().then(function (config) {
      if (!config) {
        renderError("Nem sikerült csatlakozni a szolgáltatáshoz. Kérjük, próbálja meg később.");
        return;
      }
      if (!state.messages.length) {
        addMessage("assistant", config.persona && config.persona.greeting ? config.persona.greeting : "Üdvözlöm!");
        renderSuggested(config.persona && config.persona.suggestedQuestions);
      } else {
        renderMessages();
      }
      textarea.focus();
    });
  }

  function closePanel() {
    state.panelOpen = false;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  function renderSuggested(list) {
    suggestedRow.innerHTML = "";
    if (!list || !list.length || state.messages.length > 1) return;
    list.forEach(function (q) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lumio-chip";
      chip.textContent = q;
      chip.addEventListener("click", function () {
        sendMessage(q);
      });
      suggestedRow.appendChild(chip);
    });
  }

  function clearSuggested() {
    suggestedRow.innerHTML = "";
  }

  function addMessage(role, content) {
    state.messages.push({ role: role, content: content });
    saveSession();
    var el = document.createElement("div");
    el.className = "lumio-msg " + role;
    el.textContent = content;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addSystemMessage(text) {
    var el = document.createElement("div");
    el.className = "lumio-msg system";
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function renderMessages() {
    messagesEl.innerHTML = "";
    state.messages.forEach(function (m) {
      var el = document.createElement("div");
      el.className = "lumio-msg " + m.role;
      el.textContent = m.content;
      messagesEl.appendChild(el);
    });
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    var el = document.createElement("div");
    el.className = "lumio-typing";
    el.setAttribute("aria-label", "Gépel...");
    el.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function renderError(message) {
    if (!errorBanner) {
      errorBanner = document.createElement("div");
      errorBanner.className = "lumio-error-banner";
      panel.insertBefore(errorBanner, composerForm);
    }
    var phone = state.config && state.config.escalation && state.config.escalation.phone;
    errorBanner.innerHTML =
      escapeHtml(message) + (phone ? ' <a href="tel:' + encodeURIComponent(phone) + '">' + escapeHtml(phone) + "</a>" : "");
    errorBanner.hidden = false;
  }

  function clearError() {
    if (errorBanner) errorBanner.hidden = true;
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function onSubmit(e) {
    e.preventDefault();
    var text = textarea.value.trim();
    if (!text || state.sending) return;
    textarea.value = "";
    autoGrow();
    sendMessage(text);
  }

  function sendMessage(text) {
    if (state.sending) return;
    clearSuggested();
    clearError();
    addMessage("user", text);
    state.sending = true;
    sendBtn.disabled = true;

    if (!state.conversationId) state.conversationId = newConversationId();

    var typingEl = showTyping();
    var assistantEl = null;
    var assistantText = "";

    var url = API_BASE + "/api/chat?tenantId=" + encodeURIComponent(TENANT_ID);
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        conversationId: state.conversationId,
        messages: state.messages.map(function (m) {
          return { role: m.role, content: m.content };
        }),
      }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              throw new HttpError(res.status, data);
            });
        }
        if (!res.body) throw new Error("no_stream");
        return readStream(res.body.getReader());
      })
      .then(function () {
        typingEl.remove();
        state.sending = false;
        sendBtn.disabled = false;
        if (assistantText) {
          state.messages.push({ role: "assistant", content: assistantText });
          saveSession();
        }
      })
      .catch(function (err) {
        typingEl.remove();
        state.sending = false;
        sendBtn.disabled = false;
        if (assistantEl && assistantText) {
          state.messages.push({ role: "assistant", content: assistantText });
          saveSession();
        }
        handleSendError(err);
      });

    function readStream(reader) {
      var decoder = new TextDecoder();
      var buffer = "";

      return pump();

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, { stream: true });
          var sepIndex;
          while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
            var rawEvent = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            var line = rawEvent.split("\n").filter(function (l) {
              return l.indexOf("data:") === 0;
            })[0];
            if (!line) continue;
            var jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            var evt;
            try {
              evt = JSON.parse(jsonStr);
            } catch (e) {
              continue;
            }
            if (evt.type === "delta") {
              if (!assistantEl) {
                typingEl.remove();
                assistantEl = addMessageNoSave("assistant", "");
              }
              assistantText += evt.text;
              assistantEl.textContent = assistantText;
              scrollToBottom();
            } else if (evt.type === "error") {
              renderError(evt.message || "Hiba történt.");
            }
          }
          return pump();
        });
      }
    }

    function addMessageNoSave(role, content) {
      var el = document.createElement("div");
      el.className = "lumio-msg " + role;
      el.textContent = content;
      messagesEl.appendChild(el);
      scrollToBottom();
      return el;
    }
  }

  function HttpError(status, data) {
    this.status = status;
    this.data = data || {};
  }

  function handleSendError(err) {
    if (err instanceof HttpError) {
      if (err.status === 429) {
        addSystemMessage(err.data.error || "Túl sok üzenet, kérjük próbálja később.");
        return;
      }
      if (err.status === 400 && err.data.error) {
        addSystemMessage(err.data.error);
        return;
      }
      if (err.status === 404 || err.status === 403) {
        renderError("A szolgáltatás jelenleg nem elérhető ezen az oldalon.");
        return;
      }
    }
    renderError("Hiba történt a kapcsolat közben. Kérjük, próbálja újra.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
