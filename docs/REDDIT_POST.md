# r/localLlama post draft

> Post URL: https://www.reddit.com/r/LocalLLaMA/
> Pick a **Title**, paste the **Body**. Suggested flair: "Project".

---

## Title (pick one)

**A)** my small local model kept making up API defaults. so i made it open a browser and check its own work

**B)** your 3B model still lying about API flags with full confidence? this free thing makes it fact-check itself

**C)** small local models are great and also confidently wrong. i built a fix

---

## Body

so small local models are honestly doing a lot, they're just... really confident. the kind of confident where they'll say "the default is 10" and "use the `--cache-type` flag" and "node's fetch doesn't support that" and sound *completely* sure while being wrong.

big models can get away with it. the 3B-7B stuff you actually run at home? you catch them every time. annoying.

so i built a free extension for [pi](https://www.npmjs.com/package/pi) coding agents that does one thing: when the model's about to state something it's likely to screw up (an exact number, a flag, a version, "this doesn't support that"), it doesn't just guess. it spins up a **second agent that opens a real browser, goes to the actual docs/repo/npm page, reads it, and hands back the answer with sources.**

> **verified** — default is 10
> sources: `index.d.ts` (`@default 10`), npm readme

no API keys. no cloud. your model stays local, the librarian just goes on a quick web check.

the part that actually got me: i ran the same task, same small model, with and without it.

- **without:** gave up halfway, no answer
- **with:** finished perfectly, cited the real docs

the smaller the model, the more it helps. big models kind of already do this in their heads, so they barely notice it.

### try it
```bash
pi install npm:pi-ultra-scout
```
then just use pi (or open a session and type `/ulw`). works with any provider pi can talk to, including a local llama.cpp router on `127.0.0.1`. if you don't know what pi is, it's basically a terminal coding agent that loads extensions — think a REPL but it's a coding agent.

### links
- repo + docs: https://github.com/BrutchsamaJeanLouis/pi-ultra-scout
- npm: https://www.npmjs.com/package/pi-ultra-scout
- the full writeup w/ charts (how much it lifts weak models): in the GitHub release

happy to help anyone get it running on their setup. what's everyone running it on?

---

## optional comments (post these yourself after you publish)

1. **"how's this different from just giving the model a web-search tool?"** — it is that, but it triggers automatically on the claims small models are most likely to botch, and it hands back *cited* evidence into the agent's loop instead of making the small model decide for itself whether to go look.

2. **"does it need internet?"** — yeah, the librarian has to browse (that's the whole point). your main model can still be 100% local.

3. **"which models?"** — any pi provider. i've tested it headless with a small hosted model and local llama.cpp routers. smaller = more benefit.
