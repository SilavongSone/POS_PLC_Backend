import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  RequestContext,
  type RequestStore,
} from '../src/common/request-context.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export type TestApp = {
  app: NestExpressApplication;
  /** Tenant-scoped client for setup and assertions: runs as the seeded company "plc". */
  prisma: PrismaService;
  /** The seeded company and its first branch. */
  tenantId: string;
  branchId: string;
  http: () => Record<
    'get' | 'post' | 'put' | 'patch' | 'delete',
    (url: string) => request.Test
  >;
  /** Creates a user in a built-in group (or with explicit permissions) and returns a bearer header. */
  userWith: (
    group:
      'Admin' | 'Manager' | 'Cashier' | 'Viewer' | { permissions: string[] },
  ) => Promise<{
    id: string;
    username: string;
    auth: { Authorization: string };
  }>;
  /** An app service whose calls run as the seeded company (outside any HTTP request). */
  service: <T extends object>(type: abstract new (...args: never[]) => T) => T;
  close: () => Promise<void>;
};

let seq = 0;

/**
 * Runs every client call inside `store`'s request context. Prisma queries are lazy, so
 * the promise is also awaited (`then`) inside it, where the tenant extension reads it.
 */
export function inContext<T extends object>(target: T, store: RequestStore): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver) as unknown;
      if (typeof value === 'function') {
        return (...args: unknown[]) =>
          RequestContext.run(store, () => {
            const result = (value as (...a: unknown[]) => unknown).apply(
              t,
              args,
            );
            return result instanceof Object && 'then' in result
              ? (result as Promise<unknown>).then((x) => x)
              : result;
          });
      }
      if (value && typeof value === 'object') return inContext(value, store);
      return value;
    },
  });
}
export const TEST_PASSWORD = 'test-password-1';

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    // Webhooks verify signatures over the exact bytes received (req.rawBody).
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  const base = app.get(PrismaService);
  const tenant = await RequestContext.asPlatform(() =>
    base.tenant.findUniqueOrThrow({ where: { code: 'plc' } }),
  );
  const prisma = inContext(base, { tenantId: tenant.id });
  const branch = await prisma.branch.findFirstOrThrow({
    where: { code: 'MAIN' },
  });
  // Routes live under the global /api prefix, as in production.
  const server = app.getHttpServer() as App;
  const http = () => ({
    get: (url: string) => request(server).get(`/api${url}`),
    post: (url: string) => request(server).post(`/api${url}`),
    put: (url: string) => request(server).put(`/api${url}`),
    patch: (url: string) => request(server).patch(`/api${url}`),
    delete: (url: string) => request(server).delete(`/api${url}`),
  });
  const passwordHash = await argon2.hash(TEST_PASSWORD);

  const userWith: TestApp['userWith'] = async (group) => {
    const groupId =
      typeof group === 'string'
        ? (await prisma.userGroup.findFirstOrThrow({ where: { name: group } }))
            .id
        : (
            await prisma.userGroup.create({
              data: {
                name: `test-group-${Date.now()}-${++seq}`,
                permissions: group.permissions,
              },
            })
          ).id;
    const user = await prisma.user.create({
      data: {
        username: `test-${Date.now()}-${++seq}`,
        fullName: 'Test User',
        passwordHash,
        groupId,
      },
    });
    const res = await http()
      .post('/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD })
      .expect(200);
    return {
      id: user.id,
      username: user.username,
      auth: { Authorization: `Bearer ${res.body.accessToken as string}` },
    };
  };

  return {
    app,
    prisma,
    tenantId: tenant.id,
    branchId: branch.id,
    http,
    userWith,
    service: (type) => inContext(app.get(type), { tenantId: tenant.id }),
    close: () => app.close(),
  };
}
