/**
 * Cloud Functions for Empower Iowa — Elim Springs Campus.
 *
 * A web page can delete Firestore documents, but it can NOT delete another
 * person's Firebase Authentication sign-in — only the Admin SDK can. These
 * callable functions close that gap so removing an account (and "Clear All
 * Data") really removes the login, not just its role record.
 *
 * Both functions are admin-only and re-check that server-side; never trust the
 * client's own claim about who it is.
 *
 * Deploy:  firebase deploy --only functions      (requires the Blaze plan)
 * If the app is served from another origin, see the CORS note in DEPLOYMENT.md.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const SCHOOL_ID = "elim-springs";

// Keep in sync with bootstrapAdminEmails() in firestore.rules and
// window._bootstrapAdminEmails in index.html.
const BOOTSTRAP_ADMIN_EMAILS = ["teacher@elimsprings.com"];

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
async function assertAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  }
  if (isBootstrapEmail(context.auth.token.email)) return;
  if ((await roleOf(context.auth.uid)) === "admin") return;
  throw new functions.https.HttpsError(
    "permission-denied",
    "Only an admin can manage accounts."
  );
}

/** uids of everyone holding an admin role record. */
async function adminUids() {
  const qs = await usersCol().where("role", "==", "admin").get();
  return new Set(qs.docs.map((d) => d.id));
}

/**
 * Delete ONE account: its Firebase Auth sign-in and its role record.
 * Refuses to remove the caller, or the last remaining admin.
 */
exports.deleteAccount = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const uid = String((data && data.uid) || "");
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "uid is required.");
  }
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "You cannot delete your own account."
    );
  }

  const role = await roleOf(uid);
  if (role === "admin") {
    const admins = await adminUids();
    if (admins.size <= 1) {
      throw new functions.https.HttpsError(
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
      throw new functions.https.HttpsError("internal", (e && e.message) || "Auth delete failed.");
    }
  }

  return { ok: true, uid, authDeleted };
});

/**
 * Delete EVERY non-admin sign-in — used by "Clear All Data".
 * Admin role records, bootstrap admin emails and the caller are always kept.
 */
exports.purgeNonAdminAuth = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const keep = await adminUids();
  keep.add(context.auth.uid);

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
