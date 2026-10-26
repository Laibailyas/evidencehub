/**
 * plusquam — landing page script.
 *
 * Most behaviour is handled by /js/i18n.js (auto-init).
 * This file exists for landing-specific hooks: CTA analytics,
 * scroll reveals, etc. Keep it small.
 */

(function () {
  // Track CTA clicks (replace with your analytics provider when ready).
  document.querySelectorAll('.landing-cta, .landing-cta-sm').forEach(el => {
    el.addEventListener('click', () => {
      // Example: window.plausible && window.plausible('cta_signin_click', { props: { from: el.className } });
      console.info('[plusquam] CTA click:', el.className);
    });
  });

  // Subtle reveal-on-scroll for the feature cards.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.opacity = '1';
          e.target.style.transform = 'translateY(0)';
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.landing-feature').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      io.observe(el);
    });
  }
})();
