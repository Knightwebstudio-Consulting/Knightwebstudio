// KWS Hub: one function, four entry points.
// ?fn=public  booking pages and website forms (no login)
// ?fn=twilio  Twilio call and text webhooks (signature checked)
// ?fn=api     the app's private API (session checked inside)
// ?fn=runner  scheduled sends, called by pg_cron (secret checked)
import { cors, loadConfig } from "../_shared/hub.ts";
import publicHandler from "./public.ts";
import twilioHandler from "./twilio.ts";
import apiHandler from "./api.ts";
import runnerHandler from "./runner.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  await loadConfig();
  const fn = new URL(req.url).searchParams.get("fn");
  if (fn === "twilio") return twilioHandler(req);
  if (fn === "api") return apiHandler(req);
  if (fn === "runner") return runnerHandler(req);
  return publicHandler(req);
});
