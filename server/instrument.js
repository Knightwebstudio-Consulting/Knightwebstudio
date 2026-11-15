// Error monitoring for this server (Sentry project "knightwebstudio-payments" at
// knightwebstudio.sentry.io). index.js loads this file first, before anything else.
//
// - Reports only when running on Render (Render sets RENDER=true), so local runs stay quiet.
// - Render's SENTRY_DSN environment variable overrides the key below; SENTRY_DSN=off turns
//   reporting off. The DSN is a send-only public key, not a secret.
// - Errors only (no performance tracing). Reports never include request bodies, headers,
//   cookies or IP addresses: a webhook body carries the client's name, email and address.
const Sentry = require("@sentry/node");

const DSN =
  process.env.SENTRY_DSN ||
  "https://395f84c38288aa9a57ee62ed5364c0df@o4512433094262784.ingest.us.sentry.io/4512433234509824";

if (process.env.RENDER && DSN !== "off") {
  Sentry.init({
    dsn: DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "production",
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.headers;
        delete event.request.cookies;
      }
      return event;
    },
  });
}

module.exports = Sentry;
