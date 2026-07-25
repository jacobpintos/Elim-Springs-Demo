# Deployment & data-isolation guide

This app is a single-file web app (`index.html`) backed by Firebase Auth +
Cloud Firestore. This document covers the **security rules** and the
**per-family data isolation** introduced alongside the demo-data fix, plus how
to add teachers and parent/student logins.

> **Important:** the security rules in `firestore.rules` are the *entire* access
> control layer. The app is only as safe as the deployed rules. Until you deploy
> them (step 1), Firestore uses whatever rules your project currently has.

---

## 1. Deploy the security rules

The rules live in `firestore.rules`. Deploy them one of two ways.

**Firebase CLI (recommended):**

```bash
npm install -g firebase-tools     # once
firebase login
firebase use elim-school-2abae    # this project's id
firebase deploy --only firestore:rules
```

(If the project has no `firebase.json`, add one with
`{ "firestore": { "rules": "firestore.rules" } }` or run `firebase init firestore`.)

**Firebase console (no CLI):** open the project → **Firestore Database → Rules**,
paste the contents of `firestore.rules`, and **Publish**.

---

## 2. How access works now

Data lives under `schools/elim-springs/…`:

| Path | Who can read | Who can write |
|------|--------------|---------------|
| `state/main` | teachers only | teachers only |
| `users/{uid}` | that user (own record) + teachers | teachers only |
| `portals/{studentId}` | teachers + the student's linked parent/student uids | teachers only |
| `responses/{studentId}` | teachers + linked uids | teachers (all) / linked parent (only the `slips` field) |

- **`state/main`** is the teacher's full working gradebook. Parents and students
  never touch it — that is what closes the old hole where any logged-in user
  could read every family's data.
- **`portals/{studentId}`** is a per-student, read-only snapshot the teacher's
  app writes automatically (on every save). Each doc lists `allowedUids`; the
  rules only let those uids read it. A parent's browser only ever loads the
  portal docs for their own children.
- **`responses/{studentId}`** is where a parent's permission-slip
  authorizations are written. A linked parent can change only the `slips`
  field and cannot alter the allow list.

**No default-teacher.** A login that isn't a bootstrap teacher email and has no
user record is shown "Account not set up" and given no data. (Previously an
unknown account silently became a teacher with full access.)

---

## 3. Roles

| Role | Gradebook | Account management |
|------|-----------|--------------------|
| **admin** | full | create/edit/remove **any** account, including teachers and admins |
| **teacher** | full | create/edit/remove **parent and student** accounts only |
| **parent** | — | portal (own children) + submit permission slips |
| **student** | — | portal (own record) |

Both admin and teacher see the full gradebook and share the same `state/main`.

A user's role comes from **either** a bootstrap admin email **or** their
`users/{uid}` record's `role`. The bootstrap list appears in **two places that
must match**:

- `firestore.rules` → `bootstrapAdminEmails()`
- `index.html` → `window._bootstrapAdminEmails`

Both currently contain `teacher@elimsprings.com`, which is therefore the
founding **admin**. The bootstrap path grants access even before a user record
exists, so you can't lock yourself out.

**Adding staff:** an admin creates a teacher or another admin straight from the
in-app **Accounts** screen (see §4). Alternatively add an admin email to the
bootstrap list in *both* files above and redeploy. Teachers cannot create
teachers/admins — the UI hides it and the rules reject it (no privilege
escalation).

---

## 4. Creating accounts in the app

Staff create logins from the **Accounts** screen — no console needed for the
common cases:

- Admins can create **admin / teacher / parent / student** accounts.
- Teachers can create **parent / student** accounts.

Under the hood, "Create Account" uses a **secondary Firebase app instance** to
create the real Firebase Auth login without disturbing the signed-in staff
session, writes the `users/{uid}` role record (with `studentIds` and
`classIds`), signs the secondary session out, and emails a password reset link.
The creator is shown a temporary password to hand off; the new user can also use
**Forgot password?** to set their own.

- **Linking:** for parent/student accounts, check the students they should see.
  The staff app then publishes each student's `portals/*` read-model and
  scaffolds `responses/*` automatically.
- **Removing:** "Remove" deletes the `users/{uid}` role record, which revokes
  app access immediately. The underlying **Firebase Auth login** is not deleted
  by the web app — remove it in **Authentication → Users** in the console (or via
  a Cloud Function) if you want the sign-in gone entirely.

