#!/usr/bin/env python3
"""Render paper figures from experiments/runs/scoreboard.json."""
import json, os, re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SB = os.path.join(ROOT, "experiments", "runs", "scoreboard.json")
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

def load():
    return json.load(open(SB, encoding="utf-8"))

def model_of(snap):
    if "nemo" in snap: return "nemo-3b"
    if "-4b-" in snap or snap.endswith("-4b") or re.search(r"-4b-", snap): return "4b-local"
    return "27b"

def cond_of(snap):
    # format: P-COND-... or P-COND-tag-...
    parts = os.path.basename(snap).split("-")
    if len(parts) >= 2:
        c = parts[1]
        if c in ("C0", "C1", "C2"): return c
    return None

def payload_of(snap):
    parts = os.path.basename(snap).split("-")
    return parts[0] if parts else "?"

def main():
    rows = [r for r in load() if "error" not in r]
    print(f"scoreboard rows (valid): {len(rows)}")

    # Group by (model, condition) for the main comparison chart
    groups = {}
    for r in rows:
        m = model_of(r["snap"])
        c = cond_of(r["snap"])
        if not c: continue
        key = (m, c)
        groups.setdefault(key, []).append(r)

    # Model order for the chart (weakest to strongest)
    model_order = ["4b-local", "nemo-3b", "27b"]
    model_label = {"4b-local": "4B local\n(qwen3.5-4b)", "nemo-3b": "3B active\n(nemotron-3.5)", "27b": "27B\n(qwen3.8-27b)"}
    cond_order = ["C0", "C2"]  # WITHOUT vs WITH
    cond_label = {"C0": "WITHOUT\nulw", "C2": "WITH\nulw"}
    colors = {"C0": "#c0392b", "C2": "#27ae60"}

    # FIG 1: Main comparison — DQ by model × condition
    fig, ax = plt.subplots(figsize=(6.5, 3.8), dpi=200)
    x_positions = []
    labels = []
    x = 0
    for mi, m in enumerate(model_order):
        for ci, c in enumerate(cond_order):
            rs = groups.get((m, c), [])
            if not rs: continue
            dq_vals = [r.get("deliverable_quality", 0) for r in rs]
            mean_dq = sum(dq_vals) / len(dq_vals)
            # Bar
            bar = ax.bar(x, mean_dq, color=colors[c], width=0.6, edgecolor="white", linewidth=0.5)
            # Whiskers (min/max)
            mn, mx = min(dq_vals), max(dq_vals)
            ax.plot([x, x], [mn, mx], color="#333", linewidth=1.2)
            ax.plot([x-0.08, x+0.08], [mn, mn], color="#333", linewidth=1)
            ax.plot([x-0.08, x+0.08], [mx, mx], color="#333", linewidth=1)
            # n label
            ax.text(x, mean_dq + 0.03, f"n={len(rs)}", ha="center", fontsize=7.5)
            # Mean value on bar
            ax.text(x, mean_dq / 2, f"{mean_dq:.2f}", ha="center", fontsize=9, fontweight="bold", color="white")
            x_positions.append(x)
            labels.append(f"{model_label[m]}\n{cond_label[c]}")
            x += 0.8
        x += 0.6  # gap between model groups

    ax.set_xticks(x_positions)
    ax.set_xticklabels(labels, fontsize=7.5)
    ax.set_ylabel("Deliverable Quality (DQ, 0–1)", fontsize=9)
    ax.set_ylim(0, 1.15)
    ax.set_title("WITH-ulw vs WITHOUT-ulw: Deliverable Quality by Model Strength", fontsize=10, fontweight="bold")
    for s in ("top", "right"): ax.spines[s].set_visible(False)
    # Legend
    from matplotlib.patches import Patch
    ax.legend([Patch(facecolor=colors["C0"]), Patch(facecolor=colors["C2"])],
              ["WITHOUT ulw (C0)", "WITH ulw (C2)"], loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig_main_comparison.png"))
    plt.close(fig)

    # FIG 2: Fact errors (27B ablation, original)
    cond_order_all = ["C0", "C1", "C2"]
    cond_label_all = {"C0": "C0\n(no mech)", "C1": "C1\n(prompt)", "C2": "C2\n(full)"}
    col_all = {"C0": "#8a8a8a", "C1": "#4a90d9", "C2": "#2e7d32"}
    fig, ax = plt.subplots(figsize=(4.6, 3.2), dpi=200)
    vals, ns = [], []
    for c in cond_order_all:
        rs = groups.get(("27b", c), [])
        es = [max(0, r["fact_errors"] + len(r.get("missing_required", []))) for r in rs]
        vals.append(sum(es) / len(es) if es else 0)
        ns.append(len(es))
    ax.bar(cond_order_all, vals, color=[col_all[c] for c in cond_order_all], width=0.55)
    ax.set_ylabel("wrong/missing defaults per run")
    ax.set_ylim(0, max([1] + vals) + 0.6)
    for i, c in enumerate(cond_order_all):
        ax.text(i, vals[i] + 0.08, f"n={ns[i]}", ha="center", fontsize=8)
    ax.set_title("27B grid: Fact errors in defaults table", fontsize=9)
    ax.tick_params(labelsize=8)
    for s in ("top", "right"): ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig2_fact_errors.png"))
    plt.close(fig)

    # FIG 3: VBC + time (27B grid)
    vbc, tt, ns = [], [], []
    for c in cond_order_all:
        rs = groups.get(("27b", c), [])
        v = [r["verify_before_code"].get("verify_before_code") for r in rs if r["verify_before_code"].get("found")]
        vbc.append(100.0 * sum(1 for x in v if x) / len(v) if v else 0)
        t = sorted(int(r["dur_s"]) for r in rs if r.get("dur_s"))
        tt.append(t[len(t)//2] if t else 0)
        ns.append(len(rs))
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.4, 3.0), dpi=200)
    a1.bar(cond_order_all, vbc, color=[col_all[c] for c in cond_order_all], width=0.55)
    a1.set_ylim(0, 110); a1.set_ylabel("% of runs")
    a1.set_title("27B: verified docs BEFORE code", fontsize=8.5)
    for i, c in enumerate(cond_order_all):
        a1.text(i, vbc[i] + 3, f"{vbc[i]:.0f}%  (n={ns[i]})", ha="center", fontsize=8)
    a2.bar(cond_order_all, [x / 60 for x in tt], color=[col_all[c] for c in cond_order_all], width=0.55)
    a2.set_ylabel("minutes")
    a2.set_title("27B: median wall time per run", fontsize=8.5)
    for i, c in enumerate(cond_order_all):
        a2.text(i, tt[i] / 60 + 1, f"{tt[i]//60}m  (n={ns[i]})", ha="center", fontsize=8)
    for a in (a1, a2):
        a.tick_params(labelsize=8)
        for s in ("top", "right"): a.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig3_vbc_time.png"))
    plt.close(fig)

    print("wrote:", os.listdir(OUT))

if __name__ == "__main__":
    main()