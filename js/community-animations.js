// js/community-animations.js
// =====================================================
// GSAP animations for the Community page.
// Mirrors the spirit of home-animations.js.
//
// HOW TO USE:
//   Add at the bottom of community.html before </body>:
//
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
//   <script src="../js/community-animations.js" defer></script>
// =====================================================

(function () {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  /* ── Card selectors per panel ───────────────────────────────── */
  const PANEL_CARDS = {
    'tab-bulletin':  'article.post-row',
    'tab-polls':     '.poll-card',
    'tab-calendar':  '.event-item, .cal',
    'tab-gallery':   '.gallery-item',
    'tab-youth':     '.program-card, .notice-banner',
    'tab-pets':      '.pet-card',
  };

  /* ════════════════════════════════════════════════════════════
     Animate cards inside a panel — called on tab switch AND
     once on init for the default active panel.
     Uses fromTo so GSAP never leaves elements at opacity:0.
  ════════════════════════════════════════════════════════════ */
  function animatePanelCards(panelId, delay = 0.08) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const sel   = PANEL_CARDS[panelId] ?? '';
    const cards = sel ? panel.querySelectorAll(sel) : [];

    // Panel itself fades in
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


  /* ════════════════════════════════════════════════════════════
     Wire hover springs on cards — safe to call multiple times
  ════════════════════════════════════════════════════════════ */
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


  function init() {

    /* ════════════════════════════════════════════════════════
       HERO — staggered entrance on load
    ════════════════════════════════════════════════════════ */
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


    /* ════════════════════════════════════════════════════════
       HERO — border-radius curves as you scroll away
    ════════════════════════════════════════════════════════ */
    gsap.to('.community-hero', {
      borderRadius: '0 0 80px 80px',
      ease: 'none',
      scrollTrigger: {
        trigger:  '.community-main',
        start:    'top 95%',
        end:      'top 60%',
        scrub:    1.2,
      }
    });


    /* ════════════════════════════════════════════════════════
       INITIAL active panel — animate on first load
    ════════════════════════════════════════════════════════ */
    const activePanel = document.querySelector('.tab-panel.is-active');
    if (activePanel) {
      animatePanelCards(activePanel.id, 0.55);
      wireCardHovers(activePanel);
    }


    /* ════════════════════════════════════════════════════════
       TAB BUTTON — hover spring
    ════════════════════════════════════════════════════════ */
    document.querySelectorAll('.community-tabs .btn--category').forEach(btn => {
      btn.addEventListener('mouseenter', () =>
        gsap.to(btn, { y: -4, scale: 1.05, duration: 0.28, ease: 'back.out(2.5)' }));
      btn.addEventListener('mouseleave', () =>
        gsap.to(btn, { y: 0,  scale: 1,    duration: 0.44, ease: 'elastic.out(1, 0.5)' }));
    });


    /* ════════════════════════════════════════════════════════
       TAB SWITCH — panel reveal + card stagger
       Uses requestAnimationFrame so the panel's display:block
       from the existing click handler has already applied.
    ════════════════════════════════════════════════════════ */
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
                { x: 0, opacity: 1, duration: 0.36, ease: 'power2.out', stagger: 0.04,
                  clearProps: 'opacity,x' }
              );
            }
          }
        });
      });
    });


    /* ════════════════════════════════════════════════════════
       BULLETIN — MutationObserver: animate injected post rows
    ════════════════════════════════════════════════════════ */
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


    /* ════════════════════════════════════════════════════════
       FILTER PILLS — hover spring (global, community main)
    ════════════════════════════════════════════════════════ */
    document.querySelectorAll('.community-main .btn--filter').forEach(btn => {
      btn.addEventListener('mouseenter', () =>
        gsap.to(btn, { scale: 1.07, duration: 0.20, ease: 'back.out(3)' }));
      btn.addEventListener('mouseleave', () =>
        gsap.to(btn, { scale: 1,    duration: 0.34, ease: 'elastic.out(1, 0.55)' }));
    });


    /* ════════════════════════════════════════════════════════
       FAB — bouncy entrance + hover pulse
    ════════════════════════════════════════════════════════ */
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


    /* ════════════════════════════════════════════════════════
       MODAL — elastic drop-in / scale-out
       setTimeout(0) so module scripts that define openModal
       and closeModal run first before we wrap them.
    ════════════════════════════════════════════════════════ */
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
        const modal = overlay.querySelector('.modal');
        const finish = () => {
          overlay.classList.remove('is-open');
          if (modal) gsap.set(modal, { clearProps: 'all' });
        };
        if (modal) gsap.to(modal, { y: 18, scale: 0.95, opacity: 0, duration: 0.20, ease: 'power2.in' });
        gsap.to(overlay, { opacity: 0, duration: 0.22, ease: 'power2.in', onComplete: finish });

        if (typeof _origClose === 'function') _origClose(id);
      };
    }, 0);

  } // end init()


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
