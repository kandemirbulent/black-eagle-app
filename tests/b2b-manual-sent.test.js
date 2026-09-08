const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createB2BOutreachRouter } = require('../routes/b2bOutreachRoutes');
const { createController } = require('../public/js/b2b-outreach-dashboard');
const ID = '64b000000000000000000010';
const FIRST = '2026-09-06T12:00:00.000Z';
async function harness(run, overrides = {}) {
  const contact = { _id: ID, businessEmail: 'person@example.com', outreachStatus: 'READY', lastEmailSentAt: null, senderMailbox: '', notes: 'Existing note', selectedAt: new Date(), recordVersion: 3, researchStatus: 'COMPLETE', ...overrides };
  let writes = 0, jobs = 0, queues = 0, clock = FIRST;
  const collection = {
    async updateOne(filter, pipeline) {
      if (String(filter._id) !== ID) return { matchedCount: 0 };
      assert.equal(filter.lastEmailSentAt, null);
      assert.deepEqual(filter.outreachStatus, { $ne: 'SENT' });
      if (contact.outreachStatus === 'SENT' || contact.lastEmailSentAt || contact.optOut || !filter.businessEmail.$regex.test(contact.businessEmail)) return { matchedCount: 0 };
      const set = pipeline[0].$set;
      assert.equal(Object.hasOwn(set, 'senderMailbox'), false);
      assert.equal(Object.keys(set).some(key => /research/i.test(key)), false);
      const notes = contact.notes + set.notes.$concat[1].$literal;
      Object.assign(contact, set, { notes, recordVersion: contact.recordVersion + 1 }); writes++;
      return { matchedCount: 1 };
    },
    async findOne({ _id }) { return String(_id) === ID ? contact : null; }
  };
  const app = express(); app.use(express.json());
  app.use(createB2BOutreachRouter({ requireAdminAuth(req, res, next) { const role = req.headers['x-role']; if (!role) return res.sendStatus(401); req.adminUser = { _id: 'actor', role }; next(); }, getContactsCollection: () => collection, getRequestsCollection() { queues++; throw Error('Must not enqueue'); }, triggerJob: async () => { jobs++; throw Error('Must not trigger worker'); }, env: { B2B_OUTREACH_SEND_ENABLED: 'false' }, now: () => new Date(clock), logger: { error() {} } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const post = (id = ID, role = 'SUPERADMIN', body = {}) => fetch(`http://127.0.0.1:${server.address().port}/admin/b2b-outreach/contacts/${id}/mark-sent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-role': role }, body: JSON.stringify(body) });
  try { await run({ contact, post, advance: () => { clock = '2026-09-07T12:00:00.000Z'; }, writes: () => writes }); assert.equal(jobs, 0); assert.equal(queues, 0); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('SUPERADMIN records server timestamp and manual note without sending; repeat preserves first send', () => harness(async ({ post, contact, advance, writes }) => {
  const response = await post(ID, 'SUPERADMIN', { lastEmailSentAt: '2000-01-01', senderMailbox: 'MANUAL' });
  assert.equal(response.status, 200); assert.equal(contact.outreachStatus, 'SENT'); assert.equal(contact.lastEmailSentAt.toISOString(), FIRST);
  assert.equal(contact.senderMailbox, ''); assert.match(contact.notes, /^Existing note\nManually sent; recorded by actor/); assert.equal(contact.selectedAt, null); assert.equal(contact.recordVersion, 4); assert.equal(contact.researchStatus, 'COMPLETE');
  advance(); assert.equal((await (await post()).json()).data.alreadySent, true); assert.equal(contact.lastEmailSentAt.toISOString(), FIRST); assert.equal(writes(), 1);
}));
test('normal admin and unauthenticated caller cannot record manual send', () => harness(async ({ post, writes }) => { assert.equal((await post(ID, 'ADMIN')).status, 403); assert.equal((await post(ID, '')).status, 401); assert.equal(writes(), 0); }));
test('invalid ID rejected server-side and missing prospect returns 404', () => harness(async ({ post, writes }) => { assert.equal((await post('invalid')).status, 400); assert.equal((await post('64b000000000000000000099')).status, 404); assert.equal(writes(), 0); }));
test('existing genuine send keeps timestamp, mailbox and notes', () => harness(async ({ post, contact, writes }) => { assert.equal((await post()).status, 200); assert.equal(contact.lastEmailSentAt, FIRST); assert.equal(contact.senderMailbox, 'sales@example.com'); assert.equal(contact.notes, 'Existing note'); assert.equal(writes(), 0); }, { outreachStatus: 'SENT', lastEmailSentAt: FIRST, senderMailbox: 'sales@example.com' }));
test('unsuitable prospect cannot be marked', () => harness(async ({ post, writes }) => { assert.equal((await post()).status, 409); assert.equal(writes(), 0); }, { optOut: true }));
function element() { return { children: [], textContent: '', value: '', dataset: {}, addEventListener(name, handler) { this[name] = handler; }, setAttribute() {}, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, insertRow() { const row = element(); this.children.push(row); return row; }, insertCell() { return this.insertRow(); } }; }
test('confirmation gates mutation; refreshed ACTIVE dashboard immediately hides the sent contact', async () => {
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= element(); } });
  const contact = { _id: ID, businessEmail: 'person@example.com', outreachStatus: 'READY' }; let confirmed = false, posts = 0;
  const controller = createController({ actorRole: 'SUPERADMIN', documentRef: { getElementById: id => elements[id], createElement: element }, windowRef: { confirm(text) { assert.equal(text, 'Mark this prospect as manually sent?'); return confirmed; } }, showMessage() {}, authFetch: async (url, options) => { posts++; assert.equal(url, `/api/admin/b2b-outreach/contacts/${ID}/mark-sent`); assert.deepEqual(options, { method: 'POST' }); Object.assign(contact, { outreachStatus: 'SENT', lastEmailSentAt: FIRST }); return { ok: true, json: async () => ({ ok: true }) }; }, operationOverride: async name => { assert.equal(name, 'LIST_CONTACTS'); return { items: [contact], total: 1, selectedCount: 0, eligibleCount: 0 }; } });
  await controller.loadContacts(); let row = elements.b2bContactsTable.children[0]; assert.ok(row.children[14].children.some(button => button.textContent === 'Mark as Sent'));
  await controller.markAsSent(contact); assert.equal(posts, 0); confirmed = true; await controller.markAsSent(contact); assert.equal(posts, 1);
  assert.equal(elements.b2bContactsTable.children.length, 1); row = elements.b2bContactsTable.children[0]; assert.equal(row.children.length, 1); assert.equal(row.children[0].textContent, 'No B2B contacts available.'); assert.equal(controller.state.contacts.length, 0); assert.equal(controller.isContactSelectionBlocked(contact), true); assert.equal(elements.b2bSelectPage.disabled, true);
  elements.b2bRecordView.value = 'ALL'; await controller.loadContacts(); row = elements.b2bContactsTable.children[0]; assert.equal(row.children[11].textContent, 'SENT'); assert.equal(row.children[12].textContent, new Date(FIRST).toLocaleString()); assert.equal(row.children[14].children.some(button => button.textContent === 'Mark as Sent'), false);
});

test('genuine sent contacts are excluded from ACTIVE but retained in ALL without deletion or mutation', async () => {
  const elements = new Proxy({}, { get(target, key) { return target[key] ||= element(); } });
  const sent = { _id: ID, businessEmail: 'person@example.com', outreachStatus: 'SENT', lastEmailSentAt: FIRST };
  let listCalls = 0;
  const controller = createController({ actorRole: 'SUPERADMIN', documentRef: { getElementById: id => elements[id], createElement: element }, windowRef: {}, showMessage() {}, authFetch: async () => { throw new Error('No write expected'); }, operationOverride: async (name) => { assert.equal(name, 'LIST_CONTACTS'); listCalls++; return { items: [sent], total: 1, selectedCount: 0, eligibleCount: 0 }; } });
  await controller.loadContacts(); assert.equal(controller.state.contacts.length, 0);
  elements.b2bRecordView.value = 'ALL'; await controller.loadContacts(); assert.equal(controller.state.contacts.length, 1); assert.equal(controller.state.contacts[0], sent); assert.equal(listCalls, 2);
});

test('concurrent marking records one timestamp and one note', () => harness(async ({ post, contact, writes }) => {
  const responses = await Promise.all([post(), post()]); assert.ok(responses.every(response => response.status === 200));
  assert.equal(writes(), 1); assert.equal(contact.lastEmailSentAt.toISOString(), FIRST); assert.equal(contact.notes.match(/Manually sent/g).length, 1);
}));
