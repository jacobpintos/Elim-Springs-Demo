/**
 * Cloud Functions for Empower Iowa — Elim Springs Campus.
 *
 * A web page can delete Firestore documents, but it can NOT delete or disable
 * another person's Firebase Authentication sign-in — only the Admin SDK can.
 * These callable functions close that gap, so removing an account (and "Clear
 * All Data") really reaches the login, not just its role record.
 *
 * Every callable re-checks server-side who is asking; the client's own claim
 * about who it is, or what role it holds, is never trusted.
 *
 * One scheduled function, purgeSuspendedAccounts, enforces the retention rule
 * for removed accounts.
 *
 * 2nd-gen functions (firebase-functions v7). The region is pinned to
 * us-central1 because the web client calls httpsCallable() without one.
 *
 * Deploy:  firebase deploy --only functions      (requires the Blaze plan)
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

const SCHOOL_ID = "elim-springs";

// Keep in sync with bootstrapAdminEmails() in firestore.rules and
// window._bootstrapAdminEmails in index.html.
const BOOTSTRAP_ADMIN_EMAILS = ["teacher@elimsprings.com"];

const OPTS = { region: "us-central1", maxInstances: 10 };

// How long a removed (suspended) account is kept before it is deleted for good.
// Long enough for "we made a mistake" or "they're coming back in the fall",
// short enough that a family who has left doesn't sit in the database forever.
// Keep in sync with the note on the Accounts screen in index.html.
const SUSPENDED_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors the client's activity-log retention (index.html).
const AUDIT_DAYS = 30;
const AUDIT_MAX = 2000;

const db = () => admin.firestore();
const userDoc = (uid) => db().doc(`schools/${SCHOOL_ID}/users/${uid}`);
const usersCol = () => db().collection(`schools/${SCHOOL_ID}/users`);

function isBootstrapEmail(email) {
  const e = String(email || "").toLowerCase();
  return BOOTSTRAP_ADMIN_EMAILS.some((x) => String(x).toLowerCase() === e);
}

async function roleOf(uid) {
  const snap = await userDoc(uid).get();
  return snap.exists ? snap.data().role || "" : "";
}

/** Throws unless the caller is an admin (bootstrap email, or role === "admin"). */
async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  if (isBootstrapEmail(request.auth.token && request.auth.token.email)) return;
  if ((await roleOf(request.auth.uid)) === "admin") return;
  throw new HttpsError("permission-denied", "Only an admin can manage accounts.");
}

/** uids of everyone holding an admin role record. */
async function adminUids() {
  const qs = await usersCol().where("role", "==", "admin").get();
  return new Set(qs.docs.map((d) => d.id));
}

/**
 * Throws unless the caller may manage this account: an admin may manage anyone,
 * a teacher only parent/student accounts (mirrors firestore.rules).
 */
async function assertCanManage(request, uid) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  if (isBootstrapEmail(request.auth.token && request.auth.token.email)) return;
  const mine = await roleOf(request.auth.uid);
  if (mine === "admin") return;
  if (mine === "teacher") {
    const theirs = await roleOf(uid);
    if (theirs === "parent" || theirs === "student") return;
  }
  throw new HttpsError("permission-denied", "You cannot manage this account.");
}

/**
 * Server-side password policy. Mirrors window._pwRules in index.html — the app
 * checks the same rules before it asks, but the client is not the guard.
 */
function passwordIssues(pw, email) {
  const p = String(pw || "");
  const issues = [];
  if (p.length < 12) issues.push("at least 12 characters");
  if (!/[A-Z]/.test(p)) issues.push("an uppercase letter");
  if (!/[a-z]/.test(p)) issues.push("a lowercase letter");
  if (!/[0-9]/.test(p)) issues.push("a number");
  if (!/[^A-Za-z0-9]/.test(p)) issues.push("a symbol");
  const local = String(email || "").split("@")[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) issues.push("not based on the email address");
  const COMMON = [
    "password", "passw0rd", "p@ssw0rd", "123456", "1234567", "12345678", "123456789",
    "1234567890", "qwerty", "qwertyuiop", "asdfgh", "abc123", "letmein", "welcome",
    "admin", "iloveyou", "monkey", "dragon", "football", "baseball", "000000",
    "111111", "elimsprings", "empoweriowa", "gradebook",
  ];
  if (COMMON.some((b) => p.toLowerCase().includes(b))) issues.push("not a common or guessable password");
  return issues;
}

