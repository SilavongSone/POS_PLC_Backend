# Independent stores (separate companies of one owner)

Decided 2026-11-05. Status: built (`src/stores/`, frontend `/settings/stores`).

## Problem

An owner wants another shop whose data is completely separate: products, stock, customers,
bills, staff and reports must never be visible to or changed by the other shop, even when
the names and products are the same. Branches do not do this: branches of one company share
the catalog, customers, suppliers, settings and users on purpose.

## Decision

- A separate store **is a new company (tenant)**. Isolation comes from the existing tenant
  extension (`src/prisma/tenant-extension.ts`), which scopes every query by `tenantId`, so no
  per-table branch filtering is added and nothing can leak between stores.
- Chosen data of the current store is **copied once, with new ids**. Afterwards nothing links
  the two: editing or deleting a product in one never touches the other.
- Branches stay as they are, for one business with several locations.

| | Branch | Separate store |
|---|---|---|
| Products, prices | shared | copied once, then separate |
| Customers, suppliers | shared | separate (optional one-time copy) |
| Reports | across branches | per store |
| Stock transfer | yes | no (sell / receive) |
| Company code, document numbers, subscription | same | own |

## What is copied (`POST /stores`)

Always (replacing the sign-up defaults): VAT rates, payment types, expense categories,
currencies with the current rate of each.

Options (`copy`):

| Option | Default | Copies |
|---|---|---|
| `catalog` | on | units, categories (tree), brands + brand–category links, label templates, product groups, products (specs, prices, cost, packs, bundle items, versions). Stock 0, average cost 0. |
| `images` | on | product photos and brand logos (file copies into the new company's folder) |
| `settings` | on | all settings except `store.name`, `store.companyName`, `store.taxId`; the shop logo file is copied |
| `customers` | off | customer records only (no history, no debts) |
| `suppliers` | off | supplier records |

Never copied: stock, serials, lots, stock documents, sales, payments, shifts, debts,
quotations, repairs, expenses, held bills, audit log, staff accounts, branch prices.

Everything runs in one transaction (`ProvisioningService.provision(..., { extend })`); copied
image files are deleted if it fails.

## Owner and switching

- Only users with `settings.manage` and a **confirmed e-mail** may create a store (403
  `EMAIL_NOT_VERIFIED`). The owner account of the new store gets the same username, name,
  e-mail (confirmed), password hash, Google link and photo, in the Admin group.
- `GET /stores` lists the stores where an active account with the same confirmed e-mail
  exists; `POST /stores/switch` issues tokens for that account without the password (403
  `STORE_NOT_YOURS` otherwise). An unconfirmed address in either store is never a way in.
- At most 20 stores per owner e-mail (409 `STORE_LIMIT_REACHED`).
- E-mail sign-in already asks which company when one address is in several.

## Subscription

Each store has its own subscription on the current store's plan: a trial when the plan has
trial days, active when the plan is free, otherwise the default sign-up plan with its trial.
Pricing for several stores of one owner is a business decision still open.

## Frontend

- Settings → "My stores" (`features/settings/stores-screen.tsx`): list with switch buttons, and
  the create form (name, first branch name, copy options); after creating, a summary of what
  was copied and "Go to the new store".
- Sidebar company menu: other stores to switch to and a link to create/manage.
- Switching clears the query cache, cart, till and branch choice, revokes the old refresh
  token and opens the dashboard.

## Later

- Owner overview with totals across stores (read-only summaries).
- Platform admin view of stores grouped by owner.
