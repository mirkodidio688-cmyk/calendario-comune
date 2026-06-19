// Debug endpoint: mostra tutti i token salvati (solo per uso locale/debug)
const crypto = require('crypto');

const ENC_KEY = process.env.ENC_KEY ? Buffer.from(process.env.ENC_KEY).slice(0, 32) : Buffer.alloc(32);

function dec(data) {
  try {
    const b = Buffer.from(data, 'base64url');
    const iv = b.subarray(0, 12);
    const tag = b.subarray(12, 28);
    const ct = b.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
  } catch (e) {
    return { error: e.message };
  }
}

exports.handler = async () => {
  let tokens = {};
  try {
    const { listStores, getStore } = require('@netlify/blobs');
    const stores = await listStores();
    const tokenStore = stores.find(s => s.name === 'tokens');
    if (!tokenStore) return { statusCode: 404, body: 'No tokens store found' };

    const store = getStore('tokens');
    const keys = await store.list();
    console.log(`📦 Debug-tokens: found ${keys.length} keys in tokens store`);
    for (const key of keys) {
      const blob = await store.get(key);
      console.log(`🔑 Decoding token for: ${key}`);
      tokens[key] = dec(blob);
    }
    return { statusCode: 200, body: JSON.stringify(tokens, null, 2), headers: { 'content-type': 'application/json' } };
  } catch (e) {
    console.error(`💥 Debug-tokens error:`, e.message);
    return { statusCode: 500, body: e.message };
  }
};
