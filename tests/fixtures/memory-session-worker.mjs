import { MemoryStore } from '../../server/memory/store.ts';

const store = new MemoryStore(process.env.TEST_MEMORY_PATH);
process.send('ready');
process.once('message', () => {
  try {
    store.createSession('owner-a', process.env.TEST_DEVICE_ID);
    process.send({ result: 'created' });
  } catch (error) {
    process.send({ result: error.code || 'unexpected', message: error.message });
  } finally {
    store.close();
    process.disconnect();
  }
});
