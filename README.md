# Empower Iowa — Elim Springs Campus

A gradebook, attendance, behavior and family-portal web app for a small Iowa
school. Firebase Auth + Cloud Firestore on the back end; served as a static
page from GitHub Pages.

## Editing the app

The interface lives in **`src/app.jsx`**. `index.html` holds the login screen,
the Firebase wiring, and a *compiled copy* of the app — so after any change:

```bash
npm install     # once
npm run build   # after every edit to src/app.jsx
```

Commit `index.html` together with `src/app.jsx`: GitHub Pages runs no build of
its own, so an un-rebuilt `index.html` keeps serving the previous version.
Never hand-edit the region between the `APP-CODE` markers in `index.html` —
the next build overwrites it.

## Documentation

- `DEPLOYMENT.md` — security rules, roles, account creation, data isolation,
  snapshots, MFA, Cloud Functions, and the build step in detail.
- `docs/DATA_PROTECTION_CHECKLIST.md` — what the app covers and what policy work remains.
- `docs/PRIVACY_NOTICE.md` — draft family privacy notice.
- `docs/FERPA_ANNUAL_NOTICE.md` — draft annual notice of rights.

## Layout

| Path | What it is |
| --- | --- |
| `src/app.jsx` | The app. Edit this. |
| `build.js` | Compiles the JSX into `index.html`. |
| `index.html` | The deployed page (generated app code + hand-written boot code). |
| `firestore.rules` | The entire access-control layer. Deploy it — see `DEPLOYMENT.md` §1. |
| `functions/` | Admin-only Cloud Functions for deleting Firebase Auth sign-ins. |
