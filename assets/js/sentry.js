/* Error monitoring with Sentry (project "knightwebstudio-com" at knightwebstudio.sentry.io).

   - Live site only: local copies and previews report nothing.
   - Errors only: no performance tracing, no session replay, no cookies, no IP addresses
     (sendDefaultPii stays off). What a report holds: the page address, the error and its
     stack trace, and the browser and device type. Form contents are never included.
   - Light: the Sentry Loader Script is about 1 KB and only fetches the full SDK when an
     error actually happens. It loads async, so it never holds up the first paint.
   - The DSN in the URL below is a public key by design; it can only send errors in.
   Loader, rate limit (300 errors an hour) and alerts are set in Sentry, under the
   project's Settings > Client Keys. */
(function () {
  if (!/(^|\.)knightwebstudio\.com$/.test(location.hostname)) return;

  window.sentryOnLoad = function () {
    Sentry.init({
      environment: 'production',
      sendDefaultPii: false,
      // Report only errors raised by this site's own pages and scripts,
      // not browser extensions or other companies' scripts (Stripe, hCaptcha)
      allowUrls: [/^https:\/\/(www\.)?knightwebstudio\.com\//],
      ignoreErrors: [
        'Script error.', // a cross-origin script failed and the browser hid the details
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured'
      ]
    });
  };

  var s = document.createElement('script');
  s.src = 'https://js.sentry-cdn.com/b08a9aa8b3df252aac8a08def83e7fa8.min.js';
  s.crossOrigin = 'anonymous';
  s.async = true;
  document.head.appendChild(s);
})();