/**
 * Create ONE account: the Firebase Auth sign-in and its role record.
 *
 * This used to happen in the browser, on a second Firebase app instance, with
 * createUserWithEmailAndPassword() — which meant the project had to leave
 * public sign-up enabled, and anyone holding the (public) web API key could
 * register themselves an account. Doing it here with the Admin SDK bypasses
 * that switch, so sign-up can be turned off in the console: see DEPLOYMENT.md.
 *
 * An admin may create any role; a teacher only parent/student accounts — the
 * same rule the app shows and firestore.rules enforces.
 */
exports.createAccount = onCall(OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const data = request.data || {};
  const role = String(data.role || "");
  const email = String(data.email || "").trim();
  const password = String(data.password || "");
  const name = String(data.name || "").trim();

  if (!["admin", "teacher", "parent", "student"].includes(role)) {
    throw new HttpsError("invalid-argument", "Pick a role.");
  }
  if (!email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  const bootstrap = isBootstrapEmail(request.auth.token && request.auth.token.email);
  const mine = bootstrap ? "admin" : await roleOf(request.auth.uid);
  if (mine !== "admin" && mine !== "teacher") {
    throw new HttpsError("permission-denied", "Only staff can create accounts.");
  }
  if (mine !== "admin" && (role === "admin" || role === "teacher")) {
    throw new HttpsError("permission-denied", "Only an admin can create teacher or admin accounts.");
  }

  const issues = passwordIssues(password, email);
  if (issues.length) {
    throw new HttpsError("invalid-argument", "The temporary password needs " + issues.join(", ") + ".");
  }

  let user;
  try {
    user = await admin.auth().createUser({
      email,
      password,
      displayName: name || undefined,
    });
  } catch (e) {
    const code = (e && e.code) || "";
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "That email already has a sign-in.");
    }
    if (code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "That email address isn't valid.");
    }
    throw new HttpsError("internal", (e && e.message) || "Could not create the sign-in.");
  }

  const staff = role === "admin" || role === "teacher";
  try {
    await userDoc(user.uid).set({
      role,
      name,
      email,
      studentIds: staff ? [] : (Array.isArray(data.studentIds) ? data.studentIds : []),
      classIds: Array.isArray(data.classIds) && data.classIds.length ? data.classIds : ["main"],
      createdAt: Date.now(),
      createdBy: request.auth.uid,
    });
  } catch (e) {
    // Never leave a sign-in behind that no role record accounts for.
    await admin.auth().deleteUser(user.uid).catch(() => {});
    throw new HttpsError("internal", "Created the sign-in but could not save the account; nothing was kept.");
  }

  return { ok: true, uid: user.uid };
});

/**
 * Suspend or restore ONE account.
 *
 * Removing someone in the app suspends them rather than destroying the login:
 * the Firebase Auth sign-in is disabled and the role record is flagged, so an
 * accidental removal can be undone and that parent signs back in with the
 * password they already had. Deleting for good is deleteAccount, below.
 */
exports.setAccountAccess = onCall(OPTS, async (request) => {
  const uid = String((request.data && request.data.uid) || "");
  const suspended = !!(request.data && request.data.suspended);
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  await assertCanManage(request, uid);
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot suspend your own account.");
  }

  if (suspended && (await roleOf(uid)) === "admin") {
    const admins = await adminUids();
    if (admins.size <= 1) {
      throw new HttpsError(
        "failed-precondition",
        "This is the last admin account. Create another admin first."
      );
    }
  }

  let authUpdated = true;
  try {
    await admin.auth().updateUser(uid, { disabled: suspended });
  } catch (e) {
    if (e && e.code === "auth/user-not-found") {
      authUpdated = false; // record without a login; the flag below still applies
    } else {
      throw new HttpsError("internal", (e && e.message) || "Auth update failed.");
    }
  }

  await userDoc(uid).set(
    { suspended, suspendedAt: suspended ? Date.now() : null },
    { merge: true }
  );

  return { ok: true, uid, suspended, authUpdated };
});

/**
 * Delete ONE account for good: its Firebase Auth sign-in and its role record.
 * Refuses to remove the caller, or the last remaining admin. This cannot be
 * undone — the app uses setAccountAccess for ordinary removals.
 */
exports.deleteAccount = onCall(OPTS, async (request) => {
  await assertAdmin(request);

  const uid = String((request.data && request.data.uid) || "");
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  }

  const role = await roleOf(uid);
  if (role === "admin") {
    const admins = await adminUids();
    if (admins.size <= 1) {
      throw new HttpsError(
        "failed-precondition",
        "This is the last admin account. Create another admin first."
      );
    }
  }

  // Remove app access first, then the sign-in itself.
  await userDoc(uid).delete().catch(() => {});

  let authDeleted = true;
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    if (e && e.code === "auth/user-not-found") {
      authDeleted = false; // record existed without a login; nothing to remove
    } else {
      throw new HttpsError("internal", (e && e.message) || "Auth delete failed.");
    }
  }

  return { ok: true, uid, authDeleted };
});

