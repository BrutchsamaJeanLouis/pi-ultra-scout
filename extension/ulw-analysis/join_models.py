#!/usr/bin/env python
"""Cross-tab ultrawork telemetry by agent model, joining ultrawork.log segments
to pi session JSONL files on start timestamp."""
import re, os, json, glob, collections
from datetime import datetime, timedelta

BASE = r"C:\Users\brutc\.pi\agent"
LOG = os.path.join(BASE, "extensions", "ultrawork.log")
SESS = os.path.join(BASE, "sessions")

def pts(s):  # parse ISO with ms
    return datetime.fromisoformat(s.replace("Z", ""))

# --- 1. session files: start ts, model timeline ---
sessions = {}  # start_dt -> (uuid, [(dt, model)])
for f in glob.glob(os.path.join(SESS, "*", "*.jsonl")):
    try:
        with open(f, encoding="utf-8", errors="replace") as fh:
            head = fh.readline()
            meta = json.loads(head)
            start = pts(meta["timestamp"])
            if start < datetime(2026, 8, 19):
                continue
            models = []
            cur = None
            for line in fh:
                if line.startswith('{"type":"model_change"'):
                    d = json.loads(line)
                    models.append((pts(d["timestamp"]), d["modelId"]))
                elif line.startswith('{"type":"message"'):
                    # stop after first user message to keep it fast? no—need full timeline; keep scanning but skip parsing
                    pass
                else:
                    continue
            if not models:
                continue
            # initial model = first model_change before first user msg approx; just use first
            sessions[round(start.timestamp())] = (meta["id"], models)
    except Exception:
        continue

def model_at(models, t):
    m = None
    for dt, mid in models:
        if dt <= t: m = mid
        else: break
    return m or (models[0][1] if models else "?")

# --- 2. ultrawork log segments ---
banner_re = re.compile(r'^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\] \[SESSION\] ═')
segs = []  # (start_dt, {counts})
cur = None
for line in open(LOG, encoding="utf-8", errors="replace"):
    m = banner_re.match(line)
    if m:
        cur = (pts(m.group(1)), {"ulw":0, "trips":0, "nudges":0, "claims":0, "agent_ends":0, "lib_calls":0})
        segs.append(cur)
        continue
    if cur is None: continue
    c = cur[1]
    if "[CMD] /ulw" in line and "ulw-" not in line: c["ulw"] += 1
    elif "LOOP GUARD TRIPPED" in line: c["trips"] += 1
    elif "NUDGE delivered" in line: c["nudges"] += 1
    elif "[TOOL] evidence_" in line or "[TOOL] research_loop" in line: c["claims"] += 1
    elif "agent_end fired" in line: c["agent_ends"] += 1
    elif "callLibrarian START" in line: c["lib_calls"] += 1

# --- 3. join on start timestamp (within 120s) ---
agg = collections.defaultdict(lambda: collections.defaultdict(int))
matched = unmatched = 0
for start, c in segs:
    best = None; bestd = timedelta(seconds=120)
    for s0 in sessions:
        d = abs(start.timestamp() - s0)
        if d < bestd.total_seconds(): bestd, best = timedelta(seconds=d), s0
    if best is None:
        unmatched += 1; continue
    matched += 1
    uuid, models = sessions[best]
    # use model at session start (events inherit; mid-session switches handled coarsely)
    mid = model_at(models, start + timedelta(seconds=60))
    a = agg[mid]
    for k, v in c.items(): a[k] += v
    a["sessions"] += 1

print(f"segments: {len(segs)}  matched: {matched}  unmatched: {unmatched}")
print(f"\n{'agent model':32} {'sess':>4} {'ulw':>4} {'ag_end':>7} {'trips':>6} {'trip%':>6} {'nudges':>7} {'claims':>7}")
for mid, a in sorted(agg.items(), key=lambda kv: -kv[1]["sessions"]):
    tp = 100*a["trips"]/a["agent_ends"] if a["agent_ends"] else 0
    print(f"{mid:32} {a['sessions']:>4} {a['ulw']:>4} {a['agent_ends']:>7} {a['trips']:>6} {tp:>5.1f}% {a['nudges']:>7} {a['claims']:>7}")

# era check: when did 4b sessions happen?
era = collections.defaultdict(set)
for s0, (uuid, models) in sessions.items():
    d = datetime.fromtimestamp(s0).strftime("%Y-%m-%d")
    era[models[0][1]].add(d)
print("\nmodel -> first/last active day:")
for m, days in sorted(era.items(), key=lambda kv: min(kv[1])):
    print(f"  {m}: {min(days)} .. {max(days)} ({len(days)} days)")
