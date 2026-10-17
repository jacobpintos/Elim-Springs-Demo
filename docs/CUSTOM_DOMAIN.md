# Putting the gradebook on your own web address

A step-by-step runbook for moving the site from
`jacobpintos.github.io/Elim-Springs-Demo` to an address the school owns, such as
`gradebook.theirschool.org`.

**Nobody doing this needs to understand DNS.** Every step says who does it, what
they need, and exactly what to type.

| | Who | Roughly |
| --- | --- | --- |
| Phase 0 | Client | Find out who controls the domain |
| Phase 1 | You → Client | Add one DNS record |
| Phase 2 | You | Tell GitHub the new address |
| Phase 3 | You | Turn on HTTPS |
| Phase 4 | You | Let Firebase accept the new address |
| Phase 5 | Both | Check it works |

Total hands-on time is about 30 minutes. Most of the elapsed time is waiting for
step 1 to take effect, which can be anywhere from 10 minutes to a few hours.

**Fill these in before you start:**

| | Value |
| --- | --- |
| The address you want | `gradebook.` ⬜ |
| GitHub account hosting the site | `jacobpintos` (change if the repo moves) |
| What DNS must point to | `jacobpintos.github.io` |

> **Pick a subdomain, not the bare domain.** `gradebook.theirschool.org`, not
> `theirschool.org`. It is one record instead of four, it cannot break the
> school's existing website or email, and every DNS provider supports it. If the
> bare domain is genuinely required, see Appendix B — but try not to.

---

## Phase 0 — Find out who controls the domain *(client)*

Neither of you can do anything until you know where the domain's settings live.
It is one of these, in order of likelihood:

1. **A domain registrar** the client bought it from — GoDaddy, Namecheap,
   Squarespace, Google Domains, Bluehost, Hover.
2. **The company that built the school website** — very common. They often hold
   the domain and never mention it.
3. **Cloudflare**, sitting in front of the registrar.

**How the client can find out, easiest first:**

- **Search their email** for "domain", "renewal", "DNS" or the domain name
  itself. Registrars send renewal notices every year. The sender tells you who it is.
- **Ask whoever maintains the school website.** If an agency or a volunteer
  built it, they almost certainly know, and may hold the login.
- **Look it up.** Go to `https://who.is` (or any WHOIS lookup), type the domain,
  and read the **Registrar** and **Name Servers** lines. If the name servers say
  something like `ns1.cloudflare.com`, the DNS is managed at Cloudflare even if
  the domain was bought elsewhere.

**What you need out of Phase 0:**

- The name of the service where DNS is managed.
- Someone who can sign in to it — the client, or whoever they delegate to.

If a web company holds it, that is fine. Phase 1's email is written to be
forwarded straight to them.

---

## Phase 1 — Add one DNS record *(you write, client sends/does)*

### What a DNS record is, in one sentence

It is a line in a lookup table that says "when someone types this address, send
them to this server." You are adding one line. It does not touch the website,
the email, or anything else on the domain.

### The email to send

Copy this, fill in the two blanks, and send it to the client — or ask the client
to forward it to whoever manages their DNS.

> **Subject: One DNS record to add for the gradebook site**
>
> Could you add a single DNS record for ⬜`theirschool.org`?
>
> | Field | Value |
> | --- | --- |
> | Type | `CNAME` |
> | Name / Host | `gradebook` |
> | Value / Points to / Target | `jacobpintos.github.io` |
> | TTL | leave default |
> | Proxy (Cloudflare only) | **OFF** — "DNS only", grey cloud, not orange |
>
> This adds a new address, `gradebook.`⬜`theirschool.org`. It will not affect
> the main website or email.
>
> Two things to check while you are in there:
>
> 1. That nothing already exists at the name `gradebook`.
> 2. Whether the domain has **CAA records**. If it does, `letsencrypt.org` needs
>    to be allowed, otherwise the new address cannot get an HTTPS certificate.
>
> Could you let me know once it is saved? Thanks.

### If the client is doing it themselves and is stuck

Tell them to sign in to the registrar and look for a menu item called **DNS**,
**DNS Management**, **Manage DNS**, **Advanced DNS**, **DNS Records**, or
**Zone Editor**. All of them mean the same thing. Then **Add record**.

The fields are named differently everywhere but always mean the same thing:

| What we call it | Also called |
| --- | --- |
| Type | Record type |
| Name | Host, Hostname, Subdomain, Label |
| Value | Points to, Target, Content, Destination, Data |

Enter just `gradebook` in the Name field — **not** the full
`gradebook.theirschool.org`. Nearly every provider adds the domain part for you.
If it ends up as `gradebook.theirschool.org.theirschool.org`, that is what went
wrong.

### Provider-specific traps

- **Cloudflare:** the record must be **DNS only** (grey cloud). If the cloud is
  orange, click it to turn it grey. An orange cloud stops GitHub from issuing
  the HTTPS certificate.
