import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export type TestApp = {
  app: INestApplication<App>;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  /** Creates a user in a built-in group (or with explicit permissions) and returns a bearer header. */
  userWith: (
    group:
      'Admin' | 'Manager' | 'Cashier' | 'Viewer' | { permissions: string[] },
  ) => Promise<{
    id: string;
    username: string;
    auth: { Authorization: string };
  }>;
  close: () => Promise<void>;
};

let seq = 0;
export const TEST_PASSWORD = 'test-password-1';

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  await app.init();
  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());
  const passwordHash = await argon2.hash(TEST_PASSWORD);

  const userWith: TestApp['userWith'] = async (group) => {
    const groupId =
      typeof group === 'string'
        ? (await prisma.userGroup.findUniqueOrThrow({ where: { name: group } }))
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

  return { app, prisma, http, userWith, close: () => app.close() };
}
