/**
 * Simulates changes in the FICTIONAL CRM so that the background pipeline can be
 * observed without any user action in Ulysse:
 *   list <dataset>
 *   stall <dataset> <id> <days>          last activity N days ago, no next step
 *   plan <dataset> <id> <dueInDays> <label...>
 *   won|lost <dataset> <id>
 *   delete <dataset> <id>
 */
import { FixtureCrmWriter } from '@ulysse/connectors';
import { databaseUrl } from '@ulysse/database';

const [command, dataset, id, ...rest] = process.argv.slice(2);
const writer = await FixtureCrmWriter.connect(databaseUrl('migrator'));
const now = new Date().toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

try {
  if (!command || !dataset)
    throw new Error('usage: fixture-crm <list|stall|plan|won|lost|delete> <dataset> [id] [...]');
  if (command === 'list') {
    for (const item of await writer.list(dataset))
      console.warn(
        `${item.externalId} v${String(item.version)}${item.deleted ? ' (deleted)' : ''}`,
      );
  } else {
    if (!id) throw new Error('missing opportunity id');
    const current = (await writer.get(dataset, id)) ?? {
      id,
      title: `Opportunité fictive ${id}`,
      status: 'open',
    };
    if (command === 'stall') {
      await writer.upsert(
        dataset,
        id,
        {
          ...current,
          status: 'open',
          last_activity: daysFromNow(-Number(rest[0] ?? '10')),
          next_action: null,
        },
        now,
      );
    } else if (command === 'plan') {
      await writer.upsert(
        dataset,
        id,
        {
          ...current,
          status: 'open',
          last_activity: now,
          next_action: {
            label: rest.slice(1).join(' ') || 'Relance planifiée',
            due: daysFromNow(Number(rest[0] ?? '3')),
          },
        },
        now,
      );
    } else if (command === 'won' || command === 'lost') {
      await writer.upsert(dataset, id, { ...current, status: command }, now);
    } else if (command === 'delete') {
      if (!(await writer.remove(dataset, id, now))) throw new Error('nothing to delete');
    } else {
      throw new Error(`unknown command ${command}`);
    }
    console.warn(
      `fixture-crm: ${command} ${dataset}/${id} done; the worker will pick it up at the next scheduled sync.`,
    );
  }
} finally {
  await writer.close();
}
