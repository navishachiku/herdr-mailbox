// mailbox sent: the letters one sender sent to one mailbox since a time. Read-only.
export const options = { from: { type: 'string' }, to: { type: 'string' }, since: { type: 'string' } };

export const usage = '  mailbox sent --from <agent|pane> --to <address|MB-id> --since <ISO time|epoch ms>   (lists that sender\'s letters in that mailbox since then; changes nothing)';

export async function build(v, positionals, h) {
  if (!v.from || !v.to || !v.since) h.usage('sent needs --from, --to and --since');
  const since = /^\d+$/.test(v.since) ? Number(v.since) : Date.parse(v.since);
  if (Number.isNaN(since)) h.usage(`--since is not a time: ${v.since}`);
  return { op: 'sent', from: await h.target(v.from), to: await h.target(v.to), since };
}
