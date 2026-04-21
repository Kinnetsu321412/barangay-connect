/* ================================================
   community-animations.js — BarangayConnect
   GSAP entrance and interaction animations for
   the Community page. Mirrors the spirit of
   home-animations.js.

   WHAT IS IN HERE:
     · Hero staggered entrance timeline on load
     · Hero border-radius scroll curve (ScrollTrigger)
     · Tab-switch panel reveal and card stagger
     · Card hover springs (pet, program, post-row)
     · Filter pill hover springs
     · FAB bouncy entrance and hover pulse
     · Bulletin MutationObserver for injected post rows
     · Modal open/close elastic patch (wraps openModal / closeModal)

   WHAT IS NOT IN HERE:
     · Tab switching logic               → community.js
     · Modal open/close base functions   → community.js
     · Animation for the home page       → home-animations.js
     · Page styles                       → community.css

   REQUIRED IMPORTS:
     · GSAP 3.12.5        (gsap.min.js via CDN)
     · ScrollTrigger 3.12.5 (ScrollTrigger.min.js via CDN)

   QUICK REFERENCE:
     Entry point      → init() (called on DOMContentLoaded or immediately)
     Panel animation  → animatePanelCards(panelId, delay?)
     Hover wiring     → wireCardHovers(root)
     Card selectors   → PANEL_CARDS map (keyed by tab panel ID)
================================================ */

