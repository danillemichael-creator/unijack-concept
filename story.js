import { STORY, span, easeInOut, easeOut } from './motion.js';

// Scroll story controller. It owns scroll → progress, the pinned stage UI and
// the schematic overlay. three.js is loaded later; everything here works
// without it, so the page is usable before (or without) the 3D view.
const root = document.documentElement;
const storyOn = root.dataset.story === 'on';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 959px)');
const stage = document.querySelector('#product-stage');
const assemblyStage = document.querySelector('#assembly-stage');
const sections = {
 platform: document.querySelector('#platform'),
 assembly: document.querySelector('.assembly-section'),
 routing: document.querySelector('#routing'),
 panel: document.querySelector('#routing .routing-panel'),
 graphic: document.querySelector('#routing .approved-routing-graphic')
};
const callout = document.querySelector('#callout-label');
const CALLOUTS = {
 assembled:'UniJack ecosystem<span>PLATFORM · CONTROLLER · PERIPHERALS</span>',
 exploded:'One connected ecosystem<span>PLATFORM · CONTROLLER · PERIPHERALS</span>',
 routing:'ERAU routing fabric<span>ILLUSTRATIVE SIGNAL PATHS</span>'
};
const VIEW_PROGRESS = {assembled:0, exploded:.5, routing:1};

let scene = null, lastFrame = null, sceneLoading = null, knots = [], handoff = {from:0,to:1}, vh = innerHeight;
let progress = 0, handoffT = 0, currentView = 'assembled', ticking = false, staticView = 'assembled';
const listeners = new Set();

// Canvas host and decorative leader labels (created here; they carry no copy).
const host = document.createElement('div');
host.className = 'stage-canvas';
host.setAttribute('aria-hidden', 'true');
const labels = ['UniJack', 'Mercury', 'PeriBoard'].map(name => {
 const el = document.createElement('span');
 el.className = 'stage-label';
 el.textContent = name;
 host.append(el);
 return el;
});
stage.prepend(host);

// ---------- Schematic overlay (assets/erau-routing-approved.svg) ----------
const overlay = document.createElement('div');
overlay.className = 'story-schematic';
overlay.setAttribute('aria-hidden', 'true');
let overlayGroups = null, overlayBox = null;
const TRACE_KIND = {'#ff862f':'route','#ff852f':'route','#ff842a':'route','#2fdc64':'cross','#30dc62':'cross','#ffe11d':'loopback','#ffe61d':'loopback','#129cf4':'fanout','#0d9ff4':'fanout'};
async function loadSchematic(){
 try {
  const response = await fetch(new URL('./assets/erau-routing-approved.svg', import.meta.url));
  if (!response.ok) throw new Error(response.status);
  const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  svg.querySelectorAll('title,desc').forEach(n => n.remove());
  svg.removeAttribute('role'); svg.removeAttribute('aria-labelledby');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  // Keep ids unique next to the inline explorer drawing.
  svg.querySelectorAll('[id]').forEach(n => n.id = 'story-' + n.id);
  svg.querySelectorAll('[fill="url(#grid)"]').forEach(n => n.setAttribute('fill', 'url(#story-grid)'));
  const style = svg.querySelector('style');
  if (style) style.textContent = style.textContent.replace(/(^|})\s*text\{/, '$1.story-schematic text{').replace(/\.(heading|small|legend|ch|region|terminal|trace|core|coretxt|gate)\b/g, '.story-schematic .$1');
  const groups = {route:[], cross:[], loopback:[], fanout:[], logic:[], dashed:[], rest:[]};
  svg.querySelectorAll('.trace').forEach(el => {
   if (el.closest('.legend')) return;
   const dashed = el.hasAttribute('stroke-dasharray');
   const kind = dashed ? 'logic' : TRACE_KIND[el.getAttribute('stroke')];
   if (!kind) return;
   el.dataset.kind = kind;
   if (!dashed) { el.setAttribute('pathLength', '1'); el.style.strokeDasharray = '1 1'; }
   groups[kind].push(el);
  });
  // Everything that is not a trace fades in as one drawing.
  [...svg.children].forEach(el => { if (!/^(defs|style)$/.test(el.tagName) && !el.matches('.trace')) groups.rest.push(el); });
  overlay.append(svg);
  overlayGroups = groups;
  root.dataset.schematic = 'ready';
  update(true);
 } catch (error) {
  console.warn('Story schematic unavailable', error);
  root.dataset.schematic = 'unavailable';
 }
}

