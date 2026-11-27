"use strict";
(() => {
  if (window.SnowEffect) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function createEngine(canvas, host) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  const lifetime = new AbortController();
  const options = { passive: true, signal: lifetime.signal };
  const mobile = matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const tilt = host.dataset.snowTilt !== "false";
  const density = Math.max(.1, Math.min(3, Number(host.dataset.snowDensity) || 1));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = v => { const t = clamp(v, 0, 1); return t*t*(3-2*t); };
  let w=0, h=0, dpr=0, active=false, disposed=false, frame=0;
  let last=0, time=0, lastTick=0, nextPaint=0, frameDebt=0, step=1000/60;
  const particles=[];
  const dragFactors=[0,0,0];
  let paintedTop=0,paintedBottom=0;
  const genericSources=["gravity","accelerometer"],legacySources=["orientation","absolute","motion"],allSources=[...genericSources,...legacySources];
  const radians=Math.PI/180;
  function orientationGravity(beta,gamma){
    return {x:Math.cos(beta*radians)*Math.sin(gamma*radians),y:Math.sin(beta*radians)};
  }
  function screenGravity(x,y,angle){
    const a=angle*radians,c=Math.cos(a),s=Math.sin(a);
    return {x:x*c+y*s,y:-x*s+y*c};
  }
  function snowDirection(x,y){
    const magnitude=Math.hypot(x,y);
    const weight=smooth((magnitude-.04)/.34);
    const gx=weight*x/Math.max(magnitude,.001)*1.9;
    const gy=1-weight+weight*y/Math.max(magnitude,.001);
    const length=Math.hypot(gx,gy)||1;
    return {x:gx/length,y:gy/length};
  }
  let gravityX=0,gravityY=1;
  const samples=Object.create(null), sensors=new Map();
  const sensorCounts={orientation:0,absolute:0,gravity:0,accelerometer:0,motion:0};
  const sensorErrors=Object.create(null), permissionStates=Object.create(null);
  let sensorSource="none",sensorCount=0,sensorStatus="waiting",permissionRequestRunning=false;
  let firstDirectionApplied=false;
  const screenAngle=()=>Number(screen.orientation?.angle??window.orientation??0)||0;
  function noteSample(source,x,y,z){
    if(![x,y,z].every(Number.isFinite))return;
    const prev=samples[source],now=performance.now();
    if(source==="accelerometer"&&prev&&now-prev.at<500){
      const k=1-Math.exp(-Math.max(1,now-prev.at)/85);
      x=prev.x+(x-prev.x)*k;
      y=prev.y+(y-prev.y)*k;
      z=prev.z+(z-prev.z)*k;
    }
    samples[source]={x,y,z,at:now};
    sensorCount++;
    sensorCounts[source]++;
    sensorStatus="active";
  }
  function sampleOrientation(event,source="orientation"){
    if(!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return;
    const g=orientationGravity(event.beta,event.gamma);
    noteSample(source,g.x,g.y,Math.cos(event.beta*radians)*Math.cos(event.gamma*radians));
  }
  function sampleAcceleration(source,a){
    if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
    const norm=Math.hypot(a.x,a.y,a.z);
    if(norm<3||norm>20)return;
    noteSample(source,-a.x/norm,a.y/norm,a.z/norm);
  }
  const sampleAbsolute=event=>sampleOrientation(event,"absolute");
  function sampleMotion(event){
    const a=event.accelerationIncludingGravity,linear=event.acceleration;
    if(a&&linear&&[a.x,a.y,a.z,linear.x,linear.y,linear.z].every(Number.isFinite)){
      const g={x:a.x-linear.x,y:a.y-linear.y,z:a.z-linear.z};
      const n=Math.hypot(g.x,g.y,g.z);
      if(n>=3&&n<=20){sampleAcceleration("motion",g);return;}
    }
    sampleAcceleration("motion",a);
  }
  function chooseGravity(now=performance.now()){
    for(const source of genericSources){
      if(samples[source]&&now-samples[source].at<1800)return {source,sample:samples[source]};
    }
    const orientation=!samples.absolute||samples.orientation?.at>=samples.absolute.at?samples.orientation:samples.absolute;
    const motion=samples.motion;
    if(motion&&now-motion.at<500&&(!orientation||now-orientation.at>180||
      (Math.hypot(orientation.x,orientation.y)<.035&&Math.hypot(motion.x,motion.y)>.12)))return {source:"motion",sample:motion};
    for(const source of legacySources){
      const sample=samples[source];
      if(sample&&now-sample.at<1800)return {source,sample};
    }
    let latest=null,source=null;
    for(const key of allSources){const sample=samples[key];if(sample&&(!latest||sample.at>latest.at)){latest=sample;source=key;}}
    return latest?{source,sample:latest}:null;
  }
  function getGravity(){
    const selected=chooseGravity();
    if(!selected){sensorSource="none";return {x:0,y:1};}
    sensorSource=selected.source;
    const g=screenGravity(selected.sample.x,selected.sample.y,screenAngle());
    return snowDirection(g.x,g.y);
  }
  function startSensor(name,source){
    if(disposed||document.hidden||permissionStates.accelerometer==="denied"||sensors.has(source)||typeof window[name]!=="function")return;
    let sensor;
    try{
      sensor=new window[name]({frequency:30,referenceFrame:"device"});
      sensors.set(source,sensor);
      sensor.addEventListener("reading",()=>sampleAcceleration(source,sensor),options);
      sensor.addEventListener("error",event=>{
        sensorErrors[source]=event.error?.name||"SensorError";
        sensors.delete(source);
        delete samples[source];
        try{sensor.stop();}catch{}
      },options);
      sensor.start();
      delete sensorErrors[source];
    }catch(error){
      sensors.delete(source);
      sensorErrors[source]=error?.name||"SensorError";
    }
  }
  function startGenericSensors(){
    startSensor("GravitySensor","gravity");
    startSensor("Accelerometer","accelerometer");
  }
  function attachLegacy(){
    window.removeEventListener("deviceorientation",sampleOrientation);
    window.removeEventListener("deviceorientationabsolute",sampleAbsolute);
    window.removeEventListener("devicemotion",sampleMotion);
    window.addEventListener("deviceorientation",sampleOrientation,options);
    window.addEventListener("deviceorientationabsolute",sampleAbsolute,options);
    window.addEventListener("devicemotion",sampleMotion,options);
  }
  async function requestExistingPermission(){
    if(disposed||permissionRequestRunning||chooseGravity())return;
    const apis=[["orientation",window.DeviceOrientationEvent],["motion",window.DeviceMotionEvent]]
      .filter(([,api])=>typeof api?.requestPermission==="function");
    if(!apis.length)return;
    if(["accelerometer","gyroscope"].some(name=>permissionStates[name]==="denied"))return;
    permissionRequestRunning=true;
    const results=await Promise.allSettled(apis.map(async([name,api])=>{
      try{
        const result=await api.requestPermission();
        permissionStates[name]=result;
        return result;
      }catch(error){
        permissionStates[name]=error?.name||"unavailable";
        return null;
      }
    }));
    permissionRequestRunning=false;
    if(disposed)return;
    if(results.some(r=>r.status==="fulfilled"&&r.value==="granted")){
      attachLegacy();
      startGenericSensors();
    }
  }
  async function inspectPermission(name){
    try{
      const permission=await navigator.permissions.query({name});
      if(disposed)return;
      permissionStates[name]=permission.state;
      permission.addEventListener("change",()=>{
        permissionStates[name]=permission.state;
        if(permission.state==="granted"){
          attachLegacy();
          startGenericSensors();
        }else if(permission.state==="denied"){
          if(name==="accelerometer"){
            for(const [source,sensor] of sensors){try{sensor.stop();}catch{} sensors.delete(source);}
            for(const source of Object.keys(samples))delete samples[source];
          }else{
            delete samples.orientation;
            delete samples.absolute;
          }
          sensorStatus="denied";
        }
      },options);
    }catch{permissionStates[name]="unsupported";}
  }
  function initSensors(){
    if(!tilt || !window.isSecureContext){sensorStatus="disabled";return;}
    attachLegacy();
    startGenericSensors();
    if(navigator.permissions) Promise.all(["accelerometer","gyroscope"].map(inspectPermission));
    window.addEventListener("focus",startGenericSensors,options);
    window.addEventListener("pageshow",startGenericSensors,options);
  }
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
    const y = initial ? Math.random()*h : -12 - Math.random()*32;
    return {
      layer, x: Math.random()*w, y, radius, speed,
      opacity: near ? .20 + depth*.20 : middle ? .32 + depth*.38 : .22 + depth*.24,
      phase: Math.random()*Math.PI*2, frequency: .45+Math.random()*1.05,
      sway: (near?10:middle?6:3)+Math.random()*5,
      age: initial ? .45 + Math.random()*.45 : 0,
      fade: .45 + Math.random()*.45,
      vx: gravityX*speed, vy: gravityY*speed
    };
  }
  function layerFor(i) {
    return i%13===0?2:i%3===0?1:0;
  }

  function resize() {
    if (disposed) return false;
    const width=canvas.clientWidth, height=canvas.clientHeight;
    const ratio=Math.min(devicePixelRatio || 1, mobile ? .9 : 1.5,Math.sqrt((mobile?2400000:4800000)/Math.max(1,width*height)),4096/Math.max(1,width,height));
    if (!width || !height) return false;
    if (width===w && height===h && ratio===dpr) return true;
    const oldW=w, oldH=h;
    w=width; h=height; dpr=ratio;
    canvas.width=Math.max(1,Math.round(w*dpr));
    canvas.height=Math.max(1,Math.round(h*dpr));
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    paintedTop=paintedBottom=0;
    if (oldW && oldH) {
      if(oldW!==w)for(const p of particles)p.x*=w/oldW;
      if(h<oldH)for(let i=particles.length-1;i>=0;i--)if(particles[i].y>h+44)particles.splice(i,1);
    }
    const count=Math.max(1,Math.round(density*(mobile ? clamp(w*h/7200,32,320) : clamp(w*h/6500,48,640))));
    if(particles.length>count)particles.length=count;
    while(particles.length<count){
      const p=particle(true,layerFor(particles.length));
      if(oldH&&h>oldH)p.y=oldH+Math.random()*(h-oldH);
      particles.push(p);
    }
    return true;
  }

  function recycle(p) {
    const next=particle(false,p.layer);
    next.fade=.18+Math.random()*.25;
    const pad=next.radius*4+12;
    const horizontal=Math.abs(gravityX)*h,vertical=Math.abs(gravityY)*w;
    if(Math.random()*(horizontal+vertical)<horizontal){
      next.x=gravityX>0?-pad:w+pad;
      next.y=Math.random()*h;
    }else{
      next.x=Math.random()*w;
      next.y=gravityY>=0?-pad:h+pad;
    }
    Object.assign(p,next);
  }

  function render(now) {
    if (!active || disposed || document.hidden) return;
    const gap=now-(lastTick||now); lastTick=now;
    frameDebt=gap>26?Math.min(24,frameDebt+1):Math.max(0,frameDebt-.12);
    const nextStep=frameDebt>=12?1000/30:frameDebt<=3?1000/60:step;
    if(nextStep!==step){step=nextStep;nextPaint=now;}
    if(!nextPaint)nextPaint=now;
    if(now+1.5<nextPaint){frame=requestAnimationFrame(render);return;}
    nextPaint+=step*Math.max(1,Math.floor((now+1.5-nextPaint)/step)+1);
    const dt=clamp((now-(last||now))/1000,0,.067);
    last=now; time+=dt;
    for(let layer=0;layer<3;layer++)dragFactors[layer]=1-Math.exp(-dt*(10+layer*1.3));
    const target=getGravity();
    if(!firstDirectionApplied&&sensorSource!=="none"){
      gravityX=target.x;gravityY=target.y;firstDirectionApplied=true;
    }else{
      const gravityBlend=1-Math.exp(-dt*18);
      gravityX+=(target.x-gravityX)*gravityBlend;
      gravityY+=(target.y-gravityY)*gravityBlend;
    }
    const air=Math.sin(time*.72)*3.2+Math.sin(time*.24+1.3)*2.1;
    const visibleTop=0,visibleBottom=h;
    if(paintedBottom>paintedTop)ctx.clearRect(0,Math.max(0,paintedTop-16),w,Math.min(h,paintedBottom+16)-Math.max(0,paintedTop-16));
    paintedTop=visibleTop;paintedBottom=visibleBottom;
    for(const p of particles){
      p.age+=dt;
      p.phase+=dt*p.frequency;
      const sway=Math.sin(p.phase)*p.sway+air;
      const targetX=gravityX*p.speed+sway*gravityY;
      const targetY=gravityY*p.speed-sway*gravityX;
      p.vx+=(targetX-p.vx)*dragFactors[p.layer];
      p.vy+=(targetY-p.vy)*dragFactors[p.layer];
      p.x+=p.vx*dt;
      p.y+=p.vy*dt;
      const pad=p.radius*4+44;
      if((p.x<-pad&&p.vx<0)||(p.x>w+pad&&p.vx>0)||
         (p.y<-pad&&p.vy<0)||(p.y>h+pad&&p.vy>0))recycle(p);
      if(p.y<visibleTop||p.y>visibleBottom)continue;
      const alpha=p.opacity*smooth(p.age/p.fade);
      if(alpha<.01)continue;
      ctx.globalAlpha=alpha;
      const size=p.radius*3;
      ctx.drawImage(sprites[p.layer],p.x-size*.5,p.y-size*.5,size,size);
    }
    ctx.globalAlpha=1;
    frame=requestAnimationFrame(render);
  }

  function resetClock(){
    last=0;lastTick=0;nextPaint=0;frameDebt=0;
  }
  function start(){
    if(disposed||active||!resize())return;
    active=true;
    canvas.classList.add("snow-effect__canvas--active");
    if(!document.hidden)frame=requestAnimationFrame(render);
  }
  let observer;
  function onSizeChange(){
    if(disposed)return;
    if(active)resize();
    else start();
  }
  if("ResizeObserver" in window){
    observer=new ResizeObserver(onSizeChange);
    observer.observe(canvas);
    observer.observe(host);
  }else{
    window.addEventListener("resize",onSizeChange,options);
  }

  function dispose(){
    if(disposed)return;
    disposed=true;active=false;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    for(const sensor of sensors.values()){try{sensor.stop();}catch{}}
    sensors.clear();
    lifetime.abort();
    canvas.classList.remove("snow-effect__canvas--active");
    particles.length=0;
    canvas.width=canvas.height=1;
    for(const sprite of sprites)sprite.width=sprite.height=1;
  }
  document.addEventListener("visibilitychange",()=>{
    if(!active||disposed)return;
    cancelAnimationFrame(frame);
    resetClock();
    if(!document.hidden){
      if(tilt && window.isSecureContext){attachLegacy();startGenericSensors();}
      frame=requestAnimationFrame(render);
    }
  },options);

  initSensors();
  if(sensorCount){const target=getGravity();gravityX=target.x;gravityY=target.y;firstDirectionApplied=true;}
  start();
  return {dispose, requestMotion: () => tilt && window.isSecureContext ? requestExistingPermission() : Promise.resolve()};
  }

  const selector = ".snow";
  const entries = new Map();
  let pending = false;
  let observer, intersections, sizes;
  const hasBox = host => {
    const style = getComputedStyle(host);
    return host.isConnected && host.clientWidth > 0 && host.clientHeight > 0 &&
      style.display !== "none" && style.visibility === "visible" &&
      host.getClientRects().length > 0 &&
      !host.closest("[hidden], dialog:not([open])");
  };
  function stop(entry) {
    if (entry.engine) entry.engine.dispose();
    entry.engine = null;
    entry.canvas.remove();
  }
  function sync(entry) {
    const {host, canvas} = entry;
    if (reduced.matches || document.hidden || entry.intersecting === false || !hasBox(host)) {
      stop(entry);
      return;
    }
    const config = `${host.dataset.snowDensity ?? ""}|${host.dataset.snowTilt ?? ""}`;
    if (entry.engine && canvas.parentNode === host && entry.config === config) return;
    if (entry.engine) stop(entry);
    entry.config = config;
    if (getComputedStyle(host).position === "static") host.setAttribute("data-snow-static", "");
    host.appendChild(canvas);
    entry.engine = createEngine(canvas, host);
    if (!entry.engine) canvas.remove();
  }
  function attach(host) {
    if (!(host instanceof HTMLElement) || !host.matches(selector)) return null;
    if (/^(AREA|BASE|BR|COL|EMBED|HR|IMG|INPUT|LINK|META|PARAM|SOURCE|TRACK|WBR|CANVAS|VIDEO|IFRAME|SELECT|TEXTAREA)$/.test(host.tagName)) return null;
    if (entries.has(host)) return entries.get(host);
    const canvas = document.createElement("canvas");
    canvas.className = "snow-effect__canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("role", "presentation");
    const entry = {host, canvas, engine:null, intersecting:null, config:null};
    entries.set(host, entry);
    intersections?.observe(host);
    sizes?.observe(host);
    sync(entry);
    return entry;
  }
  function detach(host) {
    const entry = entries.get(host);
    if (!entry) return;
    entries.delete(host);
    intersections?.unobserve(host);
    sizes?.unobserve(host);
    stop(entry);
    host.removeAttribute("data-snow-static");
  }
  function refresh() {
    pending = false;
    for (const host of entries.keys()) if (!host.isConnected || !host.matches(selector)) detach(host);
    for (const host of document.querySelectorAll(selector)) attach(host);
    for (const entry of entries.values()) sync(entry);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(refresh);
  }
  function init() {
    if ("IntersectionObserver" in window) {
      intersections = new IntersectionObserver(records => {
        for (const record of records) {
          const entry = entries.get(record.target);
          if (entry) {entry.intersecting = record.isIntersecting; sync(entry);}
        }
      });
    }
    if ("ResizeObserver" in window) {
      sizes = new ResizeObserver(records => {
        for (const record of records) {
          const entry = entries.get(record.target);
          if (entry) sync(entry);
        }
      });
    }
    for (const entry of entries.values()) {
      intersections?.observe(entry.host);
      sizes?.observe(entry.host);
    }
    observer = new MutationObserver(records => {
      if (records.some(record => {
        if (record.type === "attributes") return !record.target.classList?.contains("snow-effect__canvas");
        return [...record.addedNodes,...record.removedNodes].some(node =>
          node.nodeType === 1 && (!node.classList?.contains("snow-effect__canvas") ||
            [...entries.values()].some(entry => entry.canvas === node && entry.engine && node.parentNode !== entry.host)));
      })) schedule();
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","style","hidden","open","data-snow-density","data-snow-tilt"]});
    document.addEventListener("visibilitychange", refresh);
    reduced.addEventListener?.("change",refresh);
    window.addEventListener("resize",schedule,{passive:true});
    window.addEventListener("pageshow",refresh);
    window.addEventListener("pagehide",()=>{for(const entry of entries.values())stop(entry);});
    refresh();
  }
  window.SnowEffect = Object.freeze({
    mount(host) {host.classList.add("snow"); attach(host); return host;},
    unmount(host) {host.classList.remove("snow"); detach(host);},
    refresh,
    async requestMotion(host) {
      const entry = entries.get(host);
      if (entry?.engine) await entry.engine.requestMotion();
    }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
