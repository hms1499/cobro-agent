---
name: ship
description: Merge a finished plan branch into main, push, wait for the Vercel production deploy and smoke-check production. Use only when the user asks to ship or deploy.
disable-model-invocation: true
---

Ship the branch `$ARGUMENTS` (default: the current branch) to production. Stop and report at the first failure.

1. **Gate on the branch.** Run `npm test && npm run typecheck && npm run lint && npm run build`, keeping the full output in a file and reading its tail. `git status --short` must be clean apart from files the user knows about.
2. **Confirm with the user** before merging. Show the commit count (`git log --oneline main..<branch> | wc -l`) and whether `origin/main` moved (`git fetch && git log HEAD..origin/main`).
3. **Merge locally:** `git checkout main && git pull --ff-only && git merge --no-ff <branch>`. The message ends with the `Co-Authored-By` trailer. Run the full gate again on the merged result.
4. **Migrations.** If the branch adds files under `drizzle/`, they must reach the Neon **main** branch (production) as well as dev. `npm run db:migrate` only reaches dev through `.env.local`. Ask the user how to apply them to production before pushing.
5. **Push:** `git push origin main`, then delete the merged local branch with `git branch -d`.
6. **Wait for Vercel.** Poll `vercel ls cobro-agent` until the newest Production row is `Ready` (or `Error`).
7. **Smoke-check production** (`https://cobro-agent.vercel.app`):
   - `/` → 200, `/app` → 307 to `/signin`.
   - `/api/pay/nope?asset=USDT` → 404 (proves the DB is reachable).
   - `POST /api/cron/treasury` without a bearer → 401.
   - `gh workflow run treasury-cron.yml`, then `gh run watch <id> --exit-status`. The log shows `{"issued":N}` (proves `CRON_SECRET` matches between GitHub and Vercel).
8. **Report** the merge commit, the push range, the deployment URL and each probe result. If the plan has a ledger in `.superpowers/sdd/<plan>/progress.md`, append the outcome there.
