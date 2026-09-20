#!/usr/bin/env python3
"""Aggregate scoreboard.json into per (model x condition) stats.

Model inferred from snap name: 'nemo' -> nemo-3b, '4b' -> 4b, else 27b.
Outputs JSON + a markdown table suitable for the paper.
"""
import json, os, re, sys
from collections import defaultdict

runs = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/experiments/runs"
rows = json.load(open(os.path.join(runs, "scoreboard.json"), encoding="utf-8"))

def model_of(snap):
    if "nemo" in snap: return "nemo-3b"
    if "-4b" in snap or snap.endswith("4b") or re.search(r"-4b-", snap): return "4b"
    return "27b"

groups = defaultdict(list)
for r in rows:
    if "error" in r: continue
    m = model_of(r["snap"])
    groups[(m, r["cond"])].append(r)

def _num(v):
    if isinstance(v, bool): return None
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str):
        try: return float(v)
        except ValueError: return None
    return None

def stat(rows, key):
    vals = [v for v in (_num(r.get(key)) for r in rows) if v is not None]
    return sum(vals) / len(vals) if vals else None

out = []
for (m, c) in sorted(groups):
    rs = groups[(m, c)]
    out.append({
        "model": m, "cond": c, "n": len(rs),
        "mean_fact_errors": round(stat(rs, "fact_errors"), 3),
        "fact_error_range": [min(r["fact_errors"] for r in rs), max(r["fact_errors"] for r in rs)],
        "mean_dur_s": round(stat(rs, "dur_s"), 0),
        "mean_deliverable_quality": round(stat(rs, "deliverable_quality"), 3),
        "dq_range": [min((r.get("deliverable_quality") or 0) for r in rs), max((r.get("deliverable_quality") or 0) for r in rs)],
        "vbc_rate": round(sum(1 for r in rs if r.get("verify_before_code", {}).get("verify_before_code")) / len(rs), 3),
        "evidence_rate": round(sum(1 for r in rs if r.get("evidence_artifacts", 0) > 0) / len(rs), 3),
        "tests_green_rate": round(sum(1 for r in rs if r.get("tests_green")) / len(rs), 3),
        "todo_rate": round(stat(rs, "todo_boxes") / 5, 3),
        "url_ok_rate": round(sum(1 for r in rs if r.get("url_ok")) / len(rs), 3),
        "cells": [r["snap"] for r in rs],
    })

json.dump(out, open(os.path.join(runs, "aggregate.json"), "w", encoding="utf-8"), indent=2)
print(f"{'model':10} {'cond':4} {'n':>2} {'errors(mean)':>13} {'range':>9} {'DQ(mean)':>9} {'dur(m)':>8} {'vbc':>5} {'ev':>5} {'tests':>6} {'todo':>5} {'url':>5}")
for o in out:
    rng = f"{o['fact_error_range'][0]}-{o['fact_error_range'][1]}"
    print(f"{o['model']:10} {o['cond']:4} {o['n']:>2} {o['mean_fact_errors']:>13.2f} {rng:>9} {o['mean_deliverable_quality']:>9.2f} {o['mean_dur_s']/60:>8.1f} {o['vbc_rate']:>5.2f} {o['evidence_rate']:>5.2f} {o['tests_green_rate']:>6.2f} {o['todo_rate']:>5.2f} {o['url_ok_rate']:>5.2f}")