// ---------- Scroll → progress ----------
const docTop = el => el.getBoundingClientRect().top + scrollY;
function measure(){
 vh = innerHeight;
 if (!storyOn) return;
 const yPlatform = docTop(sections.platform), yAsm = docTop(sections.assembly);
 const yAsmEnd = yAsm + sections.assembly.offsetHeight, yRoute = docTop(sections.routing), yPanel = docTop(sections.panel);
 // On phones the routing copy must clear the pinned stage before the drawing starts.
 const copy = document.querySelector('.routing-copy');
 const copyEnd = docTop(copy) + copy.offsetHeight - parseFloat(getComputedStyle(copy).paddingBottom);
 const raw = [[0,0],[yPlatform - vh*.4,STORY.yaw[1]],[yAsm - vh*.05,STORY.pull[1]],[yAsmEnd - vh*.95,STORY.hold[1]],[compact.matches ? copyEnd - vh*.05 : yRoute + vh*.05,STORY.topDown[1]],[yPanel - vh*.9,1]];
 knots = []; let prev = -1;
 for (const [y,p] of raw) { const value = Math.max(prev + 1, y); knots.push([value,p]); prev = value; }
 const graphicTop = docTop(sections.graphic);
 handoff = {from: knots.at(-1)[0], to: Math.max(knots.at(-1)[0] + vh*.35, graphicTop - vh*.16)};
}
function progressAt(y){
 if (y <= knots[0][0]) return 0;
 for (let i = 1; i < knots.length; i++) {
  const [y0,p0] = knots[i-1], [y1,p1] = knots[i];
  if (y <= y1) return p0 + (p1 - p0) * (y - y0) / (y1 - y0);
 }
 return 1;
}
function scrollForProgress(p){
 for (let i = 1; i < knots.length; i++) {
  const [y0,p0] = knots[i-1], [y1,p1] = knots[i];
  if (p <= p1) return y0 + (y1 - y0) * (p - p0) / (p1 - p0 || 1);
 }
 return knots.at(-1)[0];
}

// ---------- Render the non-3D parts of the stage ----------
function viewFor(p){ return p < STORY.yaw[1] ? 'assembled' : p < STORY.leave[0] + .05 ? 'exploded' : 'routing'; }
function setView(view){
 if (view === currentView) return;
 currentView = view;
 document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
 if (callout) callout.innerHTML = CALLOUTS[view];
 stage.dataset.stageView = view;
}
function stageRegion(){ return host.getBoundingClientRect(); }
function layoutOverlay(){
 if (!overlayGroups) return;
 const region = stageRegion(), rect = lastFrame?.baseRect;
 let width, x, y;
 if (storyOn && rect && !compact.matches) { width = rect.width; x = region.left + rect.x; y = region.top + rect.y + rect.height/2 - width*941/1672/2; }
 else { width = Math.min(region.width * .92, 1100); x = region.left + (region.width - width)/2; y = region.top + (region.height - width*941/1672)/2; }
 overlayBox = {x, y: storyOn ? y : y - region.top, width, height: width*941/1672, left: x - region.left};
 overlay.style.width = width + 'px'; overlay.style.height = overlayBox.height + 'px';
}
function drawSchematic(p, h){
 if (!overlayGroups) return;
 const s = span(p, STORY.schematic);
 overlay.style.opacity = '1';
 overlayGroups.rest.forEach(el => el.style.opacity = String(s));
 const mode = sections.graphic?.closest('[data-signal-mode]')?.dataset.signalMode || 'route';
 const settle = easeInOut(span(h, [.1, .7]));
 for (const kind of ['route','cross','loopback','fanout','logic']) {
  const d = easeOut(span(p, STORY.draw[kind]));
  const active = kind === mode;
  overlayGroups[kind].forEach(el => {
   if (kind === 'logic') el.style.opacity = String(d * (active ? 1 : 1 - .82*settle));
   else { el.style.strokeDashoffset = String(1 - d); el.style.opacity = d > 0 ? String(active ? 1 : 1 - .82*settle) : '0'; }
   el.style.strokeWidth = active ? String(5.5 + 1.5*settle) : '';
  });
 }
 if (storyOn && overlayBox && compact.matches) {
  // Phones: the drawing stays in the pinned stage, under the copy, and
  // simply fades with it; the explorer below is always fully visible.
  overlay.style.transform = `translate3d(${overlayBox.x}px,${overlayBox.y}px,0)`;
  overlay.style.opacity = String(s * (1 - easeInOut(span(h, [0, .55]))));
  root.style.setProperty('--handoff', '1');
 } else if (storyOn && overlayBox) {
  // Carry the drawing onto the explorer's own schematic, then hand over.
  let x = overlayBox.x, y = overlayBox.y, scale = 1;
  if (h > 0 && sections.graphic) {
   const target = sections.graphic.getBoundingClientRect(), t = easeInOut(span(h, [0, .85]));
   x += (target.left - x) * t; y += (target.top - y) * t; scale = 1 + (target.width / overlayBox.width - 1) * t;
  }
  overlay.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
  const swap = easeOut(span(h, [.72, 1]));
  overlay.style.opacity = String(s > 0 ? 1 - swap : 0);
  root.style.setProperty('--handoff', swap.toFixed(3));
 } else if (overlayBox) {
  overlay.style.transform = `translate3d(${overlayBox.left}px,${overlayBox.y}px,0)`;
  overlay.style.opacity = String(s);
 }
}
function placeLabels(frame){
 frame.labels.forEach((l, i) => {
  labels[i].style.transform = `translate3d(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px,0)`;
  labels[i].style.opacity = l.o.toFixed(3);
 });
}