/**
 * Delete EVERY non-admin sign-in — used by "Clear All Data".
 * Admin role records, bootstrap admin emails and the caller are always kept.
 */
exports.purgeNonAdminAuth = onCall(OPTS, async (request) => {
  await assertAdmin(request);

  const keep = await adminUids();
  keep.add(request.auth.uid);

  // Collect every user first — deleting while paginating can skip entries.
  const all = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    all.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  const doomed = all.filter((u) => !keep.has(u.uid) && !isBootstrapEmail(u.email));

  const deleted = [];
  const failed = [];
  for (const u of doomed) {
    try {
      await admin.auth().deleteUser(u.uid);
      deleted.push(u.email || u.uid);
    } catch (e) {
      failed.push(u.email || u.uid);
    }
    await userDoc(u.uid).delete().catch(() => {});
  }

  return { ok: true, deleted: deleted.length, emails: deleted, failed };
});

/**
 * Write an entry into the staff activity log (state/main → auditLog).
 *
 * Anything this backend does to someone's account has to show up where staff
 * look for it, credited to the schedule rather than to a person. Prunes to the
 * same 30-day / 2000-entry window the app uses.
 */
async function appendAuditEntry(action, detail) {
  const ref = db().doc(`schools/${SCHOOL_ID}/state/main`);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    actorUid: null,
    actorName: "Retention schedule",
    actorRole: "system",
    action,
    detail,
  };
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return; // no gradebook yet — nothing to append to
    const cutoff = Date.now() - AUDIT_DAYS * DAY_MS;
    const log = ((snap.data() || {}).auditLog || [])
      .filter((e) => e && (e.ts || 0) >= cutoff)
      .concat([entry])
      .slice(-AUDIT_MAX);
    tx.set(ref, { auditLog: log }, { merge: true });
  });
}

/**
 * Retention rule for removed accounts.
 *
 * Removing someone suspends their account rather than deleting it, so the
 * mistake case is recoverable — but a suspended record would otherwise keep a
 * former family's name, email and student links in the database indefinitely.
 * Once a day, this deletes every account that has been suspended for more than
 * SUSPENDED_RETENTION_DAYS: the Firebase Auth sign-in and the role record both
 * go, and the deletion is recorded in the activity log.
 *
 * Two accounts are never touched: a founding admin email (you can't lock
 * yourself out of your own school), and a record whose suspension has no
 * timestamp — that one gets a timestamp instead, so its clock starts now
 * rather than the deletion happening on the strength of a missing field.
 *
 * Needs Cloud Scheduler enabled on the project (it comes with the Blaze plan).
 */
exports.purgeSuspendedAccounts = onSchedule(
  {
    region: "us-central1",
    schedule: "every day 03:15",
    timeZone: "America/Chicago",
    maxInstances: 1,
  },
  async () => {
    const cutoff = Date.now() - SUSPENDED_RETENTION_DAYS * DAY_MS;
    const qs = await usersCol().where("suspended", "==", true).get();

    const deleted = [];
    for (const doc of qs.docs) {
      const rec = doc.data() || {};
      if (isBootstrapEmail(rec.email)) continue;

      const since = Number(rec.suspendedAt || 0);
      if (!since) {
        // Suspended before this rule existed, or by the offline fallback path:
        // start the clock instead of deleting on the strength of a blank field.
        await doc.ref.set({ suspendedAt: Date.now() }, { merge: true });
        continue;
      }
      if (since > cutoff) continue;

      try {
        await admin.auth().deleteUser(doc.id);
      } catch (e) {
        if (!e || e.code !== "auth/user-not-found") {
          // Leave the record alone so the next run tries again, rather than
          // dropping the role record while the sign-in survives.
          console.error(`purgeSuspendedAccounts: auth delete failed for ${doc.id}`, e);
          continue;
        }
      }
      await doc.ref.delete();
      deleted.push(`${rec.role || "account"} ${rec.email || rec.name || doc.id}`);
    }

    if (deleted.length) {
      await appendAuditEntry(
        "account.purge",
        `Deleted ${deleted.length} account${deleted.length === 1 ? "" : "s"} ` +
          `removed more than ${SUSPENDED_RETENTION_DAYS} days ago: ${deleted.join(", ")}`
      );
    }
    console.log(`purgeSuspendedAccounts: deleted ${deleted.length} of ${qs.size} suspended.`);
    return null;
  }
);
