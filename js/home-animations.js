gsap.registerPlugin(ScrollTrigger);

/* ── Reduced motion bail-out ─────────────────────────── */
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ════════════════════════════════════════════════════════
   CURSOR PARALLAX — hero bg follows mouse lazily
   ════════════════════════════════════════════════════════ */
(function () {
  const hero = document.querySelector(".hero");
  if (!hero || reduced) return;
  let tx = 50, ty = 50, cx = 50, cy = 50;
  window.addEventListener("mousemove", e => {
    tx = 50 + (e.clientX / window.innerWidth  - 0.5) * 10;
    ty = 50 + (e.clientY / window.innerHeight - 0.5) *  7;
  });
  gsap.ticker.add(() => {
    cx += (tx - cx) * 0.055;
    cy += (ty - cy) * 0.055;
    hero.style.backgroundPosition = `${cx}% ${cy}%`;
  });
})();

gsap.fromTo(".hero",
  { backgroundSize: "100%" },
  {
    backgroundSize: "115%",
    ease: "none",
    scrollTrigger: {
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: 2.5,
    }
  }
);

/* ════════════════════════════════════════════════════════
   SCROLL INDICATOR — fades as you leave hero
   ════════════════════════════════════════════════════════ */
gsap.to(".hero__scroll-indicator", {
  opacity: 0, y: 14,
  ease: "none",
  scrollTrigger: {
    trigger: ".hero",
    start: "top 85%",
    end: "32% top",
    scrub: true,
  }
});

/* ════════════════════════════════════════════════════════
   HERO CONTENT — entrance on load
   ════════════════════════════════════════════════════════ */
const heroTl = gsap.timeline({ delay: 0.1 });
heroTl
  .from(".hero .location-pill",        { y: 24, opacity: 0, duration: 0.7, ease: "power3.out" })
  .from(".hero__headline",             { y: 36, opacity: 0, duration: 0.85, ease: "power3.out" }, "-=0.45")
  .from(".hero__desc",                 { y: 24, opacity: 0, duration: 0.7,  ease: "power3.out" }, "-=0.5")
  .from(".hero__cta .btn--outline-hero",{ y: 20, opacity: 0, duration: 0.55, ease: "back.out(1.8)", stagger: 0.1 }, "-=0.4")
  .from(".hero__right > *",            { y: 28, opacity: 0, duration: 0.6,  ease: "power3.out", stagger: 0.12 }, "-=0.55");

/* ════════════════════════════════════════════════════════
   HELPER — build a reusable scroll reveal
   toggleActions: play reverse play reverse = replays every time
   ════════════════════════════════════════════════════════ */
function reveal(targets, vars, triggerEl, start = "top 82%") {
  return gsap.from(targets, {
    ...vars,
    scrollTrigger: {
      trigger: triggerEl || targets,
      start,
      toggleActions: "play reverse play reverse",
    }
  });
}

/* ════════════════════════════════════════════════════════
   SECTION TRANSITIONS — curved wave wipe UP
   Each section slides up with a rounded top edge clipping in
   ════════════════════════════════════════════════════════ */
// Hero bottom corners curve as you scroll away — flat on top, curves as it leaves
gsap.to(".hero", {
  borderRadius: "0 0 80px 80px",
  ease: "none",
  scrollTrigger: {
    trigger: ".section-quick-actions",
    start: "top bottom",
    end: "top 60%",
    scrub: 1,
  }
});

gsap.to(".dark-footer-wrap", {
  borderRadius: "64px 64px 0 0",
  ease: "none",
  scrollTrigger: {
    trigger: ".dark-footer-wrap",
    start: "top bottom",
    end: "top top",
    scrub: 1,
  }
});


/* ════════════════════════════════════════════════════════
   QUICK ACTIONS — staggered spring bounce
   ════════════════════════════════════════════════════════ */
reveal(".quick-actions__grid .btn--selector", {
  y: 44, opacity: 0, scale: 0.86,
  duration: 0.7, ease: "back.out(2)",
  stagger: 0.07,
}, ".section-quick-actions");

/* Eyebrow + heading wipe */
reveal([".section-quick-actions .section-eyebrow",
        ".section-quick-actions .section-heading"], {
  y: 28, opacity: 0, duration: 0.65, ease: "power3.out", stagger: 0.1,
}, ".section-quick-actions", "top 85%");

/* ── GSAP hover spring on selector buttons ── */
document.querySelectorAll(".btn--selector").forEach(btn => {
  btn.addEventListener("mouseenter", () =>
    gsap.to(btn, { y: -7, scale: 1.05, duration: 0.38, ease: "back.out(2.8)" }));
  btn.addEventListener("mouseleave", () =>
    gsap.to(btn, { y: 0, scale: 1, duration: 0.5, ease: "elastic.out(1, 0.45)" }));
});

/* ════════════════════════════════════════════════════════
   RECENT UPDATES — staggered slide from sides
   ════════════════════════════════════════════════════════ */
reveal(".section-updates .section-eyebrow, .section-updates .section-heading", {
  y: 22, opacity: 0, duration: 0.6, ease: "power3.out", stagger: 0.1,
}, ".section-updates");

reveal(".post-featured", {
  x: -60, opacity: 0, duration: 1.0, ease: "expo.out",
}, ".section-updates", "top 75%");

reveal(".post-row--accented", {
  x: 50, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.15,
}, ".section-updates__rows", "top 80%");

/* post row hover spring */
document.querySelectorAll(".post-row--accented").forEach(row => {
  row.addEventListener("mouseenter", () =>
    gsap.to(row, { y: -4, duration: 0.3, ease: "back.out(2.2)" }));
  row.addEventListener("mouseleave", () =>
    gsap.to(row, { y: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" }));
});

/* ════════════════════════════════════════════════════════
   STATS — count-up is in HTML; add spatial reveal
   ════════════════════════════════════════════════════════ */
reveal(".section-stats .section-heading, .section-stats .section-eyebrow", {
  y: 22, opacity: 0, duration: 0.65, ease: "power3.out", stagger: 0.1,
}, ".section-stats");

reveal(".stat-grid__item", {
  y: 36, opacity: 0, scale: 0.92,
  duration: 0.75, ease: "back.out(1.8)", stagger: 0.13,
}, ".stat-grid", "top 80%");

/* ════════════════════════════════════════════════════════
   CTA SECTION — big staggered entrance
   ════════════════════════════════════════════════════════ */
reveal(".section-cta__icon", {
  scale: 0.2, opacity: 0, duration: 0.7, ease: "back.out(2.5)",
}, ".section-cta");

reveal([".section-cta__heading", ".section-cta__desc", ".section-cta .btn--orange"], {
  y: 34, opacity: 0, duration: 0.75, ease: "power3.out", stagger: 0.14,
}, ".section-cta", "top 78%");

/* ════════════════════════════════════════════════════════
   EYEBROW LABELS (global catch-all for any missed)
   ════════════════════════════════════════════════════════ */
gsap.utils.toArray(".section-eyebrow").forEach(el => {
  if (ScrollTrigger.getById(el)) return; // skip already-triggered
  reveal(el, { x: -18, opacity: 0, duration: 0.5, ease: "power2.out" }, el, "top 88%");
});