import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo';
import { makeLogin } from './raw';

let d: Demo;
let login: ReturnType<typeof makeLogin>;
let F: Awaited<ReturnType<typeof login>>;
let K: typeof F;
let T: typeof F;
let ids: { k: number; t: number; meera: number };
let projects: { acme: number; green: number; bright: number };
const db = () => d.app.ctx.db;
const uid = (email: string): number => (db().prepare('SELECT id FROM users WHERE email=?').get(email) as { id: number }).id;
const notes = async (I: typeof F) => (await I.call('GET', '/notifications')).j.items as { link: string; text: string; user_id: number }[];

beforeAll(async () => {
  d = await createDemo({ TRUST_PROXY: '1' });
  login = makeLogin(d.app);
  F = await login('aarav@demo.test');
  K = await login('kabir@demo.test');
  T = await login('tara@demo.test');
  ids = { k: uid('kabir@demo.test'), t: uid('tara@demo.test'), meera: uid('meera@demo.test') };
  const p = (await F.call('GET', '/projects?limit=500')).j as { id: number; name: string }[];
  projects = { acme: p.find((x) => x.name.startsWith('Fleet'))?.id as number, green: p.find((x) => x.name.startsWith('GreenLeaf'))?.id as number, bright: p.find((x) => x.name.startsWith('BrightPath'))?.id as number };
});
afterAll(() => d.app.close());

