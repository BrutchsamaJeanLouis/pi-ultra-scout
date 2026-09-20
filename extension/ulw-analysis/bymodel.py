#!/usr/bin/env python
# Cross-tab ultrawork rates by session start-model
import re, collections

LOG = r"C:\Users\brutc\.pi\agent\extensions\ultrawork.log"
sess = {}          # sid -> dict
order = []
cur = None
pat_session = re.compile(r'^(\S+) \[SESSION_START\] (\S+) model=([\w.\-]+)')
pat_ulw = re.compile(r'^(\S+) \[CMD\] /ulw(?!-)')
pat_guard = re.compile(r'^(\S+) \[COMPACT\] .*LOOP GUARD TRIPPED')
pat_guard_done = re.compile(r'^(\S+) \[COMPACT\] .*loop guard: TODO.md shows all items \[x\]')
pat_nudge = re.compile(r'^(\S+) \[LIB\] NUDGE delivered')
pat_skip = re.compile(r'^(\S+) \[LIB\] callLibrarian SKIPPED')
pat_claims = re.compile(r'^(\S+) \[TOOL\] (evidence_register|evidence_add|evidence_check|research_loop)')

for line in open(LOG, encoding="utf-8", errors="replace"):
    m = pat_session.match(line)
    if m:
        ts, sid, model = m.groups()
        cur = sid
        if sid not in sess:
            sess[sid] = {"model": model, "ulw": 0, "trip": 0, "tripdone": 0,
                         "nudge": 0, "skip": 0, "claims": 0, "agent_end": 0}
            order.append(sid)
        continue
    if not cur or cur not in sess:
        continue
    s = sess[cur]
    if cur != sid:
        sid = cur
    if pat_ulw.match(line):
        s["ulw"] += 1
    if pat_guard_done.match(line):
        s["tripdone"] += 1
    elif pat_guard.match(line):
        s["trip"] += 1
    if "agent_end fired" in line:
        s["agent_end"] += 1
    if pat_nudge.match(line):
        s["nudge"] += 1
    elif pat_skip.match(line):
        s["skip"] += 1
    cm = pat_claims.match(line)
    if cm:
        s["claims"] += 1

# aggregate by model
agg = collections.defaultdict(lambda: collections.defaultdict(int))
for sid, s in sess.items():
    m = s["model"]
    agg[m]["sessions"] += 1
    for k in ("ulw", "trip", "tripdone", "nudge", "skip", "claims", "agent_end"):
        agg[m][k] += s[k]

print(f"total sessions: {len(sess)}")
print(f"{'model':28} {'sess':>5} {'ulw':>5} {'agent_end':>10} {'trips':>6} {'trip%':>6} {'nudges':>7} {'claims':>7}")
for m, a in sorted(agg.items(), key=lambda kv: -kv[1]["sessions"]):
    trip_pct = 100*a["trip"]/a["agent_end"] if a["agent_end"] else 0
    print(f"{m:28} {a['sessions']:>5} {a['ulw']:>5} {a['agent_end']:>10} {a['trip']:>6} {trip_pct:>5.1f}% {a['nudge']:>7} {a['claims']:>7}")

# date span per model
span = collections.defaultdict(lambda: [None, None])
for line in open(LOG, encoding="utf-8", errors="replace"):
    m = pat_session.match(line)
    if m:
        ts, sid, model = m.groups()
        d = ts[:10]
        if span[model][0] is None or d < span[model][0]:
            span[model][0] = d
        if span[model][1] is None or d > span[model][1]:
            span[model][1] = d
print("\nmodel date spans:")
for m, (a, b) in span.items():
    print(f"  {m}: {a} .. {b}")
