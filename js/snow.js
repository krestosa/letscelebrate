"use strict";
(() => {
  const canvas = document.getElementById("intro-snow");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const lifetime = new AbortController();
  const options = { passive: true, signal: lifetime.signal };
  const mobile = matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints>0 || Math.min(innerWidth,innerHeight)<=600;
  const orientationSensor = window.DeviceOrientationEvent;
  const motionSensor = window.DeviceMotionEvent;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = v => { const t = clamp(v, 0, 1); return t*t*(3-2*t); };
  const root = document.documentElement;
  let w = 0, h = 0, active = false, disposed = false, frame = 0, last = 0, time = 0;
  let gravityX = 0, gravityY = 1, particles = [], sensorListening = false;
  let orientationReading = null, motionReading = null, gravityReading = null;
  let orientationAt = -Infinity, motionAt = -Infinity, gravityAt = -Infinity;
  let gravitySensor=null, gravityStarting=false, permissionDenied=false, permissionWatches=[];
  let motionSign = 1, sensorState = "waiting", debug = null;
  let targetX = 0, targetY = 1, flowX = 0, flowY = 1;
  let flowAngle=0, targetAngle=0, targetStrength=1, flowStrength=1;
  let filteredX=0, filteredY=1, sensorInitialized=false, source="", debugAt=0;
  let landing = false, landingBlend = 0;
  let lastTick = 0, frameDebt = 0, nextPaint = 0, step = 1000/60;
  const TAU=2*Math.PI;
  const dragFactors = [0,0,0];

  function setSensorState(state) {
    if(sensorState===state && canvas.dataset.motion===state)return;
    sensorState = state;
    canvas.dataset.motion = state;
    if (debug) debug.textContent = "Nieve · " + state;
  }
  function onOrientation(event) {
    if(permissionDenied)return;
    if (!Number.isFinite(event.gamma) || !Number.isFinite(event.beta)) return;
    const gamma = event.gamma * Math.PI / 180;
    const beta = event.beta * Math.PI / 180;
    // Gravity projected into the original device axes (screen y points down).
    // This works even with the handset upright and avoids Euler-roll ambiguity.
    orientationReading = [Math.cos(beta)*Math.sin(gamma), Math.sin(beta)];
    orientationAt = performance.now();
    setSensorState("orientation");
  }
  function onMotion(event) {
    if(permissionDenied)return;
    const g = event.accelerationIncludingGravity;
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return;
    const a = event.acceleration;
    const ax = g.x-(Number.isFinite(a?.x)?a.x:0);
    const ay = g.y-(Number.isFinite(a?.y)?a.y:0);
    const reading = [clamp(-ax/9.81,-1,1),clamp(ay/9.81,-1,1)];
    if (orientationReading && performance.now()-orientationAt<800) {
      // Match older implementations with reversed accelerometer polarity.
      const dot=reading[0]*orientationReading[0]+reading[1]*orientationReading[1];
      if(Math.abs(dot)>.18)motionSign=dot<0?-1:1;
    }
    motionReading = reading;
    motionAt = performance.now();
    if(!orientationReading)setSensorState("motion");
  }
  function updateGravity(now,dt) {
    // Prefer orientation; only switch to motion if orientation has genuinely
    // stopped and fresh accelerometer data is available. Avoid alternating
    // sources on adjacent frames when their delivery frequencies differ.
    // Direct gravity is independent of Euler-angle delivery and avoids
    // choosing a stale orientation event over a live accelerometer.
    const useGravity=gravityReading && now-gravityAt<1000;
    const useOrientation=!useGravity && orientationReading &&
      (now-orientationAt<1800 || !motionReading || now-motionAt>500) &&
      !(motionReading && now-motionAt<500 &&
        Math.hypot(...orientationReading)<.025 && Math.hypot(...motionReading)>.18);
    const reading=useGravity?gravityReading:useOrientation?orientationReading:motionReading||gravityReading;
    if(!reading)return;
    const nextSource=useGravity||(!useOrientation&&!motionReading)?"gravity":useOrientation?"orientation":"motion";
    const sign=nextSource==="orientation"?1:motionSign;
    const angle=(screen.orientation?.angle ?? Number(window.orientation ?? 0))*Math.PI/180;
    const gx=(reading[0]*Math.cos(angle)+reading[1]*Math.sin(angle))*sign;
    const gy=(-reading[0]*Math.sin(angle)+reading[1]*Math.cos(angle))*sign;
    if(!sensorInitialized){
      filteredX=gx;filteredY=gy;sensorInitialized=true;
    }
    // Low-pass the input vector before converting it into a direction.
    // Do not reset the filter on a source switch.
    const inputMix=1-Math.exp(-dt*(source===nextSource?15:8));
    filteredX+=(gx-filteredX)*inputMix;
    filteredY+=(gy-filteredY)*inputMix;
    gravityX=filteredX;gravityY=filteredY;source=nextSource;
    setSensorState(nextSource);
    const planar=Math.hypot(gravityX,gravityY);
    const x=gravityX*2.35;
    const y=gravityY+Math.max(0,1-planar*2.15)*.72;
    const norm=Math.hypot(x,y);
    // Hold the preceding angle near zero gravity instead of allowing an
    // unstable atan2 reading to flip the entire field.
    if(norm>.075)targetAngle=Math.atan2(x,y);
    targetStrength=.82+.18*smooth(norm/.5);
    targetX=Math.sin(targetAngle);
    targetY=Math.cos(targetAngle);
    if(debug&&now-debugAt>160){
      debugAt=now;
      debug.textContent="Nieve · "+sensorState+" · "+Math.round(targetAngle*180/Math.PI)+"° · "+Math.round(1000/step)+" FPS";
    }
  }

  function listenSensors() {
    if(disposed||sensorListening||!mobile||reduced.matches)return;
    sensorListening=true;
    window.addEventListener("deviceorientation",onOrientation,options);
    window.addEventListener("deviceorientationabsolute",event=>{
      if(performance.now()-orientationAt>1000)onOrientation(event);
    },options);
    window.addEventListener("devicemotion",onMotion,options);
    setSensorState("waiting");
    setTimeout(()=>{
      if(!disposed&&!hasSensorData()&&sensorState==="waiting")setSensorState("no-data");
    },2500);
  }
  // Chromium exposes requestPermission() too: its presence does not mean
  // the user needs to tap an activation button. Read any already-authorized
  // sensor immediately and query its permission state without a gesture.
  const permissionApis = [...new Set([orientationSensor,motionSensor])]
    .filter(api=>typeof api?.requestPermission==="function");
  let permissionBusy=false, permissionGranted=false, gestureArmed=false;
  function hasSensorData(){return !!(orientationReading||motionReading||gravityReading);}
  function stopGravity(){try{gravitySensor?.stop();}catch{}gravitySensor=null;gravityStarting=false;}
  async function startGravity(){
    if(disposed||permissionDenied||gravitySensor||gravityStarting||!window.isSecureContext||typeof window.GravitySensor!=="function")return;
    gravityStarting=true;
    try{
      // Only start an already-authorized sensor. Never use a second API to
      // override an explicit denial or manufacture motion data.
      if(navigator.permissions?.query){
        const permission=await navigator.permissions.query({name:"accelerometer"});
        if(disposed||permissionDenied||permission.state!=="granted")return;
      }
      if(disposed||permissionDenied)return;
      const sensor=new window.GravitySensor({frequency:30,referenceFrame:"device"});
      gravitySensor=sensor;
      sensor.addEventListener("reading",()=>{
        if(!Number.isFinite(sensor.x)||!Number.isFinite(sensor.y)||!Number.isFinite(sensor.z))return;
        if(Math.hypot(sensor.x,sensor.y,sensor.z)<1)return;
        gravityReading=[clamp(-sensor.x/9.81,-1,1),clamp(sensor.y/9.81,-1,1)];
        gravityAt=performance.now();
        if(orientationReading&&performance.now()-orientationAt<800){
          const dot=gravityReading[0]*orientationReading[0]+gravityReading[1]*orientationReading[1];
          if(Math.abs(dot)>.18)motionSign=dot<0?-1:1;
        }
        setSensorState("gravity");
      },options);
      sensor.addEventListener("error",()=>{stopGravity();},{once:true,signal:lifetime.signal});
      sensor.start();
    }catch{stopGravity();}finally{gravityStarting=false;}
  }
  async function watchSensorPermissions(){
    if(!navigator.permissions?.query)return;
    for(const name of ["accelerometer","gyroscope"]){
      try{
        const p=await navigator.permissions.query({name});
        if(disposed)return;
        permissionWatches.push(p);
        p.addEventListener("change",()=>{
          if(disposed)return;
          permissionDenied=permissionWatches.some(item=>item.state==="denied");
          if(permissionDenied){stopGravity();gravityReading=motionReading=orientationReading=null;targetAngle=0;targetStrength=1;setSensorState("denied");return;}
          permissionGranted=false;
          listenSensors();
          startGravity();
          if(permissionApis.length)requestSensorPermission();
        },options);
      }catch{}
    }
  }
  function onFirstGesture(event){
    if(!event.isTrusted||disposed||permissionDenied||permissionGranted||hasSensorData())return;
    // A native permission prompt may require transient user activation.
    // Never prevent the underlying click or request permission after denial.
    if(navigator.userActivation && !navigator.userActivation.isActive)return;
    disarmGesture();
    requestSensorPermission(true);
  }
  function disarmGesture(){
    gestureArmed=false;
    window.removeEventListener("click",onFirstGesture,true);
    window.removeEventListener("keydown",onFirstGesture,true);
  }
  function armGesture(){
    if(gestureArmed||disposed||permissionGranted||hasSensorData())return;
    gestureArmed=true;
    window.addEventListener("click",onFirstGesture,{capture:true,passive:true,signal:lifetime.signal});
    window.addEventListener("keydown",onFirstGesture,{capture:true,passive:true,signal:lifetime.signal});
  }
  async function requestSensorPermission(userActivated=false){
    if(disposed||permissionDenied||permissionBusy||permissionGranted||hasSensorData()||!permissionApis.length)return;
    permissionBusy=true;
    // Execute both calls synchronously before awaiting either result.
    const pending=permissionApis.map(api=>{
      try{return Promise.resolve(api.requestPermission());}
      catch(error){return Promise.reject(error);}
    });
    const results=await Promise.allSettled(pending);
    permissionBusy=false;
    if(disposed)return;
    if(hasSensorData()||results.some(r=>r.status==="fulfilled"&&r.value==="granted")){
      permissionGranted=true;
      disarmGesture();
      if(!hasSensorData())setSensorState("waiting");
      startGravity();
      return;
    }
    const requiresGesture=results.some(r=>r.status==="rejected"&&
      (r.reason?.name==="NotAllowedError"||r.reason?.name==="InvalidStateError"));
    if(!userActivated&&requiresGesture){
      setSensorState("gesture-required");
      armGesture();
      // Query-only fallback can start if access was already granted.
      startGravity();
    }else{
      permissionDenied=results.every(r=>r.status==="fulfilled"&&r.value==="denied");
      if(permissionDenied){stopGravity();gravityReading=null;}
      setSensorState(permissionDenied?"denied":"unavailable");
      disarmGesture();
    }
  }
  // Opt-in, local-only diagnostics; never collect or transmit sensor values.
  if(new URLSearchParams(location.search).get("snow-debug")==="1"){
    debug=document.createElement("output");
    debug.className="snow-debug";
    debug.setAttribute("aria-live","off");
    document.body.append(debug);
  }

  // Paint the soft depth-of-field sprites once, not a blur on every frame.
  const sprites = [0,1,2].map(layer => {
    const image = document.createElement("canvas");
    image.width = image.height = 48;
    const pen = image.getContext("2d");
    const gradient = pen.createRadialGradient(24,24,0,24,24,23);
    if (layer === 0) {
      gradient.addColorStop(0,"rgba(255,255,255,.96)");
      gradient.addColorStop(.46,"rgba(255,255,255,.80)");
      gradient.addColorStop(1,"rgba(255,255,255,0)");
    } else if (layer === 1) {
      gradient.addColorStop(0,"rgba(255,255,255,.98)");
      gradient.addColorStop(.48,"rgba(255,255,255,.86)");
      gradient.addColorStop(.78,"rgba(255,255,255,.18)");
      gradient.addColorStop(1,"rgba(255,255,255,0)");
    } else {
      gradient.addColorStop(0,"rgba(255,255,255,.75)");
      gradient.addColorStop(.28,"rgba(255,255,255,.48)");
      gradient.addColorStop(1,"rgba(255,255,255,0)");
    }
    pen.fillStyle=gradient;
    pen.fillRect(0,0,48,48);
    return image;
  });

  function particle(initial = false, layer = 0) {
    const depth = Math.random(), near = layer === 2, middle = layer === 1;
    const radius = near ? 3.2 + depth*2.6 : middle ? 1.45 + depth*1.25 : .75 + depth*.8;
    const speed = near ? 62 + depth*36 : middle ? 36 + depth*34 : 18 + depth*22;
    const y = initial ? Math.random()*h*(Math.random()<.68?.48:1) : -12 - Math.random()*32;
    return {
      layer, x: Math.random()*w, y, radius, speed,
      opacity: near ? .20 + depth*.20 : middle ? .32 + depth*.38 : .22 + depth*.24,
      phase: Math.random()*Math.PI*2, frequency: .45+Math.random()*1.05,
      sway: (near?10:middle?6:3)+Math.random()*5,
      age: initial ? -(Math.random()*.64) : 0,
      fade: .45 + Math.random()*.45,
      vx: 0, vy: speed
    };
  }
  function layerFor(i) {
    // Far field dominates; only a handful of larger foreground flakes.
    return i%13===0?2:i%3===0?1:0;
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const oldW = w, oldH = h;
    w = bounds.width; h = bounds.height;
    const dpr = Math.min(devicePixelRatio || 1, mobile ? 0.9 : 1.5);
    canvas.width = Math.round(w*dpr);
    canvas.height = Math.round(h*dpr);
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    const count = Math.round(mobile ? clamp(w*h/7200,32,72) : clamp(w*h/6500,48,180));
    if (oldW && oldH) for (const p of particles) {
      p.x *= w/oldW; p.y *= h/oldH;
    }
    if (particles.length>count) particles.length=count;
    while (particles.length<count) particles.push(particle(true,layerFor(particles.length)));
  }

  function recycle(p) {
    const next=particle(false,p.layer);
    // Spawn on the incoming edge, weighted by the flow through each edge.
    // This keeps density stable when flakes travel almost horizontally.
    const horizontal=Math.abs(flowX)*h, vertical=Math.abs(flowY)*w;
    const side=Math.random()*(horizontal+vertical)<horizontal;
    const pad=next.radius*3;
    if(side){next.x=flowX>=0?-pad:w+pad;next.y=Math.random()*h;}
    else{next.x=Math.random()*w;next.y=flowY>=0?-pad:h+pad;}
    const speed=next.speed*(1+Math.abs(flowX)*1.45)*flowStrength;
    next.vx=flowX*speed;next.vy=flowY*speed;
    next.fade=.18+Math.random()*.25;
    Object.assign(p,next);
  }

  function render(now) {
    if (!active || disposed) return;
    const gap=now-(lastTick||now);lastTick=now;
    // Stable 60-Hz target independent of tilt. Only lower the rate when
    // sustained frame misses indicate that the device cannot keep up.
    frameDebt=gap>26?Math.min(24,frameDebt+1):Math.max(0,frameDebt-.12);
    const nextStep=frameDebt>=12?1000/30:frameDebt<=3?1000/60:step;
    if(nextStep!==step){step=nextStep;nextPaint=now;}
    if(!nextPaint)nextPaint=now;
    if(now+1.5<nextPaint){frame=requestAnimationFrame(render);return;}
    nextPaint+=step*Math.max(1,Math.floor((now+1.5-nextPaint)/step)+1);
    const dt=clamp((now-(last||now))/1000,0,.067);
    last=now;time+=dt;
    for(let layer=0;layer<3;layer++)dragFactors[layer]=1-Math.exp(-dt*(6.2+layer*1.1));
    updateGravity(now,dt);
    // Interpolate the shortest arc rather than lerping Cartesian components.
    // The unit vector keeps its magnitude when the phone reverses direction.
    const delta=((targetAngle-flowAngle+Math.PI)%TAU+TAU)%TAU-Math.PI;
    const response=1-Math.exp(-dt*12);
    flowAngle+=delta*response;
    flowAngle=((flowAngle+Math.PI)%TAU+TAU)%TAU-Math.PI;
    flowStrength+=(targetStrength-flowStrength)*response;
    flowX=Math.sin(flowAngle);
    flowY=Math.cos(flowAngle);
    const air=Math.sin(time*.72)*3.2+Math.sin(time*.24+1.3)*2.1;
    landingBlend += ((landing?1:0)-landingBlend)*(1-Math.exp(-dt*4));
    ctx.clearRect(0,0,w,h);
    for (const p of particles) {
      p.age+=dt;
      p.phase+=dt*p.frequency;
      const speed=p.speed*(1+Math.abs(flowX)*1.45)*flowStrength;
      const sway=Math.sin(p.phase)*p.sway+air;
      const desiredX=flowX*speed+flowY*sway;
      const desiredY=flowY*speed-flowX*sway;
      const drag=dragFactors[p.layer];
      p.vx+=(desiredX-p.vx)*drag;
      p.vy+=(desiredY-p.vy)*drag;
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      const pad=p.radius*4;
      if (p.y>h+pad || p.y<-pad-h*.12 || p.x<-pad-w*.08 || p.x>w+pad+w*.08) recycle(p);
      // Ease each flake into view and protect the main typographic lockup.
      const birth=smooth(p.age/p.fade);
      if (birth<=0) continue;
      const dx=(p.x-w*.5)/(w*.32),dy=(p.y-h*.5)/(h*.23);
      const center=.38+.62*smooth(dx*dx+dy*dy);
      const alpha=p.opacity*birth*(center+(1-center)*landingBlend*.65)*(1-landingBlend*.12);
      if(alpha<.01)continue;
      ctx.globalAlpha=alpha;
      const size=p.radius*3;
      ctx.drawImage(sprites[p.layer],p.x-size*.5,p.y-size*.5,size,size);
    }
    ctx.globalAlpha=1;
    frame=requestAnimationFrame(render);
  }

  function dispose() {
    if (disposed) return;
    disposed=true; active=false;
    root.classList.remove("snow-active");
    cancelAnimationFrame(frame);
    stopGravity();
    lifetime.abort();
    debug?.remove();
    particles=[];
    canvas.width=canvas.height=1;
    for(const sprite of sprites)sprite.width=sprite.height=1;
  }

  function start() {
    if(disposed||active||reduced.matches)return;
    resize();
    if(!w||!h)return;
    active=true;last=0;lastTick=0;nextPaint=0;frameDebt=0;time=0;
    root.classList.add("snow-active");
    if(!document.hidden)frame=requestAnimationFrame(render);
  }

  if(mobile&&!reduced.matches){
    if(!window.isSecureContext)setSensorState("HTTPS-required");
    else if(!orientationSensor&&!motionSensor&&typeof window.GravitySensor!=="function")setSensorState("unsupported");
    else {
      listenSensors();
      watchSensorPermissions();
      if(permissionApis.length)requestSensorPermission();
      // Where permission APIs are absent, the browser enforces access itself.
      else startGravity();
    }
  }else setSensorState("natural");
  // Start with the photographic opening, before the first numeral enters.
  // The spin event is only a fallback if the initial canvas has no dimensions.
  start();
  document.addEventListener("loading-spin-start",start,{once:true,signal:lifetime.signal});
  const enterLanding=()=>{landing=true;start();};
  document.addEventListener("intro-revealing",enterLanding,{once:true,signal:lifetime.signal});
  document.addEventListener("intro-dismissed",enterLanding,{once:true,signal:lifetime.signal});
  // Preserve particles and sensor state while the intro is removed.
  // Suspend the animation when the page is hidden, then resume without a jump.
  document.addEventListener("visibilitychange",()=>{
    if(!active||disposed)return;
    cancelAnimationFrame(frame);
    last=0;lastTick=0;nextPaint=0;frameDebt=0;
    if(!document.hidden){
      frame=requestAnimationFrame(render);
      if(mobile&&!permissionDenied)startGravity();
    }
  },{signal:lifetime.signal});
  window.addEventListener("pagehide",event=>{if(!event.persisted)dispose();},options);
  let resizePending=false;
  window.addEventListener("resize",()=>{
    if(!active||resizePending)return;
    resizePending=true;
    requestAnimationFrame(()=>{resizePending=false;if(active)resize();});
  },options);
  reduced.addEventListener?.("change",()=>{if(reduced.matches)dispose();},{signal:lifetime.signal});
})();
