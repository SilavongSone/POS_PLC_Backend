/**
 * Writes the API's OpenAPI document to docs/openapi.json (the frontend's API contract):
 *
 *   pnpm build && pnpm openapi:export
 *
 * Builds the Nest app from the compiled output in dist/ (tsx cannot emit the decorator
 * metadata Nest's dependency injection needs) without listening on a port or touching the
 * database. Keys are sorted so the file only changes when the API does; CI fails when the
 * committed file is out of date.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'docs', 'openapi.json');

// The document does not depend on these; they only satisfy env validation. Nothing
// connects to the database while the document is built.
process.env.DATABASE_URL ??= 'postgresql://openapi@localhost:5432/openapi';
process.env.JWT_SECRET ??= 'openapi-export-only-secret-0123456789';
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV ??= 'development';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Recursively sorts object keys (arrays keep their order). */
function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

async function load<T>(file: string): Promise<T> {
  try {
    return (await import(pathToFileURL(path.join(dist, file)).href)) as T;
  } catch (error) {
    throw new Error(`Cannot load dist/${file}: run "pnpm build" first.`, {
      cause: error,
    });
  }
}

async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await load<{ AppModule: new () => unknown }>(
    'app.module.js',
  );
  const { configureApp, createOpenApiDocument } =
    await load<typeof import('../src/app.setup.js')>('app.setup.js');

  const app = await NestFactory.create<Parameters<typeof configureApp>[0]>(
    AppModule,
    { logger: false, bodyParser: false, abortOnError: false },
  );
  configureApp(app);
  const doc = createOpenApiDocument(app);
  await app.close();

  const json = JSON.parse(JSON.stringify(doc)) as Json;
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(sortKeys(json), null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, out)}`);
}

await main();
