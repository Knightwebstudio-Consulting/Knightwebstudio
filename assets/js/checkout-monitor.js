/* Payment monitoring for /checkout/ and /checkout/success/ (README: "Error monitoring").

   The checkout scripts catch their own failures and show the visitor a message, so those
   failures never reach Sentry by themselves. This file reports them without touching the
   payment code:
   - anything the page logs with console.error: the checkout scripts log every checkout
     that fails to load, every failed payment confirmation and every failed status check;
   - the checkout status line turning into an error (for example a checkout that won't load).
   Card declines are not reported: Stripe shows those inside its form and they are not bugs.
   Loaded in the <head>, before the payment script runs. Live site only. */
(function () {
  if (!/(^|\.)knightwebstudio\.com$/.test(location.hostname)) return;

  var area = location.pathname.indexOf('/checkout/success') === 0 ? 'checkout-success' : 'checkout';
  var waiting = [];
  var lastReport = 0;

  function ready() { return window.Sentry && typeof Sentry.withScope === 'function'; }
  function flush() { var q = waiting; waiting = []; q.forEach(function (fn) { fn(); }); }
  // Sentry's loader is async, so it may still be on its way when the first failure happens.
  // Once it is here, tag everything this page reports (Sentry's own catches too) with the area.
  var tries = 0;
  var timer = setInterval(function () {
    if (ready()) {
      clearInterval(timer);
      if (typeof Sentry.onLoad === 'function') Sentry.onLoad(function () { Sentry.setTag('area', area); });
      flush();
    } else if (++tries > 60) { clearInterval(timer); }
  }, 250);

  function report(error, message) {
    lastReport = Date.now();
    var send = function () {
      Sentry.withScope(function (scope) {
        scope.setTag('area', area);
        scope.setLevel('error');
        if (message) scope.setExtra('shown', message);
        if (error) Sentry.captureException(error);
        else Sentry.captureMessage(message);
      });
    };
    if (ready()) { flush(); send(); } else { waiting.push(send); }
  }

  var original = console.error;
  console.error = function () {
    try {
      var args = Array.prototype.slice.call(arguments);
      var error = null;
      var text = args.map(function (a) {
        if (a instanceof Error) { error = error || a; return a.message; }
        return String(a);
      }).join(' ');
      report(error || new Error(text), text);
    } catch (e) { /* monitoring must never break the page */ }
    return original.apply(console, arguments);
  };

  function watchStatus() {
    var el = document.getElementById('checkout-status');
    if (!el) return;
    var check = function () {
      var text = (el.textContent || '').trim();
      // A visitor who arrives without choosing a package is not a fault
      if (el.classList.contains('error') && !/^Choose a package/.test(text) && Date.now() - lastReport > 3000) {
        report(null, 'Checkout showed an error: ' + text);
      }
    };
    check(); // the payment script may already have shown one while the page was loading
    if (window.MutationObserver) {
      new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchStatus);
  else watchStatus();
})();
