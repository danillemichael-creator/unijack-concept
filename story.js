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
// No leader labels: the page adds no text of its own to the stage.
const labels = [];
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
 // Knots sit where section edges cross the story line (near the bottom of the
 // viewport), so the pinned story spans ~2.2 screens on desktop and ~1.5 on
 // phones and finishes just as the explorer panel enters.
 const mid = y => y - vh * LINE;
 const raw = [[0,0],[mid(yPlatform),STORY.yaw[1]],[mid(yAsm),STORY.pull[1]],[mid(yAsmEnd),STORY.hold[1]],[mid(yRoute) + (yPanel - yRoute) * .3,STORY.topDown[1]],[mid(yPanel),1]];
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

// ---------- Stage text: each beat's copy pins above the board and fades ----------
// A beat's text fades in over the last stretch of its travel into the band and
// fades out as its beat runs out. The hero only fades out.
// Story text is fixed in the band above the board. Each block shows while its
// section (an in-flow spacer) spans the middle of the viewport; opacity and a
// small rise follow the scroll position directly — nothing is time-based.
const windows = [
 ['.beat-proof', '.beat-proof .story-text'],
 ['#platform', '#platform .story-text'],
 ['.assembly-section', '.assembly-section .assembly-copy'],
 ['.beat-routing', '.beat-routing .story-text'],
 ['.beat-stats', '.beat-stats .story-text']
].map(([s, e]) => ({section: document.querySelector(s), el: document.querySelector(e), top: 0, bottom: 0, o: -1}));
const heroText = [...document.querySelectorAll('.hero > .hero-copy, .hero > .hero-bottom')];
const LINE = .95; // the story line, as a share of the viewport height
const smooth = t => t * t * (3 - 2 * t);
const clamp01 = v => Math.min(1, Math.max(0, v));
function measureWindows(){
 for (const w of windows) { w.top = docTop(w.section); w.bottom = w.top + w.section.offsetHeight; }
}
function fadeBeats(){
 const centre = scrollY + vh * LINE;
 let assembly = false;
 for (const w of windows) {
  const ramp = Math.min(vh * .08, (w.bottom - w.top) * .3);
  const o = smooth(clamp01((centre - w.top) / ramp)) * smooth(clamp01((w.bottom - centre) / ramp));
  if (w.el === windows[2].el && o > .5) assembly = true;
  if (Math.abs(o - w.o) < .002) continue;
  w.o = o;
  const rising = centre < (w.top + w.bottom) / 2;
  w.el.style.opacity = o.toFixed(3);
  w.el.style.transform = o >= .999 ? '' : `translate3d(0,${((1 - o) * (rising ? 14 : -10)).toFixed(1)}px,0)`;
  w.el.dataset.live = String(o > .5);
 }
 root.dataset.chapter = assembly ? 'assembly' : 'story';
 const h = 1 - smooth(clamp01(scrollY / (vh * .16)));
 heroText.forEach(el => { el.style.opacity = h.toFixed(3); el.style.pointerEvents = h > .5 ? '' : 'none'; });
}
// Keyboard focus moving into faded story text brings its section into view first.
function revealOnFocus(event){
 const w = windows.find(w => w.el.contains(event.target));
 if (!w || w.o > .9) return;
 scrollTo({top: (w.top + w.bottom) / 2 - vh * LINE, behavior: 'instant'});
}
// The scene frames the board in the region below the tallest story text.
function computeFrame(){
 const stageTop = stage.getBoundingClientRect().top;
 let band = 0;
 for (const w of windows) {
  const block = w.el.matches('.assembly-copy') ? w.el.querySelector('.part-text') : w.el;
  band = Math.max(band, block.getBoundingClientRect().bottom - stageTop);
 }
 // At the top of the page the board sits below the (taller) hero copy.
 const heroEnd = document.querySelector(compact.matches ? '.hero-bottom' : '.hero-actions');
 const heroBottom = heroEnd.getBoundingClientRect().bottom + scrollY - stageTop; // position at scroll 0
 return {top: Math.round(band + (compact.matches ? 12 : 20)), bottom: compact.matches ? 120 : 24, hero: Math.round(heroBottom + (compact.matches ? 8 : 24))};
}
function frameScene(){
 if (!storyOn) return;
 const f = computeFrame();
 placeGlow(f);
 scene?.setFrame(f.top, f.bottom, f.hero);
}
// Loading glow (and the still image, if it is needed) sit where the board
// will land on the first screen, using the same framing as the scene.
function placeGlow(f){
 const W = stage.clientWidth, H = stage.clientHeight, region = Math.max(H * .3, H - f.top - f.bottom);
 const lowered = f.hero > f.top;
 const y = f.top + region / 2 + (lowered ? (f.hero - f.top) * .62 : 0);
 const w = (compact.matches ? W * .94 : Math.min(W * .8, 1200)) / (lowered ? 1.18 : 1);
 stage.style.setProperty('--glow-y', `${Math.round(y)}px`);
 stage.style.setProperty('--glow-w', `${Math.round(w)}px`);
 // The still photo fits between the hero copy and the stage controls.
 const room = Math.max(120, H - f.hero - (compact.matches ? 104 : 92));
 const stillH = Math.min(w / 1.78, room);
 stage.style.setProperty('--still-top', `${Math.round(f.hero + (room - stillH) / 2)}px`);
 stage.style.setProperty('--still-h', `${Math.round(stillH)}px`);
 stage.style.setProperty('--still-w', `${Math.round(Math.min(w, stillH * 1.78))}px`);
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
// Rasterise the drawing once, almost transparent, so its first real frame
// during the story does not pay for the initial paint.
let prewarmed = false;
function prewarmOverlay(){
 if (prewarmed || !storyOn || !overlayGroups || !overlayBox || !scene) return;
 prewarmed = true;
 overlay.style.opacity = '.004';
 overlay.style.transform = `translate3d(${overlayBox.x}px,${overlayBox.y}px,0)`;
 overlayGroups.rest.forEach(el => el.style.opacity = '1');
 requestAnimationFrame(() => requestAnimationFrame(() => update(true)));
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
  if (!labels[i]) return;
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
  if (!force && p === progress && h === handoffT) { fadeBeats(); return; }
  progress = p; handoffT = h;
  setView(viewFor(p));
  stage.style.setProperty('--fade', (1 - easeInOut(span(h, [0, .55]))).toFixed(3));
  stage.style.setProperty('--dim', span(p, STORY.dim).toFixed(3));
  root.dataset.handoff = h >= 1 ? 'done' : 'pending';
  stage.dataset.visible = String(h < 1);
  scene?.setActive(h < 1 && !document.hidden);
  scene?.setProgress(p);
  drawSchematic(p, h);
  fadeBeats();
 } else {
  drawSchematic(VIEW_PROGRESS[staticView] >= 1 ? 1 : 0, 0);
 }
 listeners.forEach(fn => fn(progress));
}
function requestUpdate(){ if (!ticking) { ticking = true; requestAnimationFrame(() => update()); } }

