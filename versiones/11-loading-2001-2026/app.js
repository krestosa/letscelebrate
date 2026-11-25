"use strict";
(() => {
  const wheels = [...document.querySelectorAll(".wheel")];
  const label = document.getElementById("year-label");
  const progress = document.getElementById("loading-progress");
  const fill = document.getElementById("loading-progress-fill");
  let canvas = document.getElementById("cylinder-canvas");
  if (wheels.length !== 4 || !label || !progress || !fill || !canvas) return;

  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const initialHold = 1160, durations = [1120,1350,1580,1810];
  const totalDuration = initialHold + durations[3];
  const acceleration = 120, braking = 560;
  const step = Math.PI * 2 / 10;
  const radius = 1 / step, camera = 1.45;
  const limit = Math.acos(radius / (camera + radius));
  const cell = 256, atlasSize = 1024;
  let renderer, frame = 0, startedAt = null, finished = false, launched = false;
  let lastPercent = -1, needsResize = true;
  const drums = wheels.map((wheel, i) => {
    const start = Number(wheel.dataset.start), end = Number(wheel.dataset.end);
    return {wheel, start, end, steps:[3,4,4,5][i]*10+(end-start+10)%10,
      duration:durations[i], digit:wheel.querySelector(".wheel__static"), settled:false};
  });
  root.classList.add("loading-preparing");

  // Rasterize the original Gazzetta glyphs once. The texture is wrapped
  // around a genuinely curved cylindrical surface, not a stack of flat cards.
  function makeAtlas() {
    const a = document.createElement("canvas");
    a.width = a.height = atlasSize;
    const ctx = a.getContext("2d");
    ctx.font = '900 '+cell+'px Gazzetta, Impact, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f7f5f0";
    const m = ctx.measureText("2026");
    const baseline = cell/2 + ((m.fontBoundingBoxAscent ?? cell*.8)-(m.fontBoundingBoxDescent ?? cell*.2))/2;
    for (let i=0;i<10;i++) {
      const x=(i%4)*cell, y=Math.floor(i/4)*cell;
      ctx.save(); ctx.beginPath(); ctx.rect(x,y,cell,cell);ctx.clip();
      ctx.fillText(String(i),x+cell/2,y+baseline);ctx.restore();
    }
    return a;
  }

  function webGLRenderer(atlas) {
    const gl = canvas.getContext("webgl", {alpha:true, antialias:true, premultipliedAlpha:true});
    if (!gl) return null;
    const vertex = `
      attribute vec2 aSurface;
      uniform vec2 uSize,uCenter;
      uniform float uEm,uRadius,uCamera;
      varying float vAngle,vU;
      void main(){
        float angle=aSurface.y;
        float y=uRadius*sin(angle), z=uRadius*(cos(angle)-1.0);
        float w=1.0-z/uCamera;
        vec2 center=vec2(2.0*uCenter.x/uSize.x-1.0,1.0-2.0*uCenter.y/uSize.y);
        vec2 offset=vec2(2.0*aSurface.x*uEm/uSize.x,-2.0*y*uEm/uSize.y);
        gl_Position=vec4(center*w+offset,0.0,w);
        vAngle=angle;vU=aSurface.x+0.5;
      }`;
    const fragment = `
      precision mediump float;
      uniform sampler2D uAtlas;
      uniform float uPhase,uStep,uBlur,uLimit;
      varying float vAngle,vU;
      vec4 glyph(float phase){
        float n=phase+vAngle/uStep+0.5;
        float digit=mod(floor(n),10.0);
        vec2 uv=(vec2(mod(digit,4.0),floor(digit/4.0))*256.0+
          vec2(0.5+vU*255.0,0.5+fract(n)*255.0))/1024.0;
        return texture2D(uAtlas,uv);
      }
      void main(){
        vec4 c=vec4(0.0);
        for(int i=0;i<7;i++){
          float f=(float(i)-3.0)/3.0;
          c+=glyph(uPhase+f*uBlur)*(1.0-0.65*abs(f));
        }
        c/=4.4;
        float edge=1.0-smoothstep(uLimit*0.80,uLimit,abs(vAngle));
        float light=0.24+0.76*pow(max(0.0,cos(vAngle)),1.65);
        gl_FragColor=vec4(vec3(0.9686,0.9608,0.9412)*light,clamp(c.a*edge,0.0,1.0));
      }`;
    const compile=(kind,src)=>{
      const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    // 96 connected curved segments per reel; perspective-correct texture mapping.
    const vertices=[];
    for(let i=0;i<=96;i++){
      const a=-limit+2*limit*i/96;
      vertices.push(-.5,a,.5,a);
    }
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    const attr=gl.getAttribLocation(program,"aSurface");
    gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
    for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const u=Object.fromEntries(["uSize","uCenter","uEm","uRadius","uCamera","uAtlas","uPhase","uStep","uBlur","uLimit"].map(n=>[n,gl.getUniformLocation(program,n)]));
    gl.uniform1i(u.uAtlas,0);gl.uniform1f(u.uRadius,radius);
    gl.uniform1f(u.uCamera,camera);gl.uniform1f(u.uStep,step);gl.uniform1f(u.uLimit,limit);
    gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    return {
      resize(w,h,dpr){gl.viewport(0,0,Math.round(w*dpr),Math.round(h*dpr));gl.uniform2f(u.uSize,w,h);},
      clear(){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);},
      draw(d,pos,speed){
        gl.uniform2f(u.uCenter,d.x,d.y);gl.uniform1f(u.uEm,d.em);
        gl.uniform1f(u.uPhase,pos);gl.uniform1f(u.uBlur,Math.min(.38,speed*8));
        gl.drawArrays(gl.TRIANGLE_STRIP,0,vertices.length/2);
      }
    };
  }

  // CPU fallback: project the same curved cylindrical mesh in narrow strips.
  // This preserves curvature and depth even if WebGL is disabled.
  function cpuRenderer(atlas) {
    const ctx=canvas.getContext("2d");
    if(!ctx)return null;
    let w=0,h=0;
    const project=a=>{
      const z=radius*(Math.cos(a)-1), scale=camera/(camera-z);
      return {y:radius*Math.sin(a)*scale, scale};
    };
    return {
      resize(width,height,dpr){w=width;h=height;ctx.setTransform(dpr,0,0,dpr,0,0);},
      clear(){ctx.clearRect(0,0,w,h);},
      draw(d,pos,speed){
        const n=160, blur=Math.min(.38,speed*8);
        const samples=blur>.015?[[-blur,.25],[0,.5],[blur,.25]]:[[0,1]];
        for(let i=0;i<n;i++){
          const a=-limit+2*limit*i/n,b=-limit+2*limit*(i+1)/n,mid=(a+b)/2;
          const p=project(a),q=project(b),m=project(mid);
          const dy=d.y+p.y*d.em, dh=Math.max(.25,(q.y-p.y)*d.em+.4);
          const dx=d.x-d.em*m.scale/2,dw=d.em*m.scale;
          const edge=Math.min(1,Math.max(0,(limit-Math.abs(mid))/(limit*.2)));
          const shade=.24+.76*Math.pow(Math.cos(mid),1.65);
          for(const [offset,weight] of samples){
            const index=pos+offset+mid/step+.5;
            const digit=((Math.floor(index)%10)+10)%10;
            const fraction=index-Math.floor(index);
            const sy=Math.min(cell-1,Math.max(0,fraction*cell));
            const sh=Math.min(cell-sy,Math.max(1,(b-a)/step*cell));
            ctx.globalAlpha=shade*edge*weight;
            ctx.drawImage(atlas,(digit%4)*cell,Math.floor(digit/4)*cell+sy,cell,sh,dx,dy,dw,dh);
          }
        }
        ctx.globalAlpha=1;
      }
    };
  }

  function resize(){
    const box=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
    if(!box.width||!box.height)return;
    canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);
    renderer?.resize(box.width,box.height,dpr);
    for(const d of drums){
      const r=d.wheel.getBoundingClientRect();
      d.x=r.left-box.left+r.width/2;d.y=r.top-box.top+r.height/2;
      d.em=parseFloat(getComputedStyle(d.wheel).fontSize)||100;
    }
    needsResize=false;
  }

  function updateProgress(elapsed){
    const value=Math.max(0,Math.min(1,elapsed/totalDuration));
    fill.style.transform="scaleX("+value+")";
    const percent=Math.floor(value*100);
    if(percent!==lastPercent){lastPercent=percent;progress.setAttribute("aria-valuenow",String(percent));}
  }
  function settle(d){
    if(d.settled)return;
    d.settled=true;d.digit.textContent=String(d.end);
    d.wheel.classList.add("is-settled");d.wheel.classList.remove("is-spinning");
  }
  function finish(){
    if(finished)return;
    finished=true;cancelAnimationFrame(frame);renderer?.clear();
    drums.forEach(settle);updateProgress(totalDuration);label.textContent="2026";
    root.classList.add("loading-complete");
    document.dispatchEvent(new Event("loading-complete"));
  }
  function motion(t,duration,steps){
    const speed=steps/(duration-(acceleration+braking)/2);
    if(t<acceleration)return {p:speed*t*t/(2*acceleration),v:speed*t/acceleration};
    if(t<duration-braking)return {p:speed*(t-acceleration/2),v:speed};
    const r=Math.max(0,duration-t);
    return {p:steps-speed*r*r/(2*braking),v:speed*r/braking};
  }
  function render(now){
    if(finished)return;
    if(startedAt===null){startedAt=now;root.classList.add("loading-ready");}
    updateProgress(now-startedAt);
    const elapsed=now-startedAt-initialHold;
    if(needsResize)resize();
    renderer?.clear();
    if(elapsed>=0){
      for(const d of drums){
        if(d.settled)continue;
        if(elapsed>=d.duration){settle(d);continue;}
        const m=motion(elapsed,d.duration,d.steps);
        if(renderer){d.wheel.classList.add("is-spinning");renderer.draw(d,d.start+m.p,m.v);}
      }
      if(drums.every(d=>d.settled)){finish();return;}
    }
    frame=requestAnimationFrame(render);
  }

  if(reduced.matches){finish();return;}
  reduced.addEventListener?.("change",()=>{if(reduced.matches)finish();});
  addEventListener("resize",()=>{needsResize=true;},{passive:true});
  function launch(){
    if(launched||finished)return;
    launched=true;
    try{
      const atlas=makeAtlas();
      try{renderer=webGLRenderer(atlas);}catch{
        const replacement=canvas.cloneNode(false);
        canvas.replaceWith(replacement);canvas=replacement;
      }
      if(!renderer)renderer=cpuRenderer(atlas);
    }catch{renderer=null;}
    frame=requestAnimationFrame(render);
  }
  setTimeout(launch,1200);
  if(document.fonts?.ready)document.fonts.ready.then(launch,launch);else launch();
})();
