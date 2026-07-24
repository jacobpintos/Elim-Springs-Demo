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

## 3. Teachers

A user is a teacher if **either**:

1. their verified login email is in the bootstrap list, **or**
2. their `users/{uid}` record has `role: "teacher"`.

The bootstrap list appears in **two places that must match**:

- `firestore.rules` → `bootstrapTeacherEmails()`
- `index.html` → `window._bootstrapTeacherEmails`

Currently both contain `teacher@elimsprings.com`. The bootstrap path means the
founding teacher always has access even if their user record is missing, so you
can't lock yourself out.

**To add another teacher** (same class/students): once that person has a
Firebase Auth account, sign in as an existing teacher and create their
`users/{uid}` record with `role: "teacher"` — or add their email to the
bootstrap list in *both* files above and redeploy the rules + the HTML. All
teachers share the same `state/main`, so they all see the same students.

---

## 4. Parent / student logins

For a parent or student portal to work, that person needs:

1. a **Firebase Auth account** (email/password), and
2. a **`users/{uid}` record** with `role: "parent"` (or `"student"`) and
   `studentIds: ["s1", ...]` linking them to their child/children.

Creating the Auth account requires the Firebase console (**Authentication → Add
user**) or the Admin SDK / a Cloud Function — a web page can't create a login
for someone else without signing itself in as them. After the Auth account
exists, create the matching `users/{uid}` record (the `uid` is shown in the
console).

Once linked, the teacher's app automatically publishes that student's
`portals/{studentId}` doc and scaffolds the `responses/{studentId}` doc (the
teacher must sign in at least once after the link is added). The parent then
sees only their own child.

> The in-app **Accounts** screen currently manages legacy display records, not
> real logins — it does not create Firebase Auth accounts. Wiring that screen to
> provision real accounts (via a Cloud Function) is a good follow-up.

---

## 5. Isolation test checklist (do this after deploying rules)

Use the **Rules Playground** (Firestore → Rules → Playground) and a real
browser session:

1. **Teacher:** sign in as `teacher@elimsprings.com`. Full app loads. Edit a
   grade; confirm `portals/*` docs appear/update in the Firestore console.
2. **Provision a parent:** create an Auth account (e.g. `parent1@example.com`)
   and a `users/{thatUid}` doc `{role:"parent", studentIds:["<one student id>"]}`.
   Sign in as the teacher once so the portal/response docs scaffold.
3. **Parent sees only their child:** sign in as the parent. Only their linked
   student appears; grades/attendance/notes load.
4. **Cross-family read is denied:** in the Rules Playground, simulate the
   parent's uid doing `get` on **another** student's `portals/{otherId}` →
   *denied*. Simulate the parent reading `state/main` → *denied*.
5. **Permission slip:** as the parent, authorize a slip. `responses/{sid}.slips`
   updates; the teacher's Events view reflects it. In the Playground, simulate
   the parent changing `allowedUids` on their responses doc → *denied*.
6. **Unknown account:** sign in with an email that is neither a bootstrap
   teacher nor has a user record → "Account not set up", no data.

---

## 6. Known limitations / follow-ups

- **Account provisioning** (creating Auth logins + user records) is manual via
  the console. A Cloud Function would let the teacher do it in-app.
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
- The **Accounts** screen no longer collects a password; it only links a person
  to students. Creating the actual login is still a Firebase Auth step (console
  or a future Cloud Function), after which the person can set their password via
  “Forgot password?”.
