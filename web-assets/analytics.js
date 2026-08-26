(() => {
  const googleTagId = document.querySelector('meta[name="google-tag-id"]')?.content;
  const measurementId = document.querySelector('meta[name="google-analytics-id"]')?.content;
  const productionHost = location.hostname === 'paint.rip' || location.hostname === 'www.paint.rip';

  window.__pintaAnalytics = {
    googleTagId,
    measurementId,
    enabled: Boolean(productionHost && googleTagId && measurementId),
  };
  if (!window.__pintaAnalytics.enabled) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  // Load the consolidated Google tag, but configure the GA4 destination only
  // once so a single navigation cannot produce duplicate page-view events.
  window.gtag('config', measurementId, {
    page_location: location.href,
    page_path: `${location.pathname}${location.search}`,
  });

  const loader = document.createElement('script');
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleTagId)}`;
  loader.referrerPolicy = 'strict-origin-when-cross-origin';
  document.head.append(loader);
})();