// ---------- Scene loading ----------
// If the board is not ready about 4s after the hero text first paints, the
// glow gives way to the still photograph for the rest of this visit.
const STILL_AFTER_MS = 4000, STILL = Symbol('still');
let abandoned = false, stillAt = Infinity;
const shouldStop = () => storyOn && (abandoned || performance.now() > stillAt);
// Fetch the still photo early when the board is slow, so it is ready in time.
function prefetchStill(){
 if (scene || !storyOn) return;
 const img = stage.querySelector('.scene-fallback'), pre = new Image();
 pre.sizes = img.sizes; pre.srcset = img.srcset; pre.src = img.src;
}
const stillDeadline = new Promise(resolve => {
 const arm = start => {
  stillAt = start + STILL_AFTER_MS;
  setTimeout(prefetchStill, Math.max(0, start + 1800 - performance.now()));
  setTimeout(() => resolve(STILL), Math.max(0, stillAt - performance.now()));
 };
 const fcp = performance.getEntriesByName('first-contentful-paint')[0];
 if (fcp) { arm(fcp.startTime); return; }
 try {
  new PerformanceObserver((list, observer) => {
   for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') { observer.disconnect(); arm(e.startTime); }
  }).observe({type: 'paint', buffered: true});
 } catch { arm(performance.now()); }
});
function showStill(){
 stage.dataset.webgl = 'unavailable'; stage.classList.add('no-webgl');
 const img = stage.querySelector('.scene-fallback');
 const shown = () => img.classList.add('is-loaded');
 if (img.complete && img.naturalWidth) shown(); else img.addEventListener('load', shown, {once: true});
}
function loadScene(){
 if (sceneLoading) return sceneLoading;
 stage.dataset.webgl = 'loading';
 sceneLoading = (async () => {
  try {
   const creating = import('./story-scene.js').then(({createStoryScene}) => shouldStop() ? STILL : createStoryScene(host, {
    shouldStop,
    lite: storyOn && compact.matches,
    instant: !storyOn || reduced.matches,
    onFrame: frame => { if (abandoned) return; lastFrame = frame; placeLabels(frame); stage.style.setProperty('--intro', frame.intro.toFixed(3)); }
   }));
   const settle = creating.catch(error => { if (error?.message === 'cancelled') return STILL; throw error; });
   const winner = storyOn ? await Promise.race([settle, stillDeadline]) : await settle;
   if (winner === STILL) {
    abandoned = true;
    creating.then(late => late !== STILL && late?.dispose(), () => {});
    showStill();
    root.dataset.scene = 'unavailable'; root.dataset.still = 'timeout';
    return null;
   }
   scene = winner;
   stage.dataset.webgl = 'ready'; stage.classList.add('ready');
   frameScene();
   root.dataset.scene = 'ready';
   return scene;
  } catch (error) {
   console.error('3D view unavailable', error);
   showStill();
   root.dataset.scene = 'unavailable';
   return null;
  }
 })();
 return sceneLoading;
}

