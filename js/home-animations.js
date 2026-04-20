/* ================================================================
   home-animations.js — BarangayConnect
   GSAP animations for the home page only.
   Requires: gsap.min.js + ScrollTrigger.min.js loaded before this.
   ================================================================ */

gsap.registerPlugin(ScrollTrigger);

/* ── 1. Hero border morphs from full-radius to none as you scroll ─ */
gsap.to(".hero", {
  borderRadius: "0 0 0 0",
  scrollTrigger: {
    trigger: ".hero",
    start: "bottom 90%",
    end: "bottom 50%",
    scrub: 1.2,            /* silky smooth, tied to scroll position */
  }
});

/* ── 2. Hero content fades up — replaces the CSS animation ──────── */
/* Remove the CSS animation on .hero__left once GSAP loads          */
gsap.from(".hero__left", {
  y: 40, opacity: 0, duration: 1.1,
  ease: "power3.out", delay: 0.1
});
gsap.from(".hero__right", {
  y: 30, opacity: 0, duration: 1.0,
  ease: "power3.out", delay: 0.28
});

/* ── 3. Quick action buttons bounce in staggered ─────────────────── */
gsap.from(".quick-actions__grid .btn--selector", {
  y: 36, opacity: 0, scale: 0.88,
  duration: 0.65,
  ease: "back.out(1.8)",  /* the "bounce" */
  stagger: 0.08,           /* 80ms between each button */
  scrollTrigger: {
    trigger: ".section-quick-actions",
    start: "top 78%",
    toggleActions: "play none none none"
  }
});

/* ── 4. Recent Updates — featured card slides in from left ───────── */
gsap.from(".post-featured", {
  x: -50, opacity: 0, duration: 0.9,
  ease: "power3.out",
  scrollTrigger: {
    trigger: ".section-updates",
    start: "top 72%",
  }
});

/* Post rows stagger in from right */
gsap.from(".post-row--accented", {
  x: 40, opacity: 0, duration: 0.7,
  ease: "power3.out",
  stagger: 0.14,
  scrollTrigger: {
    trigger: ".section-updates__rows",
    start: "top 78%",
  }
});

/* ── 5. Stats count-up is already in HTML JS, just add reveal ────── */
gsap.from(".stat-grid__item", {
  y: 30, opacity: 0, scale: 0.94,
  duration: 0.7,
  ease: "back.out(1.5)",
  stagger: 0.12,
  scrollTrigger: {
    trigger: ".stat-grid",
    start: "top 80%",
  }
});

/* ── 6. CTA section content bounces up ───────────────────────────── */
gsap.from(".section-cta__icon", {
  scale: 0, opacity: 0, duration: 0.6,
  ease: "back.out(2.2)",
  scrollTrigger: { trigger: ".section-cta", start: "top 78%" }
});
gsap.from(".section-cta__heading, .section-cta__desc, .section-cta .btn--orange", {
  y: 28, opacity: 0, duration: 0.7,
  ease: "power3.out",
  stagger: 0.13,
  scrollTrigger: { trigger: ".section-cta", start: "top 75%" }
});

/* ── 7. Hover: Quick action tiles spring on mouseenter ──────────── */
/* This adds physical bounciness beyond what CSS transition can do   */
document.querySelectorAll(".btn--selector").forEach(btn => {
  btn.addEventListener("mouseenter", () => {
    gsap.to(btn, { y: -6, scale: 1.04, duration: 0.35, ease: "back.out(2.5)" });
  });
  btn.addEventListener("mouseleave", () => {
    gsap.to(btn, { y: 0, scale: 1, duration: 0.4, ease: "elastic.out(1, 0.5)" });
  });
});

/* ── 8. Post rows spring on hover ───────────────────────────────── */
document.querySelectorAll(".post-row--accented").forEach(row => {
  row.addEventListener("mouseenter", () => {
    gsap.to(row, { y: -3, duration: 0.3, ease: "back.out(2)" });
  });
  row.addEventListener("mouseleave", () => {
    gsap.to(row, { y: 0, duration: 0.45, ease: "elastic.out(1, 0.55)" });
  });
});

/* ── 9. Eyebrow labels slide in from left ───────────────────────── */
gsap.utils.toArray(".section-eyebrow").forEach(el => {
  gsap.from(el, {
    x: -20, opacity: 0, duration: 0.55,
    ease: "power2.out",
    scrollTrigger: { trigger: el, start: "top 85%" }
  });
});

/* ── 10. Section headings wipe in ───────────────────────────────── */
gsap.utils.toArray(".section-heading").forEach(el => {
  gsap.from(el, {
    y: 22, opacity: 0, duration: 0.7,
    ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 85%" }
  });
});

/* ── Performance: kill ScrollTriggers on low-end / prefers reduced  */
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  ScrollTrigger.getAll().forEach(t => t.kill());
  gsap.globalTimeline.clear();
}