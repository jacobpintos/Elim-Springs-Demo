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

## 9. Daily snapshots

**Settings → Daily Snapshots** keeps one restorable backup of the gradebook per
day, for 30 days.

- **Capture:** the staff app takes a snapshot at local **midnight** (a timer),
  and also catches up on load if the day has no snapshot yet — so a day is never
  missed just because nobody had the app open at 00:00. Only one snapshot is
  kept per calendar day.
- **Storage:** because a Firestore document is capped at 1 MB, we can't hold 30
  full copies of the gradebook inside `state/main`. Instead, small metadata
  (`{id,date,timestamp}`) lives in `state.saves` (the list you see), and each
  full day's copy lives in its own `snapshots/{id}` document — **staff-only** via
  the rules. Requires deploying the updated `firestore.rules` (the `snapshots`
  match).
- **Retention:** on each capture, snapshot documents (and their metadata) older
  than 30 days are deleted.
- **Restore** rolls the gradebook back to that day's copy and reloads. Your
  **snapshot history and activity log are preserved**, and the restore is itself
  recorded in the activity log. A snapshot can also be deleted manually.

## 10. Excel export

- **Gradebook → ⬇ Excel** exports the selected student's gradebook as an `.xlsx`
  workbook: a **Summary** sheet (per-subject average and grade) and an
  **Assignments** sheet (every assignment with score, max, and percent — or the
  MDN mark and meaning for MDN students).
- **Reports → Transcript → ⬇ Export to Excel** exports the generated transcript
  as `.xlsx` (subjects × finalized quarters, final grade, and GPA columns for
  grades 9–12).
- Files download straight from the browser. The export uses the **SheetJS**
  library, loaded on first use from cdnjs (the same CDN the app already uses for
  React/Babel), so the first export needs a network connection; there are no
  other dependencies and nothing is uploaded anywhere.

## 11. Passwords & multi-factor authentication (MFA)

### Strong passwords (on by default, no setup)
Every place the app sets a password — creating an account, and the teacher and
portal "change password" flows — enforces: **at least 12 characters, with an
uppercase letter, a lowercase letter, a number, and a symbol, not based on the
email, and not a common password.** A live checklist shows the rules, and
"Generate" makes a compliant password. Firebase's own hosted **reset** page
enforces its own minimum; to make it match, turn on the **server-side password
policy** under Identity Platform (below).

### MFA via authenticator app (TOTP) — requires enabling in Firebase
The code for two-factor authentication is built in (enrollment UI in **Settings**
and the portal, plus a sign-in code prompt), but it only works once the project
is upgraded:

1. In the Firebase console, upgrade the project to the **Blaze (pay-as-you-go)**
   plan (MFA requires it). Review **Identity Platform pricing** and set a Google
   Cloud **budget alert** first.
2. Firebase console → **Authentication → Sign-in method → Advanced /
   Multi-factor** → enable **Identity Platform**, then enable **TOTP
   (authenticator app)** as a second factor. (Do **not** rely on SMS — it costs
   per text; TOTP is what this app uses and sends no messages.)
3. Users then open **Settings → Two-Factor Authentication** (staff) or the
   portal's password screen, tap **Set up two-factor**, scan the QR code with any
   authenticator app (Microsoft Authenticator, Google Authenticator, Authy,
   1Password…), and enter a code. From then on, sign-in asks for the 6-digit code.

- **Recommended for every staff account** (they can see student records).
- **Lost device:** an admin removes MFA from that user in the Firebase console
  (Authentication → the user → remove second factor); the user re-enrolls.
- Until step 2 is done, the 2FA screen shows "not enabled yet" and sign-in works
  with password only — nothing breaks.

> The live MFA flow was **not** testable during development (it needs Identity
> Platform enabled), so verify enrollment and a code-prompted sign-in end-to-end
> once you turn it on.
>
> If the Two-Factor screen still says "not enabled" **after** you've turned on
> Identity Platform + TOTP, the bundled Firebase SDK may predate TOTP support.
> Update the three `firebasejs/9.23.0/...` `<script>` URLs at the top of
> `index.html` to a newer release (the current 10.x line) and retest — the compat
> API used here is stable across those versions.

### Email verification
- **Enrolling two-factor always requires a verified email** (Firebase's own rule). If a user hasn't verified, the Two-Factor card shows a **Send verification email** button instead of the setup flow — no effect on signing in.
- **Optional sign-in gate:** set `window._requireEmailVerification=true` in `index.html` to also **block sign-in** until a non-admin's email is verified (a "Verify your email" screen with a resend button appears). **Default is `false`** so demo data with fake emails still logs in. Founding admin email(s) are **always exempt**, so you can't lock yourself out. Turn it on for production once real emails are in use — it's a one-line flip, on or off.

## 12. Idle auto-logout & Content-Security-Policy

- **Idle auto-logout:** signed-in users are automatically signed out after **20
  minutes** of inactivity (adjust via `window._idleMinutes` in `index.html`) to
  protect unattended or shared devices.
- **Content-Security-Policy:** the page's CSP is restricted to the specific CDNs
  and Firebase endpoints the app uses (instead of the previous `default-src *`).
  **Test sign-in, Firestore reads/writes, fonts, and Excel/QR export after
  deploying**; if something is blocked, the browser console names the blocked
  host — add it to the CSP `<meta>` in `index.html`, or revert that one line to
  the previous `default-src *` value while you investigate.

## 13. FERPA / privacy

Protecting student records is mostly **policy**, not code. See:

- `docs/DATA_PROTECTION_CHECKLIST.md` — what the app covers and the policy items still needed.
- `docs/PRIVACY_NOTICE.md` — draft family privacy notice.
- `docs/FERPA_ANNUAL_NOTICE.md` — draft annual notice of rights.

These are **starting-point drafts** to adapt and review with counsel — not final
legal text. Confirm which laws bind your school (FERPA applies to schools
receiving federal education funding; state law and COPPA may also apply).

## 14. Cloud Functions — deleting sign-ins (optional but recommended)

A web page can delete Firestore documents but **cannot delete another person's
Firebase Authentication sign-in** — only the Admin SDK can. Two admin-only
callable functions in `functions/index.js` close that gap:

| Function | Used by | What it does |
|---|---|---|
| `deleteAccount` | Accounts → **Remove** | Deletes that user's Auth sign-in *and* their role record. Refuses to delete you, or the last admin. |
| `purgeNonAdminAuth` | Settings → **Clear All Data** | Deletes every non-admin sign-in. Admin accounts, bootstrap admin emails, and the caller are always kept. |

Both re-check server-side that the caller is an admin (bootstrap email or a
`role: "admin"` record) — the client's claim is never trusted.

### Deploy

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

Requires the **Blaze (pay-as-you-go)** plan — same as MFA. For a school's
handful of calls this sits inside the free monthly allowance, but review current
Cloud Functions pricing and set a budget alert first.

Keep `BOOTSTRAP_ADMIN_EMAILS` and `SCHOOL_ID` at the top of `functions/index.js`
in sync with `firestore.rules` and `index.html`.

### Without deploying

Everything still works: removing an account deletes the role record (which
revokes app access immediately) and the app tells you the sign-in must be
removed in the Firebase console. Clear All Data likewise lists the exact emails
to delete. Deploying simply makes that automatic.

> The functions were **not** live-tested during development (they need a
> deployed Blaze project). Verify both flows once deployed — especially that a
> non-admin is rejected and that the last admin cannot be deleted.
