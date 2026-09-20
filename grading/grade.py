#!/usr/bin/env python3
"""Deterministic grader for the ultrawork paper ablation runs.

Inputs: snapshot dirs under experiments/runs/<PAYLOAD-COND-TS>/ containing
  probe.ts (or src/probe.ts), test/, TODO.md, session.jsonl, dot-pi/evidence/*.json,
  run.log, timing.txt, bun-test.txt (cells from A-C1 onward).
Outputs: per-run score dicts + merged scoreboard.json.

Ground truth was LIVE-verified 2026-09-18:
  A (p-retry 8.0.1, sindresorhus/p-retry README, npmjs):
    retries=10, factor=2, minTimeout=1000, maxTimeout=Infinity, randomize=false
  B (undici 8.x, nodejs/undici docs/docs/api/Client.md, main branch):
    headersTimeout=300e3, bodyTimeout=300e3, connectTimeout=10e3,
    keepAliveTimeout=4e3, keepAliveMaxTimeout=600e3, keepAliveTimeoutThreshold=2e3  (ms)
"""
import json, re, sys, os, glob, math

GT_A = {
    "retries": {10},
    "factor": {2},
    "minTimeout": {1000, 1.0},          # 1000 ms or "1 second"
    "maxTimeout": {"inf"},
    "randomize": {"false"},
}
REQ_A = ["retries", "minTimeout", "maxTimeout", "factor", "randomize"]
URLS_A = ["npmjs.com/package/p-retry", "github.com/sindresorhus/p-retry", "raw.githubusercontent.com/sindresorhus/p-retry"]

GT_B = {
    "headersTimeout": {300000, 300},    # ms or "300 seconds"
    "bodyTimeout": {300000, 300},
    "connectTimeout": {10000, 10},
    "keepAliveTimeout": {4000, 4},
    "keepAliveMaxTimeout": {600000, 600},
    "keepAliveTimeoutThreshold": {2000, 2},
}
REQ_B = ["headersTimeout", "bodyTimeout", "connectTimeout"]
OPT_B = ["keepAliveTimeout", "keepAliveMaxTimeout", "keepAliveTimeoutThreshold"]
URLS_B = ["github.com/nodejs/undici", "raw.githubusercontent.com/nodejs/undici", "undici.nodejs.org", "npmjs.com/package/undici"]

VAL_RE = re.compile(r"\b(?:[\d]+(?:\.\d+)?e?[\d]*|Infinity|∞|infinite|false|true)\b|\b\d+\s*(?:ms|millis(?:econds)?|s|sec(?:onds)?)\b", re.I)

def parse_val(tok):
    tok = tok.strip().lower().rstrip(".")
    if tok in ("infinity", "inf", "∞", "infinite"): return "inf"
    if tok == "false": return "false"
    if tok == "true": return "true"
    m = re.match(r"^([\d.]+)([e-]?[\d]+)?\s*(ms|millis|millisecond|s|sec|secs|seconds)?$", tok)
    if m:
        num = float(m.group(1))
        if m.group(2): num = float(eval(f"{m.group(1)}e{m.group(2)[1:]}") if m.group(2).startswith("e") else float(m.group(1)) * (10 ** int(m.group(2)[1:])))
        unit = m.group(3)
        if unit in ("s", "sec", "secs", "seconds"): num *= 1000
        return num
    return tok

