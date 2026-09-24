# Handover & ownership

**Empower Iowa — Elim Springs Campus gradebook**

Who should read what:

| You are | Read |
| --- | --- |
| A school administrator | Sections 1–5. You never need to touch the code. |
| The person maintaining the software | Sections 6–9, then `DEPLOYMENT.md`. |

> Fill in the blanks marked `⬜` once the accounts exist, and keep this file up to
> date. It is the page someone reaches for when the person who built this is
> unavailable.

---

## 1. What the system is, and where each part lives

Four separate things. Losing access to any one of them is a different kind of
problem, so they are listed separately.

| Part | What it is | Where it lives | Who must own it |
| --- | --- | --- | --- |
| **The student data** | Every grade, attendance record, note and login | Firebase project **`elim-school-2abae`** | **The school** |
| **The software** | The source code and the published web page | GitHub repository `⬜ org/repo` | The school (see §6) |
| **The address** | The web address families type | DNS for `⬜ school domain` | The school (already) |
| **The bill** | Google Cloud billing account | `⬜ billing account name` | The school (see §7) |

**The one that matters most is the first.** The student data lives in Firebase,
not GitHub. If the school owns only one thing, own the Firebase project.

---

## 2. Who holds which permission

The school owns everything. The technical person is granted working access,
which the school can withdraw at any time without anyone's cooperation.

| | School | Technical maintainer |
| --- | --- | --- |
| Firebase project | **Owner** ×2 people | **Editor** |
| GitHub organisation | **Owner** ×2 people | **Admin** on the repository |
| Billing account | **Administrator** | none needed |
| DNS | Whoever manages the school website | none needed |

**Editor** can do every operational task — deploy code, fix data, manage
sign-ins. It **cannot** grant permissions or delete the project. That gap is the
entire point: the school keeps the ability to lock the door.

> **Two owners, not one.** If the single owner leaves the school or loses their
> account, nobody can grant access to a successor and the project becomes
> unrecoverable. Use two named people, and prefer a role address
> (`admin@school.org`) over a personal one.

**Current holders — keep this filled in:**

| Role | Name | Account | Added |
| --- | --- | --- | --- |
| Firebase Owner | ⬜ | ⬜ | ⬜ |
| Firebase Owner (2nd) | ⬜ | ⬜ | ⬜ |
| Firebase Editor (maintainer) | ⬜ | ⬜ | ⬜ |
| GitHub org Owner | ⬜ | ⬜ | ⬜ |
| GitHub org Owner (2nd) | ⬜ | ⬜ | ⬜ |
| Billing administrator | ⬜ | ⬜ | ⬜ |
| Founding admin login (§8) | ⬜ | ⬜ | ⬜ |

---

## 3. Granting access to a new technical person

No command line needed. About five minutes.

**Firebase (so they can deploy and fix things)**

1. Go to **console.firebase.google.com** and open **elim-school-2abae**.
2. Gear icon (top left) → **Users and permissions**.
3. **Add member** → their Google account address → role **Editor** → Add.

**GitHub (so they can change the code)**

1. Open the organisation → the repository → **Settings** → **Collaborators and teams**.
2. **Add people** → their GitHub username → role **Admin** → Add.

That is everything. They can now do the whole job.

> If their first deploy of the Cloud Functions fails with a permissions error,
> the missing piece is usually **Service Account User**. Add it the same way, in
> the Google Cloud console under **IAM**.

---

## 4. Removing someone's access

Do this the day the arrangement ends. It takes two minutes and needs nothing
from them.

1. **Firebase** → gear → **Users and permissions** → find them → **Remove**.
2. **GitHub** → organisation → **People** → find them → **Remove from organisation**.
3. **Change the password on the founding admin account** (§8) if they ever knew it.
4. If they held the billing account, move billing to a school account (§7).

Their access stops immediately. Nothing in the system breaks — the app keeps
running, families keep signing in, and nothing needs redeploying.

---

## 5. What the school must never lose

| If this is lost | Consequence | Prevention |
| --- | --- | --- |
| Both Firebase Owner accounts | Nobody can ever grant access again; the data is stranded | Two owners, one a role address |
| The founding admin login (§8) | You can still recover via Firebase Owner | Keep the password in the school's password manager |
| The billing account | Cloud Functions stop; the app still works but account deletion and cleanup stop | Two billing administrators |
| DNS control | The web address stops resolving | It is the school's domain already |

