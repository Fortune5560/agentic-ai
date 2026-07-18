/* Agentic AI — progressive enhancement.
   Safe to block or fail: all content stays visible without JavaScript. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Mark JS availability so CSS can gate hidden-then-revealed styles. */
  document.documentElement.classList.add('js');

  /* ---- Decorative starfield (pages with <body data-stars>) ---- */
  if (document.body.hasAttribute('data-stars') && !reduceMotion) {
    var stars = document.createElement('div');
    stars.id = 'stars';
    stars.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stars);
    for (var i = 0; i < 150; i++) {
      var s = document.createElement('div');
      s.classList.add('star');
      var size = Math.random() * 2 + 'px';
      s.style.width = size;
      s.style.height = size;
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDuration = 10 + Math.random() * 20 + 's';
      stars.appendChild(s);
    }
  }

  /* ---- Scroll-reveal for sections and blueprint articles ---- */
  var els = Array.prototype.slice.call(
    document.querySelectorAll('main section, article.blueprint, .bp-nav')
  );
  els.forEach(function (el) { el.classList.add('reveal'); });

  if (reduceMotion || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---- Back-to-top button ---- */
  var btn = document.createElement('button');
  btn.className = 'to-top';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Back to top');
  btn.textContent = '↑';
  document.body.appendChild(btn);

  function onScroll() {
    btn.classList.toggle('show', window.scrollY > 600);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  btn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
})();
