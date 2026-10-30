/**
 * Generates docs/er-diagram.md from prisma/schema.prisma: Mermaid ER diagrams per
 * domain (every column, keys and relations) plus a column table for each model.
 *
 *   pnpm docs:er
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');

type Field = {
  name: string;
  type: string;
  list: boolean;
  optional: boolean;
  attrs: string;
  doc: string;
};
type Model = {
  name: string;
  doc: string;
  fields: Field[];
  blockAttrs: string[];
};
type Enum = {
  name: string;
  doc: string;
  values: { name: string; doc: string }[];
};

const models: Model[] = [];
const enums: Enum[] = [];

// ── Parse ────────────────────────────────────────────────────────────────
{
  const lines = schema.split(/\r?\n/);
  let doc: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const head = /^(model|enum)\s+(\w+)\s*\{/.exec(line);
    if (line.startsWith('///')) {
      doc.push(line.slice(3).trim());
      continue;
    }
    if (!head) {
      if (!line.startsWith('//')) doc = [];
      continue;
    }
    const [, kind, name] = head;
    const blockDoc = doc.join(' ');
    doc = [];
    const body: string[] = [];
    for (i++; i < lines.length && lines[i].trim() !== '}'; i++)
      body.push(lines[i].trim());
    if (kind === 'enum') {
      const e: Enum = { name, doc: blockDoc, values: [] };
      let vdoc: string[] = [];
      for (const l of body) {
        if (l.startsWith('///')) vdoc.push(l.slice(3).trim());
        else if (/^\w+/.test(l)) {
          e.values.push({ name: l.split(/\s/)[0], doc: vdoc.join(' ') });
          vdoc = [];
        }
      }
      enums.push(e);
      continue;
    }
    const m: Model = { name, doc: blockDoc, fields: [], blockAttrs: [] };
    let fdoc: string[] = [];
    for (const l of body) {
      if (l.startsWith('///')) fdoc.push(l.slice(3).trim());
      else if (l.startsWith('@@')) m.blockAttrs.push(l);
      else {
        const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(l);
        if (f) {
          // Trailing `// comment` on the same line counts as documentation too.
          const [attrs, trailing] = f[5].split(/\s+\/\/\s*/);
          m.fields.push({
            name: f[1],
            type: f[2],
            list: !!f[3],
            optional: !!f[4],
            attrs: attrs.trim(),
            doc: [...fdoc, trailing].filter(Boolean).join(' '),
          });
        }
        fdoc = [];
      }
    }
    models.push(m);
  }
}

const modelNames = new Set(models.map((m) => m.name));
const enumNames = new Set(enums.map((e) => e.name));
const byName = new Map(models.map((m) => [m.name, m]));

// ── Relations ────────────────────────────────────────────────────────────
type Relation = {
  parent: string;
  child: string;
  fk: string[];
  optional: boolean;
  one: boolean;
  label: string;
};
const relations: Relation[] = [];
for (const m of models) {
  for (const f of m.fields) {
    if (!modelNames.has(f.type)) continue;
    const fk = /fields:\s*\[([^\]]+)\]/.exec(f.attrs);
    if (!fk) continue; // the other side of a relation
    const cols = fk[1].split(',').map((s) => s.trim());
    const fkFields = cols.map((c) => m.fields.find((x) => x.name === c)!);
    const unique =
      (cols.length === 1 && /@unique\b|@id\b/.test(fkFields[0].attrs)) ||
      m.blockAttrs.some((a) =>
        new RegExp(`^@@(unique|id)\\(\\[\\s*${cols.join(',\\s*')}\\s*\\]`).test(
          a,
        ),
      );
    relations.push({
      parent: f.type,
      child: m.name,
      fk: cols,
      optional: f.optional,
      one: unique,
      label: f.name,
    });
  }
}

const fkCols = (m: Model) =>
  new Set(relations.filter((r) => r.child === m.name).flatMap((r) => r.fk));

/** Column-level keys. Composite primary/unique keys are listed per model below the diagram. */
function keys(m: Model, f: Field): string[] {
  const k: string[] = [];
  if (
    /@id\b/.test(f.attrs) ||
    m.blockAttrs.some((a) =>
      new RegExp(`^@@id\\(\\[[^\\]]*\\b${f.name}\\b`).test(a),
    )
  )
    k.push('PK');
  if (fkCols(m).has(f.name)) k.push('FK');
  if (/@unique\b/.test(f.attrs)) k.push('UK');
  return k;
}

const dbType = (f: Field) => {
  const db = /@db\.(\w+)(\(([^)]*)\))?/.exec(f.attrs);
  if (db) return db[3] ? `${db[1]}(${db[3].replace(/\s/g, '')})` : db[1];
  if (f.type === 'String' && /uuid\(\)/.test(f.attrs)) return 'uuid';
  return f.type;
};

