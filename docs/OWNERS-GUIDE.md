# BUFC Performance Hub — Owner's Guide

A plain-English manual for how the whole thing fits together, written for Scott.
Keep this handy — it explains every service you're paying for or signed up to,
what it does, and what to do when things go wrong.

Last updated: 28 July 2026

---

## 1. The big picture

Your app lives in **three places**, each with a job:

| Place | What it is | Address |
|---|---|---|
| **Replit** | The workshop. This is where the app gets built and changed, with its own private test copy of the site. | replit.com (your account) |
| **GitHub** | The filing cabinet. Every version of the app's code is stored here. Replit pushes finished work to GitHub. | github.com/Snorkcity/Soccer_Hub |
| **Railway** | The shop front. Runs the **live site** your coaches use. It watches GitHub and redeploys itself when new code arrives. | app.gameinsights.com.au |

The flow is always: **change it on Replit → push to GitHub → Railway deploys it live** (takes a few minutes).

**Dev vs Prod — the golden rule:**
- The Replit preview is **dev**: a sandbox with test data. Break anything you like here.
- app.gameinsights.com.au is **prod** (production): the real thing, real data, real users.
- They have **separate databases and separate user accounts**. Changing a password or entering data in one does not affect the other. Your login email is the same in both (scott@gameinsights.com.au) but they are two different accounts under the hood.

---

## 2. The databases (where all the data lives)

There are **two PostgreSQL databases**, both hosted on Railway:

- **Postgres-Dev** — the test database the Replit workshop uses.
- **Postgres-Prod** — the real database behind the live site.

What's in them: seasons, matches, goals, player stats, the full league tables,
GPS sessions, athletic testing, session plans, the practice library, reflections,
match prep reports, user accounts — everything.

Things worth knowing:
- The app **updates its own database structure** when it starts up (called "migrations"). So when Railway deploys new code, any new tables it needs get created automatically — you never have to touch the database directly.
- Data you enter on the live site (Data Entry page) goes straight into Postgres-Prod.
- Dev data gets loaded from spreadsheets/CSVs by the agent during building, so it can drift out of date compared to prod. That's normal.

---

## 3. Resend (the email service)

**What it's for:** the app can't send emails on its own. Resend is the post
office — the app hands it an email ("send this reset link to this address")
and Resend delivers it.

**When emails get sent:**
- Someone clicks **"Forgot password?"** on the sign-in page → they get a reset link (works once, expires in 1 hour).
- You create a user **without typing a starting password** → they get a welcome invite with a "Set your password" button (works once, expires in 7 days).
- You click the **mail icon** next to a user on the Users page → fresh set-password link (cancels any older links).

**How it's set up:**
- Account: resend.com, signed up with scott.conlon10@gmail.com. Free tier: 3,000 emails/month — you'll never get near it.
- Your domain **gameinsights.com.au is verified** there (we added DNS records — MX, two TXTs, and DMARC — in July 2026). That's what lets emails come from **noreply@gameinsights.com.au** and land in inboxes rather than spam.
- **Two API keys** (think of them as passwords the app uses to talk to Resend):
  - *Devenvironment_CoachHub* — stored in Replit's secrets, used by the workshop.
  - *Prod_CoachHub* — stored in Railway's variables (named `RESEND_API_KEY`), used by the live site.
- Keys are shown only once when created. If one is ever lost or leaked: create a new key in Resend, put it in the right place (Replit secret or Railway variable), delete the old key. The other environment keeps working throughout.

**If emails stop arriving:** check resend.com → the domain still says "Verified", and check the "Emails" tab there — it shows every email sent and whether it was delivered.

---

## 4. OpenAI (the AI features)

The app uses OpenAI's AI in a few places:

- **Coach Assistant** — the chat that answers questions from your 14 curriculum documents.
- **Data Entry screenshot reader** — reads match screenshots and pre-fills the stats.
- **Reflection voice interviews** — the talking interview feature.

