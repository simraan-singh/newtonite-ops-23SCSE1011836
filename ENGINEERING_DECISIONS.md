# Engineering Decisions

## Assumptions

The brief leaves product decisions open on purpose. These are the ones I made, and which I would confirm with a product manager first.

| Question | My assumption | Check with PM? |
|---|---|---|
| What states exist? | Open → In Progress → Awaiting Approval → Resolved → Closed. Awaiting Approval can be sent back to In Progress. | Yes – do some item types (e.g. simple tasks) skip approval? |
| Who approves? | A Lead (or Admin) **of the item's team**. | Yes – should the person who did the work be blocked from approving their own item? |
| Roles | Viewer (read), Member (create, edit, claim, comment, move), Lead (Member + approve), Admin (everything). A user can have a different role in each team. | No |
| Who can see an item? | Only members of the item's team. Everyone else gets 404, so we don't reveal that it exists. | No |
| Can a claimed item be re-claimed? | No. Claim only succeeds on an unassigned item. Reassignment is a separate (not yet built) Lead action. | Yes |
| What happens on a conflict? | The second writer gets 409 plus the latest version, and must look again before retrying. Last-write-wins is never used. | No |

## 1. Concurrency: optimistic locking and conditional updates

**Context.** Two people may claim the same item, or edit it at the same time from screens they loaded minutes ago.

**Options considered.**
- Last write wins: simple, but silently loses someone's change.
- Pessimistic locks (`SELECT … FOR UPDATE` held while a user edits): safe, but locks would be held across slow human actions and abandoned tabs.
- Optimistic locking with a `version` column, plus conditional `UPDATE … WHERE` statements.

**Choice.** Optimistic locking.
- Every item has a `version`. Edits and transitions run `UPDATE … WHERE id = $1 AND version = $2`, then increment the version. Zero rows updated means someone else changed it, so the API returns **409** with the latest item.
- Claim is a single atomic statement: `UPDATE … SET assignee_id = me WHERE id = $1 AND assignee_id IS NULL`. Postgres row locking guarantees only one of two simultaneous claims matches.

**Trade-off.** Under heavy contention on the same item, users see more 409s and must retry. For an ops tool where most items are touched by one or two people, that is far better than losing data or holding locks. The UI turns the 409 into a clear "this item changed" message and shows the latest version.

## 2. History written in the same transaction as the change

**Context.** Every change to owner, priority and state must be recorded, and history must never disagree with the item.

**Options considered.**
- Write the item, then write history in a second step: a crash between the two leaves them out of sync.
- Database triggers: automatic, but hide logic away from the code reviewers read.
- Insert into `activity_events` inside the same transaction as the update.

**Choice.** A small `tx()` helper wraps each action in `BEGIN … COMMIT`. The update and its `activity_events` row are committed together or rolled back together. `activity_events` is append-only: rows are only ever inserted.

**Trade-off.** Each write is slightly heavier (one extra insert), and every new endpoint must remember to log its event. A trigger would enforce that automatically; I chose explicit code because it is easier to read and explain.

## 3. Authorization: one permission function, scoped per team

**Context.** Permissions must be enforced on the server, per team and per resource, not by hiding buttons.

**Choice.**
- `memberships(user_id, team_id, role)` stores a role per team.
- On each request, the auth middleware loads the user's roles into `{ teamId: role }`.
- A single function, `can(user, action, teamId)`, compares the role's rank against the action's requirement (read = Viewer, write = Member, approve = Lead).
- Every item endpoint goes through `loadItem()`, which returns **404** if the user is not in the item's team and **403** if they are in the team but their role is too low.
- List queries always include `team_id = ANY(<my team ids>)`, so other teams' data is never fetched.

**Trade-off.** Roles are a simple ranked ladder. That is easy to reason about, but it cannot express "can approve but cannot edit". A permission table per action would be more flexible and more complex. The UI also hides buttons a user cannot use, but only for convenience; the tests call the API directly to prove the server enforces the rules.

## 4. Idempotent create

**Context.** A double-click or a network retry should not create two work items.

**Choice.** The client generates one random `Idempotency-Key` per create form and sends it in a header. Inside the create transaction the server:
1. takes a Postgres advisory lock on `user id + key`, so two identical requests at the same moment run one after the other;
2. returns the stored response if the key was already used;
3. otherwise creates the item and stores the key with the response in `idempotency_keys`, in the same transaction.

**Trade-off.** The table grows forever; a real system would expire keys after a day or so. Keys are scoped per user, so one user cannot replay another's request.

## 5. Server-side filtering and cursor pagination

**Context.** Tens of thousands of items and a growing history.

**Options considered.** Load everything and filter in the browser; offset pagination (`LIMIT 20 OFFSET 4000`); cursor pagination.

**Choice.** All filters, views and search run in SQL. Lists are ordered by `id DESC`, and the next page is requested with `cursor=<last id>` (`WHERE id < cursor`). Indexes support the common queries: `(team_id, status, priority)`, `assignee_id`, and `activity_events(item_id, created_at)`.

**Trade-off.** Cursor pagination stays fast on deep pages and does not skip or repeat rows when new items arrive, but it cannot jump to "page 37". Ordering by id means "newest created first"; sorting by priority or due date would need a compound cursor. Search uses `ILIKE`, which is simple but will not scale to millions of rows without a full-text index.

## 6. What I chose not to build (yet)

- **Background jobs / outbox.** The plan was a `jobs` table written in the same transaction as an assignment, plus a worker with retries and an idempotent handler. I prioritised getting the five concurrency and authorization behaviours correct and tested first.
- **Websockets.** The UI polls every 10–15 seconds, which the brief allows.
- **Data-fetching library.** Instead of TanStack Query, the UI uses a ~50-line `useQuery` hook (polling, ignoring stale responses, optimistic updates with rollback). It is small enough to explain line by line. In a larger app I would switch to TanStack Query.
- Sign-up, SSO, email, attachments and fancy styling, as the brief suggested.

## What would change at 10× scale

- Read replicas for list and dashboard queries.
- Partition `activity_events` by time.
- Move search to Postgres full-text search, or to a dedicated search engine.
- A real job queue for notifications.
- Push updates over websockets instead of polling.

## Next week I would…

1. Add the transactional outbox and a worker (notify the new assignee, with retries and a max-attempt limit).
2. Add a Lead-only "reassign" action with its own activity event and test.
3. Run the tests against a separate, freshly created test database in CI.
4. Containerise the API and UI so `docker compose up` starts everything.
5. Expire old idempotency keys, and add rate limiting to login.