- **GoDaddy:** uses "Points to" for the value. Fine for a subdomain.
- **Squarespace / former Google Domains:** DNS is under
  **Settings → Domains → DNS Settings → Custom records**.
- **Namecheap:** **Advanced DNS → Host Records**, type "CNAME Record".

### How to check it worked, without bothering the client

Wait 15 minutes after they confirm, then go to
`https://dnschecker.org`, choose **CNAME** from the dropdown, type
`gradebook.theirschool.org`, and search. Green ticks showing
`jacobpintos.github.io` mean it is live.

*(If you are comfortable in a terminal: `nslookup -type=CNAME gradebook.theirschool.org`)*

Nothing in Phase 2 will work until this check passes. It is normal for it to
take a few hours.

---

## Phase 2 — Tell GitHub the new address *(you)*

1. Go to the repository on GitHub.
2. **Settings** (top row of tabs) → **Pages** (left sidebar).
3. Under **Custom domain**, type the full address:
   `gradebook.theirschool.org`
4. Click **Save**.

GitHub will show **"DNS check in progress"** with a yellow or red notice. That
is expected. It re-checks automatically; it can take up to an hour.

**What just happened:** GitHub added a file called `CNAME` to the repository
containing that address. Leave it there. If it is ever deleted, the custom
address stops working.

> If GitHub says the domain is already taken or in use elsewhere, something else
> is already pointing at `gradebook` — go back to Phase 1 and have the old record
> removed.

---

## Phase 3 — Turn on HTTPS *(you)*

HTTPS is the padlock in the address bar. Without it, browsers mark the site "Not
Secure" — unacceptable for student records.

1. Stay on **Settings → Pages**.
2. Wait until the **Enforce HTTPS** checkbox is no longer greyed out. GitHub
   gets a certificate automatically once DNS resolves — usually under an hour,
   occasionally up to 24.
3. Tick it.

**If it stays greyed out for more than a day,** the usual cause is one of:

- The Cloudflare proxy is still on (orange cloud) → Phase 1.
- CAA records block Let's Encrypt → ask the client to allow `letsencrypt.org`.
- DNS has not finished propagating → re-check at dnschecker.org.

---

## Phase 4 — Let Firebase accept the new address *(you)*

**Do not skip this.** The site will load perfectly without it, and then every
single sign-in will fail with a confusing error.

Firebase refuses sign-ins from any web address it has not been told about.

1. Go to `https://console.firebase.google.com`
2. Open the project **elim-school-2abae**.
3. Left sidebar → **Authentication** → **Settings** tab → **Authorized domains**.
4. **Add domain** → type `gradebook.theirschool.org` → **Add**.

That is it. It takes effect immediately.

> The existing entries (`localhost`, `elim-school-2abae.firebaseapp.com`) stay.
> Do not remove them.

---

## Phase 5 — Check it works *(you, then client)*

In order:

| # | Check | If it fails |
| --- | --- | --- |
| 1 | `https://gradebook.theirschool.org` loads the sign-in page | Phase 1 or 2 |
| 2 | There is a padlock, not "Not Secure" | Phase 3 |
| 3 | A **teacher** can sign in | Phase 4 |
| 4 | A **parent** can sign in and sees only their own children | Unrelated — tell me |
| 5 | The old `jacobpintos.github.io/...` address redirects to the new one | Normal, no action |

Then have the client load it on their own phone, on mobile data rather than
school wifi — that catches DNS being cached on the school network.

**Only tell families the new address once checks 1–4 pass.**

---

## Appendix A — Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Site not found" / GitHub 404 | DNS not propagated, or `CNAME` file missing | Wait; check dnschecker.org; confirm the repo has a `CNAME` file |
| "Not Secure" warning | HTTPS not enforced | Phase 3 |
| Sign-in fails, `auth/unauthorized-domain` | Firebase does not know the address | Phase 4 |
| Certificate never issues | Cloudflare proxy on, or CAA records | Phase 1 traps |
| Record created but address goes to the school's main site | Name field had the full domain typed in | Phase 1, "just `gradebook`" |
| Works for you, not for the school | Their network cached old DNS | Wait, or test on mobile data |

## Appendix B — Using the bare domain instead

Only if the school genuinely wants the gradebook at `theirschool.org` itself —
which means it replaces their current website.

Instead of one CNAME, four A records:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Verify these against GitHub's current Pages documentation before sending them —
GitHub has changed these addresses before, and a stale list fails silently.

Everything else in the runbook is unchanged.

## Appendix C — Who ends up controlling what

Once this is done, **the client controls the web address.** If the DNS record is
removed, the site becomes unreachable at that address regardless of who owns the
code or the data.

That is normal and appropriate — it is their domain. But it is worth both of you
knowing it before families start using the address. See `docs/HANDOVER.md` for
the wider ownership picture.
