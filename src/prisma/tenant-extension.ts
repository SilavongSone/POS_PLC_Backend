import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import {
  RequestContext,
  TenantContextMissingError,
} from '../common/request-context.js';

type RuntimeField = { name: string; kind: string; type: string };
export type RuntimeDataModel = {
  models: Record<string, { fields: RuntimeField[] }>;
};

/** Which models carry tenantId, and where each relation field of each model points. */
export type TenantModelMap = {
  scoped: Set<string>;
  relations: Map<string, Map<string, string>>;
};

export function buildTenantModelMap(dm: RuntimeDataModel): TenantModelMap {
  const scoped = new Set<string>();
  const relations = new Map<string, Map<string, string>>();
  for (const [name, model] of Object.entries(dm.models)) {
    if (
      model.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar')
    ) {
      scoped.add(name);
    }
    relations.set(
      name,
      new Map(
        model.fields
          .filter((f) => f.kind === 'object')
          .map((f) => [f.name, f.type]),
      ),
    );
  }
  return { scoped, relations };
}

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const each = (v: unknown, fn: (d: Data) => void) =>
  (Array.isArray(v) ? v : [v]).forEach((d) => isObject(d) && fn(d));

/**
 * Sets tenantId on a create payload and on every nested create of a tenant model in it
 * (Prisma query extensions only see the top-level call).
 */
function stampCreate(
  map: TenantModelMap,
  model: string,
  data: Data,
  tenantId: string,
) {
  if (map.scoped.has(model)) data.tenantId = tenantId;
  stampNested(map, model, data, tenantId);
}

function stampNested(
  map: TenantModelMap,
  model: string,
  data: Data,
  tenantId: string,
) {
  const relations = map.relations.get(model);
  if (!relations) return;
  for (const [field, value] of Object.entries(data)) {
    const target = relations.get(field);
    if (!target || !isObject(value)) continue;
    const create = (d: Data) => stampCreate(map, target, d, tenantId);
    const update = (d: Data) => stampNested(map, target, d, tenantId);
    if (value.create) each(value.create, create);
    if (isObject(value.createMany)) each(value.createMany.data, create);
    if (value.connectOrCreate)
      each(value.connectOrCreate, (c) => each(c.create, create));
    if (value.upsert) {
      each(value.upsert, (u) => {
        each(u.create, create);
        each(u.update, update);
      });
    }
    if (value.update)
      each(value.update, (u) => each(isObject(u.data) ? u.data : u, update));
    if (value.updateMany) each(value.updateMany, (u) => each(u.data, update));
  }
}

/**
 * Tenant isolation for every Prisma call: reads, updates and deletes get
 * `where.tenantId`, creates get `data.tenantId`, from the request context. A tenant model
 * touched with no tenant in context throws (fail closed) unless running as platform.
 */
export function tenantExtension(map: TenantModelMap) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const store = RequestContext.get();
          const tenantId = store?.tenantId;
          const touchesTenant =
            map.scoped.has(model) ||
            // A create on a child table may nest creates of tenant models.
            [
              'create',
              'createMany',
              'createManyAndReturn',
              'update',
              'upsert',
            ].includes(operation);
          if (!tenantId) {
            if (store?.platform || !map.scoped.has(model)) return query(args);
            throw new TenantContextMissingError(`${model}.${operation}`);
          }
          if (!touchesTenant) return query(args);

          const a = args as Data;
          if (map.scoped.has(model) && WHERE_OPS.has(operation)) {
            a.where = { ...(a.where as Data | undefined), tenantId };
          }
          switch (operation) {
            case 'create':
              stampCreate(map, model, (a.data ??= {}) as Data, tenantId);
              break;
            case 'createMany':
            case 'createManyAndReturn':
              each(a.data, (d) => stampCreate(map, model, d, tenantId));
              break;
            case 'upsert':
              stampCreate(map, model, a.create as Data, tenantId);
              stampNested(map, model, a.update as Data, tenantId);
              break;
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
              if (isObject(a.data)) {
                // tenantId itself can never be changed.
                delete a.data.tenantId;
                stampNested(map, model, a.data, tenantId);
              }
              break;
          }
          return query(a);
        },
      },
    },
  });
}

/**
 * Wraps a client with the tenant extension. The result keeps the client's type: the
 * extension only rewrites query arguments.
 */
export function withTenantIsolation<T extends PrismaClient>(client: T): T {
  const dataModel = (
    client as unknown as { _runtimeDataModel?: RuntimeDataModel }
  )._runtimeDataModel;
  if (!dataModel?.models) {
    throw new Error(
      'Prisma runtime data model not found: tenant isolation unavailable',
    );
  }
  return client.$extends(
    tenantExtension(buildTenantModelMap(dataModel)),
  ) as unknown as T;
}
