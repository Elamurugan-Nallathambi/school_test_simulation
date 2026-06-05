// Reusable conversational AI reading buddy. Mounts a panel (mic + explain + voice
// toggle + chat) into any container and talks about a given context (passage +
// question + options). Used both in the live test runner and on the results review.
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class Buddy {
  // ctx: { subject, grade, passage:{title,text}|null, questionText, options:[] }
  constructor(ctx) {
    this.ctx = ctx || {};
    this.chat = [];
    this.history = [];
    this.audio = null;
    this.recState = "idle";   // idle | recording | busy
    this.el = null;
  }

  isMuted() { try { return localStorage.getItem("buddyVoice") === "off"; } catch { return false; } }

  panelHtml() {
    return `
      <div class="tutor-controls">
        <button class="tutor-mic buddy-mic" type="button">🎤 Tap to talk</button>
        <button class="tutor-btn sm buddy-explain" type="button">💡 Explain this</button>
        <button class="tutor-btn sm buddy-voice" type="button" title="Voice on or off">${this.isMuted() ? "🔇 Voice off" : "🔊 Voice on"}</button>
        <span class="tutor-state buddy-state"></span>
      </div>
      <div class="tutor-chat buddy-chat"></div>`;
  }

  mount(container) {
    this.el = container;
    container.classList.add("tutor-panel");
    container.innerHTML = this.panelHtml();
    container.querySelector(".buddy-mic").onclick = () => this.toggleRec();
    container.querySelector(".buddy-explain").onclick = () => this.explain();
    container.querySelector(".buddy-voice").onclick = () => this.toggleVoice();
    this.renderChat();
  }

  q(sel) { return this.el ? this.el.querySelector(sel) : null; }
  setState(s) { const e = this.q(".buddy-state"); if (e) e.textContent = s || ""; }
  addChat(role, text) { this.chat.push({ role, text }); this.renderChat(); }
  renderChat() {
    const box = this.q(".buddy-chat");
    if (!box) return;
    box.innerHTML = this.chat.map((m) => `<div class="tc-row ${m.role}"><span class="tc-bubble">${esc(m.text)}</span></div>`).join("");
    box.scrollTop = box.scrollHeight;
  }

  toggleVoice() {
    const muted = !this.isMuted();
    try { localStorage.setItem("buddyVoice", muted ? "off" : "on"); } catch {}
    const b = this.q(".buddy-voice"); if (b) b.textContent = muted ? "🔇 Voice off" : "🔊 Voice on";
    if (muted && this.audio) { try { this.audio.pause(); } catch {} this.audio = null; this.setState(""); }
  }

  stop() {
    if (this.audio) { try { this.audio.pause(); } catch {} this.audio = null; }
    try { if (this.rec && this.rec.state !== "inactive") this.rec.stop(); } catch {}
    try { if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop()); } catch {}
    this.recState = "idle";
  }

  playAudio(buf, onend) {
    try { if (this.audio) this.audio.pause(); } catch {}
    const a = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
    this.audio = a;
    a.onended = () => onend && onend();
    a.play().catch(() => onend && onend());
  }

  body(extra) {
    const p = this.ctx.passage;
    return {
      subject: this.ctx.subject, grade: this.ctx.grade,
      passageTitle: p ? p.title : "", passageText: p ? p.text : "",
      questionText: this.ctx.questionText, options: this.ctx.options || [],
      mute: this.isMuted(), ...extra,
    };
  }

  // Returns { text, audio:ArrayBuffer|null }
  async ask(endpoint, extra) {
    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.body(extra)),
    });
    if (!res.ok) throw new Error("net");
    if (this.isMuted()) { const d = await res.json(); return { text: (d.text || ""), audio: null }; }
    const text = decodeURIComponent(res.headers.get("X-Tutor-Text") || "");
    return { text, audio: await res.arrayBuffer() };
  }

  async explain() {
    if (this.recState !== "idle") return;
    this.recState = "busy"; this.setState("🤔 Your buddy is thinking…");
    try {
      const { text, audio } = await this.ask("/api/tutor", {});
      this.addChat("buddy", text);
      if (audio) { this.setState("🔊 Listening…"); this.playAudio(audio, () => this.setState("")); } else this.setState("");
    } catch { this.netError(); } finally { this.recState = "idle"; }
  }

  toggleRec() { if (this.recState === "recording") this.stopRec(); else if (this.recState === "idle") this.startRec(); }

  async startRec() {
    const mic = this.q(".buddy-mic");
    try { this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { this.setState("Please allow the microphone so you can talk to your buddy."); return; }
    this.recChunks = [];
    try { this.rec = new MediaRecorder(this.micStream); }
    catch { this.setState("This browser can't record — try Chrome."); this.stop(); return; }
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.recChunks.push(e.data); };
    this.rec.onstop = () => this.onRecStop();
    this.rec.start();
    this.recState = "recording";
    if (mic) { mic.textContent = "⏹ Stop & ask"; mic.classList.add("rec"); }
    this.setState("🎙️ Listening to you… tap Stop when done.");
  }

  stopRec() {
    const mic = this.q(".buddy-mic");
    if (mic) { mic.textContent = "🎤 Tap to talk"; mic.classList.remove("rec"); }
    try { if (this.rec && this.rec.state !== "inactive") this.rec.stop(); } catch {}
    try { if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop()); } catch {}
  }

  async onRecStop() {
    const type = (this.rec && this.rec.mimeType) || "audio/webm";
    const blob = new Blob(this.recChunks || [], { type });
    if (blob.size < 800) { this.recState = "idle"; this.setState("I didn't catch that — tap and try again."); return; }
    this.recState = "busy"; this.setState("✍️ Writing down what you said…");
    let said = "";
    try { const r = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": type }, body: blob }); said = ((await r.json()).text || "").trim(); }
    catch { this.recState = "idle"; this.setState("Couldn't hear that — try again."); return; }
    if (!said) { this.recState = "idle"; this.setState("I didn't catch that — tap and try again."); return; }
    this.addChat("kid", said);
    await this.send(said);
    this.recState = "idle";
  }

  async send(message) {
    this.setState("🤔 Your buddy is thinking…");
    try {
      const { text, audio } = await this.ask("/api/chat", { history: this.history, message });
      this.addChat("buddy", text);
      this.history.push({ role: "user", content: message }, { role: "assistant", content: text });
      if (this.history.length > 12) this.history = this.history.slice(-12);
      if (audio) { this.setState("🔊 Listening…"); this.playAudio(audio, () => this.setState("")); } else this.setState("");
    } catch { this.netError(); }
  }

  netError() { this.setState(navigator.onLine ? "Couldn't reach your buddy — try again." : "Connect to the internet to chat."); }
}
