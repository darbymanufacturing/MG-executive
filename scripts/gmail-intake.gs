/**
 * gmail-intake.gs — Google Apps Script that feeds supplier invoices from Gmail
 * into Omni's Autopilot intake queue (docs/AUTOMATION_PLAN.md §4.3).
 *
 * WHY THIS SHAPE: the suppliers already email PDFs to the company inboxes, so
 * nobody should have to forward anything. A Gmail filter labels those messages;
 * this script posts each new attachment to Omni every 15 minutes and relabels
 * the thread as done. It is free (well inside Apps Script quotas) and needs no
 * Google Cloud project.
 *
 * ── SETUP (about 10 minutes, once) ──────────────────────────────────────────
 * 1. In Gmail, create a filter that labels supplier invoices `Omni/Intake`.
 *    A good start: has attachment, from any of your suppliers, or subject
 *    contains τιμολόγιο / invoice / απόδειξη.
 * 2. Go to https://script.google.com → New project → paste this file.
 * 3. Edit CONFIG below: set SECRET to the same value you put in Vercel as
 *    INTAKE_EMAIL_SECRET. (Keep this script private — the secret is in it.)
 * 4. Run `setUpTrigger` once and approve the permissions prompt.
 * 5. Optional: run `testOnce` to push the newest labelled message immediately.
 *
 * Labels are created automatically if missing.
 */

var CONFIG = {
  ENDPOINT: 'https://mg-executive.vercel.app/api/intake-email',
  SECRET: 'PASTE_THE_SAME_VALUE_AS_INTAKE_EMAIL_SECRET',
  SOURCE_LABEL: 'Omni/Intake',
  DONE_LABEL: 'Omni/Done',
  MAX_THREADS: 20,          // per run; keeps well inside UrlFetch quotas
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
  ALLOWED_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
};

function setUpTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'pushNewInvoices') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('pushNewInvoices').timeBased().everyMinutes(15).create();
  getOrCreateLabel_(CONFIG.SOURCE_LABEL);
  getOrCreateLabel_(CONFIG.DONE_LABEL);
  Logger.log('Trigger installed: pushNewInvoices every 15 minutes.');
}

function testOnce() {
  var n = pushNewInvoices();
  Logger.log('Pushed ' + n + ' message(s).');
}

function pushNewInvoices() {
  if (!CONFIG.SECRET || CONFIG.SECRET.indexOf('PASTE_') === 0) {
    throw new Error('Set CONFIG.SECRET to the same value as INTAKE_EMAIL_SECRET in Vercel.');
  }

  var source = getOrCreateLabel_(CONFIG.SOURCE_LABEL);
  var done = getOrCreateLabel_(CONFIG.DONE_LABEL);
  var threads = source.getThreads(0, CONFIG.MAX_THREADS);
  var pushed = 0;

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    var allOk = true;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var attachments = collectAttachments_(msg);
      if (attachments.length === 0) continue;

      var payload = {
        messageId: msg.getId(),
        from: msg.getFrom(),
        subject: msg.getSubject(),
        receivedAt: msg.getDate().toISOString(),
        attachments: attachments,
      };

      try {
        var res = UrlFetchApp.fetch(CONFIG.ENDPOINT, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'X-Intake-Secret': CONFIG.SECRET },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        var code = res.getResponseCode();
        if (code >= 200 && code < 300) {
          pushed++;
        } else {
          allOk = false;
          Logger.log('Omni returned ' + code + ': ' + res.getContentText().slice(0, 300));
        }
      } catch (err) {
        allOk = false;
        Logger.log('Push failed: ' + err);
      }
    }

    // Only move the thread on once every message in it went through, so a
    // transient failure is retried on the next run instead of being lost.
    if (allOk) {
      threads[t].addLabel(done);
      threads[t].removeLabel(source);
    }
  }
  return pushed;
}

function collectAttachments_(msg) {
  var out = [];
  var atts = msg.getAttachments({ includeInlineImages: true, includeAttachments: true });
  for (var i = 0; i < atts.length; i++) {
    var a = atts[i];
    var type = a.getContentType();
    if (CONFIG.ALLOWED_TYPES.indexOf(type) === -1) continue;
    if (a.getSize() > CONFIG.MAX_ATTACHMENT_BYTES) continue;
    out.push({
      filename: a.getName(),
      mimeType: type,
      contentBase64: Utilities.base64Encode(a.getBytes()),
    });
  }
  return out;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