**How it's paid for:** via your OpenAI API key (`OPENAI_API_KEY`), stored in
Replit secrets and Railway variables. This is pay-as-you-go on your OpenAI
account (platform.openai.com) — separate from any ChatGPT subscription. Usage
for a club this size is typically small, but you can see spend at
platform.openai.com under Billing.

---

## 5. Users, permissions and accounts

**Who can do what:**
- **You (superadmin)** — see and manage everything, including the Users page. Your account: scott@gameinsights.com.au.
- **Everyone else** — sees only what you tick for them, per team/league.

**The six tickable pages** (per league): Season Stats, GPS Insights, Testing,
Match Prep, Reflections, Data Entry. A tick = they can view *and* edit that
page for that league. **Always available to any signed-in user:** Hub home,
Coach Assistant, Session Planner, Session Library, My Account.

**Creating someone's account (the easy way):**
1. Users page → **New user**
2. Name + their real email (important — that's where their invite and any password resets go)
3. Leave the password box **blank**
4. Tick the pages they should see for each team → Save
5. They get an email with a "Set your password" button — done. Send them app.gameinsights.com.au if they lose the link.

**Housekeeping you can do any time:**
- Change someone's ticks: Users page → pencil icon.
- Someone locked out: mail icon next to their name → they get a fresh set-password email. (Or they can use "Forgot password?" themselves.)
- Remove someone: bin icon. Their account is gone immediately.
- Everyone manages their own name/email/password on **My Account** (bottom of the sidebar).

**Test accounts:** your domain has a catch-all — email to *anything*@gameinsights.com.au
lands in hello@gameinsights.com.au. So you can invent test addresses on the spot
(e.g. luketest@gameinsights.com.au) and still receive their emails.

---

## 6. Replit (the workshop)

This is where you talk to the agent and changes get made.

- The **preview pane** shows the dev version of the app (test data).
- **Secrets** (Replit's locked cupboard) hold the dev API keys: Resend, OpenAI, the dev database address, your admin password. Neither you nor the agent can read a secret's value back out once saved — you can only replace it.
- Replit also keeps **checkpoints** — snapshots of the project as work happens, so changes can be rolled back if something goes wrong.
- When a piece of work is finished and tested, the agent **commits and pushes it to GitHub**, which triggers the Railway deploy.

---

## 7. Railway (the live site)

- The **Soccer_Hub** service runs the app at app.gameinsights.com.au. The two Postgres boxes next to it are the databases (section 2).
- **Variables** (Railway's version of secrets) hold the live keys: `RESEND_API_KEY`, `OPENAI_API_KEY`, the prod database address, and `NODE_ENV=production`.
- **Deploys:** Railway redeploys automatically when new code lands on GitHub. You can watch progress (and see a green tick when done) in the service's Deployments tab. A deploy takes a few minutes; the site stays up during it.
- **If the live site misbehaves:** Railway's Deployments tab shows the logs — that's the first place to look (or just ask the agent to investigate).

---

## 8. Quick "how do I…" reference

| I want to… | Do this |
|---|---|
| Add a coach | Users page → New user → leave password blank → tick their pages → Save |
| Coach forgot their password | They click "Forgot password?" on the sign-in page — no need to involve you |
| Re-send someone's invite | Users page → mail icon on their row |
| Change what someone can see | Users page → pencil icon → tick/untick → Save |
| Change my own password | My Account (bottom of sidebar) |
| Enter match data | Data Entry page on the **live site** (so it's in the real database) |
| Check if an email went out | resend.com → Emails tab |
| See if a deploy finished | Railway → Soccer_Hub → Deployments |
| Get something changed/built | Ask the agent in Replit; it goes live after push + deploy |

---

## 9. The accounts you own (for your records)

| Service | Login | What it costs |
|---|---|---|
| Replit | your Replit account | your Replit plan |
| GitHub | Snorkcity | free |
| Railway | your Railway account | usage-based hosting (app + 2 databases) |
| Resend | scott.conlon10@gmail.com | free tier |
| OpenAI | your OpenAI account | pay-as-you-go API usage |
| Domain (gameinsights.com.au) | your domain registrar | annual renewal — also where the DNS records and the catch-all email live |
