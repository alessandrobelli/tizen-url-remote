import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Holds { url, version } in memory and mirrors it to a JSON file so a
// container restart doesn't lose the URL. `version` changes on every /url or
// /reload; the TV navigates whenever it sees a version it hasn't seen yet.
export function createStore(filePath, initialUrl = '') {
  let state = load(filePath, initialUrl);

  function save() {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, filePath);
  }

  return {
    get() {
      return { url: state.url, version: state.version };
    },
    setUrl(url) {
      state = { url, version: state.version + 1 };
      save();
    },
    bumpVersion() {
      state = { url: state.url, version: state.version + 1 };
      save();
    },
  };
}

function load(filePath, initialUrl) {
  if (!existsSync(filePath)) {
    return { url: initialUrl, version: 0 };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return { url: String(parsed.url || ''), version: Number(parsed.version) || 0 };
  } catch (err) {
    throw new Error(`Cannot read state file ${filePath}: ${err.message}`);
  }
}
