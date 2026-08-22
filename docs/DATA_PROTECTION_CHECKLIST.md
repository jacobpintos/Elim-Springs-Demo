# Data protection & FERPA readiness checklist

> **Not legal advice.** This is a practical checklist to help protect student
> records in this app. Confirm which laws actually bind your school (FERPA
> applies to schools receiving U.S. Dept. of Education funding; you may instead
> or additionally be subject to state student-privacy law and, for students
> under 13, COPPA) and have your policies reviewed by qualified counsel.

## Technical safeguards (in the app)

| Safeguard | Status | Notes |
|-----------|--------|-------|
| Per-family data isolation (parents see only their own children) | ✅ Done | Enforced by Firestore rules — **must deploy `firestore.rules`** |
| Role-based least privilege (admin / teacher / parent / student) | ✅ Done | No default-teacher; no privilege escalation |
| Passwords managed by Firebase Auth (none stored in the database) | ✅ Done | |
| Strong password policy (≥12 chars, mixed classes, not common) | ✅ Done | Enforced in-app; consider also setting the server-side policy (below) |
| Multi-factor authentication (TOTP / authenticator app) | ⏳ Code ready | Requires enabling **Identity Platform + TOTP** in Firebase (see DEPLOYMENT.md §11) |
| Idle auto-logout (20 min) | ✅ Done | Protects unattended/shared devices |
| Activity log (who changed what, 30-day) | ✅ Done | Staff-only |
| In-app restore points (3 most recent, taken at each staff sign-in) | ✅ Done | Short-term undo, **not** a backup — see below |
| Encryption in transit & at rest | ✅ Done | Firebase/Firestore provides this by default |
| Tightened Content-Security-Policy | ✅ Done | Allowlist of required hosts |
| Remove demo/fake student data before go-live | ⬜ To do | Use **Settings → Clear All Data** |

**Recommended additional technical steps**
- Turn on **scheduled Firestore backups** in the Google Cloud console. The in-app restore points only cover the last three staff sign-ins and live in the same project as the data; they will not recover a mistake found weeks later.
- In Firebase Auth, turn on the **server-side password policy** (Identity Platform) so the hosted password-reset page enforces the same strength rules as the app.
- Require **email verification** for staff accounts.
- Consider printable **backup codes** or a documented admin reset path for lost MFA devices.

## Policy & process (not code — you must create these)

- [ ] **Annual FERPA notice** to parents of their rights — see `FERPA_ANNUAL_NOTICE.md`.
- [ ] **Privacy notice** — what is collected, where stored, who sees it, retention — see `PRIVACY_NOTICE.md`.
- [ ] **Consent forms** at enrollment, including **directory-information** definition + opt-out, and consent for any third-party disclosure.
- [ ] **Process to inspect/review** records (respond within 45 days) and to **request amendment** (with a hearing if refused).
- [ ] **Record of disclosures** of student PII to third parties (who received what, and why).
- [ ] **Vendor agreement with Google** — accept **Google Cloud's Data Processing Terms / DPA** so Google is a processor acting under your control (this is how FERPA's "school official" cloud exception is met).
- [ ] **Incident/breach response plan** — Iowa Code §715C requires breach notification; write down who does what.
- [ ] **Data retention & destruction schedule** — how long records are kept and how they're securely destroyed (don't destroy anything with a pending inspection request).
- [ ] **Designate a records custodian** and give staff a short "legitimate educational interest" rule: only access data you need for your role (the activity log makes access visible).
- [ ] **Staff training** on handling student records.
