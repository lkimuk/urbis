import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAtlasClient } from '../renderer/desktop-api.mjs';

test('client unwraps plain bridge results and restores stable domain errors', async () => {
  const request = { cityId: 'beijing', variant: 'outline' };
  let received;
  const client = createAtlasClient({
    getCities: async () => ({ ok: true, value: [{ id: 'beijing' }] }),
    getMap: async (payload) => {
      received = payload;
      return { ok: false, error: { code: 'MAP_UNAVAILABLE', message: '地图不可用' } };
    },
    saveImage: async () => ({ ok: true, value: { canceled: true } }),
  });
  assert.deepEqual(await client.getCities(), [{ id: 'beijing' }]);
  await assert.rejects(client.getMap(request), { code: 'MAP_UNAVAILABLE', message: '地图不可用' });
  assert.equal(received, request);
  assert.deepEqual(await client.saveImage({ dataURL: 'png' }), { canceled: true });
});