const isUuidKey = (model: string, col: string) => {
  const f = byName.get(model)?.fields.find((x) => x.name === col);
  return !!f && /uuid\(\)/.test(f.attrs);
};

/** Like dbType, but foreign keys to UUID primary keys read as `uuid`. */
const columnType = (m: Model, f: Field) => {
  const ref = relations.find(
    (r) => r.child === m.name && r.fk.includes(f.name),
  );
  return ref && f.type === 'String' && isUuidKey(ref.parent, 'id')
    ? 'uuid'
    : dbType(f);
};

const defaultOf = (f: Field) => {
  const d =
    /@default\((.*?)\)(?=\s|$|\s@)/.exec(f.attrs) ??
    /@default\(([^)]*\)?)\)/.exec(f.attrs);
  if (!d) return '';
  if (d[1].startsWith('dbgenerated')) return 'request tenant';
  return d[1];
};

// Mermaid attribute types must be single tokens.
const mermaidType = (m: Model, f: Field) =>
  (enumNames.has(f.type) ? f.type : columnType(m, f))
    .replace(/\((\d+),(\d+)\)/, '_$1_$2')
    .replace(/[^\w]/g, '_') + (f.list ? '_array' : '');

const scalarFields = (m: Model) =>
  m.fields.filter((f) => !modelNames.has(f.type));
