/* KWS Hub website form. Paste on any site:
   <div data-kws-form="business-slug/contact"></div>
   <script src="<your Hub address>/form.js?v=14" async></script>
   It inherits the page's font and colors, and posts to KWS Hub (new contact, pipeline card,
   instant reply, owner alert). No cookies, no tracking. */
(function () {
  var FN = "https://uhmyfoibrwdkdhrnnaah.supabase.co/functions/v1/hub";
  var LABELS = { name: "Name", phone: "Mobile phone", email: "Email", company: "Business name", address: "Address", service: "What do you need?", message: "Message" };
  var TYPES = { phone: "tel", email: "email" };
  var AUTO = { name: "name", phone: "tel", email: "email", company: "organization", address: "street-address" };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function css() {
    if (document.getElementById("kws-form-css")) return;
    var s = document.createElement("style"); s.id = "kws-form-css";
    s.textContent = ".kws-form{display:grid;gap:12px;max-width:560px;font:inherit;color:inherit}.kws-form label{display:grid;gap:5px;font-weight:600;font-size:.92em}" +
      ".kws-form input,.kws-form textarea{font:inherit;font-weight:400;padding:11px 13px;border-radius:10px;border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;width:100%;box-sizing:border-box}" +
      ".kws-form textarea{min-height:110px;resize:vertical}.kws-form button{font:inherit;font-weight:650;padding:12px 22px;border:0;border-radius:999px;background:var(--kws-accent,#2C46C4);color:#fff;cursor:pointer;justify-self:start}" +
      ".kws-form button[disabled]{opacity:.6}.kws-form .kws-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.kws-form .kws-msg{font-weight:600}.kws-form .kws-err{color:#b3261e}" +
      ".kws-form .kws-fine{font-size:.8em;opacity:.75;font-weight:400}";
    document.head.appendChild(s);
  }
  function mount(box) {
    var parts = (box.getAttribute("data-kws-form") || "").split("/");
    var a = parts[0], f = parts[1] || "contact";
    if (!a) return;
    css();
    // the form's fields, button text and color come from KWS Hub; data-fields overrides
    fetch(FN + "?op=formcfg&a=" + encodeURIComponent(a) + "&f=" + encodeURIComponent(f))
      .then(function (r) { return r.json(); }).catch(function () { return {}; })
      .then(function (cfg) { build(box, a, f, cfg || {}); });
  }
  function build(box, a, f, cfg) {
    if (cfg.color) box.style.setProperty("--kws-accent", cfg.color);
    var fields = box.getAttribute("data-fields") ? box.getAttribute("data-fields").split(",") : (cfg.fields || ["name", "phone", "email", "message"]);
    var form = el("form", { class: "kws-form", novalidate: "" });
    fields.forEach(function (k) {
      k = String(k).trim(); if (!LABELS[k]) return;
      var input = k === "message" ? el("textarea", { name: k }) : el("input", { name: k, type: TYPES[k] || "text" });
      if (AUTO[k]) input.setAttribute("autocomplete", AUTO[k]);
      if (k === "name") input.required = true;
      form.appendChild(el("label", {}, [document.createTextNode(LABELS[k]), input]));
    });
    var hp = el("input", { name: "website_url", tabindex: "-1", autocomplete: "off" });
    form.appendChild(el("div", { class: "kws-hp", "aria-hidden": "true" }, [hp]));
    var btn = el("button", { type: "submit", text: box.getAttribute("data-button") || cfg.button || "Send" });
    var msg = el("p", { class: "kws-msg", role: "status", "aria-live": "polite" });
    form.appendChild(btn);
    if (fields.indexOf("phone") > -1) form.appendChild(el("p", { class: "kws-fine", text: "By sending, you agree we may text or call you about your request. Reply STOP to opt out." }));
    form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = { op: "form", a: a, f: f };
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      if (!data.phone && !data.email) { msg.className = "kws-msg kws-err"; msg.textContent = "Please add a phone number or email so we can reach you."; return; }
      btn.disabled = true; msg.className = "kws-msg"; msg.textContent = "Sending…";
      fetch(FN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) throw new Error(d.error);
          form.reset(); Array.prototype.forEach.call(form.querySelectorAll("label,button,.kws-fine"), function (n) { n.hidden = true; });
          msg.textContent = d.message || "Thanks! We'll be in touch shortly.";
        })
        .catch(function (err) { btn.disabled = false; msg.className = "kws-msg kws-err"; msg.textContent = err.message || "That didn't send. Please call us instead."; });
    });
    box.innerHTML = ""; box.appendChild(form);
  }
  function init() { Array.prototype.forEach.call(document.querySelectorAll("[data-kws-form]"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
