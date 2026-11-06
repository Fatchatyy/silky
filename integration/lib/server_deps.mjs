// Packages that only the server installs (drizzle-orm, bcrypt, jsonwebtoken): this folder has no node_modules of its
// own, so they are loaded from the copy installed in server/.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));

export const importFromServer = (name) => import(pathToFileURL(serverRequire.resolve(name)).href);