const clean = (s: string) => s.replace(/"/g, "'").replace(/\|/g, '/');

// ── Domains ──────────────────────────────────────────────────────────────
const DOMAINS: { title: string; lo: string; models: string[] }[] = [
  {
    title: 'Companies, plans and system',
    lo: 'ບໍລິສັດ, ແພັກເກດ ແລະ ລະບົບ',
    models: [
      'Tenant',
      'Branch',
      'Plan',
      'Subscription',
      'BillingInvoice',
      'SignupRequest',
      'PlatformAdmin',
      'Setting',
      'DocSequence',
      'IdempotencyKey',
    ],
  },
  {
    title: 'Users, permissions and audit',
    lo: 'ຜູ້ໃຊ້, ສິດ ແລະ ປະຫວັດ',
    models: [
      'UserGroup',
      'User',
      'UserBranch',
      'RefreshToken',
      'UserToken',
      'AuditLog',
    ],
  },
  {
    title: 'Catalog, prices and promotions',
    lo: 'ສິນຄ້າ, ລາຄາ ແລະ ໂປຣໂມຊັນ',
    models: [
      'Category',
      'Brand',
      'Product',
      'ProductImage',
      'ProductBundleItem',
      'BranchPrice',
      'TaxRate',
      'Promotion',
      'PromotionItem',
    ],
  },
  {
    title: 'Stock, serials and suppliers',
    lo: 'ສາງ, serial ແລະ ຜູ້ສະໜອງ',
    models: [
      'Supplier',
      'StockDocument',
      'StockDocumentItem',
      'StockMovement',
      'SerialNumber',
      'StockLot',
      'BranchStock',
    ],
  },
  {
    title: 'Customers, quotations and sales',
    lo: 'ລູກຄ້າ, ໃບສະເໜີລາຄາ ແລະ ການຂາຍ',
    models: [
      'Customer',
      'HeldBill',
      'Quotation',
      'QuotationItem',
      'Sale',
      'SaleItem',
      'Payment',
      'PaymentType',
      'ExchangeRate',
      'TaxInvoice',
      'DebtPayment',
      'SaleReturn',
      'SaleReturnItem',
    ],
  },
  {
    title: 'Registers, shifts and expenses',
    lo: 'ເຄື່ອງຂາຍ, ກະ ແລະ ລາຍຈ່າຍ',
    models: ['Register', 'Shift', 'CashMovement', 'ExpenseCategory', 'Expense'],
  },
  {
    title: 'Repairs and warranty claims',
    lo: 'ງານສ້ອມ ແລະ ເຄມປະກັນ',
    models: ['ServiceTicket', 'ServiceTicketLine', 'ServiceTicketLog'],
  },
];

const assigned = new Set(DOMAINS.flatMap((d) => d.models));
const missing = models.filter((m) => !assigned.has(m.name)).map((m) => m.name);
if (missing.length)
  DOMAINS.push({ title: 'Other', lo: 'ອື່ນໆ', models: missing });

// Every company table points at Tenant; drawing that line everywhere hides the real structure.
const isTenantLink = (r: Relation) =>
  r.parent === 'Tenant' && r.fk.includes('tenantId');

function relationLine(r: Relation) {
  const parentSide = r.optional ? '|o' : '||';
  const childSide = r.one ? 'o|' : 'o{';
  return `  ${r.parent} ${parentSide}--${childSide} ${r.child} : "${r.label}"`;
}

function entity(m: Model) {
  const rows = scalarFields(m).map((f) => {
    const k = keys(m, f);
    const note = [
      f.optional ? 'nullable' : '',
      defaultOf(f) ? `default ${defaultOf(f)}` : '',
      f.doc,
    ]
      .filter(Boolean)
      .join('; ');
    return `    ${mermaidType(m, f)} ${f.name}${k.length ? ` ${k.join(', ')}` : ''}${note ? ` "${clean(note).slice(0, 90)}"` : ''}`;
  });
  return `  ${m.name} {\n${rows.join('\n')}\n  }`;
}

// ── Write ────────────────────────────────────────────────────────────────
const out: string[] = [];
const tenantTables = relations.filter(isTenantLink).length;
out.push(
  '# ER Diagram — PLC POS',
  '',
  '> Generated from `prisma/schema.prisma` by `pnpm docs:er`. Do not edit by hand; change the schema and regenerate.',
  '',
  `**${models.length} tables · ${enums.length} enums · ${relations.length} relations.** Design notes: [database-design.md](./database-design.md).`,
  '',
  '## Conventions',
  '',
  '- Primary keys are UUID strings (`id`, generated by the app) unless marked otherwise; composite keys are listed under each table.',
  `- **Multi-company:** ${tenantTables} tables have \`tenantId → Tenant.id\`, defaulted from the request (\`current_setting('app.tenant_id')\`); every query is scoped by the Prisma tenant extension (\`src/prisma/tenant-extension.ts\`). These links are drawn only in the first diagram.`,
  '- Money: LAK `Decimal(18,0)`, THB/USD `Decimal(18,2)`, exchange rates `Decimal(18,4)`, percents `Decimal(5,2)`. Translated names are JSON `nameI18n` maps (`{"lo","th","en"}`).',
  '- Cardinality: `||--o{` one-to-many, `||--o|` one-to-one, `|o--` optional parent (nullable foreign key). Labels are the Prisma relation field.',
  '- Keys: **PK** primary key, **FK** foreign key, **UK** unique.',
  '',
  '## Contents',
  '',
  '1. [Overview (all relations)](#overview)',
  ...DOMAINS.map(
    (d, i) => `${i + 2}. [${d.title} — ${d.lo}](#${slug(d.title)})`,
  ),
  `${DOMAINS.length + 2}. [Enums](#enums)`,
  '',
  '## Overview',
  '',
  'Every table and every foreign key except the `tenantId` links (see Conventions).',
  '',
  '```mermaid',
  'erDiagram',
  ...relations.filter((r) => !isTenantLink(r)).map(relationLine),
  '```',
  '',
);

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

for (const [i, d] of DOMAINS.entries()) {
  const own = new Set(d.models);
  const rels = relations.filter(
    (r) =>
      (own.has(r.child) || own.has(r.parent)) && (i === 0 || !isTenantLink(r)),
  );
  out.push(
    `## ${d.title}`,
    '',
    `${d.lo}. Tables from other sections appear as empty boxes.`,
    '',
    '```mermaid',
    'erDiagram',
  );
  for (const name of d.models) out.push(entity(byName.get(name)!));
  out.push(...rels.map(relationLine), '```', '');

  for (const name of d.models) {
    const m = byName.get(name)!;
    out.push(`### ${m.name}`, '');
    if (m.doc) out.push(m.doc, '');
    out.push(
      '| Column | Type | Null | Default | Key | Description |',
      '|---|---|---|---|---|---|',
    );
    for (const f of scalarFields(m)) {
      const k = keys(m, f);
      const ref = relations.find(
        (r) => r.child === m.name && r.fk.includes(f.name),
      );
      const type = enumNames.has(f.type)
        ? `enum \`${f.type}\``
        : `\`${columnType(m, f)}${f.list ? '[]' : ''}\``;
      const desc = [
        ref ? `→ \`${ref.parent}.${ref.fk.length > 1 ? '…' : 'id'}\`` : '',
        f.doc,
      ]
        .filter(Boolean)
        .join(' ');
      out.push(
        `| \`${f.name}\` | ${type} | ${f.optional ? 'yes' : ''} | ${defaultOf(f) ? `\`${clean(defaultOf(f))}\`` : ''} | ${k.join(', ')} | ${clean(desc)} |`,
      );
    }
    const extra = m.blockAttrs.filter((a) => /^@@(id|unique|index)/.test(a));
    if (extra.length)
      out.push(
        '',
        `Keys and indexes: ${extra.map((a) => `\`${a.replace(/\s+/g, ' ')}\``).join(' · ')}`,
      );
    out.push('');
  }
}

out.push('## Enums', '');
for (const e of enums) {
  out.push(`### ${e.name}`, '');
  if (e.doc) out.push(e.doc, '');
  out.push(
    e.values
      .map((v) => `- \`${v.name}\`${v.doc ? ` — ${v.doc}` : ''}`)
      .join('\n'),
    '',
  );
}

writeFileSync(join(root, 'docs/er-diagram.md'), out.join('\n'));
console.log(
  `Wrote docs/er-diagram.md (${models.length} models, ${enums.length} enums, ${relations.length} relations)`,
);