(function () {

  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  /* Bail out entirely if the user prefers reduced motion */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;


  // ================================================
  // CONFIGURATION
  // ================================================

  /* Maps each tab panel ID to its card selector for staggered entrance */
  const PANEL_CARDS = {
    'tab-bulletin':  'article.post-row',
    'tab-polls':     '.poll-card',
    'tab-calendar':  '.event-item, .cal',
    'tab-gallery':   '.gallery-item',
    'tab-youth':     '.program-card, .notice-banner',
    'tab-pets':      '.pet-card',
  };


  // ================================================
  // PANEL ANIMATION
  // ================================================

  /*
     Fades the panel in and staggers its cards upward.
     Uses fromTo so GSAP never leaves elements at opacity:0.
     Called on tab switch and once on init for the default active panel.
  */
  function animatePanelCards(panelId, delay = 0.08) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const sel   = PANEL_CARDS[panelId] ?? '';
    const cards = sel ? panel.querySelectorAll(sel) : [];

    gsap.fromTo(panel,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.36, ease: 'power3.out', clearProps: 'opacity,y' }
    );

    if (!cards.length) return;

    gsap.fromTo(cards,
      { y: 30, opacity: 0, scale: 0.96 },
      {
        y: 0, opacity: 1, scale: 1,
        duration: 0.52, ease: 'back.out(1.7)',
        stagger: 0.07,
        delay,
        clearProps: 'opacity,y,scale',
      }
    );
  }


  // ================================================
  // HOVER SPRINGS
  // ================================================

  /*
     Attaches GSAP hover springs to unwired cards within a root element.
     Guards with [data-hover] so it is safe to call multiple times.
  */
  function wireCardHovers(root) {
    root.querySelectorAll('.pet-card:not([data-hover])')
      .forEach(c => {
        c.dataset.hover = '1';
        c.addEventListener('mouseenter', () =>
          gsap.to(c, { y: -5, scale: 1.02, duration: 0.28, ease: 'back.out(2.2)' }));
        c.addEventListener('mouseleave', () =>
          gsap.to(c, { y: 0,  scale: 1,    duration: 0.45, ease: 'elastic.out(1, 0.5)' }));
      });

    root.querySelectorAll('.program-card:not([data-hover])')
      .forEach(c => {
        c.dataset.hover = '1';
        c.addEventListener('mouseenter', () =>
          gsap.to(c, { y: -6, duration: 0.30, ease: 'back.out(2.4)' }));
        c.addEventListener('mouseleave', () =>
          gsap.to(c, { y: 0,  duration: 0.50, ease: 'elastic.out(1, 0.5)' }));
      });

    root.querySelectorAll('.post-row:not([data-hover])')
      .forEach(row => {
        row.dataset.hover = '1';
        row.addEventListener('mouseenter', () =>
          gsap.to(row, { y: -4, duration: 0.26, ease: 'back.out(2.2)' }));
        row.addEventListener('mouseleave', () =>
          gsap.to(row, { y: 0,  duration: 0.44, ease: 'elastic.out(1, 0.5)' }));
      });
  }


  // ================================================
  // INIT
  // ================================================

  function init() {

    /* ── Hero: staggered entrance on load ─────────────────────── */
    const heroTl = gsap.timeline({ delay: 0.08 });

    heroTl
      .from('.community-hero__eyebrow', {
        y: 18, opacity: 0, duration: 0.55, ease: 'power3.out',
      })
      .from('.community-hero__title', {
        y: 38, opacity: 0, duration: 0.80, ease: 'power3.out',
      }, '-=0.38')
      .from('.community-tabs .btn--category', {
        y: 22, opacity: 0, scale: 0.88,
        duration: 0.55, ease: 'back.out(2)',
        stagger: 0.07,
        clearProps: 'opacity,y,scale',
      }, '-=0.50');


    /* ── Hero: border-radius curves as the page scrolls away ──── */
    gsap.to('.community-hero', {
      borderRadius: '0 0 80px 80px',
      ease: 'none',
      scrollTrigger: {
        trigger: '.community-main',
        start:   'top 95%',
        end:     'top 60%',
        scrub:   1.2,
      }
    });


    /* ── Initial active panel: animate on first load ───────────── */
    const activePanel = document.querySelector('.tab-panel.is-active');
    if (activePanel) {
      animatePanelCards(activePanel.id, 0.55);
      wireCardHovers(activePanel);
    }


    /* ── Tab buttons: hover spring ─────────────────────────────── */
    document.querySelectorAll('.community-tabs .btn--category').forEach(btn => {
      btn.addEventListener('mouseenter', () =>
        gsap.to(btn, { y: -4, scale: 1.05, duration: 0.28, ease: 'back.out(2.5)' }));
      btn.addEventListener('mouseleave', () =>
        gsap.to(btn, { y: 0,  scale: 1,    duration: 0.44, ease: 'elastic.out(1, 0.5)' }));
    });


    /* ── Tab switch: panel reveal + card stagger + filter pills ── */
    /*
       Uses requestAnimationFrame so the panel's display:block from
       the existing click handler has already been applied before
       animatePanelCards reads layout.
    */
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        requestAnimationFrame(() => {
          const panelId = 'tab-' + btn.dataset.tab;
          animatePanelCards(panelId);

          const panel = document.getElementById(panelId);
          if (panel) {
            wireCardHovers(panel);

            const pills = panel.querySelectorAll('.btn--filter');
            if (pills.length) {
              gsap.fromTo(pills,
                { x: -14, opacity: 0 },
                {
                  x: 0, opacity: 1,
                  duration: 0.36, ease: 'power2.out',
                  stagger: 0.04,
                  clearProps: 'opacity,x',
                }
              );
            }
          }
        });
      });
    });


    /* ── Bulletin: MutationObserver for injected post rows ─────── */
    /*
       Debounced 80 ms so a batch of DOM mutations triggers one animation
       pass rather than one per node.
    */
    const bulletinList = document.getElementById('bulletinList');
    if (bulletinList) {
      let _animTimer = null;

      const observer = new MutationObserver(() => {
        clearTimeout(_animTimer);
        _animTimer = setTimeout(() => {
          const rows = bulletinList.querySelectorAll('article.post-row');
          if (!rows.length) return;

          gsap.fromTo(rows,
            { y: 22, opacity: 0 },
            {
              y: 0, opacity: 1,
              duration: 0.46, ease: 'power3.out',
              stagger: 0.06,
              clearProps: 'opacity,y',
            }
          );

          wireCardHovers(bulletinList);
        }, 80);
      });

      observer.observe(bulletinList, { childList: true, subtree: false });
    }


    /* ── Filter pills: hover spring (community main, global) ───── */
    document.querySelectorAll('.community-main .btn--filter').forEach(btn => {
      btn.addEventListener('mouseenter', () =>
        gsap.to(btn, { scale: 1.07, duration: 0.20, ease: 'back.out(3)' }));
      btn.addEventListener('mouseleave', () =>
        gsap.to(btn, { scale: 1,    duration: 0.34, ease: 'elastic.out(1, 0.55)' }));
    });


    /* ── FAB: bouncy entrance + hover pulse ────────────────────── */
    gsap.from('.btn--fab', {
      scale: 0, rotation: -45, opacity: 0,
      duration: 0.55, ease: 'back.out(3)',
      delay: 0.9,
      clearProps: 'opacity,scale,rotation',
    });

    const fab = document.querySelector('.btn--fab');
    if (fab) {
      fab.addEventListener('mouseenter', () =>
        gsap.to(fab, { scale: 1.12, duration: 0.24, ease: 'back.out(3)' }));
      fab.addEventListener('mouseleave', () =>
        gsap.to(fab, { scale: 1,    duration: 0.40, ease: 'elastic.out(1, 0.5)' }));
    }


    /* ── Modal: elastic drop-in / scale-out ────────────────────── */
    /*
       Wrapped in setTimeout(0) so module scripts that define openModal
       and closeModal have already run before we patch them.
    */
    setTimeout(function patchModals() {
      const _origOpen  = window.openModal;
      const _origClose = window.closeModal;

      window.openModal = function (id) {
        const overlay = document.getElementById(id);
        if (overlay) {
          overlay.classList.add('is-open');

          const modal = overlay.querySelector('.modal');
          if (modal) {
            gsap.fromTo(modal,
              { y: 28, scale: 0.95, opacity: 0 },
              { y: 0,  scale: 1,    opacity: 1,
                duration: 0.42, ease: 'back.out(2)', clearProps: 'all' }
            );
          }

          gsap.fromTo(overlay,
            { opacity: 0 },
            { opacity: 1, duration: 0.26, ease: 'power2.out', clearProps: 'opacity' }
          );
        }
        if (typeof _origOpen === 'function') _origOpen(id);
      };

      window.closeModal = function (id) {
        const overlay = document.getElementById(id);
        if (!overlay) {
          if (typeof _origClose === 'function') _origClose(id);
          return;
        }

        const modal  = overlay.querySelector('.modal');
        const finish = () => {
          overlay.classList.remove('is-open');
          if (modal) gsap.set(modal, { clearProps: 'all' });
        };

        if (modal) {
          gsap.to(modal, { y: 18, scale: 0.95, opacity: 0, duration: 0.20, ease: 'power2.in' });
        }
        gsap.to(overlay, { opacity: 0, duration: 0.22, ease: 'power2.in', onComplete: finish });

        if (typeof _origClose === 'function') _origClose(id);
      };
    }, 0);

  } // end init()


  // ================================================
  // ENTRY POINT
  // ================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
