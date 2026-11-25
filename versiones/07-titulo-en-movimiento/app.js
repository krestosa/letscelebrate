"use strict";

(() => {
  const form = document.getElementById("voucher-form");
  const email = document.getElementById("email");
  const phone = document.getElementById("phone");
  const terms = document.getElementById("terms");
  const submit = document.getElementById("claim-button");
  const feedback = document.getElementById("form-feedback");
  const confirmation = document.getElementById("confirmation");
  const codeField = document.getElementById("voucher-code");
  const copyButton = document.getElementById("copy-code");
  const copyFeedback = document.getElementById("copy-feedback");
  const demoNotice = document.getElementById("demo-notice");

  const endpoint = "/api/lets-celebrate/voucher";
  const duplicateMessage = "Ya tenés tu código. Es 1 por persona.";
  const serviceMessage = "No pudimos solicitar tu código. Intentá nuevamente.";
  const demo = location.protocol === "file:" ||
    (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
      new URLSearchParams(location.search).get("demo") === "1");
  const demoKey = "letscelebrate.demo.claims.v1";
  let busy = false;

  demoNotice.hidden = !demo;

  function showFeedback(element, message, kind = "error") {
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
  }

  function normalizePhone(value) {
    const raw = value.trim();
    if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
    let digits = raw.replace(/\D/g, "");
    const international = raw.startsWith("+") || digits.startsWith("00");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (international && !digits.startsWith("54")) {
      return /^[1-9]\d{7,14}$/.test(digits) ? "+" + digits : null;
    }
    if (digits.startsWith("54") && digits.length >= 12) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("9")) digits = digits.slice(1);
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 12) {
      const candidates = [2, 3, 4].filter(i => digits.slice(i, i + 2) === "15");
      if (candidates.length !== 1) return null;
      const i = candidates[0];
      digits = digits.slice(0, i) + digits.slice(i + 2);
    }
    return /^[1-9]\d{9}$/.test(digits) ? "+549" + digits : null;
  }

  async function digest(value) {
    if (!globalThis.crypto?.subtle) throw new Error("Demo storage unavailable");
    const bytes = new TextEncoder().encode("letscelebrate-demo:" + value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  }

  async function claimDemo(data) {
    const keys = await Promise.all([digest("email:" + data.email), digest("phone:" + data.phone)]);
    const claim = () => {
      const previous = JSON.parse(localStorage.getItem(demoKey) || "[]");
      if (!Array.isArray(previous)) throw new Error("Invalid demo storage");
      if (keys.some(key => previous.includes(key))) return { duplicate: true };
      const bytes = crypto.getRandomValues(new Uint8Array(5));
      const code = "DEMO-" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      localStorage.setItem(demoKey, JSON.stringify([...previous, ...keys]));
      return { code };
    };
    return navigator.locks ? navigator.locks.request(demoKey, claim) : claim();
  }

  async function claimReal(data) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      if (response.status === 409) return { duplicate: true };
      if (!response.ok) throw new Error("Voucher request failed");
      const payload = await response.json();
      if (payload.status === "already_claimed") return { duplicate: true };
      if (typeof payload.code !== "string" || !payload.code.trim() ||
          payload.code.length > 128 || /^DEMO-/i.test(payload.code)) {
        throw new Error("Invalid voucher response");
      }
      return { code: payload.code.trim() };
    } finally {
      clearTimeout(timer);
    }
  }

  function setBusy(value) {
    busy = value;
    form.setAttribute("aria-busy", String(value));
    [email, phone, terms, submit].forEach(el => { el.disabled = value; });
    submit.textContent = value ? "Solicitando código…" : "Quiero mi código";
  }

  phone.addEventListener("input", () => phone.setCustomValidity(""));

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    showFeedback(feedback, "");
    const normalizedPhone = normalizePhone(phone.value);
    phone.setCustomValidity(normalizedPhone ? "" : "Ingresá un número de celular válido.");
    if (!form.reportValidity()) return;
    const data = { email: email.value.trim().toLowerCase(), phone: normalizedPhone, acceptedTerms: terms.checked };
    if (!data.acceptedTerms) return;
    setBusy(true);
    try {
      const result = await (demo ? claimDemo(data) : claimReal(data));
      if (result.duplicate) {
        showFeedback(feedback, duplicateMessage);
        return;
      }
      codeField.value = result.code;
      form.reset();
      form.hidden = true;
      confirmation.hidden = false;
      document.getElementById("confirmation-title").focus();
    } catch {
      showFeedback(feedback, serviceMessage);
    } finally {
      setBusy(false);
    }
  });

  copyButton.addEventListener("click", async () => {
    if (!codeField.value) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeField.value);
        copied = true;
      }
    } catch {   }
    if (!copied) {
      codeField.focus();
      codeField.select();
      codeField.setSelectionRange(0, codeField.value.length);
      try { copied = document.execCommand("copy"); } catch {   }
    }
    showFeedback(copyFeedback, copied ? "Código copiado." : "Seleccioná y copiá el código.", copied ? "success" : "error");
  });

  submit.disabled = false;
})();

 
(() => {
  const stage = document.querySelector(".hero__stage");
  const lockup = document.querySelector(".campaign-lockup");
  const title = document.querySelector(".campaign-title");
  const first = document.querySelector(".campaign-word--lets");
  const second = document.querySelector(".campaign-word--celebrate");
  if (!stage || !lockup || !title || !first || !second) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = n => n * n * (3 - 2 * n);
  let geometry, frame = 0, resizeFrame = 0;
  function clear() {
    first.style.transform = second.style.transform = "";
    title.style.removeProperty("--campaign-size");
  }
  function measure() {
    clear();
    const compact = innerWidth <= 720;
    const box = lockup.getBoundingClientRect();
    let a = first.getBoundingClientRect();
    let b = second.getBoundingClientRect();
    if (!box.width || !a.width || !b.width) { geometry = null; return; }
    const naturalSize = parseFloat(getComputedStyle(title).fontSize);
    const initialGap = Math.max(18, Math.min(100, box.width * .07));
    const fit = Math.min(1, compact
      ? box.width / Math.max(a.width, b.width)
      : (box.width - initialGap) / (a.width + b.width));
    if (fit < 1) {
      title.style.setProperty("--campaign-size", (naturalSize * fit) + "px");
      a = first.getBoundingClientRect();
      b = second.getBoundingClientRect();
    }
    const gap = compact
      ? Math.max(4, Math.min(8, innerWidth * .012))
      : Math.max(6, Math.min(14, innerWidth * .006));
    const scale = Math.min(1, (box.width - gap) / (a.width + b.width));
    const aw = a.width * scale, bw = b.width * scale;
    const ah = a.height * scale, bh = b.height * scale;
    const rowHeight = Math.max(ah, bh);
    const left = box.left + (box.width - aw - bw - gap) / 2;
    const top = Math.min(a.top, b.top) + (compact ? Math.min(24, innerWidth * .058) : 0);
    const height = Math.max(stage.offsetHeight, innerHeight);
    geometry = {
      compact, scale, start: scrollY + stage.getBoundingClientRect().top + height * (compact ? .004 : .01),
      distance: height * (compact ? .15 : innerWidth <= 900 ? .17 : .23),
      ax: left - a.left, ay: top + (rowHeight - ah) / 2 - a.top,
      bx: left + aw + gap - b.left, by: top + (rowHeight - bh) / 2 - b.top
    };
  }
  function render() {
    frame = 0;
    if (!geometry || reduced.matches) { first.style.transform = second.style.transform = ""; return; }
    const g = geometry;
    const raw = clamp((scrollY - g.start) / Math.max(1, g.distance));
    const x = g.compact ? ease(clamp(raw / .65)) : ease(raw);
    const y = g.compact ? ease(clamp((raw - .65) / .35)) : ease(raw);
    const scale = 1 + (g.scale - 1) * x;
    first.style.transform = "translate3d(" + (g.ax*x) + "px," + (g.ay*y) + "px,0) scale(" + scale + ")";
    second.style.transform = "translate3d(" + (g.bx*x) + "px," + (g.by*y) + "px,0) scale(" + scale + ")";
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  function refresh() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      measure();
      render();
    });
  }
  addEventListener("scroll", schedule, {passive:true});
  addEventListener("resize", refresh, {passive:true});
  addEventListener("orientationchange", refresh, {passive:true});
  reduced.addEventListener?.("change", refresh);
  document.fonts?.ready.then(refresh).catch(() => {});
  refresh();
})();
