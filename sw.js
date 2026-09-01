// Kensington Tours Spain Guide — Client Tracker reminder service worker
// (Aug 2026, unverified live). MUST be hosted at a real https:// (or
// http://localhost) origin alongside Tommie_Tours.html, in the
// same directory — service workers cannot be registered from file:// at
// all (a hard browser restriction, not a bug here) and cannot be inlined
// via a Blob/data: URL (also blocked by browsers), which is why this is a
// second file instead of staying inside the single HTML file like
// everything else in this project. If this file isn't reachable at
// ./sw.js relative to the guide, registration just fails silently and the
// existing same-tab-only browser-notification reminders (see
// ctCheckDueReminders in the main file) keep working exactly as before —
// nothing here is required for the app to function.
//
// What this actually buys: while this page (or an installed copy of it)
// has at least one window open somewhere — even in the background,
// unfocused — notifications already worked before this file existed. What
// THIS unlocks is Periodic Background Sync: Chrome/Chromium browsers can
// wake this worker on their own schedule even with no window open at all,
// IF the page has been installed as an app (see the manifest link in the
// main file) AND Chrome's own site-engagement heuristics consider it
// "used enough" — there is no manual override for that second condition,
// it is entirely Chrome's call, and Firefox/Safari don't implement
// Periodic Background Sync at all. So this is a real best-effort upgrade,
// not a guaranteed one — treat every reminder that arrives this way as a
// bonus on top of the same-tab path, never the only thing relied on for
// something time-sensitive.
//
// Service workers can't read the page's localStorage (different storage
// world entirely) — so instead of duplicating the Client Tracker's full
// data model, the main file mirrors just the fields a reminder needs
// (id, name, status, nextFollowUp) into IndexedDB every time Client
// Tracker data is saved (see ctMirrorRemindersToIndexedDb in the main
// file). This worker only ever reads that mirror — it never writes
// client data, matching this project's "push/read only, never a second
// source of truth" discipline used everywhere else (Outlook, propose_todo_update).

const CT_REMINDER_DB = 'kt-reminders';
const CT_REMINDER_DB_VERSION = 1;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

// A fetch handler with no actual caching logic is still required by some
// browsers' installability criteria — this project has no offline-asset
// story to add (it's one downloaded HTML file, already fully available
// offline by nature), so this is a deliberate plain passthrough, not an
// oversight.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

function ctSwOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CT_REMINDER_DB, CT_REMINDER_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clients')) db.createObjectStore('clients', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notified')) db.createObjectStore('notified');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function ctSwGetAllClients(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clients', 'readonly');
    const req = tx.objectStore('clients').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function ctSwGetNotifiedMap(db) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('notified', 'readonly');
      const req = tx.objectStore('notified').get('map');
      req.onsuccess = () => resolve(req.result || {});
      req.onerror = () => resolve({});
    } catch (e) { resolve({}); }
  });
}

function ctSwPutNotifiedMap(db, map) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('notified', 'readwrite');
      tx.objectStore('notified').put(map, 'map');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

// Same "overdue or due today, once per day per client" rule as the
// same-tab ctCheckDueReminders() in the main file — deliberately kept
// this simple rather than also porting the hot-lead-nudge logic, since
// this worker has no live-AI access and no way to reach Client Tracker
// fields beyond what's mirrored.
async function ctSwCheckDue() {
  let db;
  try { db = await ctSwOpenDb(); } catch (e) { return; }
  let clients, notified;
  try {
    clients = await ctSwGetAllClients(db);
    notified = await ctSwGetNotifiedMap(db);
  } catch (e) { return; }
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const c of clients) {
    if (!c || !c.nextFollowUp || c.status === 'Closed') continue;
    const diffDays = Math.round((new Date(c.nextFollowUp) - new Date(today)) / 86400000);
    if (diffDays > 0) continue; // not due yet
    if (notified[c.id] === today) continue; // already reminded today
    const body = diffDays < 0
      ? `Follow-up was due ${c.nextFollowUp} — ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue.`
      : 'Follow-up is due today.';
    try {
      await self.registration.showNotification('📋 ' + c.name, { body, tag: 'ct-' + c.id, renotify: false });
    } catch (e) { /* notification API unavailable/blocked — skip, try again next wake */ }
    notified[c.id] = today;
    changed = true;
  }
  if (changed) await ctSwPutNotifiedMap(db, notified);
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'ct-check-followups') event.waitUntil(ctSwCheckDue());
});

// Not every browser/OS that lacks Periodic Background Sync also lacks
// one-off Background Sync — registering the same tag under both event
// types is a harmless extra chance at a wake-up, never a requirement.
self.addEventListener('sync', (event) => {
  if (event.tag === 'ct-check-followups') event.waitUntil(ctSwCheckDue());
});
