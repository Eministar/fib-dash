'use client';

import { useEffect, useRef } from 'react';

const vertex = `attribute vec2 a_position;
void main(){gl_Position=vec4(a_position,0.,1.);}`;
const fragment = `precision mediump float;
uniform vec2 u_resolution;
uniform float u_scroll;
uniform float u_time;
uniform vec2 u_pointer;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
void main(){
 vec2 uv=gl_FragCoord.xy/u_resolution;
 vec2 p=(gl_FragCoord.xy-.5*u_resolution)/u_resolution.y;
 p+=u_pointer*.035;
 float s=u_scroll*2.5;
 p+=vec2(sin(u_time*.045)*.15,cos(u_time*.035)*.12);
 float n=noise(p*3.+vec2(s*.4,s*.2));
 n+=.5*noise(p*6.+vec2(n,s*.3));
 n+=.25*noise(p*12.+n);
 float beam=exp(-pow((p.x-.19+sin(p.y*1.8+s)*.18)*2.4,2.));
 float haze=smoothstep(.3,1.4,n)*beam;
 vec3 color=mix(vec3(.028,.037,.047),vec3(.19,.25,.30),haze*.65);
 color+=(hash(gl_FragCoord.xy)-.5)*.013;
 color*=1.-.4*length(uv-.5);
 gl_FragColor=vec4(color,1.);
}`;