> Requires the **Email/Password** provider to be enabled in Firebase
> Authentication (it already is, since sign-in uses it).

---

## 4a. Classrooms (scaffolded, not yet enforced)

Everyone is currently in one class. To make separating teachers by classroom an
easy future change, each staff account carries `classIds: ["main"]` and the
default class id is `window._defaultClassId` in `index.html`. Turning on real
per-classroom isolation later means: give students a `classId`, filter each
teacher's roster to their `classIds`, and (for true DB-level isolation) scope
`state`/portal reads by class in the rules — the same pattern already used to
isolate families. The fields are in place so that step doesn't need a data
migration.

---

## 5. Isolation test checklist (do this after deploying rules)

Use the **Rules Playground** (Firestore → Rules → Playground) and a real
browser session:

1. **Teacher:** sign in as `teacher@elimsprings.com`. Full app loads. Edit a
   grade; confirm `portals/*` docs appear/update in the Firestore console.
2. **Provision a parent in-app:** on **Accounts**, create a parent, link one
   student, and note the temporary password. Confirm a `users/{uid}` doc and the
   student's `portals/*` doc exist in the console.
3. **Parent sees only their child:** sign in as the parent (temp password or via
   Forgot password). Only their linked student appears; grades/attendance load.
4. **Cross-family read is denied:** in the Rules Playground, simulate the
   parent's uid doing `get` on **another** student's `portals/{otherId}` →
   *denied*. Simulate the parent reading `state/main` → *denied*.
5. **Permission slip:** as the parent, authorize a slip. `responses/{sid}.slips`
   updates; the teacher's Events view reflects it. In the Playground, simulate
   the parent changing `allowedUids` on their responses doc → *denied*.
6. **Role hierarchy:** sign in as a **teacher** (non-admin) → the Accounts role
   dropdown offers only Parent/Student. In the Playground, simulate a teacher
   uid creating a `users/{x}` doc with `role:"teacher"` → *denied*; simulate an
   **admin** uid doing the same → *allowed*.
7. **Unknown account:** sign in with an email that is neither a bootstrap admin
   nor has a user record → "Account not set up", no data.

---

## 6. Known limitations / follow-ups

- **Account deletion** removes the role record (app access) but not the Firebase
  Auth login itself — do that in the console or via a Cloud Function.
- **Per-classroom isolation** is scaffolded (see §4a) but not yet enforced; today
  all staff see all students.
- **Slip reconciliation** into the teacher's master document happens while the
  teacher is signed in (their app listens and merges). A parent authorizing
  overnight is recorded immediately in `responses/*` and is reflected in the
  teacher's view the next time the teacher app is open.
- **Legacy fields:** `state.users` still carries demo account records from the
  pre-Firebase build (name/email/role/links only — **no passwords**). They are
  not real logins. Use **Clear All Data** in Settings before going live to
  remove demo records (it now also clears the `portals/*` and `responses/*`
  collections).

## 7. Passwords

Passwords are managed entirely by **Firebase Authentication** — none are stored
in Firestore.

- **Sign-in** uses Firebase email/password auth.
- **Forgot password** on the sign-in screen sends a Firebase reset email (works
  for teachers, parents, and students).
- **Change password** is available in the teacher **Settings → My Password**
  card and in the parent/student portal header, both via Firebase Auth
  `updatePassword` (a recent sign-in may be required).
- **Creating an account** (Accounts screen) provisions a real Firebase Auth
  login with a temporary password and emails a reset link; the new user sets
  their own password. No plaintext password is ever stored in Firestore.

## 8. Activity log

The **Activity** tab records who changed what and when. It is visible only to
staff (admin/teacher) — the tab exists only in the staff app, and the entries
live inside `state/main`, which the rules restrict to staff and which is never
copied into the parent/student portal docs.

- **What's captured:** gradebook edits (grades, attendance, behavior, notes, by
  student name), roster and settings changes, quarter finalize/unlock,
  promotion/archiving, and account create/remove/link changes — each with the
  acting user's name and role and a timestamp. Rapid edits are coalesced into a
  single entry per save.
- **Retention:** entries are kept for **30 days**. Older entries are pruned on
  every write (and capped at 2000), and the tab only ever shows the last 30
  days, so nothing older is stored or displayed during normal use. No Firestore
  TTL policy or console configuration is required.
