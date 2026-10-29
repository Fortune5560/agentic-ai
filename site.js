/* Fortune Owivri — portfolio progressive enhancement.
   Safe to block or fail: every page is fully readable without JavaScript. */
(function () {
  'use strict';

  /* matchMedia is optional: a missing implementation is treated as "no
     preference expressed", which is the safe default. */
  var reduceMotion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* Mark JS availability so CSS can gate hidden-then-revealed styles. */
  document.documentElement.classList.add('js');

  /* ---- Decorative starfield (pages with <body data-stars>) ---- */
  if (document.body.hasAttribute('data-stars') && !reduceMotion) {
    var stars = document.createElement('div');
    stars.id = 'stars';
    stars.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stars);
    for (var i = 0; i < 140; i++) {
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

  /* ---- Scroll-reveal ----
     .no-reveal opts a section out (the lab), so a failed observer can never hide
     something the visitor is meant to interact with. */
  var els = Array.prototype.slice.call(
    document.querySelectorAll('main section:not(.no-reveal), article.case, .case-nav')
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

  /* ---- Project filters (projects hub only) ----
     Without JS every project stays visible; the filters are the enhancement. */
  var filterBar = document.getElementById('project-filters');
  if (filterBar) {
    var buttons = Array.prototype.slice.call(filterBar.querySelectorAll('.filter-btn'));
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-tags]'));
    var status = document.getElementById('filter-status');

    function apply(tag) {
      var shown = 0;
      cards.forEach(function (card) {
        var tags = (card.getAttribute('data-tags') || '').split(/\s+/);
        var match = tag === 'all' || tags.indexOf(tag) !== -1;
        card.setAttribute('data-hidden', match ? 'false' : 'true');
        if (match) shown++;
      });
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === tag));
      });
      if (status) {
        status.textContent = 'Showing ' + shown + ' of ' + cards.length + ' projects' +
          (tag === 'all' ? '.' : ' tagged “' + tag + '”.');
      }
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () { apply(b.getAttribute('data-filter')); });
    });
    apply('all');
  }
})();
