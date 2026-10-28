import { createInterface } from 'node:readline';
import { BlockNovaSession } from './session.js';

// One process per Gymnasium environment, reused across all steps and resets.
let session;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const message = JSON.parse(line);
    let result;
    if (message.op === 'init') {
      session = new BlockNovaSession(message.config);
      result = session.spec();
    } else {
      if (!session) throw new Error('Initialize the session first');
      if (message.op === 'reset') result = session.reset(message.seed);
      else if (message.op === 'step') result = session.step(message.action);
      else throw new Error(`Unknown operation: ${message.op}`);
    }
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
  }
}
