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

  // Integration contract: same-origin POST, JSON { email, phone, acceptedTerms: true }.
  // Success: HTTP 200/201 { code: "issued-by-commerce-system" }.
  // Duplicate of either identifier: HTTP 409 or { status: "already_claimed" }.
  // The server must atomically enforce uniqueness and issue redeemable vouchers.
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
    } catch { /* Try selection-based clipboard support. */ }
    if (!copied) {
      codeField.focus();
      codeField.select();
      codeField.setSelectionRange(0, codeField.value.length);
      try { copied = document.execCommand("copy"); } catch { /* manual copy */ }
    }
    showFeedback(copyFeedback, copied ? "Código copiado." : "Seleccioná y copiá el código.", copied ? "success" : "error");
  });

  submit.disabled = false;
})();