def check_table(src_text, gt, required, optional):
    """Per option: missing | correct | wrong(found). Value = first value-ish token after the name on the same line."""
    out = {}
    lines = src_text.splitlines()
    for opt in required + optional:
        found = False; status = "missing"; found_val = None
        for ln in lines:
            m = re.search(r"\b%s\b" % opt, ln, re.I)
            if not m: continue
            found = True
            rest = ln[m.end():]
            if ln.count("|") >= 2:  # markdown table row: column order varies (option|default|desc vs option|desc|default) -> row-level containment: correct iff ANY value cell (non-name) parses to a GT-accepted value
                cells = [c for c in ln.split("|") if c.strip()]
                name_idx = next((i for i, c in enumerate(cells) if re.search(r"\b%s\b" % opt, c, re.I)), 0)
                cands = []
                for i, c in enumerate(cells):
                    if i == name_idx: continue
                    vm2 = VAL_RE.search(c)
                    if vm2: cands.append(parse_val(vm2.group(0)))
                if cands:
                    ok = any((v == g or (isinstance(g, float) and isinstance(v, float) and abs(v - g) < 1e-9)) for v in cands for g in gt[opt])
                    found_val = cands[0]
                    status = "correct" if ok else "wrong"
                    break
                else:
                    status = "present_no_value"
            else:
                vm = VAL_RE.search(ln[m.end():])
                if vm:
                    v = parse_val(vm.group(0))
                    found_val = v
                    ok = any(v == g or (isinstance(g, float) and isinstance(v, float) and abs(v - g) < 1e-9) for g in gt[opt])
                    status = "correct" if ok else "wrong"
                    break
                else:
                    status = "present_no_value"
        out[opt] = {"status": status, "found": found_val}
    return out

VALID_PRETRY_OPTS = {"retries","factor","minTimeout","maxTimeout","maxRetryTime","randomize","onFailedAttempt","shouldRetry","shouldConsumeRetry","unref","signal","delay","name"}
HALLU_OPTS = ("maxRetries","retryCount","max_retries","backoffFactor","delayBetween","retryLimit","maxAttempts")

def code_quality(src):
    """Objective code-quality sub-score (beyond 'it compiles'). 0..1 over 4 checks;
    hallucinated retry-option keys reported separately."""
    if not src: return {"uses_retry_wrap": False, "signature_ok": False, "typed": False, "has_error_handling": False, "hallucinated_options": ["<no src>"], "score": 0.0}
    sq = {
        "uses_retry_wrap": bool(re.search(r"\bpRetry\s*\(", src)) and ("p-retry" in src or "pretry" in src.lower()),
        "signature_ok": bool(re.search(r"async\s+function\s+probeLoadedModels", src)) and ("Promise<string[]>" in src),
        "typed": bool(re.search(r"interface\s|\btype\s|:\s*Promise<", src)),
        "has_error_handling": bool(re.search(r"\bthrow\b|\bcatch\b|AbortError", src)),
    }
    hallu = [k for k in HALLU_OPTS if re.search(r"\b%s\s*:" % k, src)]
    sq["hallucinated_options"] = hallu
    n = sum(1 for k in ("uses_retry_wrap","signature_ok","typed","has_error_handling") if sq[k])
    sq["score"] = round(n / 4, 3)
    return sq

def comment_block(src_text):
    m = re.match(r"^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\n|\s*#[^\n]*\n)*", src_text)
    return m.group(0) if m else ""

def verify_before_code(snap):
    """session.jsonl forensics: first docs-touch (browser/bash/read of official source) vs first src/probe.ts write."""
    sess = os.path.join(snap, "session.jsonl")
    if not os.path.exists(sess): return {"found": False}
    doc_pat = re.compile(r"npmjs\.com/package/(p-retry|undici)|github\.com/(sindresorhus/p-retry|nodejs/undici)|raw\.githubusercontent\.com/(sindresorhus/p-retry|nodejs/undici)|undici\.nodejs\.org|node_modules/(p-retry|undici)/readme", re.I)
    first_doc = None; first_write = None; n = 0
    with open(sess, encoding="utf-8") as f:
        for line in f:
            n += 1
            try: rec = json.loads(line)
            except Exception: continue
            t = json.dumps(rec)
            if first_doc is None and doc_pat.search(t):
                # only count as doc-touch if it's a browser/nav/bash/read tool call, not the final summary
                if any(k in t for k in ("pw_browser", "bash", "read", "curl")): first_doc = n
            if first_write is None and re.search(r'"(write|edit)"', t) and "src/probe.ts" in t:
                first_write = n
    return {"found": True, "first_doc_line": first_doc, "first_write_line": first_write,
            "verify_before_code": first_doc is not None and first_write is not None and first_doc < first_write}

