// Dev-only stand-in for Drive's appDataFolder, loaded only by `?mock-drive`.
// It exists so the real sync() — file lookup, multipart create, media update, merge on
// pull — can be exercised without a Google account. It stores the "remote" file in
// localStorage under pit.mockdrive, so two browser profiles on one machine can even
// pretend to be two devices sharing an account.
//
//   http://localhost:8000/?mock-drive
//
// Nothing here ships in the normal path: app.js imports it dynamically behind the flag.

const KEY = 'pit.mockdrive';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = f => localStorage.setItem(KEY, JSON.stringify(f));

export async function mockApi(url, opts = {}) {
  const file = read();
  await new Promise(r => setTimeout(r, 60));   // a little latency, like the real thing

  if (url.includes('/oauth2/v3/userinfo')) {                     // who is signed in
    return { name: 'Mock Learner', email: 'mock@example.test',
      picture: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#888"/></svg>') };
  }
  // Order matters: the upload endpoint is /upload/drive/v3/files?… and would otherwise
  // match the lookup branch.
  if (url.includes('uploadType=media')) {                        // update in place
    write({ ...file, body: opts.body, modifiedTime: new Date().toISOString() });
    return '';
  }
  if (url.includes('uploadType=multipart')) {                    // create
    const body = String(opts.body);
    const parts = body.split('\r\n\r\n');
    write({ id: 'mock-file', body: parts[parts.length - 1].split('\r\n--')[0], modifiedTime: new Date().toISOString() });
    return '';
  }
  if (url.includes('spaces=appDataFolder')) {                    // find
    return { files: file.id ? [{ id: file.id, modifiedTime: file.modifiedTime }] : [] };
  }
  if (/\/drive\/v3\/files\/[^/?]+\?alt=media/.test(url)) {       // download
    if (!file.body) throw new Error('Drive 404');
    return JSON.parse(file.body);
  }
  throw new Error('mock drive: unexpected call ' + url);
}
