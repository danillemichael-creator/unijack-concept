// UniJack local navigation: disclosure on phones, current-section marker.
(() => {
 const nav = document.querySelector('#local-nav');
 if (!nav) return;
 const toggle = nav.querySelector('#local-nav-toggle');
 const links = [...nav.querySelectorAll('.local-nav-links a')];
 const setOpen = open => {
  nav.dataset.open = String(open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Hide UniJack sections' : 'Show UniJack sections');
 };
 toggle.addEventListener('click', () => setOpen(nav.dataset.open !== 'true'));
 links.forEach(a => a.addEventListener('click', () => setOpen(false)));
 document.addEventListener('click', e => { if (!nav.contains(e.target)) setOpen(false); });
 document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.dataset.open === 'true') { setOpen(false); toggle.focus(); } });

 // Mark the section that holds the middle of the viewport.
 const targets = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
 let ticking = false;
 const mark = () => {
  ticking = false;
  const mid = innerHeight * .45;
  let current = null;
  for (const t of targets) { const r = t.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) current = t; }
  links.forEach(a => a.toggleAttribute('aria-current', current && a.getAttribute('href') === '#' + current.id));
  links.forEach(a => { if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'true'); });
 };
 addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } }, {passive: true});
 mark();
})();