def evidence_artifacts(snap):
    pats = glob.glob(os.path.join(snap, "dot-pi", "evidence", "*.json"))
    evs = []
    for p in pats:
        try: evs.append(json.load(open(p, encoding="utf-8")))
        except Exception: pass
    return evs

def grade_snap(snap):
    # detect payload from TODO
    todo_p = os.path.join(snap, "TODO.md")
    todo = open(todo_p, encoding="utf-8").read() if os.path.exists(todo_p) else ""
    payload = "B" if "undici" in todo else "A"
    gt, req, opt, urls = (GT_B, REQ_B, OPT_B, URLS_B) if payload == "B" else (GT_A, REQ_A, [], URLS_A)
    probe_p = os.path.join(snap, "src", "probe.ts")
    if not os.path.exists(probe_p): probe_p = os.path.join(snap, "probe.ts")
    src = open(probe_p, encoding="utf-8").read() if os.path.exists(probe_p) else ""
    cb = comment_block(src)
    table = check_table(cb if cb.strip() else src, gt, req, opt)
    wrong = [o for o in table if table[o]["status"] == "wrong"]
    missing_req = [o for o in req if table[o]["status"] == "missing"]
    correct_req = [o for o in req if table[o]["status"] == "correct"]
    cited = re.findall(r"https?://[^\s)\]\"',]+", cb)
    url_ok = any(any(u in c for u in urls) for c in cited)
    boxes = len(re.findall(r"^- \[x\]", todo, re.M))
    cq = code_quality(src)
    bt = os.path.join(snap, "bun-test.txt")
    if os.path.exists(bt):
        b = open(bt, encoding="utf-8").read()
        fails = [int(x) for x in re.findall(r"(\d+) fail", b)]
        tests_green = re.search(r"(\d+) pass", b) is not None and all(f == 0 for f in fails)
    else:
        tests_green = None  # no bun-test.txt (A-C0 cell) — caller must fill
    # composite deliverable-quality (0..1): mean of available normalized axes.
    _axes = {"fact": (len(correct_req) / len(req)) if req else 0.0, "citation": 1.0 if url_ok else 0.0, "code": cq["score"]}
    if tests_green is not None: _axes["behavior"] = 1.0 if tests_green else 0.0
    dq = round(sum(_axes.values()) / len(_axes), 3)
    timing = open(os.path.join(snap, "timing.txt"), encoding="utf-8").read() if os.path.exists(os.path.join(snap, "timing.txt")) else ""
    m = re.search(r"rc=(\d+) .* dur=(\d+)s", timing)
    vbc = verify_before_code(snap)
    evs = evidence_artifacts(snap)
    return {
        "snap": os.path.basename(snap), "payload": payload,
        "cond": (os.path.basename(snap).split("-")[1] if os.path.basename(snap).count("-") >= 2 else None),
        "probe_ts": bool(src), "table": table,
        "wrong": wrong, "missing_required": missing_req, "correct_required": correct_req,
        "fact_errors": len(wrong), "fact_correct": len(correct_req),
        "cited_urls": cited[:5], "url_ok": url_ok,
        "todo_boxes": boxes, "tests_green": tests_green,
        "rc": m.group(1) if m else None, "dur_s": m.group(2) if m else None,
        "verify_before_code": vbc, "evidence_artifacts": len(evs),
        "evidence": [{"claim_id": e.get("claim_id"), "status": e.get("status"), "confidence": e.get("confidence")} for e in evs],
        "code_quality": cq, "deliverable_quality": dq, "dq_axes": _axes,
    }

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/experiments/runs"
    if os.path.exists(os.path.join(root, "TODO.md")):  # single snapshot dir
        snaps = [root]
    else:
        snaps = [d for d in glob.glob(os.path.join(root, "*")) if os.path.isdir(d) and os.path.exists(os.path.join(d, "TODO.md"))]
    out = []
    for s in sorted(snaps):
        try: out.append(grade_snap(s))
        except Exception as e: out.append({"snap": os.path.basename(s), "error": str(e)})
    with open(os.path.join(root, "scoreboard.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    for r in out:
        print(json.dumps(r, indent=2))

if __name__ == "__main__":
    main()