function update(force = false){
 ticking = false;
 if (storyOn) {
  const y = scrollY;
  const p = progressAt(y);
  const h = Math.min(1, Math.max(0, (y - handoff.from) / (handoff.to - handoff.from)));
  if (!force && p === progress && h === handoffT) return;
  progress = p; handoffT = h;
  setView(viewFor(p));
  root.dataset.chapter = p > STORY.pull[0] + .2 && p < STORY.leave[0] + .02 ? 'assembly' : 'story';
  stage.style.setProperty('--fade', (1 - easeInOut(span(h, [0, .55]))).toFixed(3));
  stage.style.setProperty('--dim', span(p, STORY.dim).toFixed(3));
  root.dataset.handoff = h >= 1 ? 'done' : 'pending';
  stage.dataset.visible = String(h < 1);
  scene?.setActive(h < 1 && !document.hidden);
  scene?.setProgress(p);
  drawSchematic(p, h);
 } else {
  drawSchematic(VIEW_PROGRESS[staticView] >= 1 ? 1 : 0, 0);
 }
 listeners.forEach(fn => fn(progress));
}
function requestUpdate(){ if (!ticking) { ticking = true; requestAnimationFrame(() => update()); } }

// ---------- Scene loading ----------
function loadScene(){
 if (sceneLoading) return sceneLoading;
 stage.dataset.webgl = 'loading';
 sceneLoading = (async () => {
  try {
   const {createStoryScene} = await import('./story-scene.js');
   scene = await createStoryScene(host, {
    lite: storyOn && compact.matches,
    instant: !storyOn || reduced.matches,
    onFrame: frame => { lastFrame = frame; placeLabels(frame); }
   });
   stage.dataset.webgl = 'ready'; stage.classList.add('ready');
   root.dataset.scene = 'ready';
   return scene;
  } catch (error) {
   console.error('3D view unavailable', error);
   stage.dataset.webgl = 'unavailable'; stage.classList.add('no-webgl');
   root.dataset.scene = 'unavailable';
   return null;
  }
 })();
 return sceneLoading;
}

function init(){
 if (storyOn) document.body.append(overlay); else stage.append(overlay);
 measure();
 addEventListener('scroll', requestUpdate, {passive: true});
 const relayout = () => { measure(); layoutOverlay(); update(true); };
 addEventListener('resize', relayout);
 new ResizeObserver(relayout).observe(document.body);
 document.fonts?.ready.then(relayout);
 document.addEventListener('visibilitychange', () => scene?.setActive(!document.hidden && (!storyOn || handoffT < 1)));
 loadSchematic().then(() => { layoutOverlay(); update(true); });
 update(true);
 // Load three.js after first paint, when the browser is idle.
 const start = () => (window.requestIdleCallback || (fn => setTimeout(fn, 200)))(() => loadScene().then(s => { if (s) { layoutOverlay(); update(true); } }), {timeout: 1500});
 if (root.dataset.saveData === 'on') return;
 if (document.readyState === 'complete') start(); else addEventListener('load', start, {once: true});
}

export const story = {
 on: storyOn,
 init,
 loadScene,
 get scene(){ return scene; },
 get progress(){ return progress; },
 onProgress(fn){ listeners.add(fn); return () => listeners.delete(fn); },
 // Stage buttons: in the story they scroll to their stage; otherwise they jump.
 goTo(view){
  if (storyOn) {
   const behavior = reduced.matches ? 'instant' : 'smooth';
   scrollTo({top: scrollForProgress(VIEW_PROGRESS[view] === 1 ? .995 : VIEW_PROGRESS[view]), behavior});
   return;
  }
  staticView = view; setViewStatic(view);
 },
 inAssemblyRange(p = progress){ return p > STORY.pull[0] + .2 && p < STORY.leave[0] + .02; },
 scrollFor(p){ return scrollForProgress(p); },
 measure,
 relayout(){ measure(); layoutOverlay(); update(true); }
};
function setViewStatic(view){
 currentView = '';
 setView(view);
 loadScene().then(s => { s?.setProgress(VIEW_PROGRESS[view] === 1 ? STORY.topDown[1] + .2 : VIEW_PROGRESS[view]); layoutOverlay(); update(true); });
}