function init(){
 if (storyOn) document.body.append(overlay); else stage.append(overlay);
 measure(); measureWindows(); frameScene();
 addEventListener('scroll', requestUpdate, {passive: true});
 if (storyOn) document.addEventListener('focusin', revealOnFocus);
 const relayout = () => { measure(); measureWindows(); frameScene(); layoutOverlay(); update(true); };
 addEventListener('resize', relayout);
 new ResizeObserver(relayout).observe(document.body);
 document.fonts?.ready.then(relayout);
 document.addEventListener('visibilitychange', () => scene?.setActive(!document.hidden && (!storyOn || handoffT < 1)));
 loadSchematic().then(() => { layoutOverlay(); update(true); prewarmOverlay(); });
 update(true);
 if (root.dataset.saveData === 'on') return;
 // The board is the hero: start loading right after first paint.
 requestAnimationFrame(() => setTimeout(() => loadScene().then(s => { if (s) { layoutOverlay(); update(true); prewarmOverlay(); } }), 0));
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
 inAssemblyRange(p = progress){ return p > STORY.pull[1] - .03 && p < STORY.hold[1] + .03; },
 scrollFor(p){ return scrollForProgress(p); },
 measure,
 relayout(){ measure(); measureWindows(); frameScene(); layoutOverlay(); update(true); }
};
function setViewStatic(view){
 currentView = '';
 setView(view);
 loadScene().then(s => { s?.setProgress(VIEW_PROGRESS[view] === 1 ? STORY.topDown[1] + .2 : VIEW_PROGRESS[view]); layoutOverlay(); update(true); });
}
