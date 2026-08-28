/**
 * Analytics bootstrap.
 *
 * The editor puts the open document's name in `document.title` so the browser tab is useful.
 * GA4 reads `document.title` for the `page_title` parameter of every event it collects — not
 * just the page view, but `user_engagement`, `scroll`, and our own `exception` events — which
 * would send that file name to Google. File names are frequently personal.
 *
 * So `page_title` is pinned to a fixed label naming only which page is open, set both globally
 * and on the measurement ID, and `document.title` is never read here. Query strings and
 * fragments are dropped from the reported path for the same reason: nothing needs them, and
 * they are the other place something private could end up.
 */

/**
 * The coarse page label reported to analytics. One of a small fixed set, never derived from
 * anything the user typed or opened. A locale prefix is stripped so `/fr/about/` and `/about/`
 * report as the same page; the locale is still visible in the reported path, which carries no
 * personal data.
 */
export function pageIdentityFor(pathname) {
  const withoutIndex = pathname.replace(/\/index\.html$/, '/');
  const withoutLocale = withoutIndex.replace(/^\/[a-z]{2}(?:-[A-Za-z]{2,4})?(?=\/)/, '');
  const normalized = withoutLocale === '' ? '/' : withoutLocale;
  if (normalized === '/') return 'Editor';
  if (normalized === '/about/') return 'About';
  if (normalized === '/user-guide/') return 'User Guide';
  return 'Other';
}

(() => {
  const googleTagId = document.querySelector('meta[name="google-tag-id"]')?.content;
  const measurementId = document.querySelector('meta[name="google-analytics-id"]')?.content;
  const productionHost = location.hostname === 'paint.rip' || location.hostname === 'www.paint.rip';

  const pageTitle = pageIdentityFor(location.pathname);
  const pagePath = location.pathname;
  const pageLocation = `${location.origin}${location.pathname}`;

  window.__pintaAnalytics = {
    googleTagId,
    measurementId,
    pageTitle,
    pagePath,
    enabled: Boolean(productionHost && googleTagId && measurementId),
  };
  if (!window.__pintaAnalytics.enabled) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  // set() runs before config() so the very first page view already carries the fixed title.
  // Both are needed: config covers events sent to this measurement ID, set covers the ones
  // gtag collects automatically and would otherwise fill in from document.title.
  window.gtag('set', {
    page_title: pageTitle,
    page_path: pagePath,
    page_location: pageLocation,
  });
  // Load the consolidated Google tag, but configure the GA4 destination only
  // once so a single navigation cannot produce duplicate page-view events.
  window.gtag('config', measurementId, {
    page_title: pageTitle,
    page_location: pageLocation,
    page_path: pagePath,
  });

  const loader = document.createElement('script');
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleTagId)}`;
  loader.referrerPolicy = 'strict-origin-when-cross-origin';
  document.head.append(loader);
})();
