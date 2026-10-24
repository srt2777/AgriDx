import { resolve } from './path.mjs';
export function createReadOnlyFileSystem(snapshot) {
  const files = new Map(Object.entries(snapshot));
  const directories = new Map();
  for (const file of files.keys()) {
    const segments = file.split('/').filter(Boolean);
    for (let index = 0; index < segments.length; index++) {
      const directory = `/${segments.slice(0, index).join('/')}`;
      if (!directories.has(directory)) directories.set(directory, new Map());
      directories.get(directory).set(segments[index], index < segments.length - 1);
    }
  }
  const missing = (file) => new Error(`Knowledge snapshot has no file: ${file}`);
  return {
    readFileSync(file) {
      const value = files.get(resolve(file));
      if (value === undefined) throw missing(file);
      return value;
    },
    realpathSync(file) {
      const normalized = resolve(file);
      if (!files.has(normalized) && !directories.has(normalized)) throw missing(file);
      return normalized;
    },
    readdirSync(directory, options) {
      const entries = directories.get(resolve(directory));
      if (!entries) throw missing(directory);
      return [...entries].map(([name, directory]) => options?.withFileTypes
        ? { name, isDirectory: () => directory, isFile: () => !directory }
        : name);
    },
  };
}
