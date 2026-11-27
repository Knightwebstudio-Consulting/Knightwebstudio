/*
 * Lead Desk app. One app serves every business: each connects once with its own
 * Lead Desk app link (made in the sheet's Setup wizard, step 6). The link carries
 * the address of that business's sheet and its phone-app key, after a #, so it
 * never reaches this website's server. Everything is stored on this device only.
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var POLL_MS = 30000;
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: the app still works, it just forgets */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* fine */ } }
  };
  var S = {
    desks: store.get('ld-desks', []),
    current: store.get('ld-current', ''),
    view: store.get('ld-view', 'now'),
    sound: store.get('ld-sound', false),
    data: null, at: '', offline: false, error: '', drafts: {}, fresh: {}, seen: null,
    loading: false, installEvt: null, sheet: false
  };
  var root = document.getElementById('root');
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>';
  var REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  var MORE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return root.querySelector(sel); }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }
  function tel(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 10) d = '1' + d; return d ? 'tel:+' + d : ''; }
  function nice(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
    if (!m) return s || '';
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]);
    if (!m[4]) return mon;
    var h = +m[4];
    return mon + ', ' + (h % 12 || 12) + ':' + m[5] + ' ' + (h < 12 ? 'am' : 'pm');
  }
  function clock() { var d = new Date(); return d.getHours() % 12 + (d.getHours() % 12 ? 0 : 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? ' am' : ' pm'); }
  function b64decode(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function idOf(url, key) { var h = 0, s = url + '|' + key; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return 'd' + (h >>> 0).toString(36); }
  function desk() { return S.desks.filter(function (d) { return d.id === S.current; })[0] || S.desks[0] || null; }
  function saveDesks() { store.set('ld-desks', S.desks); store.set('ld-current', S.current); }

  function beep() {
    if (!S.sound) return;
    try {
      var ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      [0, 0.22].forEach(function (at) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
        o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.2);
      });
    } catch (e) { /* no audio */ }
  }

  // ---------- talking to the sheet ----------
  /** A Lead Desk link (the app link, or the browser link from older setups) -> { url, key, business }. */
  function parseLink(text) {
    text = String(text || '').trim();
    var m = text.match(/#connect=([A-Za-z0-9_-]+)/);
    var d = null;
    if (m) {
      try { var j = JSON.parse(b64decode(m[1])); d = { url: j.u, key: j.k, business: j.b || '' }; } catch (e) { return null; }
    } else {
      var m2 = text.match(/^(https:\/\/script\.google\.com\/[^?#\s]+\/exec)\?(?:[^#\s]*&)?desk=([A-Za-z0-9]+)/);
      if (m2) d = { url: m2[1], key: m2[2], business: '' };
    }
    if (!d || !/^https:\/\/script\.google\.com\/(macros|a\/macros\/[^/]+)\/s\/[A-Za-z0-9_-]+\/exec$/.test(d.url) || !/^[A-Za-z0-9]{20,}$/.test(String(d.key))) return null;
    return d;
  }
  /** Plain-text POST: browsers send it from any website without a pre-check, and Google answers with JSON. */
  function api(d, fn, args) {
    return fetch(d.url + '?api=1', { method: 'POST', body: JSON.stringify({ key: d.key, fn: fn, args: args || {} }) })
      .then(function (r) {
        if (!r.ok) throw new Error('The sheet did not answer (error ' + r.status + '). Try again in a minute.');
        return r.json();
      }, function () {
        var e = new Error('No connection. Showing what you had last.'); e.offline = true; throw e;
      })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Something went wrong.'); return j.data; });
  }
  function connect(link) {
    var d = parseLink(link);
    if (!d) return Promise.reject(new Error('That is not a Lead Desk app link. Ask the business owner to send it again (Setup wizard, step 6).'));
    return api(d, 'hello').then(function (h) {
      d.business = h.business || d.business || 'Your business';
      d.id = idOf(d.url, d.key);
      S.desks = S.desks.filter(function (x) { return x.id !== d.id; }).concat([d]);
      S.current = d.id;
      saveDesks();
      S.data = null; S.seen = null;
      return d;
    });
  }

  // ---------- data ----------
  function counts(D) {
    return { now: D.stats.callNowOpen, list: D.stats.callListOpen, replies: D.replies.length, queue: D.queue.length };
  }
  function take(D, quiet) {
    var openNow = D.callNow.filter(function (x) { return !x.called && !x.outcome; });
    if (S.seen) {
      var news = openNow.filter(function (x) { return !S.seen[x.id]; });
      if (news.length) {
        news.forEach(function (x) { S.fresh[x.id] = true; });
        announce(news);
      }
    }
    S.seen = {};
    openNow.forEach(function (x) { S.seen[x.id] = true; });
    S.data = D;
    S.at = clock();
    S.offline = false;
    S.error = '';
    var d = desk();
    if (d) store.set('ld-data-' + d.id, { data: D, at: S.at });
    setBadge(counts(D).now);
    var typing = document.activeElement && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName) && root.contains(document.activeElement);
    if (typing && quiet) renderTop(); else render();
  }
  function load(quiet) {
    var d = desk();
    if (!d || S.loading) return Promise.resolve();
    S.loading = true;
    var btn = $('#refresh');
    if (btn && !quiet) btn.classList.add('busy');
    return api(d, 'load').then(function (D) { take(D, quiet); }).catch(function (e) {
      if (e.offline) {
        S.offline = true;
        var cached = store.get('ld-data-' + d.id, null);
        if (cached && !S.data) { S.data = cached.data; S.at = cached.at; }
      } else {
        S.error = e.message;
      }
      render();
    }).then(function () { S.loading = false; });
  }
  function setBadge(n) {
    try {
      if (!('setAppBadge' in navigator)) return;
      if (n) navigator.setAppBadge(n); else navigator.clearAppBadge();
    } catch (e) { /* badges are a nicety */ }
  }
  function announce(news) {
    var names = news.map(function (x) { return x.business; }).join(', ');
    toast('New: ' + names);
    beep();
    try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* not a phone */ }
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) {
        news.slice(0, 3).forEach(function (x) {
          reg.showNotification('Call now: ' + x.business, { body: [x.why, x.phone].filter(Boolean).join(' · '), tag: 'ld-' + x.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
        });
      });
    }
  }

  // ---------- screens ----------
  function render() {
    if (!S.desks.length) return renderConnect();
    if (!S.data) {
      var cached = store.get('ld-data-' + desk().id, null);
      if (cached) { S.data = cached.data; S.at = cached.at; }
    }
    if (!S.data) {
      root.innerHTML = '<div class="wrap"><div class="empty"><b>' + (S.error ? 'Could not load' : 'Loading…') + '</b>' + esc(S.error) + '</div></div>';
      if (S.error) root.querySelector('.empty').insertAdjacentHTML('beforeend', '<p><button class="btn small" id="retry" type="button">Try again</button> <button class="btn small" id="openSheet" type="button">Settings</button></p>');
      bind();
      renderSheet();
      return;
    }
    root.innerHTML = '<div class="wrap"><header class="top" id="top"></header><main class="list" id="list"></main><div class="foot" id="foot"></div></div>';
    renderTop();
    renderList();
    renderFoot();
    renderSheet();
    bind();
  }
  function renderConnect() {
    var tip = installTip();
    root.innerHTML = '<div class="wrap connect"><div class="card" style="width:100%">' +
      '<img class="logo" src="icons/icon-192.png" alt="">' +
      '<h1>Lead Desk</h1><p class="muted">Call your hot leads first and log every call, from your phone or computer.</p>' +
      '<label for="link"><b>Your Lead Desk app link</b></label>' +
      '<div class="row"><input type="url" id="link" placeholder="Paste the link the business owner sent you" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button class="btn primary" id="go" type="button">Connect</button></div>' +
      '<div id="msg" class="note bad hidden" role="alert"></div>' +
      '<p class="small muted" style="margin-top:12px">The owner finds it in the Lead Desk sheet: Setup wizard, step 6, "Email it to me". Opening that link on this device connects it for you.</p>' +
      (tip ? '<div class="note" style="margin-top:12px">' + tip + '</div>' : '') +
      '</div></div>';
    $('#go').addEventListener('click', function () { doConnect($('#link').value); });
    $('#link').addEventListener('keydown', function (e) { if (e.key === 'Enter') doConnect($('#link').value); });
  }
  function doConnect(link) {
    var btn = $('#go') || $('#addGo');
    var msg = $('#msg') || $('#addMsg');
    if (btn) { btn.classList.add('busy'); btn.textContent = 'Connecting…'; }
    connect(link).then(function (d) {
      S.sheet = false;
      toast('Connected to ' + d.business);
      render();
      load(false);
    }).catch(function (e) {
      if (btn) { btn.classList.remove('busy'); btn.textContent = 'Connect'; }
      if (msg) { msg.textContent = e.message; msg.classList.remove('hidden'); }
    });
  }
  function renderTop() {
    var D = S.data, d = desk(), c = counts(D);
    var state = !D.outreach ? '<span class="pill">Outreach off</span>' : D.testMode ? '<span class="pill warm">Test mode</span>' : '<span class="pill ok">Live</span>';
    var brand = S.desks.length > 1
      ? '<select id="deskPick" aria-label="Business">' + S.desks.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === d.id ? ' selected' : '') + '>' + esc(x.business) + '</option>'; }).join('') + '</select>'
      : esc(D.business || d.business);
    var tabs = [{ id: 'now', label: 'Call now', hot: true }, { id: 'list', label: 'Call list' }, { id: 'replies', label: 'Replies' }];
    if (D.review || D.queue.length) tabs.push({ id: 'queue', label: 'Approve' });
    if (!tabs.some(function (t) { return t.id === S.view; })) S.view = 'now';
    $('#top').innerHTML = '<div class="bar"><div><div class="brand">' + brand + '</div><div class="title">Lead Desk</div></div>' +
      '<div class="tools">' + state + '<button class="icon-btn" id="refresh" type="button" aria-label="Refresh">' + REFRESH + '</button>' +
      '<button class="icon-btn" id="openSheet" type="button" aria-label="Settings">' + MORE + '</button></div></div>' +
      '<div class="stats">' + D.stats.sentToday + ' of ' + D.stats.cap + ' emails sent today' + (D.review ? ' · emails wait for approval' : '') + '</div>' +
      (S.offline ? '<div class="note warn banner">No connection. Showing what you had at ' + esc(S.at) + '.</div>' : '') +
      (S.error ? '<div class="note bad banner">' + esc(S.error) + '</div>' : '') +
      '<nav class="tabs" role="tablist">' + tabs.map(function (t) {
        var n = c[t.id];
        return '<button type="button" role="tab" class="tab' + (t.id === S.view ? ' on' : '') + (t.hot && n ? ' hot' : '') + '" data-view="' + t.id + '" aria-selected="' + (t.id === S.view) + '">' + esc(t.label) + '<span class="n">' + n + '</span></button>';
      }).join('') + '</nav>';
    document.title = (c.now ? '(' + c.now + ') ' : '') + 'Lead Desk';
  }
  function leadCard(x) {
    var k = x.tab + '|' + x.id;
    var dr = S.drafts[k] || { called: x.called, outcome: x.outcome, notes: x.notes };
    var done = x.called || x.outcome;
    var who = [x.contact !== (x.business || '') ? x.contact : '', x.town].filter(Boolean).join(' · ');
    var meta = [
      x.email ? '<a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>' : '',
      x.clicks ? '<span>' + esc(x.clicks) + ' click' + (x.clicks == 1 ? '' : 's') + (x.lastClicked ? ', last ' + esc(nice(x.lastClicked)) : '') + '</span>' : '',
      x.link ? '<a href="' + esc(x.link) + '" target="_blank" rel="noopener">Their link</a>' : '',
      x.added ? '<span>Added ' + esc(nice(x.added)) + '</span>' : ''
    ].filter(Boolean).join('');
    return '<article class="card lead' + (done ? ' done' : '') + (S.fresh[x.id] ? ' fresh' : '') + '" data-k="' + esc(k) + '" data-id="' + esc(x.id) + '" data-tab="' + esc(x.tab) + '">' +
      '<div class="biz">' + esc(x.business || x.contact || x.email) + '</div>' +
      (who ? '<div class="who">' + esc(who) + '</div>' : '') +
      '<div class="why"><span class="pill ' + (x.tab === 'Call Now' ? 'hot' : 'warm') + '">' + esc(x.why) + '</span></div>' +
      (x.about ? '<div class="about">' + esc(x.about) + '</div>' : '') +
      (x.phone ? '<a class="callbtn" href="' + tel(x.phone) + '">' + PHONE + 'Call ' + esc(x.phone) + '</a>' : '<div class="note">No phone number on file' + (x.email ? '. Email them instead.' : '.') + '</div>') +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      '<div class="log"><div class="seg" role="group" aria-label="Call result">' +
      S.data.called.map(function (c) { return '<button type="button" data-called="' + esc(c) + '" class="' + (dr.called === c ? 'on' : '') + '" aria-pressed="' + (dr.called === c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
      '<select data-f="outcome" aria-label="Outcome"><option value="">Outcome…</option>' + S.data.outcomes.map(function (o) { return '<option' + (dr.outcome === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' +
      '<textarea data-f="notes" placeholder="Notes from the call" aria-label="Notes">' + esc(dr.notes) + '</textarea>' +
      '<div class="saverow"><button type="button" class="btn primary small" data-act="save">Save call</button>' +
      (done ? '<span class="muted small">Logged ' + esc(nice(x.calledOn)) + '</span>' : '') + '</div></div></article>';
  }
  function replyCard(x) {
    return '<article class="card lead"><div class="biz">' + esc(x.business || x.email) + '</div>' +
      (x.contact && x.contact !== x.business ? '<div class="who">' + esc(x.contact) + '</div>' : '') +
      '<div class="why"><span class="pill blue">Replied: answer from your inbox</span></div>' +
      (x.phone ? '<a class="callbtn" href="' + tel(x.phone) + '">' + PHONE + 'Call ' + esc(x.phone) + '</a>' : '') +
      '<div class="meta">' + (x.thread ? '<a href="https://mail.google.com/mail/u/0/#all/' + esc(x.thread) + '" target="_blank" rel="noopener">Open the email</a>' : '') +
      (x.email ? '<a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>' : '') + (x.lastCall ? '<span>Last call: ' + esc(x.lastCall) + '</span>' : '') + '</div></article>';
  }
  function queueCard(x) {
    return '<article class="card lead q" data-id="' + esc(x.id) + '" data-step="' + x.step + '">' +
      '<div class="biz">' + esc(x.business) + '</div><div class="who">Email ' + x.step + ' to ' + esc(x.to) + '</div>' +
      '<input type="text" data-f="subject" value="' + esc(x.subject) + '" aria-label="Subject">' +
      '<textarea data-f="body" aria-label="Email">' + esc(x.body) + '</textarea>' +
      '<div class="saverow"><button type="button" class="btn primary small" data-act="approve">Approve and send</button>' +
      '<span class="muted small">{{link}} becomes the tracked link.</span></div></article>';
  }
  function renderList() {
    var D = S.data, html;
    if (S.view === 'now') html = D.callNow.length ? D.callNow.map(leadCard).join('') : '<div class="empty"><b>Nobody to call right now</b>People who click a link or send an inquiry show up here, newest first.</div>';
    else if (S.view === 'list') html = D.callList.length ? D.callList.map(leadCard).join('') : '<div class="empty"><b>The Call List is clear</b>Leads land here after their last email with no reply, a bounced email, or no email address.</div>';
    else if (S.view === 'replies') html = D.replies.length ? D.replies.map(replyCard).join('') : '<div class="empty"><b>No replies waiting</b>When a lead replies, their emails stop and they show up here.</div>';
    else html = D.queue.length ? '<div class="saverow"><button type="button" class="btn small" data-act="approve-all">Approve and send all ' + D.queue.length + '</button></div><br>' + D.queue.map(queueCard).join('')
      : '<div class="empty"><b>Nothing waiting for approval</b>With Sending mode "Review first", each email waits here before it goes out.</div>';
    $('#list').innerHTML = html;
    S.fresh = {};
  }
  function renderFoot() {
    $('#foot').innerHTML = 'Updated ' + esc(S.at) + ' · <button type="button" id="snd">' + (S.sound ? 'Sound on' : 'Turn on sound') + '</button>' +
      (S.installEvt && !standalone ? ' · <button type="button" id="install">Install app</button>' : '');
  }
  function installTip() {
    if (standalone) return '';
    if (isIOS) return '<b>Install it:</b> tap the Share button, then <b>Add to Home Screen</b>.';
    if (S.installEvt) return '<b>Install it:</b> <button class="btn small" id="install2" type="button">Install app</button>';
    return '<b>Install it:</b> in Chrome or Edge, use the install icon in the address bar or the menu\'s "Install app". On Android, the ⋮ menu, then "Install app" or "Add to Home screen".';
  }
  function renderSheet() {
    var old = document.getElementById('scrim');
    if (old) old.remove();
    if (!S.sheet) return;
    var notif = 'Notification' in window ? Notification.permission : 'unsupported';
    var tip = installTip();
    var el = document.createElement('div');
    el.className = 'scrim'; el.id = 'scrim';
    el.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="Settings"><div class="row"><h2>Settings</h2><button class="btn small" id="closeSheet" type="button">Done</button></div>' +
      '<div class="card"><b>Businesses on this device</b>' + S.desks.map(function (d) {
        return '<div class="desk-row"><span>' + esc(d.business) + (d.id === S.current ? ' <span class="pill ok">open</span>' : '') + '</span>' +
          '<span>' + (d.id !== S.current ? '<button class="btn small" type="button" data-open="' + esc(d.id) + '">Open</button> ' : '') +
          '<button class="btn small danger" type="button" data-forget="' + esc(d.id) + '">Remove</button></span></div>';
      }).join('') +
      '<p class="small muted" style="margin:10px 0 6px">Add another business with its Lead Desk app link:</p>' +
      '<div class="row"><input type="url" id="addLink" placeholder="Paste a Lead Desk app link" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn small" id="addGo" type="button">Connect</button></div>' +
      '<div id="addMsg" class="note bad hidden" role="alert"></div></div>' +
      '<div class="card"><label class="switch"><input type="checkbox" id="sndSw"' + (S.sound ? ' checked' : '') + '> Sound for new hot leads</label>' +
      (notif === 'unsupported' ? '' : notif === 'granted' ? '<p class="small muted" style="margin:10px 0 0">Alerts on this device are on while the app is open or in the background.</p>'
        : '<p class="small muted" style="margin:10px 0 6px">Get an alert on this device when a new hot lead comes in (while the app is open or in the background).</p><button class="btn small" id="notif" type="button"' + (notif === 'denied' ? ' disabled' : '') + '>' + (notif === 'denied' ? 'Alerts are blocked in this browser\'s settings' : 'Turn on alerts') + '</button>') +
      '<p class="small muted" style="margin:10px 0 0">The owner\'s "call now" emails still arrive too, so keep notifications on for your email app.</p></div>' +
      (tip ? '<div class="card">' + tip + '</div>' : '') +
      '<p class="small muted" style="text-align:center;margin-top:14px">Lead Desk ' + VERSION + ' by KnightWebStudio</p></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.id === 'closeSheet') { S.sheet = false; renderSheet(); return; }
      var open = e.target.closest('[data-open]'), forget = e.target.closest('[data-forget]');
      if (open) { S.current = open.getAttribute('data-open'); saveDesks(); S.data = null; S.seen = null; S.sheet = false; render(); load(false); }
      if (forget) {
        var id = forget.getAttribute('data-forget');
        if (!confirm('Remove this business from this device?')) return;
        S.desks = S.desks.filter(function (d) { return d.id !== id; });
        store.del('ld-data-' + id);
        if (S.current === id) { S.current = S.desks[0] ? S.desks[0].id : ''; S.data = null; S.seen = null; }
        saveDesks(); S.sheet = !!S.desks.length; render(); if (S.desks.length) load(false); else setBadge(0);
      }
      if (e.target.id === 'addGo') doConnect(document.getElementById('addLink').value);
      if (e.target.id === 'notif') {
        Notification.requestPermission().then(function () { renderSheet(); });
      }
      if (e.target.id === 'install2') promptInstall();
    });
    var sw = document.getElementById('sndSw');
    if (sw) sw.addEventListener('change', function () { S.sound = sw.checked; store.set('ld-sound', S.sound); beep(); renderFoot && $('#foot') && renderFoot(); });
  }
  function promptInstall() {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    S.installEvt.userChoice.then(function () { S.installEvt = null; render(); });
  }

  // ---------- actions ----------
  function readCard(card) {
    var on = card.querySelector('[data-called].on');
    return { called: on ? on.getAttribute('data-called') : '', outcome: card.querySelector('[data-f=outcome]').value, notes: card.querySelector('[data-f=notes]').value };
  }
  function approve(items, btn) {
    btn.classList.add('busy'); btn.textContent = 'Sending…';
    api(desk(), 'approve', { items: items }).then(function (D) { toast(D.message || 'Done'); take(D); })
      .catch(function (e) { toast(e.message); btn.classList.remove('busy'); btn.textContent = 'Approve and send'; });
  }
  function bind() {
    root.onclick = function (e) {
      var t = e.target;
      if (t.closest('#refresh') || t.closest('#retry')) { S.error = ''; load(false); return; }
      if (t.closest('#openSheet')) { S.sheet = true; renderSheet(); return; }
      if (t.closest('#snd')) { S.sound = !S.sound; store.set('ld-sound', S.sound); beep(); renderFoot(); return; }
      if (t.closest('#install') || t.closest('#install2')) { promptInstall(); return; }
      var tab = t.closest('[data-view]');
      if (tab) { S.view = tab.getAttribute('data-view'); store.set('ld-view', S.view); renderTop(); renderList(); return; }
      var allBtn = t.closest('[data-act="approve-all"]');
      if (allBtn) {
        approve([].slice.call(root.querySelectorAll('.lead.q')).map(function (c) { return { id: c.getAttribute('data-id'), step: +c.getAttribute('data-step'), subject: c.querySelector('[data-f=subject]').value, body: c.querySelector('[data-f=body]').value }; }), allBtn);
        return;
      }
      var card = t.closest('.lead');
      if (!card) return;
      var k = card.getAttribute('data-k');
      var cb = t.closest('[data-called]');
      if (cb) {
        var d = S.drafts[k] = S.drafts[k] || readCard(card);
        d.called = d.called === cb.getAttribute('data-called') ? '' : cb.getAttribute('data-called');
        card.querySelectorAll('[data-called]').forEach(function (b) { var on = b.getAttribute('data-called') === d.called; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        return;
      }
      var act = t.closest('[data-act]');
      if (!act) return;
      if (act.getAttribute('data-act') === 'save') {
        var v = S.drafts[k] || readCard(card);
        v.notes = card.querySelector('[data-f=notes]').value;
        v.outcome = card.querySelector('[data-f=outcome]').value;
        if (!v.called && !v.outcome) { toast('Pick a call result or an outcome first'); return; }
        act.classList.add('busy'); act.textContent = 'Saving…';
        api(desk(), 'log', { tab: card.getAttribute('data-tab'), id: card.getAttribute('data-id'), called: v.called, outcome: v.outcome, notes: v.notes })
          .then(function (D) { delete S.drafts[k]; toast('Saved'); take(D); })
          .catch(function (err) { toast(err.offline ? 'No connection: nothing was saved. Try again when you are back online.' : err.message); act.classList.remove('busy'); act.textContent = 'Save call'; });
      } else if (act.getAttribute('data-act') === 'approve') {
        approve([{ id: card.getAttribute('data-id'), step: +card.getAttribute('data-step'), subject: card.querySelector('[data-f=subject]').value, body: card.querySelector('[data-f=body]').value }], act);
      }
    };
    root.oninput = function (e) {
      var card = e.target.closest('.lead[data-k]');
      if (!card) return;
      var k = card.getAttribute('data-k');
      var d = S.drafts[k] = S.drafts[k] || readCard(card);
      d[e.target.getAttribute('data-f')] = e.target.value;
    };
    root.onchange = function (e) {
      if (e.target.id === 'deskPick') { S.current = e.target.value; saveDesks(); S.data = null; S.seen = null; render(); load(false); }
    };
  }

  // ---------- start ----------
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; if (S.data) renderFoot(); else if (!S.desks.length) renderConnect(); });
  window.addEventListener('appinstalled', function () { S.installEvt = null; toast('Installed'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* works without it, just not offline */ }); });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(true); });
  setInterval(function () { if (document.visibilityState !== 'hidden') load(true); }, POLL_MS);

  var hash = location.hash.match(/connect=([A-Za-z0-9_-]+)/);
  if (hash) {
    // Arrived from an app link: connect, then take the key out of the address bar.
    var link = '#connect=' + hash[1];
    history.replaceState(null, '', location.pathname + location.search);
    root.innerHTML = '<div class="wrap"><div class="empty"><b>Connecting…</b></div></div>';
    connect(link).then(function (d) { toast('Connected to ' + d.business); render(); load(false); })
      .catch(function (e) { render(); var m = $('#msg'); if (m) { m.textContent = e.message; m.classList.remove('hidden'); } else toast(e.message); });
  } else {
    render();
    load(false);
  }
})();
