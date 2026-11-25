"use strict";

(() => {
  const form = document.getElementById("voucher-form");
  const email = document.getElementById("email");
  const phone = document.getElementById("phone");
  const terms = document.getElementById("terms");
  const submit = document.getElementById("claim-button");
  const feedback = document.getElementById("form-feedback");
  const confirmation = document.getElementById("confirmation");
  const codeButton = document.getElementById("voucher-code");
  const codeText = document.getElementById("voucher-code-text");
  const codeField = document.getElementById("voucher-code-fallback");
  const copyButton = document.getElementById("copy-code");
  const copyFeedback = document.getElementById("copy-feedback");
  const generated = document.getElementById("claim-generated");
  const viewCode = document.getElementById("view-code");
  const dragHandle = document.getElementById("confirmation-drag");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const desktopDialog = matchMedia("(min-width:1025px) and (pointer:fine) and (hover:hover)");

  const endpoint = "/api/lets-celebrate/voucher";
  const duplicateMessage = "Ya tenés tu código. Es 1 por persona.";
  const serviceMessage = "No pudimos solicitar tu código. Intentá nuevamente.";
  const previewHost = location.hostname === "krestosa.github.io" &&
    /^\/letscelebrate(?:\/|$)/.test(location.pathname);
  const localPreview = location.protocol === "file:" ||
    ["localhost","127.0.0.1","[::1]","192.168.1.33"].includes(location.hostname);
  const demo = previewHost || localPreview;
  let busy = false, issuedCode = null;
  let closeTimer = 0, closing = false, drag = null;
  let copyTimer=0, copyVersion=0;

  if (demo) {
    form.autocomplete = "off";
    email.autocomplete = "off";
    phone.autocomplete = "off";
  }

  function clearClosing() {
    clearTimeout(closeTimer);
    closeTimer=0;
    closing=false;
  }
  function clearDrag() {
    const id=drag?.id;
    drag=null;
    if(id!==undefined && dragHandle.hasPointerCapture(id))dragHandle.releasePointerCapture(id);
    delete confirmation.dataset.dragging;
    confirmation.style.removeProperty("transform");
    confirmation.style.removeProperty("--sheet-overlay");
  }
  function openConfirmation() {
    if(!issuedCode)return;
    codeField.value=issuedCode;
    codeField.hidden=true;
    resetCopiedState();
    showFeedback(copyFeedback,"");
    clearClosing();
    clearDrag();
    if(!confirmation.open){
      delete confirmation.dataset.visible;
      confirmation.showModal();
      document.documentElement.classList.add("voucher-modal-open");
      confirmation.getBoundingClientRect();
    }
    confirmation.dataset.visible="";
    document.getElementById("confirmation-title").focus({preventScroll:true});
  }
  function finishClose(){
    if(!closing)return;
    clearClosing();
    if(confirmation.open)confirmation.close();
  }
  function requestClose(){
    if(!confirmation.open||closing)return;
    clearDrag();
    closing=true;
    delete confirmation.dataset.visible;
    if(reducedMotion.matches){finishClose();return;}
    const duration=parseFloat(getComputedStyle(confirmation).getPropertyValue("--sheet-duration"))||500;
    closeTimer=setTimeout(finishClose,duration+80);
  }
  confirmation.addEventListener("transitionend",event=>{
    if(event.target===confirmation&&event.propertyName==="transform"&&!event.pseudoElement&&closing)finishClose();
  });
  confirmation.addEventListener("cancel",event=>{event.preventDefault();requestClose();});
  confirmation.addEventListener("click",event=>{
    if(event.target!==confirmation||drag)return;
    const box=confirmation.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)requestClose();
  });
  confirmation.addEventListener("close",()=>{
    clearClosing();
    clearDrag();
    resetCopiedState();
    delete confirmation.dataset.visible;
    document.documentElement.classList.remove("voucher-modal-open");
    (issuedCode?viewCode:submit).focus({preventScroll:true});
  });
  viewCode.addEventListener("click",openConfirmation);

  dragHandle.addEventListener("pointerdown",event=>{
    if(!confirmation.open||drag||desktopDialog.matches||!event.isPrimary||event.button!==0||reducedMotion.matches)return;
    const style=getComputedStyle(confirmation);
    const offset=style.transform==="none"?0:new DOMMatrixReadOnly(style.transform).m42;
    const height=confirmation.offsetHeight;
    const viewportHeight=document.documentElement.clientHeight;
    const maxOverdrag=Math.min(parseFloat(style.getPropertyValue("--sheet-overdrag"))||40,Math.max(0,viewportHeight-height-8));
    clearClosing();
    confirmation.style.transform="translateY("+offset+"px)";
    confirmation.style.setProperty("--sheet-overlay",String(Math.max(0,1-Math.max(0,offset)/height)));
    confirmation.dataset.dragging="";
    confirmation.dataset.visible="";
    drag={id:event.pointerId,startY:event.clientY,base:offset,y:offset,lastY:event.clientY,lastAt:performance.now(),velocity:0,height,maxOverdrag};
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  dragHandle.addEventListener("pointermove",event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const now=performance.now(),delta=event.clientY-drag.startY;
    const elapsed=now-drag.lastAt;
    if(elapsed>0)drag.velocity=(event.clientY-drag.lastY)/elapsed;
    drag.lastY=event.clientY;drag.lastAt=now;
    const raw=drag.base+delta;
    const limit=drag.maxOverdrag;
    drag.y=raw<0?(limit>0?-limit*(1-Math.exp(raw*.2/limit)):0):Math.min(raw,drag.height+Math.max(0,raw-drag.height)*.2);
    confirmation.style.transform="translateY("+drag.y+"px)";
    confirmation.style.setProperty("--sheet-overlay",String(Math.max(0,Math.min(1,1-drag.y/drag.height))));
  });
  function endDrag(event,cancelled=false){
    if(!drag||event.pointerId!==drag.id)return;
    const current=drag;
    const velocity=performance.now()-current.lastAt<100?current.velocity:0;
    const dismiss=!cancelled&&(current.y>current.height*.42||(current.y>12&&velocity>.11));
    confirmation.getBoundingClientRect();
    clearDrag();
    if(dismiss)requestClose();
  }
  dragHandle.addEventListener("pointerup",event=>endDrag(event));
  dragHandle.addEventListener("pointercancel",event=>endDrag(event,true));
  dragHandle.addEventListener("lostpointercapture",event=>endDrag(event,true));
  desktopDialog.addEventListener("change",()=>{if(drag)clearDrag();});

  function showFeedback(element, message, kind = "error") {
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
  }

  function phoneDialString(value){
    const raw=String(value).trim();
    let digits=raw.replace(/\D/g,"");
    if(raw.startsWith("+"))return "+"+digits;
    if(digits.startsWith("00")&&digits.length>2)return "+"+digits.slice(2);
    if(digits.startsWith("54")&&digits.length>=12)return "+"+digits;
    return digits;
  }
  function formatPhone(value){
    const dial=phoneDialString(value);
    if(!dial||dial==="+")return dial;
    const api=window.libphonenumber;
    if(!api?.AsYouType)return dial;
    const bareMobile=!dial.startsWith("+")&&/^9\d/.test(dial);
    const formatter=new api.AsYouType("AR");
    let formatted=formatter.input(bareMobile?"+54"+dial:dial);
    if(bareMobile)formatted=formatted.replace(/^\+54\s*/,"");
    if(bareMobile||dial.startsWith("+54")||!dial.startsWith("+")){
      if(bareMobile||dial.startsWith("+54")){
        const groups=formatted.split(" ");
        const last=groups.length-1;
        const minGroups=bareMobile?4:dial.startsWith("+549")?5:4;
        if(groups.length>=minGroups){
          if(/^\d{1,4}$/.test(groups[last])&&/^\d{3,4}$/.test(groups[last-1])){
            groups[last-1]+="-"+groups[last];
            groups.pop();formatted=groups.join(" ");
          }
        }
      }else formatted=formatted.replace(/^(0\d{2,4})\s/,"($1) ").replace(/^(\(0\d{2,4}\)|\d{2,4}) 15-/,"$1 15 ");
    }
    return formatted;
  }
  function normalizePhone(value){
    const raw=String(value).trim();
    if(!/^\+?[\d\s().-]+$/.test(raw))return null;
    let dial=phoneDialString(raw);
    if(!dial.startsWith("+")&&/^9\d{10}$/.test(dial))dial="+54"+dial;
    const api=window.libphonenumber;
    if(!api?.parsePhoneNumberFromString)return null;
    const parsed=api.parsePhoneNumberFromString(dial,"AR");
    if(!parsed?.isPossible())return null;
    if(parsed.country==="AR"&&parsed.nationalNumber.length===10){
      return "+549"+parsed.nationalNumber;
    }
    return parsed.number;
  }
  function updatePhoneFormat(){
    phone.setCustomValidity("");
    const before=phone.value;
    const caret=phone.selectionStart??before.length;
    const countBefore=before.slice(0,caret).replace(/\D/g,"").length;
    const formatted=formatPhone(before);
    if(formatted===before)return;
    const removedPrefix=before.replace(/\D/g,"").startsWith("00")&&formatted.startsWith("+")?2:0;
    const digitTarget=Math.max(0,countBefore-removedPrefix);
    phone.value=formatted;
    if(caret===before.length){
      phone.setSelectionRange(formatted.length,formatted.length);
      return;
    }
    let pos=0,digits=0;
    while(pos<formatted.length&&digits<digitTarget){
      if(/\d/.test(formatted[pos]))digits++;
      pos++;
    }
    if(digitTarget===0&&formatted.startsWith("+"))pos=1;
    phone.setSelectionRange(pos,pos);
  }

  function claimDemo() {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return { code: "DEMO-" + Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("").toUpperCase() };
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
      if (response.status === 404 || response.status === 405) throw new Error("voucher-service-unconfigured");
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

  phone.addEventListener("input",updatePhoneFormat);
  phone.addEventListener("blur",updatePhoneFormat);

  const claimSection=form.closest(".claim-section");
  function completeFormEntrance(){claimSection.dataset.entranceComplete="";}
  claimSection.addEventListener("pointerdown",completeFormEntrance,{once:true});
  claimSection.addEventListener("focusin",completeFormEntrance,{once:true});
  claimSection.addEventListener("animationend",event=>{
    if(event.target===form)completeFormEntrance();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    if (issuedCode) { openConfirmation(); return; }
    showFeedback(feedback, "");
    const normalizedPhone = normalizePhone(phone.value);
    phone.setCustomValidity(normalizedPhone ? "" : "Ingresá un número de celular válido.");
    if (!form.reportValidity()) return;
    const data = { email: email.value.trim().toLowerCase(), phone: normalizedPhone, acceptedTerms: terms.checked };
    if (!data.acceptedTerms) return;
    setBusy(true);
    try {
      const result = demo ? claimDemo() : await claimReal(data);
      if (result.duplicate) {
        showFeedback(feedback, duplicateMessage);
        return;
      }
      issuedCode=result.code;
      completeFormEntrance();
      form.reset();
      form.hidden=true;
      generated.hidden=false;
      openConfirmation();
    } catch (error) {
      showFeedback(feedback, error?.message === "voucher-service-unconfigured"
        ? "El servicio de códigos todavía no está configurado." : serviceMessage);
    } finally {
      setBusy(false);
    }
  });

  function resetCopiedState(){
    clearTimeout(copyTimer);
    copyVersion++;
    delete codeButton.dataset.copied;
    codeText.textContent=issuedCode||"";
    codeButton.setAttribute("aria-label","Copiar código "+(issuedCode||""));
    copyFeedback.classList.remove("sr-only");
  }
  function showCopiedState(){
    clearTimeout(copyTimer);
    codeButton.dataset.copied="";
    codeText.textContent="Código copiado";
    codeButton.setAttribute("aria-label","Código copiado. Volver a copiar");
    copyFeedback.classList.add("sr-only");
    showFeedback(copyFeedback,"Código copiado.","success");
    copyTimer=setTimeout(()=>{
      resetCopiedState();
      showFeedback(copyFeedback,"");
    },1800);
  }
  async function copyIssuedCode(event) {
    if(!issuedCode)return;
    const trigger=event.currentTarget;
    const version=++copyVersion;
    clearTimeout(copyTimer);
    let copied=false;
    try {
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(issuedCode);
        copied=true;
      }
    }catch{  }
    if(version!==copyVersion||!confirmation.open)return;
    if(!copied){
      codeField.hidden=false;
      codeField.value=issuedCode;
      codeField.focus({preventScroll:true});
      codeField.select();
      codeField.setSelectionRange(0,issuedCode.length);
      try{copied=document.execCommand("copy");}catch{}
      if(copied){
        codeField.hidden=true;
        trigger.focus({preventScroll:true});
      }
    }
    if(copied){
      codeField.hidden=true;
      showCopiedState();
    }else{
      resetCopiedState();
      showFeedback(copyFeedback,"Seleccioná y copiá el código.","error");
    }
  }
  codeButton.addEventListener("click",copyIssuedCode);
  copyButton.addEventListener("click",copyIssuedCode);

  submit.disabled = false;
})();
