# Independent stores (separate companies of one owner)

Decided 2026-11-05. Status: built (`src/stores/`, platform console company page). Creation moved to the Super Admin the same day.

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

## What is copied (`POST /platform/tenants/:id/stores`)

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

## Who creates it

- **Only the Super Admin**, from the company page of the platform console (shop users have no
  create endpoint or page). Reasons: every store is a new subscription billed by PLC (payments
  are confirmed by hand), and it stops shops from creating stores to get repeated free trials.
- The owner of the new store is the source company's first active Admin, preferring one with a
  confirmed e-mail (409 `STORE_NO_OWNER` if there is none). The account is copied: username,
  name, e-mail, password hash, Google link and photo, in the Admin group.

## Switching

- `GET /stores` lists the stores where an active account with the same confirmed e-mail exists;
  `POST /stores/switch` issues tokens for that account without the password (403
  `STORE_NOT_YOURS` otherwise). An unconfirmed address in either store is never a way in.
- If the owner's e-mail is not confirmed, the store is still created (`ownerCanSwitch: false`):
  the owner signs in to it with its company code, username and the same password, and can
  switch after confirming the e-mail in both stores.
- E-mail sign-in already asks which company when one address is in several.

## Subscription

The Super Admin picks the plan and status, or leaves "same plan": the source company's plan as
a trial when it has trial days, active when it is free, otherwise the default sign-up plan.
Each store has its own subscription and invoices.

## Frontend

- Platform console, company page: "New separate store" dialog (name, first branch, plan and
  status, copy options); afterwards a summary of what was copied, the owner, and a warning when
  the owner cannot switch yet.
- Shop side: the sidebar company menu lists the owner's other stores, only when there are any.
  Switching clears the query cache, cart, till and branch choice, revokes the old refresh token
  and opens the dashboard.

## Later

- Owner overview with totals across stores (read-only summaries).
- Platform admin view of stores grouped by owner.
