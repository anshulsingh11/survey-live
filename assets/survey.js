/**
 * The test survey: a small multi-step survey that runs the SurveyGuard v2 SDK the way an agency's own page would
 * (docs/contracts/sdk-contract.md).
 *
 *   load       SurveyGuard.init({ agency, project, respondentId, sourceId, failStrategy })
 *   welcome    the survey's own consent question: grantConsent() then startCollection(), or declineConsent()
 *   questions  the collectors watch the mouse, the keyboard, the touch screen and the tab
 *   screener   a respondent who does not qualify, or whose quota is full, leaves at once: no analysis
 *   submit     collectAndSend({ choices, answers }) and act on the action: the SDK never navigates
 *   end        back to the supplier the respondent came from: complete, terminate, overquota or security
 *
 * A challenge (the drag, the proof of work) is the SDK's own overlay: collectAndSend resolves after it.
 */
(function () {
  'use strict';

  var cfg = window.SG_CONFIG || {};
  var params = new URLSearchParams(window.location.search);

  // ── The supplier ─────────────────────────────────────────────────────────
  // Who sent this respondent, and who they are to that supplier. Read once, on arrival.
  var supplierCode = (params.get('src') || params.get('source') || cfg.defaultSupplier || '').trim();
  var suppliers = cfg.suppliers || {};
  var supplier = Object.prototype.hasOwnProperty.call(suppliers, supplierCode) ? suppliers[supplierCode] : null;
  var respondentId = (params.get((supplier && supplier.ridParam) || 'rid') || params.get('rid') || '').trim();

  // ── Questions ────────────────────────────────────────────────────────────
  // type: 'single' | 'multi' | 'matrix' | 'scale' | 'text'
  // `screen(answer)` is the screener: the ending a respondent gets for that answer, or null to carry on.
  var QUESTIONS = [
    {
      id: 'q_age', type: 'single', required: true,
      text: 'What is your age?',
      options: ['Under 18', '18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 or older'],
      screen: function (a) {
        if (a === 'Under 18') return 'terminate';
        return (cfg.quotasFull || []).indexOf(a) !== -1 ? 'overquota' : null;
      }
    },
    {
      id: 'q_frequency', type: 'single', required: true,
      text: 'How often do you shop online?',
      options: ['Daily', 'A few times a week', 'A few times a month', 'Rarely', 'Never'],
      screen: function (a) { return a === 'Never' ? 'terminate' : null; }
    },
    {
      id: 'q_categories', type: 'multi', required: true,
      text: 'Which categories have you bought online in the last 6 months?',
      hint: 'Select all that apply.',
      options: ['Electronics', 'Clothing & apparel', 'Groceries', 'Home & furniture', 'Health & beauty', 'Books & media']
    },
    {
      id: 'q_satisfaction', type: 'matrix', required: true,
      text: 'How much do you agree with the following?',
      hint: 'Rate each statement from 1 (strongly disagree) to 5 (strongly agree).',
      rows: [
        'Online shopping saves me time',
        'I trust online stores with my payment details',
        'Delivery is usually faster than I expect',
        'Returns and refunds are easy to handle'
      ],
      scale: 5
    },
    {
      id: 'q_nps', type: 'scale', required: true,
      text: 'How likely are you to recommend online shopping to a friend or colleague?',
      min: 0, max: 10, lowLabel: 'Not at all likely', highLabel: 'Extremely likely'
    },
    {
      id: 'q_open', type: 'text', required: false,
      text: 'What is the single biggest thing that would improve your online shopping experience?',
      hint: 'Type naturally: a few sentences is perfect.',
      placeholder: 'Share your thoughts…'
    }
  ];

  var state = { step: -1, answers: {} }; // step -1 is the welcome screen
  var TOTAL = QUESTIONS.length;
  var app = document.getElementById('app');
  var bar = document.getElementById('bar');
  var badge = document.getElementById('sdk-badge');

  // ── The SDK ──────────────────────────────────────────────────────────────
  // `sdk` is a promise of window.SurveyGuard once init has run, or of null when the script could not be loaded.
  var sdk = loadSdk();

  function setBadge(text, cls) {
    badge.textContent = text;
    badge.className = 'badge' + (cls ? ' ' + cls : '');
  }

  /**
   * What stops the SDK before it starts, or null. Both are set-up mistakes, not analysis failures: the page says so
   * instead of letting the server answer 422 or 403.
   */
  function setupProblem() {
    if (window.location.protocol === 'file:') {
      return ['file_page', 'Opened from a file: a file:// page sends no origin, so SurveyGuard refuses its session. ' +
        'Serve the folder (python -m http.server 5500 --bind 127.0.0.1) and open http://127.0.0.1:5500/index.html.'];
    }
    if (!/^agy_[0-9a-f]{32}$/.test(cfg.agency || '') || !/^prj_[0-9a-f]{32}$/.test(cfg.project || '')) {
      return ['not_configured', 'assets/config.js: set `agency` (agy_…, Settings in the dashboard) and `project` ' +
        '(prj_…, Projects) to real ids.'];
    }
    return null;
  }

  var problem; // set by loadSdk, which runs before this line is reached

  function loadSdk() {
    problem = setupProblem();
    if (problem) {
      setBadge('unprotected: ' + problem[0], 'error');
      console.error('SurveyGuard test survey: ' + problem[1]);
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = String(cfg.backend || '').replace(/\/+$/, '') + '/static/sdk/surveyguard.js';
      script.onload = function () { resolve(window.SurveyGuard || null); };
      script.onerror = function () { resolve(null); };
      document.head.appendChild(script);
    }).then(function (sg) {
      if (!sg) {
        setBadge('unprotected: no SDK', 'error');
        return null;
      }
      var options = {
        agency: cfg.agency,
        project: cfg.project,
        failStrategy: cfg.failStrategy,
        apiBase: cfg.backend
      };
      if (supplierCode) options.sourceId = supplierCode;
      if (respondentId) options.respondentId = respondentId;
      return sg.init(options).then(function () {
        setBadge(sg.consent === 'granted' ? 'ready' : 'awaiting consent', sg.consent === 'granted' ? 'ready' : '');
        return sg;
      }, function (err) {
        // invalid_options, a refused origin (session_refused), an unreachable API: the fail strategy decides later.
        setBadge('unprotected: ' + ((err && err.code) || 'error'), 'error');
        console.warn('SurveyGuard init failed', err);
        return sg;
      });
    });
  }

  function startProtection(agreed) {
    return sdk.then(function (sg) {
      if (!sg) return;
      try {
        if (agreed) sg.grantConsent(); else sg.declineConsent();
      } catch (e) {
        return; // init never ran: not_initialised
      }
      if (!agreed) {
        setBadge('declined', 'error');
        return;
      }
      setBadge('connecting…', '');
      return sg.startCollection(8000).then(function (running) {
        setBadge(running ? 'protected' : 'unprotected: ' + sg.state, running ? 'ready' : 'error');
      });
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function setProgress() {
    bar.style.width = (state.step < 0 ? 0 : Math.round((state.step / TOTAL) * 100)) + '%';
  }

  function render() {
    setProgress();
    if (state.step < 0) return renderWelcome();
    if (state.step >= TOTAL) return renderReview();
    renderQuestion(QUESTIONS[state.step]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderWelcome() {
    app.innerHTML =
      '<h1>Consumer Habits &amp; Brand Perception</h1>' +
      '<p class="lede">A short ' + TOTAL + '-question survey about how you shop online. ' +
      'It takes about 2 minutes. Your responses are anonymous and used for research only.</p>' +
      '<label class="consent"><input type="checkbox" id="consent">' +
      '<span>I agree that how I interact with this survey (mouse, keyboard and timing, never what I type) is ' +
      'analysed to keep responses genuine.</span></label>' +
      '<div class="nav"><button class="btn-primary" id="start">Start survey →</button></div>';
    var box = document.getElementById('consent');
    sdk.then(function (sg) { if (sg && sg.consent === 'granted') box.checked = true; });
    document.getElementById('start').onclick = function () {
      var btn = this;
      btn.disabled = true;
      // A declined consent still takes the survey: collectAndSend then rejects with consent_declined.
      startProtection(box.checked).then(function () { state.step = 0; render(); });
    };
  }

  function renderQuestion(q) {
    var body = '<span class="qnum">Question ' + (state.step + 1) + ' of ' + TOTAL + '</span>' +
      '<p class="qtext">' + esc(q.text) +
      (q.required ? '' : ' <span style="color:var(--muted);font-weight:400">(optional)</span>') + '</p>' +
      (q.hint ? '<p class="hint">' + esc(q.hint) + '</p>' : '');

    if (q.type === 'single' || q.type === 'multi') {
      var sel = state.answers[q.id] || (q.type === 'multi' ? [] : null);
      body += q.options.map(function (opt) {
        var checked = q.type === 'multi' ? sel.indexOf(opt) !== -1 : sel === opt;
        return '<label class="opt' + (checked ? ' checked' : '') + '">' +
          '<input type="' + (q.type === 'multi' ? 'checkbox' : 'radio') + '" name="' + q.id + '" value="' + esc(opt) +
          '"' + (checked ? ' checked' : '') + '><span>' + esc(opt) + '</span></label>';
      }).join('');
    } else if (q.type === 'matrix') {
      var ans = state.answers[q.id] || {};
      body += '<table class="matrix"><thead><tr><th></th>';
      for (var s = 1; s <= q.scale; s++) body += '<th>' + s + '</th>';
      body += '</tr></thead><tbody>';
      q.rows.forEach(function (row, ri) {
        body += '<tr><td>' + esc(row) + '</td>';
        for (var v = 1; v <= q.scale; v++) {
          body += '<td><input type="radio" name="' + q.id + '_' + ri + '" value="' + v + '"' +
            (ans[ri] === v ? ' checked' : '') + '></td>';
        }
        body += '</tr>';
      });
      body += '</tbody></table>';
    } else if (q.type === 'scale') {
      var cur = state.answers[q.id];
      body += '<div class="scale">';
      for (var n = q.min; n <= q.max; n++) {
        body += '<label><input type="radio" name="' + q.id + '" value="' + n + '"' + (cur === n ? ' checked' : '') +
          '><span>' + n + '</span></label>';
      }
      body += '</div><div class="scale-ends"><span>' + esc(q.lowLabel) + '</span><span>' + esc(q.highLabel) +
        '</span></div>';
    } else if (q.type === 'text') {
      body += '<textarea id="txt_' + q.id + '" placeholder="' + esc(q.placeholder || '') + '">' +
        esc(state.answers[q.id] || '') + '</textarea>';
    }

    body += '<div class="err" id="err"></div><div class="nav">' +
      (state.step > 0 ? '<button class="btn-ghost" id="back">← Back</button>' : '') +
      '<button class="btn-primary" id="next">' + (state.step === TOTAL - 1 ? 'Review →' : 'Next →') + '</button></div>';
    app.innerHTML = body;
    wireQuestion(q);
  }

  function wireQuestion(q) {
    app.querySelectorAll('.opt').forEach(function (el) {
      el.addEventListener('click', function () {
        var input = el.querySelector('input');
        if (q.type === 'single') app.querySelectorAll('.opt').forEach(function (o) { o.classList.remove('checked'); });
        if (q.type === 'multi') el.classList.toggle('checked', input.checked);
        else el.classList.add('checked');
      });
    });
    var back = document.getElementById('back');
    if (back) back.onclick = function () { collectCurrent(q); state.step--; render(); };
    document.getElementById('next').onclick = function () {
      collectCurrent(q);
      var msg = validate(q);
      if (msg) { document.getElementById('err').textContent = msg; return; }
      var ending = q.screen ? q.screen(state.answers[q.id]) : null;
      if (ending) { finish(ending, null); return; }
      state.step++;
      render();
    };
  }

  function collectCurrent(q) {
    if (q.type === 'single') {
      var r = app.querySelector('input[name="' + q.id + '"]:checked');
      state.answers[q.id] = r ? r.value : null;
    } else if (q.type === 'multi') {
      state.answers[q.id] = Array.prototype.map.call(
        app.querySelectorAll('input[name="' + q.id + '"]:checked'), function (i) { return i.value; });
    } else if (q.type === 'matrix') {
      var ans = {};
      q.rows.forEach(function (_row, ri) {
        var r = app.querySelector('input[name="' + q.id + '_' + ri + '"]:checked');
        if (r) ans[ri] = parseInt(r.value, 10);
      });
      state.answers[q.id] = ans;
    } else if (q.type === 'scale') {
      var s = app.querySelector('input[name="' + q.id + '"]:checked');
      state.answers[q.id] = s ? parseInt(s.value, 10) : null;
    } else if (q.type === 'text') {
      var t = document.getElementById('txt_' + q.id);
      if (t) state.answers[q.id] = t.value;
    }
  }

  function validate(q) {
    if (!q.required) return '';
    var a = state.answers[q.id];
    if (q.type === 'multi') return a && a.length ? '' : 'Please select at least one option.';
    if (q.type === 'matrix') return a && Object.keys(a).length === q.rows.length ? '' : 'Please rate every statement.';
    if (q.type === 'text') return a && a.trim() ? '' : 'Please enter a response.';
    return a !== null && a !== undefined && a !== '' ? '' : 'Please choose an answer.';
  }

  // ── Review and submit ────────────────────────────────────────────────────
  function renderReview() {
    bar.style.width = '100%';
    app.innerHTML =
      '<h2>Review your answers</h2>' +
      '<p class="lede">Submitting runs a SurveyGuard quality check on your session.</p>' +
      QUESTIONS.map(function (q) {
        return '<p style="margin:0 0 12px"><strong>' + esc(q.text) + '</strong><br>' +
          '<span style="color:var(--muted)">' + esc(formatAnswer(q)) + '</span></p>';
      }).join('') +
      '<div class="err" id="err"></div>' +
      '<div class="nav"><button class="btn-ghost" id="back">← Back</button>' +
      '<button class="btn-primary" id="submit">Submit →</button></div>';
    document.getElementById('back').onclick = function () { state.step = TOTAL - 1; render(); };
    document.getElementById('submit').onclick = submit;
  }

  function formatAnswer(q) {
    var a = state.answers[q.id];
    if (a == null || a === '') return '(no answer)';
    if (q.type === 'multi') return a.join(', ');
    if (q.type === 'matrix') return q.rows.map(function (r, ri) { return r + ': ' + (a[ri] || '–'); }).join(' · ');
    return String(a);
  }

  /**
   * What the respondent answered, as collectAndSend takes it (Phase 19, ADR-048): closed answers are `choices`,
   * open text is `answers`. A closed answer sent as text is judged as text, and anything under three words is low
   * effort, so only the open question goes in `answers`. Kept in the survey's order.
   */
  function hostAnswers() {
    var choices = [];
    var answers = [];
    QUESTIONS.forEach(function (q) {
      var a = state.answers[q.id];
      if (a == null || a === '') return;
      if (q.type === 'text') {
        if (String(a).trim()) answers.push({ questionId: q.id, question: q.text, answer: String(a).trim() });
      } else if (q.type === 'matrix') {
        q.rows.forEach(function (row, ri) {
          if (a[ri] != null) choices.push({ questionId: q.id + '_' + ri, question: row, answer: a[ri] });
        });
      } else if (q.type === 'multi') {
        if (a.length) choices.push({ questionId: q.id, question: q.text, answer: a.join(', ') });
      } else {
        choices.push({ questionId: q.id, question: q.text, answer: a });
      }
    });
    return { choices: choices, answers: answers };
  }

  function submit() {
    var btn = document.getElementById('submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    sdk.then(function (sg) {
      if (!sg) {
        return { action: 'PROCEED_TO_SURVEY', verdict: null, source: 'none', failure: problem ? problem[0] : 'sdk_missing' };
      }
      return sg.collectAndSend(hostAnswers()).then(null, function (err) {
        var code = (err && err.code) || 'error';
        // A failure carries the fail strategy's action, already announced. Consent decides nothing: no resolution.
        var r = err && err.resolution;
        if (r) return Object.assign({}, r, { failure: r.failure || code });
        if (code === 'invalid_options') console.error('SurveyGuard refused the answers', err);
        return { action: 'PROCEED_TO_SURVEY', verdict: null, source: 'none', failure: code };
      });
    }).then(act);
  }

  /** The SDK reports; the survey acts. */
  function act(result) {
    if (result.action === 'DECOY_SURVEY' && result.decoyUrl) {
      // The decoy keeps them, then sends them out through the security URL of the supplier SurveyGuard has on
      // record for this code (Suppliers, in the dashboard): this page never sees them again.
      remember('security', result, result.decoyUrl);
      window.location.href = result.decoyUrl;
      return;
    }
    var screenedOut = result.action === 'SUPPLIER_SCREENOUT' || result.action === 'DECOY_SURVEY';
    finish(screenedOut ? 'security' : 'complete', result);
  }

  // ── Endings ──────────────────────────────────────────────────────────────
  /**
   * Where an ending goes: the supplier's URL for it with `[RID]` filled in, or null for this survey's own end page.
   * A security screen-out with no URL of its own goes to the supplier's terminate URL, as a panel expects.
   */
  function endingUrl(status) {
    var redirects = (supplier && supplier.redirects) || {};
    var template = redirects[status] || (status === 'security' ? redirects.terminate : null);
    if (!template) return null;
    var filled = template.split('[RID]').join(encodeURIComponent(respondentId));
    try {
      var url = new URL(filled, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch (e) {
      return null;
    }
  }

  function remember(status, result, url) {
    try {
      sessionStorage.setItem('sg_result', JSON.stringify(result));
      sessionStorage.setItem('sg_ending', JSON.stringify({
        status: status, supplier: supplierCode || null, respondentId: respondentId || null, redirect: url
      }));
    } catch (e) {}
  }

  function finish(status, result) {
    var url = endingUrl(status);
    remember(status, result, url);
    if (url) {
      window.location.href = url;
      return;
    }
    var qs = new URLSearchParams(window.location.search);
    qs.set('end', status);
    window.location.href = 'thanks.html?' + qs.toString();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  render();
})();