**Back up the data.** In the Firebase console under **Firestore → Backups**, turn
on **point-in-time recovery** (7 days) and a **daily scheduled backup**. The app's
own restore points only cover the last three staff sign-ins and live in the same
project — they are an undo button, not a backup.

---

## 6. For the incoming maintainer — what you need

**Access:** Firebase **Editor** on `elim-school-2abae`, GitHub **Admin** on the
repository. Ask a school Owner (§3).

**On your machine:**

```bash
git clone <the repository>
cd <repo>
npm install
npm install -g firebase-tools
firebase login
firebase use elim-school-2abae
```

**Read `DEPLOYMENT.md` before changing anything.** Especially:

- **§0** — the app is written in `src/app.jsx` and compiled into `index.html` by
  `npm run build`. Editing `index.html`'s app section directly is overwritten by
  the next build. Always commit both files together.
- **§1** — deploying the security rules. The rules *are* the access control; the
  app is only as safe as what is deployed.
- **§9b** — why the whole gradebook is one Firestore document, and the limits
  that follow.
- **§14** — the Cloud Functions.

**The two deploys:**

```bash
firebase deploy --only firestore:rules      # after editing firestore.rules
firebase deploy --only functions            # after editing functions/
```

Both must be run from the repository root, not from inside `functions/`.

The web page itself deploys automatically: GitHub Pages serves `index.html` from
the default branch, so pushing is the deploy.

---

## 7. Running costs

The project is on Google's **Blaze** (pay-as-you-go) plan. That is required
because Cloud Functions do not run on the free plan at all — **not** because of
the school's usage, which sits well inside Google's permanently-free allowances:

| | Free each day/month | This school uses |
| --- | --- | --- |
| Database reads | 50,000/day | a few hundred |
| Database writes | 20,000/day | a few hundred |
| Stored data | 1 GB | under 1 MB |
| Function calls | 2 million/month | a handful |
| Scheduled jobs | 3 | **1** |

**Expected bill: $0.** A card must be on file regardless.

> **Set a budget alert.** Blaze has no spending cap by default. In the Google
> Cloud console → **Billing → Budgets & alerts**, create a budget of a few
> dollars with email notification. It will not stop spending, but nobody gets a
> surprise.

---

## 8. The founding admin account

One email address is hard-coded as the founding administrator. It gets admin
access **even with no user record**, which is what stops the school locking
itself out — and which also makes it the most valuable account in the system.

- Current address: `⬜` (was `teacher@elimsprings.com` during development)
- It appears in **three files that must always match**: `firestore.rules`,
  `index.html`, and `functions/index.js`. Changing it means editing all three and
  redeploying the rules **and** the functions.
- It should be a **dedicated address** (`admin@school.org`), not anyone's
  personal mailbox.
- **Turn on multi-factor authentication for it** before real students are
  entered. It is the one account where a stolen password is unrecoverable.
  See `DEPLOYMENT.md` §11.
- Keep its password in the school's password manager, not in one person's head.

---

## 9. What runs by itself

So nobody is surprised by it:

| What | When | Where it is set |
| --- | --- | --- |
| Deletes accounts left removed 90 days | Nightly, 3:15am Central | `functions/index.js` |
| Saves a restore point | Each staff sign-in; keeps 3 | `index.html` |
| Deletes activity-log entries over 30 days | On each save | `index.html` |
| Signs out an idle session | After 20 minutes | `index.html` |

**If a teacher reports that changes are not saving:** the app shows a red banner
across the top when a save fails, naming the cause. It never fails silently.
Common causes are being signed out, no internet, or the security rules not being
deployed.

---

## 10. Setup still outstanding

Tick these off and date them.

- [ ] Deploy `firestore.rules` — **the app is not secure until this is done**
- [ ] Turn on point-in-time recovery and scheduled backups (§5)
- [ ] Set the billing budget alert (§7)
- [ ] Replace the founding admin address in all three files (§8)
- [ ] Turn on multi-factor authentication for the founding admin (§8)
- [ ] Add a second Firebase Owner and a second GitHub Owner (§2)
- [ ] **Settings → Clear All Data** to remove the demo students before entering real ones
- [ ] Adapt the drafts in `docs/` — privacy notice, FERPA notice, data-protection
      checklist — and have someone qualified review them
- [ ] Fill in every `⬜` in this document
