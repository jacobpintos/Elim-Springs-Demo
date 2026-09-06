# Deployment & data-isolation guide

This app is a web app served as a single `index.html`, backed by Firebase Auth +
Cloud Firestore. This document covers the **security rules** and the
**per-family data isolation** introduced alongside the demo-data fix, plus how
to add teachers and parent/student logins.

> **Important:** the security rules in `firestore.rules` are the *entire* access
> control layer. The app is only as safe as the deployed rules. Until you deploy
> them (step 1), Firestore uses whatever rules your project currently has.

> **Editing the app?** The interface lives in `src/app.jsx`, not in
> `index.html`. Run `npm run build` after every change — see
> [section 0](#0-editing-the-app-npm-run-build).

---

## 0. Editing the app (`npm run build`)

The app is written in JSX, which browsers cannot run directly. It used to be
shipped as a giant string inside `index.html` and translated in the browser by
Babel on every single sign-in — which is why signing in used to pause on a
series of technical messages, why the page pulled a compiler down from a CDN,
and why the Content-Security-Policy had to permit `unsafe-eval`.

That translation now happens once, here, at build time.

| File | Role |
| --- | --- |
| `src/app.jsx` | **Edit this.** The entire teacher/parent/student interface. |
| `build.js` | Compiles `src/app.jsx` and injects the result into `index.html`. |
| `index.html` | Generated + hand-maintained: the login screen, Firebase wiring, and the compiled app between the `APP-CODE` markers. |

One-time setup:

```bash
npm install
```

After any change to `src/app.jsx`:

```bash
npm run build
```

That rewrites everything between `<!-- APP-CODE:START -->` and
`<!-- APP-CODE:END -->` in `index.html`. Never hand-edit that region — the next
build overwrites it.

**Commit `index.html` along with `src/app.jsx`.** GitHub Pages serves files
as-is and runs no build of its own, so an un-rebuilt `index.html` means the
live site keeps serving the previous version of the app. Re-running the build
with no source change produces a byte-identical file, so it is safe to run at
any time (e.g. before committing, to confirm the two are in sync).

`node_modules/` is git-ignored; the build tools are needed only on the machine
doing the editing.

What this bought us:

- Sign-in no longer waits for a compiler to load and run.
- `unsafe-eval` is gone from the Content-Security-Policy (section 12).
- One less third-party CDN in the page's trust chain.

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

**Suspended accounts.** A record with `suspended: true` is treated as holding no
role at all: `roleOf()` returns `''`, so it fails every staff check, and
`isLinked()` refuses it as well, so a removed parent cannot read their portal or
answer a slip. The app stops them at sign-in with an explanation. Lifting the
suspension restores access immediately — see §14.

---

## 3. Roles

| Role | Gradebook | Account management |
|------|-----------|--------------------|
| **admin** | full | create/edit/remove/restore **any** account, including teachers and admins; delete permanently |
| **teacher** | full | create/edit/remove/restore **parent and student** accounts only |
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
- **Removing:** "Remove" **suspends** the account — the Firebase Auth sign-in is
  disabled and the role record flagged — so app access stops immediately but the
  removal can be undone (§14). An account left removed for 90 days is then
  deleted automatically. **Delete forever** (admins) skips the wait and is
  permanent. The last admin can never be removed.

> Requires the **Email/Password** provider to be enabled in Firebase
> Authentication (it already is, since sign-in uses it). Public **sign-up** does
> not need to be on once the Cloud Functions are deployed — see §14, *Turning
> off public sign-up*.

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

- **Account removal** suspends the sign-in and the role record, and the account
  is deleted for good 90 days later (§14). Without the Cloud Functions deployed
  only the role record is flagged — which still revokes access, since the rules
  and the app both refuse a suspended record — but the Auth sign-in stays
  enabled until you deploy them.
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
  promotion/archiving, and account create/remove/restore/link changes — each
  with the acting user's name and role and a timestamp. Rapid edits are
  coalesced into a single entry per save.
- **Events and permission slips** are described one event at a time rather than
  as a blanket "events changed": *Created event “Zoo Trip” (Oct 4) at the Zoo
  for 12 students, permission slip required*, *Deleted event …*, or *Updated
  event “Zoo Trip” (Oct 4) — moved to Oct 6, added Liam Torres, permission slip
  no longer required*. School breaks, cancellations and delays are logged the
  same way. `_summarizeEvents()` in `index.html` builds these.
- **Slip answers are the family's, not the teacher's.** A parent's answer
  reaches the teacher's copy of the data through `responses/{studentId}`, so it
  used to be logged as if the signed-in teacher had made it. It now gets its own
  entry credited to the parent who answered — *Approved the permission slip for
  Emma Carter — “Zoo Trip” (Oct 4)* — because only a family can set that status.
- **Undo:** every change made during the current sign-in can be reversed from
  the log, newest first (only the newest carries an **Undo** button; undoing an
  older one would silently discard everything done since). An ordinary edit is
  rolled back from a memory-only copy of the data taken just before it; an
  account removal is reversed by lifting the suspension (see §14). The undo is
  itself recorded in the log, and the stack is memory-only — signing out or
  reloading ends the window. Older changes are recovered with a restore
  point (§9).
- **Retention:** entries are kept for **30 days**. Older entries are pruned on
  every write (and capped at 2000), and the tab only ever shows the last 30
  days, so nothing older is stored or displayed during normal use. No Firestore
  TTL policy or console configuration is required.

## 9. Restore points (sign-in snapshots)

**Settings → Restore Points** keeps the **three most recent** restorable copies
of the gradebook.

- **Capture:** one is taken each time a **teacher or admin signs in**, from the
  data as it arrived — before that person has changed anything. So the newest
  restore point is always "how things looked when I sat down."
- **Retention:** only the newest three are kept. The moment a fourth is created
  the oldest is **deleted outright** — its `snapshots/{id}` document is removed,
  not just hidden. There is no 30-day grace period and nothing to undelete.
- **Two guards** stop the three slots being wasted, both in
  `captureLoginSnapshot()` in `index.html`:
  - a sign-in within **10 minutes** of the newest restore point does not make a
    new one (so refreshing the page a few times doesn't burn through all three);
  - neither does a sign-in where the data is **byte-identical** to the newest
    restore point (compared via a short hash stored in the metadata).

  Raise or lower these with `SNAP_KEEP` and `SNAP_MIN_GAP_MS` at the top of that
  section.
- **Storage:** because a Firestore document is capped at 1 MB, we can't hold
  full copies of the gradebook inside `state/main`. Instead, small metadata
  (`{id,date,timestamp,hash}`) lives in `state.saves` (the list you see), and
  each full copy lives in its own `snapshots/{id}` document — **staff-only** via
  the rules. Requires deploying the updated `firestore.rules` (the `snapshots`
  match).
- **Restore** rolls the gradebook back to that copy and reloads. Your
  **restore points, activity log and families' permission-slip answers are
  preserved**, and the restore is itself recorded in the activity log (including
  how many slip answers it carried across). A restore point can also be deleted
  manually.
- **Accounts are restored too.** Logins live in `users/{uid}`, outside
  `state/main`, so each restore point also stores a copy of the role records
  (`accounts` on the `snapshots/{id}` document). Restoring puts them back: an
  account removed since is un-suspended — in Firebase Auth as well as on the
  record — so that parent signs in again **with the password they already had**,
  and changed names, roles and student links are reset. Accounts created since
  the restore point are left alone, so a rollback can't lock a new family out.
  Because it captures both, the restore point is taken once the gradebook *and*
  the account records have loaded.
- **Permission slips across a rollback:** a family that has already answered a
  slip is not asked again just because a teacher rolled the gradebook back.
  For each restored event, the answer currently on file wins — but only where it
  still means the same thing. `_keepSlipAnswers()` in `index.html` requires that
  the event still exists, still asks for a slip, still lists that student, and
  that its **name, dates, location and description are unchanged**. If a teacher
  moved the date or changed the destination in between, the family agreed to
  something the restored event no longer says, so their answer is dropped and
  they are asked again. Parents' own `responses/{studentId}` documents are never
  touched by a restore.

> **This is not a backup strategy.** Three restore points spanning a few days of
> sign-ins will not recover a mistake found weeks later, and they live in the
> same Firebase project as the live data. For real protection, turn on
> [scheduled Firestore backups](https://firebase.google.com/docs/firestore/backups)
> in the Google Cloud console, which keep independent copies with their own
> retention.

## 9a. Starting mid-year: backfilling attendance

**Attendance → ⏪ Backfill Past Days** fills in attendance for school days that
have already passed, so a school adopting this partway through the year doesn't
have to click through every day since September.

Pick a date range, choose which students it applies to, choose a status
(**Present** is the realistic bulk case), and it writes one record per student
per school day. The dialog shows exactly what it will do before you commit —
how many school days fall in the range, how many students, and how many records
will be added, replaced or left alone.

What counts as a school day comes from Settings, not from the calendar:

- only the weekdays ticked under **School Days**,
- only dates inside the **school year** start/end,
- **breaks** and **cancellations** are skipped entirely,
- a **late start** is filled in at the hours you recorded for that day (see
  *Shortened days* below), falling back to half a day if you left it blank.

So set the school year dates, the school days, and any breaks or snow days
**before** running the backfill — otherwise you will record attendance on days
the school was shut.

Two things make it safe to use more than once:

- **Days that already have a record are left alone** unless you tick *Replace
  days that already have a record*. Running it twice over the same range
  therefore changes nothing, and the button reports "0 records".
- The last date **cannot be in the future** — this only ever fills in days that
  have already happened.

The intended workflow is *mark everyone present for the term, then fix the
exceptions*: run the backfill, then use the date picker at the top of the
Attendance page to visit the days somebody was absent, tardy or excused and
change just those students. Hours recalculate as you go, and the year totals and
Iowa compliance projections follow automatically.

Backfilled records are ordinary attendance records — they appear in the monthly
report, the student's attendance log, the parent portal, and the hours total,
exactly as if they had been entered on the day.

### Correcting a past day

**Attendance → 📋 Monthly Report** shows every student's month as a grid of
days. **Every day in that grid is a button**: click it to set that student to
present, absent, excused or tardy on that date, or to clear the record entirely.
This is the fastest way to work through the exceptions after a backfill, because
you can see the whole month at once.

Every change is written to the **activity log** with the date and both sides of
the change — `Attendance 2026-09-03 — Sofia Nguyen: present → absent`. A bulk
run is collapsed to one line naming the size and range, so a backfill doesn't
flood the log. Attendance is the kind of record a compliance question gets asked
about later, so a correction made weeks after the fact stays findable.

### The school calendar (breaks, delays, cancellations)

**Settings → School Calendar** is the editable list: every break, late start
and cancellation, with **Edit** and **Remove** on each, and an Add button.
Attendance's **+ Break / Special Day** still adds one from where you notice it.

These entries decide which days count as school days, so they drive attendance,
the hours total and the Iowa projections — removing one turns those days back
into ordinary school days and recalculates hours.

**Parents and students both see the same list**, read-only, in the portal beside
the calendar ("No School / Late Starts"), with past entries folded away. Parent
and student logins share the portal, so the list needs no separate role check.
It reaches them through the per-student portal document; closures are
school-wide and contain no personal data.

### Shortened days (late starts and early outs)

A **Late start / early out** takes an **Hours held** figure: how much of the day
actually ran. A two-hour late start on a six-hour day is `4`. Leave it blank and
it falls back to half a day.

That figure is what the day is worth everywhere — attendance hours, the
year-to-date total, and the remaining-hours projection. Earlier versions assumed
every delay was exactly half a day, which under-counted a one-hour delay and
over-counted a three-hour one.

### Chronic absenteeism (Iowa SF2435)

The rate is **non-exempt absences to date ÷ school days elapsed to date**, where
a school day is the same definition used everywhere else (scheduled weekdays,
inside the year, breaks and cancellations removed). Excused absences and
tardies are not non-exempt absences and do not count toward it.

Two things stop it producing nonsense:

- **Only days that have happened count** — on both sides of the fraction. A
  future-dated absence is not counted, and neither is a day the school has not
  reached yet. The monthly report reports a month **to date** for the same
  reason, so the month totals and the year-to-date figure agree.
- **Nobody is rated until 10 school days have elapsed.** One absence in the
  first week is 20%, which is arithmetic rather than a pattern; until then the
  report shows the raw count and "too early in the year to rate".

Both the Attendance banner and the monthly report read this from one function
(`chronicRate()`), so they cannot disagree — they previously worked it out
separately, and did.

## 9b. Save health: failures, size and concurrent editing

`state/main` is a single Firestore document holding the whole working
gradebook. Firestore itself is replicated and checksummed — it does not corrupt
data — but three things about writing one big document can lose work, and all
three are now visible rather than silent.

**A rejected save says so.** The write used to end in `console.error()`, which a
teacher never sees; they would keep working on a gradebook that had stopped
saving. A failed write now raises a red banner across the top of the page,
naming the likely cause (signed out, offline, document too large) and offering
**Try again**. It stays until a save succeeds.

**Size is watched.** Firestore caps a document at 1 MB. The app measures each
write:

| At | What happens |
|---|---|
| 70% (~717 KB) | Amber banner, once per session. Everything still works. |
| 95% (~996 KB) | The write is **refused** with an explanation, rather than letting Firestore reject it silently. |

**Concurrent edits cannot silently overwrite each other.** Every write carries a
`rev` number and goes through a transaction that refuses to overwrite a revision
this browser has not seen. If another teacher saved while you were editing, your
save is held and you are asked to choose:

- **Reload** — take their version and redo your change.
- **Keep mine** — deliberately replace theirs.

There is no blind "retry" on a conflict, because retrying is exactly the
overwrite the check just prevented. Deliberate whole-document replacements
(restore a snapshot, Clear All Data, Create Demo Data) bypass the check by
design — they are confirmed, destructive actions.

### What fills the document

Archived school years. Every promotion files one snapshot per student —
including that year's attendance — into `state.history`, and nothing prunes it:

| Roster | Added each June | Years until full |
|---|---|---|
| 10 students | ~175 KB | ~6 |
| 15 students | ~263 KB | ~4 |
| 20 students | ~351 KB | ~3 |
| 25 students | ~439 KB | ~2 |

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
  React), so the first export needs a network connection; there are no
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
  It also **no longer allows `unsafe-eval`**, because the app is compiled at
  build time (section 0) rather than in the browser — so a script injected into
  the page cannot use `eval`/`new Function` to run itself.
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
| `createAccount` | Accounts → **Create Account** | Creates the Auth sign-in *and* the role record with the Admin SDK. An admin may create any role; a teacher only parent/student. Rolls back the sign-in if the record can't be written. |
| `setAccountAccess` | Accounts → **Remove** / **Restore** | Disables or re-enables that user's Auth sign-in and flags the role record `suspended`. Refuses to suspend you, or the last admin. |
| `deleteAccount` | Accounts → **Delete forever** | Deletes that user's Auth sign-in *and* their role record, permanently. Refuses to delete you, or the last admin. |
| `purgeNonAdminAuth` | Settings → **Clear All Data** | Deletes every non-admin sign-in. Admin accounts, bootstrap admin emails, and the caller are always kept. |
| `purgeSuspendedAccounts` | Cloud Scheduler, daily | Deletes accounts left removed for more than 90 days — sign-in and role record. Not callable from the app. |

The four callables re-check server-side who the caller is — the client's claim is never
trusted. `deleteAccount` and `purgeNonAdminAuth` are admin-only;
`setAccountAccess` follows the same rule as the app and the security rules: an
admin may manage anyone, a teacher only parent/student accounts.

### Removal is a suspension, not a deletion

**Remove** no longer destroys anything. It disables the Firebase Auth sign-in
and sets `suspended: true` on `users/{uid}`; the rules treat a suspended record
as holding no role, the app refuses the sign-in with an explanation, and the
Accounts screen shows the account as *Removed — sign-in suspended*. That is what
makes an accidental removal recoverable: **Restore** on the Accounts screen,
**Undo** in the activity log, or a restore point (§9) all bring the account
back, and because the sign-in was never deleted the password still works.

**Delete forever** (admins, on an already-removed account) is the old behavior
and is genuinely permanent — no undo, and no restore point will bring it back.

Without the Cloud Functions deployed, removal still sets the flag on the role
record, which blocks the app and the rules; the Auth sign-in itself just stays
enabled until you deploy them.

### Turning off public sign-up

A Firebase web API key is not a secret — it identifies the project and is served
to every visitor in `index.html`. That is fine by design, **except** while the
project allows public sign-up: with the Email/Password provider on and account
creation open, anyone holding that key can POST to Identity Toolkit's
`accounts:signUp` and get a real login on the project.

Such an account reaches no data — it has no `users/{uid}` record, so the app
shows "Account not set up" and every rules path denies it. But it lets a
stranger fill the Auth user list, and it is the mechanism by which an *unclaimed*
bootstrap admin email (`bootstrapAdminEmails()` in the rules) could be taken and
turned into full admin. Keep those addresses claimed, with strong passwords.

Account creation used to need sign-up left on, because the app created the login
in the browser with `createUserWithEmailAndPassword()`. `createAccount` does it
with the Admin SDK instead, which the sign-up switch does not gate. So, **in this
order**:

1. `firebase deploy --only functions` — with `createAccount` live, verify you can
   still create an account from the Accounts screen.
2. Firebase console → **Authentication → Settings → User actions** → uncheck
   **Enable create (sign-up)**.

After that, `accounts:signUp` returns `ADMIN_ONLY_OPERATION` and the only way to
get a login on this project is a teacher or admin creating one.

The browser path is still in `index.html` as a fallback and runs only when the
Cloud Functions can't be reached, so account creation keeps working on a project
where they haven't been deployed. Once you turn sign-up off, that fallback stops
working too — which is the intended end state, not a bug.

### Retention: removed accounts don't sit there forever

A suspension that never expires would keep a former family's name, email and
student links in the database indefinitely — recoverable is good, permanent is
not. `purgeSuspendedAccounts` runs daily at 03:15 America/Chicago and deletes,
for good, every account suspended more than **`SUSPENDED_RETENTION_DAYS`** (90)
ago: the Firebase Auth sign-in and the `users/{uid}` record both go, and the
deletion is written to the activity log as *Retention schedule · system*, so
staff can see it happened.

- Change the window with `SUSPENDED_RETENTION_DAYS` at the top of
  `functions/index.js`. The Accounts screen counts down to the same number —
  `RETENTION_DAYS` in `src/app.jsx` — so change both, then `npm run build`.
- A founding admin email is never auto-deleted.
- A suspended record with no `suspendedAt` (suspended before this rule existed,
  or by the offline fallback path) has its clock started on the next run rather
  than being deleted on the strength of a missing field — so the first 90 days
  after deploying this, nothing older is swept up by surprise.
- If deleting the Auth sign-in fails, the role record is left in place and the
  next run tries again — better a lingering record than a deleted record whose
  sign-in still works.
- The rule needs **Cloud Scheduler** enabled on the project (it comes with the
  Blaze plan); `firebase deploy --only functions` sets up the job.

Once an account is auto-deleted the removal is no longer recoverable — a restore
point can rewrite the role record, but the sign-in itself is gone, so the family
would need a fresh account and a new password.

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