/** Slow ambient shader at 30 fps; scroll effects share the loop without intercepting scrolling. */
export function Cinema() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const container = canvas.closest<HTMLElement>('.fib-home');
    if (!container) return;
    const root: HTMLElement = container;
    const page = document.documentElement;
    const scenes = [...root.querySelectorAll<HTMLElement>('.scene')];
    const reveals = [...root.querySelectorAll<HTMLElement>('.reveal')];
    const pictures = [...root.querySelectorAll<HTMLElement>('.picture-reveal')];
    const footer = root.querySelector('footer');
    const revealed = new Map<HTMLElement, number>();
    let frame = 0, scroll = window.scrollY;
    let pointerX = 0, pointerY = 0, x = 0, y = 0;
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let shaders: WebGLShader[] = [];
    let resolution: WebGLUniformLocation | null = null;
    let scrollUniform: WebGLUniformLocation | null = null;
    let timeUniform: WebGLUniformLocation | null = null;
    let lastPaint = 0, elapsed = 0, layoutDirty = true;
    let pointer: WebGLUniformLocation | null = null;
    let lost = false;
    const clamp = (n: number) => Math.max(0, Math.min(1, n));

    function destroy() {
      if (gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); shaders.forEach(shader => gl!.deleteShader(shader)); }
      buffer = null; program = null; shaders = [];
      canvas!.dataset.webgl = 'fallback';
    }
    function init() {
      canvas!.dataset.webgl = 'fallback';
      if (motion.matches) return;
      try {
        gl = canvas!.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
        if (!gl) return;
        const compile = (type: number, source: string) => {
          const shader = gl!.createShader(type);
          if (!shader) throw new Error('Shader unavailable');
          shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
          if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error('Shader compilation failed');
          return shader;
        };
        const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
        program = gl.createProgram();
        if (!program) throw new Error('Program unavailable');
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
        gl.useProgram(program);
        buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const attribute = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
        resolution = gl.getUniformLocation(program,'u_resolution'); scrollUniform = gl.getUniformLocation(program,'u_scroll'); pointer = gl.getUniformLocation(program,'u_pointer');
        timeUniform = gl.getUniformLocation(program,'u_time');
        canvas!.dataset.webgl = 'ready'; resize();
      } catch { destroy(); }
    }
    function resize() {
      layoutDirty = true;
      // Bounded pixel budget even on Retina phones; CSS provides the full-size surface.
      const scale = Math.min(1, 1100 / innerWidth);
      canvas!.width = Math.round(innerWidth * scale); canvas!.height = Math.round(innerHeight * scale);
      gl?.viewport(0, 0, canvas!.width, canvas!.height); schedule();
      if (footer) root.style.setProperty('--footer-height', `${footer.getBoundingClientRect().height}px`);
    }
    function draw(now: number) {
      frame = 0;
      if (document.hidden) return;
      if (!motion.matches && now-lastPaint < 1000/30) { schedule(); return; }
      elapsed += Math.min((now-lastPaint)/1000,.05); lastPaint = now;
      const target = window.scrollY, reduced = motion.matches, height = innerHeight;
      const updateLayout = layoutDirty || Math.abs(target-scroll)>.2;
      layoutDirty = false;
      scroll += (target - scroll) * .16;
      if (Math.abs(target - scroll) < .2) scroll = target;
      x += (pointerX - x) * .09; y += (pointerY - y) * .09;
      const pageHeight = page.scrollHeight;
      root.style.setProperty('--scroll-progress', String(clamp(target / Math.max(1, pageHeight - height))));
      if (!reduced) {
        if (updateLayout) {
        // Batch geometry reads before writing the animation values.
        const sceneBoxes = scenes.map(el => el.getBoundingClientRect());
        const revealBoxes = reveals.map(el => el.getBoundingClientRect());
        const pictureBoxes = pictures.map(el => el.getBoundingClientRect());
        scenes.forEach((el, i) => {
          const rect = sceneBoxes[i]; if (rect.bottom < -100 || rect.top > height + 100) return;
          const relative = rect.top + target - scroll;
          el.style.setProperty('--scene-shift', `${-relative*.22}px`);
          el.style.setProperty('--scene-progress', String(clamp(-relative/height)));
        });
        reveals.forEach((el, i) => {
          const rect = revealBoxes[i];
          const previous = Number.parseFloat(el.style.getPropertyValue('--reveal-y')) || 0;
          const amount = Math.max(revealed.get(el) || 0, clamp((height*.94 - (rect.top-previous+target-scroll)) / (height*.30)));
          revealed.set(el, amount);
          const eased = 1-Math.pow(1-amount,3);
          el.style.setProperty('--reveal-y', `${(1-eased)*32}px`);
          el.style.setProperty('--reveal-opacity', String(.12+eased*.88));
        });
        pictures.forEach((el, i) => {
          const rect = pictureBoxes[i]; if (rect.bottom < -100 || rect.top > height+100) return;
          const entrance = Math.max(revealed.get(el) || 0, clamp((height*.98-rect.top-target+scroll)/(height*.55)));
          revealed.set(el, entrance);
          const eased = 1-Math.pow(1-entrance,3);
          const amount = (height*.5-rect.top)/height;
          el.style.setProperty('--picture-opacity', String(eased));
          el.style.setProperty('--portrait-shift', `${el.classList.contains('contact-picture') ? 0 : Math.max(-12,Math.min(12,amount*14))+(1-eased)*22}px`);
          el.style.setProperty('--portrait-scale', String(1.025-eased*.025));
        });
        }
        if (gl && program && !lost) {
          gl.uniform1f(timeUniform, elapsed);
          gl.uniform2f(resolution, canvas!.width, canvas!.height);
          gl.uniform1f(scrollUniform, scroll/Math.max(1,pageHeight-height));
          gl.uniform2f(pointer, x, y); gl.drawArrays(gl.TRIANGLES,0,6);
        }
      }
      if (!reduced && ((gl && program && !lost) || Math.abs(target-scroll)>.2 || Math.abs(pointerX-x)>.002 || Math.abs(pointerY-y)>.002)) schedule();
    }
    function schedule() { if (!frame && !document.hidden) frame=requestAnimationFrame(draw); }
    function onPointer(event: PointerEvent) { if (event.pointerType !== 'mouse' || motion.matches) return; pointerX=event.clientX/innerWidth-.5; pointerY=event.clientY/innerHeight-.5; schedule(); }
    function onMotion() {
      layoutDirty = true;
      destroy(); [...scenes,...reveals,...pictures].forEach(el=>el.removeAttribute('style'));
      if (!motion.matches) init(); schedule();
    }
    function onLost(event: Event) { event.preventDefault(); lost=true; canvas!.dataset.webgl='fallback'; }
    function onRestored() { lost=false; destroy(); init(); schedule(); }
    function onVisibility() { if (document.hidden) { cancelAnimationFrame(frame); frame=0; } else schedule(); }
    init(); resize(); schedule();
    const observer = new ResizeObserver(() => { layoutDirty=true; schedule(); }); observer.observe(document.body);
    const footerObserver = new ResizeObserver(resize); if (footer) footerObserver.observe(footer);
    window.addEventListener('scroll',schedule,{passive:true}); window.addEventListener('resize',resize);
    window.addEventListener('pointermove',onPointer,{passive:true});
    document.addEventListener('visibilitychange',onVisibility); motion.addEventListener('change',onMotion);
    canvas.addEventListener('webglcontextlost',onLost); canvas.addEventListener('webglcontextrestored',onRestored);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); footerObserver.disconnect(); destroy();
      window.removeEventListener('scroll',schedule); window.removeEventListener('resize',resize); window.removeEventListener('pointermove',onPointer);
      document.removeEventListener('visibilitychange',onVisibility); motion.removeEventListener('change',onMotion);
      canvas.removeEventListener('webglcontextlost',onLost); canvas.removeEventListener('webglcontextrestored',onRestored);
      [...scenes,...reveals,...pictures].forEach(el=>el.removeAttribute('style')); root.style.removeProperty('--scroll-progress'); root.style.removeProperty('--footer-height');
    };
  }, []);
  return <><div className="atmosphere" aria-hidden="true"><canvas className="webgl-canvas" ref={canvasRef}/></div><div className="scroll-progress" aria-hidden="true"/></>;
}
