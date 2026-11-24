(() => {
  "use strict";

  const config = window.QUEUECLASS_CONFIG || {};
  const $ = (selector) => document.querySelector(selector);
  const els = {
    connection: $("#connectionStatus"),
    sessionTitle: $("#sessionTitle"),
    sessionPill: $("#sessionPill"),
    sessionActions: $("#sessionActions"),
    start: $("#startSessionButton"),
    end: $("#endSessionButton"),
    form: $("#messageForm"),
    question: $("#question"),
    initials: $("#initials"),
    submit: $("#submitButton"),
    formNote: $("#formNote"),
    count: $("#messageCount"),
    queue: $("#queueList"),
    charCount: $("#charCount"),
    toast: $("#toastRegion"),
    endDialog: $("#endDialog"),
    confirmEnd: $("#confirmEndButton")
  };

  const TOKEN_STORAGE_KEY = "queueclass.ownerTokens.v1";
  let supabase = null;
  let currentSession = null;
  let messages = [];
  let channel = null;
  let isBusy = false;
  let ownerTokens = readOwnerTokens();

  function readOwnerTokens() {
    try { return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }

  function saveOwnerTokens() {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(ownerTokens));
  }

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type === "error" ? "error" : ""}`;
    node.textContent = message;
    els.toast.append(node);
    window.setTimeout(() => node.remove(), 3600);
  }

  function setConnection(state, label) {
    els.connection.className = `connection ${state}`;
    els.connection.lastElementChild.textContent = label;
  }

  function setBusy(value) {
    isBusy = value;
    updateFormState();
  }

  function updateFormState() {
    const ready = Boolean(currentSession?.active) && !isBusy;
    els.submit.disabled = !ready || !els.question.value.trim() || !els.initials.value.trim();
    els.question.disabled = !currentSession?.active || isBusy;
    els.initials.disabled = !currentSession?.active || isBusy;
    els.formNote.textContent = !currentSession?.active
      ? "Starte zuerst die Unterrichtsstunde."
      : "Deine Meldung erscheint sofort bei allen.";
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function renderSession() {
    const active = Boolean(currentSession?.active);
    els.sessionTitle.textContent = active
      ? (currentSession.name || "Unterricht läuft")
      : "Noch keine Stunde gestartet";
    els.sessionPill.classList.toggle("active", active);
    els.sessionPill.lastChild.textContent = active ? " Aktiv" : " Inaktiv";
    els.sessionActions.hidden = active;
    els.end.hidden = !active;
    updateFormState();
  }

  function renderQueue() {
    const sorted = [...messages].sort((a, b) => {
      const time = new Date(a.created_at) - new Date(b.created_at);
      return time || String(a.id).localeCompare(String(b.id));
    });
    els.count.textContent = String(sorted.length);
    els.queue.replaceChildren();

    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.textContent = "↳";
      const title = document.createElement("strong");
      title.textContent = "Noch keine Meldungen";
      const copy = document.createElement("p");
      copy.textContent = "Die Warteschlange ist momentan leer.";
      empty.append(icon, title, copy);
      els.queue.append(empty);
      return;
    }

    sorted.forEach((message, index) => {
      const item = document.createElement("article");
      item.className = "queue-item";

      const position = document.createElement("div");
      position.className = "queue-position";
      position.textContent = String(index + 1).padStart(2, "0");

      const body = document.createElement("div");
      const question = document.createElement("p");
      question.className = "queue-question";
      question.textContent = message.question;
      const meta = document.createElement("div");
      meta.className = "queue-meta";
      meta.textContent = `${message.initials} · ${formatTime(message.created_at)} Uhr`;
      body.append(question, meta);

      item.append(position, body);

      if (ownerTokens[message.id]) {
        const remove = document.createElement("button");
        remove.className = "remove-button";
        remove.type = "button";
        remove.textContent = "Entfernen";
        remove.setAttribute("aria-label", `Eigene Meldung entfernen: ${message.question}`);
        remove.addEventListener("click", () => deleteMessage(message.id));
        item.append(remove);
      } else {
        const spacer = document.createElement("span");
        spacer.setAttribute("aria-hidden", "true");
        item.append(spacer);
      }
      els.queue.append(item);
    });
  }

  async function invokeFunction(name, body) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      let detail = error.message || "Unbekannter Fehler";
      try {
        const context = error.context;
        if (context && typeof context.json === "function") {
          const payload = await context.json();
          detail = payload.error || detail;
        }
      } catch { /* keep original error */ }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadSession() {
    const { data, error } = await supabase
      .from("lessons")
      .select("id,name,created_at,expires_at,active")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    currentSession = data?.[0] || null;
    renderSession();
    if (currentSession) await loadMessages();
    else {
      messages = [];
      renderQueue();
      subscribeToSessionChanges();
    }
  }

  async function loadMessages() {
    if (!currentSession) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id,lesson_id,question,initials,created_at")
      .eq("lesson_id", currentSession.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    messages = data || [];
    renderQueue();
    subscribeToMessages();
  }

  function removeChannel() {
    if (channel) supabase.removeChannel(channel);
    channel = null;
  }

  function subscribeToSessionChanges() {
    removeChannel();
    channel = supabase.channel("queueclass-session")
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, async () => {
        try { await loadSession(); }
        catch (error) { toast(error.message, "error"); }
      })
      .subscribe();
  }

  function subscribeToMessages() {
    removeChannel();
    channel = supabase.channel(`queueclass-messages-${currentSession.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lesson_id=eq.${currentSession.id}` }, async () => {
        try { await loadMessagesWithoutResubscribe(); }
        catch (error) { toast(error.message, "error"); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, async () => {
        try { await loadSession(); }
        catch (error) { toast(error.message, "error"); }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("connected", "Live verbunden");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("offline", "Verbindung prüfen");
      });
  }

  async function loadMessagesWithoutResubscribe() {
    if (!currentSession) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id,lesson_id,question,initials,created_at")
      .eq("lesson_id", currentSession.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    messages = data || [];
    renderQueue();
  }

  async function createMessage(event) {
    event.preventDefault();
    if (!currentSession || isBusy) return;
    const question = els.question.value.trim();
    const initials = els.initials.value.trim().toUpperCase();
    if (!question || !initials) return;
    if (question.length > 200 || initials.length > 4) {
      toast("Bitte prüfe die Länge deiner Eingabe.", "error");
      return;
    }

    setBusy(true);
    try {
      const result = await invokeFunction("create-message", {
        lesson_id: currentSession.id, question, initials
      });
      ownerTokens[result.message_id] = result.owner_token;
      saveOwnerTokens();
      els.question.value = "";
      els.charCount.textContent = "0 / 200";
      await loadMessagesWithoutResubscribe();
      toast("Deine Meldung wurde hinzugefügt.");
    } catch (error) {
      toast(error.message || "Meldung konnte nicht hinzugefügt werden.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMessage(messageId) {
    const token = ownerTokens[messageId];
    if (!token) return;
    try {
      await invokeFunction("delete-message", { message_id: messageId, owner_token: token });
      delete ownerTokens[messageId];
      saveOwnerTokens();
      await loadMessagesWithoutResubscribe();
      toast("Deine Meldung wurde entfernt.");
    } catch (error) {
      toast(error.message || "Meldung konnte nicht entfernt werden.", "error");
    }
  }

  async function startSession() {
    setBusy(true);
    try {
      const result = await invokeFunction("manage-session", { action: "start", name: "Unterricht" });
      currentSession = result.session;
      renderSession();
      await loadMessages();
      toast("Die Unterrichtssitzung läuft.");
    } catch (error) {
      toast(error.message || "Sitzung konnte nicht gestartet werden.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    els.confirmEnd.disabled = true;
    try {
      await invokeFunction("manage-session", { action: "end", lesson_id: currentSession.id });
      Object.keys(ownerTokens).forEach((id) => {
        if (messages.some((message) => message.id === id)) delete ownerTokens[id];
      });
      saveOwnerTokens();
      currentSession = null;
      messages = [];
      renderSession();
      renderQueue();
      subscribeToSessionChanges();
      els.endDialog.close();
      toast("Die Stunde wurde beendet und die Meldungen gelöscht.");
    } catch (error) {
      toast(error.message || "Sitzung konnte nicht beendet werden.", "error");
    } finally {
      els.confirmEnd.disabled = false;
    }
  }

  function initEvents() {
    els.form.addEventListener("submit", createMessage);
    els.question.addEventListener("input", () => {
      els.charCount.textContent = `${els.question.value.length} / 200`;
      updateFormState();
    });
    els.initials.addEventListener("input", () => {
      const start = els.initials.selectionStart;
      els.initials.value = els.initials.value.replace(/[^a-zA-ZÄÖÜäöüß]/g, "").toUpperCase().slice(0, 4);
      els.initials.setSelectionRange(start, start);
      updateFormState();
    });
    els.start.addEventListener("click", startSession);
    els.end.addEventListener("click", () => els.endDialog.showModal());
    els.confirmEnd.addEventListener("click", (event) => {
      event.preventDefault();
      endSession();
    });
  }

  async function init() {
    initEvents();
    updateFormState();

    if (!config.supabaseUrl || !config.supabaseAnonKey ||
        config.supabaseUrl.includes("YOUR_SUPABASE") ||
        config.supabaseAnonKey.includes("YOUR_SUPABASE")) {
      setConnection("offline", "Setup erforderlich");
      toast("Bitte zuerst js/config.js mit deinen Supabase-Daten ausfüllen.", "error");
      return;
    }
    if (!window.supabase?.createClient) {
      setConnection("offline", "Supabase SDK nicht geladen");
      toast("Supabase konnte nicht geladen werden. Prüfe deine Internetverbindung.", "error");
      return;
    }

    supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } }
    });

    try {
      await loadSession();
      setConnection("connected", "Live verbunden");
    } catch (error) {
      setConnection("offline", "Verbindung fehlgeschlagen");
      toast(error.message || "Verbindung zu Supabase fehlgeschlagen.", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
