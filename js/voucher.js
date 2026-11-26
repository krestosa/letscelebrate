"use strict";

(() => {
  const form = document.getElementById("voucher-form");
  const email = document.getElementById("email");
  const phone = document.getElementById("phone");
  const terms = document.getElementById("terms");
  const submit = document.getElementById("claim-button");
  const feedback = document.getElementById("form-feedback");
  const emailStep = document.getElementById("claim-step-email");
  const phoneStep = document.getElementById("claim-step-phone");
  const stepLabel = document.getElementById("claim-step-label");
  const progressSecond = document.getElementById("claim-progress-second");
  const back = document.getElementById("claim-back");
  let step = 1;
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
  const isPreview = location.protocol === "file:" ||
    (["localhost","127.0.0.1","[::1]"].includes(location.hostname)) ||
    (location.hostname === "krestosa.github.io" && /^\/letscelebrate(?:\/|$)/.test(location.pathname));
  async function claimPreview(){
    const random = new Uint8Array(5);
    crypto.getRandomValues(random);
    const suffix = Array.from(random, value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    return {code:"DEMO-"+suffix};
  }
  if(isPreview){
    const notice = document.createElement("p");
    notice.className = "feedback";
    notice.textContent = "Código de prueba · no canjeable";
    document.getElementById("redeem-instruction").after(notice);
  }
  const duplicateMessage = "Ya tenés tu código. Es 1 por persona.";
  const serviceMessage = "No pudimos solicitar tu código. Intentá nuevamente.";
  let busy = false, issuedCode = null;
  let closeTimer = 0, closing = false, drag = null;
  let copyTimer=0, copyVersion=0;


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

  const countryCodes=new Set("1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 800 808 850 852 853 855 856 870 878 880 881 882 883 886 888 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 979 992 993 994 995 996 998".split(" "));
  const nationalLengths={"1":[10],"7":[10],"34":[9],"33":[9],"44":[10],"49":[10,11],"39":[9,10,11],"351":[9],"54":[10,11],"55":[10,11],"56":[9],"57":[10],"51":[9],"52":[10],"53":[8],"58":[10],"591":[8],"595":[9],"598":[8],"593":[9],"506":[8],"507":[7,8],"502":[8],"503":[8],"504":[8],"505":[8],"509":[8],"61":[9],"64":[8,9,10],"81":[9,10],"82":[9,10],"86":[11],"91":[10]};
  const arThreeDigitAreas=new Set("220 221 223 230 236 237 249 260 261 263 264 266 280 291 294 297 298 299 336 341 342 343 345 348 351 353 358 362 364 370 376 379 380 381 383 385 387 388".split(" "));
  const arNestedAreas=new Set("2202 2942 2945 2946 2948 2972 2982 2983 3435 3436 3437 3438 3454 3455 3456 3458 3482 3483 3487 3489 3532 3533 3537 3582 3583 3584 3585 3832 3835 3837 3838 3854 3855 3856 3857 3858 3873 3876 3877 3878 3885 3886 3887 3888".split(" "));
  function countryCode(digits){
    for(let n=1;n<=Math.min(3,digits.length);n++){const code=digits.slice(0,n);if(countryCodes.has(code))return code;}
    return "";
  }
  function arAreaLength(n){
    if(n.startsWith("11"))return 2;
    if(arNestedAreas.has(n.slice(0,4)))return 4;
    if(arThreeDigitAreas.has(n.slice(0,3)))return 3;
    return 4;
  }
  function arNational(digits){
    let n=digits.replace(/^0/,"");
    if(n.startsWith("9")&&n.length===11)n=n.slice(1);
    if(n.length===12){
      const area=arAreaLength(n);
      if(n.slice(area,area+2)!=="15")return null;
      n=n.slice(0,area)+n.slice(area+2);
    }
    return /^(?:11\d{8}|[23]\d{9})$/.test(n)?n:null;
  }
  function groupDigits(digits,sizes,separator=" "){
    const chunks=[];let offset=0;
    for(const size of sizes){if(offset>=digits.length)break;chunks.push(digits.slice(offset,offset+size));offset+=size;}
    if(offset<digits.length)chunks.push(digits.slice(offset));
    return chunks.join(separator);
  }
  function arDisplay(digits,international=false){
    let n=digits,lead=international?"+54 ":"";
    if(n.startsWith("9")&&(international||n.length>=3)){lead+="9 ";n=n.slice(1);}
    const trunk=n.startsWith("0");
    if(trunk)n=n.slice(1);
    if(!n)return (lead+(trunk?"0":"")).trimEnd();
    const areaSize=arAreaLength(n);
    if(n.length<areaSize)return lead+(trunk?"0":"")+n;
    const area=n.slice(0,areaSize);
    let tail=n.slice(areaSize),marker="";
    if(!international&&tail.startsWith("15")&&tail.length>10-areaSize){marker="15 ";tail=tail.slice(2);}
    const first=10-areaSize-4;
    const subscriber=tail.length>first?tail.slice(0,first)+"-"+tail.slice(first):tail;
    return (lead+(trunk?"(0"+area+")":area)+(marker||subscriber?" "+marker+subscriber:"")).trimEnd();
  }
  function internationalDisplay(code,n){
    if(code==="54")return n?arDisplay(n,true):"+54";
    let formatted;
    if(code==="1")formatted=groupDigits(n,[3,3,4],"-");
    else if(code==="55")formatted=n.length>2?"("+n.slice(0,2)+") "+groupDigits(n.slice(2),[n.length>10?5:4,4],"-"):n;
    else if(code==="56")formatted=groupDigits(n,[1,4,4]);
    else if(code==="598")formatted=groupDigits(n,[2,3,3]);
    else if(code==="34"||code==="51"||code==="351")formatted=groupDigits(n,[3,3,3]);
    else if(code==="52"||code==="57")formatted=groupDigits(n,[3,3,4]);
    else if(code==="44")formatted=groupDigits(n,n.startsWith("7")?[4,6]:[2,4,4]);
    else if(code==="81"&&n.length===10)formatted=groupDigits(n,[2,4,4]);
    else if(code==="33")formatted=groupDigits(n,[1,2,2,2,2]);
    else formatted=groupDigits(n,[3,3,4]);
    return "+"+code+(formatted?" "+formatted:"");
  }
  function phoneParts(value){
    const raw=String(value).trim();
    if(!/^\+?[\d\s().-]*$/.test(raw))return null;
    let digits=raw.replace(/\D/g,"");
    const explicit=raw.startsWith("+")||digits.startsWith("00");
    if(!raw.startsWith("+")&&digits.startsWith("00"))digits=digits.slice(2);
    return {digits,explicit};
  }
  function normalizePhone(value){
    const parts=phoneParts(value);
    if(!parts)return null;
    const {digits,explicit}=parts;
    if(!digits||digits.length>16)return null;
    const normalizeInternational=(code,n)=>{
      if(!code)return null;
      if(code==="54"){
        const national=arNational(n);
        return national?"+549"+national:null;
      }
      const lengths=nationalLengths[code];
      if(lengths?!lengths.includes(n.length):n.length<5||n.length>15-code.length)return null;
      return "+"+code+n;
    };
    if(explicit){const code=countryCode(digits);return normalizeInternational(code,digits.slice(code.length));}
    if(digits.startsWith("54")&&digits.length>=12){const normalized=normalizeInternational("54",digits.slice(2));if(normalized)return normalized;}
    const national=arNational(digits);
    if(national)return "+549"+national;
    if(digits.length>10&&!digits.startsWith("0")){
      const code=countryCode(digits);
      if(code&&nationalLengths[code]?.includes(digits.length-code.length))return normalizeInternational(code,digits.slice(code.length));
    }
    return null;
  }
  function formatPhone(value,complete=false){
    const parts=phoneParts(value);
    if(!parts)return value;
    if(complete){const normalized=normalizePhone(value);if(normalized){const digits=normalized.slice(1),code=countryCode(digits);return internationalDisplay(code,digits.slice(code.length));}}
    const {digits,explicit}=parts;
    if(explicit){const code=countryCode(digits);return code?internationalDisplay(code,digits.slice(code.length)):"+"+digits;}
    if(digits.startsWith("54")&&digits.length>=12)return internationalDisplay("54",digits.slice(2));
    return arDisplay(digits);
  }
  let previousPhoneValue=phone.value;
  function updatePhoneFormat(event){
    phone.setCustomValidity("");
    const before=phone.value,caret=phone.selectionStart??before.length;
    const complete=event?.type==="blur"||event?.inputType==="insertFromPaste"||event?.inputType==="insertReplacementText";
    if(!complete&&event?.inputType?.startsWith("delete")&&before.replace(/\D/g,"")===previousPhoneValue.replace(/\D/g,"")){
      previousPhoneValue=before;return;
    }
    const countBefore=before.slice(0,caret).replace(/\D/g,"").length;
    const formatted=formatPhone(before,complete);
    previousPhoneValue=formatted;
    if(formatted===before)return;
    const removedPrefix=before.replace(/\D/g,"").startsWith("00")&&formatted.startsWith("+")?2:0;
    const digitTarget=Math.max(0,countBefore-removedPrefix);
    phone.value=formatted;
    if(complete||caret===before.length){phone.setSelectionRange(formatted.length,formatted.length);return;}
    let pos=0,digits=0;
    while(pos<formatted.length&&digits<digitTarget){if(/\d/.test(formatted[pos]))digits++;pos++;}
    if(digitTarget===0&&formatted.startsWith("+"))pos=1;
    phone.setSelectionRange(pos,pos);
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
      if (!payload || typeof payload !== "object") throw new Error("Invalid voucher response");
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

  function syncStepControls(){
    email.disabled = busy || step !== 1;
    phone.disabled = busy || step !== 2;
    terms.disabled = busy || step !== 2;
    back.disabled = busy;
    submit.disabled = busy;
    submit.textContent = busy ? "Solicitando código…" : step === 1 ? "Continuar" : "Quiero mi código";
  }
  function setStep(next, focus = true){
    step = next;
    form.dataset.step = String(step);
    emailStep.hidden = step !== 1;
    phoneStep.hidden = step !== 2;
    back.hidden = step !== 2;
    stepLabel.textContent = "Paso " + step + " de 2" + (isPreview ? " · Demo" : "");
    progressSecond.toggleAttribute("data-done", step === 2);
    syncStepControls();
    showFeedback(feedback, "");
    if(focus){
      form.dataset.stepMotion = "";
      (step === 1 ? email : phone).focus({preventScroll:true});
    }
  }
  function setBusy(value) {
    busy = value;
    form.setAttribute("aria-busy", String(value));
    syncStepControls();
  }

  back.addEventListener("click", () => { if(!busy) setStep(1); });

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
    if(step === 1){
      if(!email.reportValidity()) return;
      completeFormEntrance();
      setStep(2);
      return;
    }
    const normalizedPhone = normalizePhone(phone.value);
    phone.setCustomValidity(normalizedPhone ? "" : "Ingresá un número de celular válido.");
    if (!form.reportValidity()) return;
    const data = { email: email.value.trim().toLowerCase(), phone: normalizedPhone, acceptedTerms: terms.checked };
    if (!data.acceptedTerms) return;
    setBusy(true);
    try {
      const result = await (isPreview ? claimPreview() : claimReal(data));
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

  setStep(1, false);
})();