describe('Task teamwork — several people, checklist, mentions, watchers', () => {
  let tid = 0;
  let link = '';
  let histFirst = 0;
  it('has a shared demo task with 3 people, a checklist and a discussion', async () => {
    const seeded = ((await F.call('GET', '/tasks?limit=500')).j as { title: string; assignees: unknown[]; check_total: number; check_done: number }[]).find((x) => x.title.startsWith('Get Fleet portal ready'));
    expect(seeded?.assignees).toHaveLength(3);
    expect(seeded?.check_total).toBe(4);
    expect(seeded?.check_done).toBe(1);
  });
  it('assigns one task to two interns, notifying both with a link that opens the task', async () => {
    const team = await F.call('POST', '/tasks', { title: 'Team task', project_id: projects.bright, assignee_ids: [ids.k, ids.t], priority: 'high' });
    expect(team.s).toBe(201);
    expect(team.j.assignees.map((a: { id: number }) => a.id).join()).toBe(`${ids.k},${ids.t}`);
    expect(team.j.assignee_id).toBe(ids.k);
    tid = team.j.id;
    link = `/tasks?open=${tid}`;
    expect((await notes(K)).some((n) => n.link === link && /assigned you T-/.test(n.text))).toBe(true);
    expect((await notes(T)).some((n) => n.link === link)).toBe(true);
  });
  it('lets an assignee who is not on the project open and work on the task and see it everywhere', async () => {
    expect((await T.call('GET', `/tasks/${tid}`)).s).toBe(200);
    expect((await T.call('GET', `/tasks/${tid}/collab`)).j.can_edit).toBe(true);
    expect(((await T.call('GET', `/tasks?assignee_id=${ids.t}&limit=500`)).j as { id: number }[]).some((x) => x.id === tid)).toBe(true);
    expect(((await T.call('GET', '/dashboard')).j.my_tasks as { id: number }[]).some((x) => x.id === tid)).toBe(true);
    expect(((await F.call('GET', '/dashboard')).j.team_load as { id: number; open_tasks: number }[]).find((x) => x.id === ids.t)?.open_tasks).toBeGreaterThanOrEqual(1);
  });
  it('notifies watchers of status changes and records who changed what in an undeletable history', async () => {
    expect((await T.call('PUT', `/tasks/${tid}`, { status: 'in_progress' })).s).toBe(200);
    expect((await notes(K)).some((n) => n.link === link && /moved T-\d+ .* to In progress/.test(n.text))).toBe(true);
    expect((await notes(F)).some((n) => n.link === link && /moved/.test(n.text))).toBe(true);
    const hist = ((await F.call('GET', `/notes?entity_type=task&entity_id=${tid}`)).j as { kind: string; body: string; user_id: number; id: number }[]).filter((n) => n.kind === 'history');
    expect(hist.some((n) => n.body === 'changed status from To do to In progress' && n.user_id === ids.t)).toBe(true);
    expect(hist.some((n) => n.body === 'created this task')).toBe(true);
    histFirst = hist[0]?.id as number;
    expect((await T.call('DELETE', `/notes/${histFirst}`)).s).toBe(403);
    expect((await F.call('DELETE', `/notes/${histFirst}`)).s).toBe(403);
  });
  it('stops an intern changing who is on a task and refuses people who do not exist', async () => {
    await T.call('PUT', `/tasks/${tid}`, { assignee_ids: [ids.t], title: 'mine now' });
    expect(((await F.call('GET', `/tasks/${tid}`)).j.assignees as unknown[]).length).toBe(2);
    expect((await F.call('POST', '/tasks', { title: 'ghost', assignee_ids: [999999] })).s).toBe(400);
  });
  it('supports a checklist: items for teammates, only for people on the task, ticking records who did it', async () => {
    const c1 = await K.call('POST', `/tasks/${tid}/checklist`, { text: 'Backend part', assignee_id: ids.t });
    expect(c1.s).toBe(201);
    expect(c1.j[0].assignee_id).toBe(ids.t);
    expect((await notes(T)).some((n) => /gave you a checklist item/.test(n.text))).toBe(true);
    expect((await K.call('POST', `/tasks/${tid}/checklist`, { text: 'x', assignee_id: ids.meera })).s).toBe(400);
    expect((await K.call('POST', `/tasks/${tid}/checklist`, { text: '   ' })).s).toBe(400);
    const tick = await T.call('PUT', `/tasks/${tid}/checklist/${c1.j[0].id}`, { done: true });
    expect(tick.j[0]).toMatchObject({ done: 1, done_by: ids.t });
    expect((await F.call('GET', `/tasks/${tid}`)).j.check_done).toBe(1);
  });
  it('lets a project teammate who is not on the task read and discuss it, not change it', async () => {
    const acmeTask = await F.call('POST', '/tasks', { title: 'Kabir only', project_id: projects.acme, assignee_ids: [ids.k] });
    const tc = await T.call('GET', `/tasks/${acmeTask.j.id}/collab`);
    expect(tc.s).toBe(200);
    expect(tc.j.can_edit).toBe(false);
    expect((await T.call('POST', `/tasks/${acmeTask.j.id}/checklist`, { text: 'x' })).s).toBe(403);
    expect((await T.call('PUT', `/tasks/${acmeTask.j.id}`, { status: 'done' })).s).toBe(403);
    expect((await T.call('POST', '/notes', { entity_type: 'task', entity_id: acmeTask.j.id, body: 'Can I help?' })).s).toBe(201);
  });
  it('shuts out an outsider completely', async () => {
    const greenOnly = await F.call('POST', '/tasks', { title: 'Tara only', project_id: projects.green, assignee_ids: [ids.t] });
    const out = [
      await K.call('GET', `/tasks/${greenOnly.j.id}/collab`), await K.call('POST', `/tasks/${greenOnly.j.id}/checklist`, { text: 'x' }),
      await K.call('POST', `/tasks/${greenOnly.j.id}/watch`, {}), await K.call('POST', '/notes', { entity_type: 'task', entity_id: greenOnly.j.id, body: 'x' }),
    ];
    expect(out.every((x) => [403, 404].includes(x.s))).toBe(true);
  });
  it('handles comments, @mentions and editing your own comment', async () => {
    const fBefore = (await notes(F)).length;
    const cm = await K.call('POST', '/notes', { entity_type: 'task', entity_id: tid, body: '@Tara Nair please check', mentions: [ids.t, 'junk', ids.k] });
    const tN = (await notes(T)).filter((n) => n.link === link);
    expect(cm.s).toBe(201);
    expect(JSON.parse(cm.j.mentions).map((m: { id: number }) => m.id).join()).toBe(String(ids.t));
    expect(tN.some((n) => /mentioned you on T-/.test(n.text))).toBe(true);
    expect(tN.some((n) => /Kabir Singh commented/.test(n.text))).toBe(false);
    expect((await notes(F)).length).toBe(fBefore + 1);
    expect((await T.call('PUT', `/notes/${cm.j.id}`, { body: 'hacked' })).s).toBe(403);
    expect((await K.call('PUT', `/notes/${histFirst}`, { body: 'x' })).s).toBe(403);
    const ed = await K.call('PUT', `/notes/${cm.j.id}`, { body: '@Tara Nair please check the API' });
    expect(ed.s).toBe(200);
    expect(ed.j.edited_at).toBeTruthy();
    expect(ed.j.body.endsWith('the API')).toBe(true);
  });
  it('can stop and resume watching', async () => {
    await K.call('POST', `/tasks/${tid}/watch`, { on: false });
    const kBefore = (await notes(K)).length;
    await F.call('POST', '/notes', { entity_type: 'task', entity_id: tid, body: 'update from founder' });
    expect((await notes(K)).length).toBe(kBefore);
    expect((await K.call('POST', `/tasks/${tid}/watch`, {})).j.watching).toBe(true);
  });
  it('removes access (and mentions) when someone is taken off the task, and cleans up on delete', async () => {
    await F.call('PUT', `/tasks/${tid}`, { assignee_ids: [ids.k] });
    expect((await T.call('GET', `/tasks/${tid}`)).s).toBe(404);
    expect(((await F.call('GET', `/notes?entity_type=task&entity_id=${tid}`)).j as { kind: string; body: string }[]).some((n) => n.kind === 'history' && n.body === 'removed Tara Nair')).toBe(true);
    const tCount = (await notes(T)).length;
    const late = await K.call('POST', '/notes', { entity_type: 'task', entity_id: tid, body: '@Tara Nair?', mentions: [ids.t] });
    expect(late.j.mentions).toBeNull();
    expect((await notes(T)).length).toBe(tCount);
    expect(((await F.call('GET', `/tasks/${tid}/collab`)).j.people as { id: number }[]).some((p) => p.id === ids.t)).toBe(false);
    await F.call('DELETE', `/tasks/${tid}`);
    for (const tb of ['task_assignees', 'task_watchers', 'task_checklist']) expect((db().prepare(`SELECT COUNT(*) n FROM ${tb} WHERE task_id=?`).get(tid) as { n: number }).n).toBe(0);
  });
});
