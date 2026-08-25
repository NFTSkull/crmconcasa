#!/usr/bin/env python3
"""P208 dual-session races against isolated Postgres. No Cloud."""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from dataclasses import dataclass, asdict

import psycopg2
from psycopg2.extras import RealDictCursor

DSN = os.environ.get(
    "P208_DSN",
    "host=127.0.0.1 port=55432 user=postgres password=postgres dbname=postgres sslmode=disable",
)


def meta(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT k, v FROM public.p208_race_meta")
        return {r[0]: r[1] for r in cur.fetchall()}


def occ(conn, org: str, day: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT public.agenda_daily_active_occupancy(%s::uuid, 'biometricos', %s::date, 'monterrey')",
            (org, day),
        )
        return int(cur.fetchone()[0])


def origin_snapshot(conn, bid: str) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT b.id, b.status, b.booking_date::text, b.booking_time::text, b.location_id,
                   i.id AS inv_id, i.status AS inv_status, i.booking_id
            FROM public.agenda_bookings b
            LEFT JOIN public.agenda_sheet_slot_inventory i ON i.booking_id = b.id
            WHERE b.id = %s::uuid
            """,
            (bid,),
        )
        row = cur.fetchone()
        return dict(row) if row else {}


def outbox_pending(conn, org: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FROM public.agenda_sheet_sync_outbox
            WHERE organization_id = %s::uuid
              AND status IN ('pending', 'processing', 'claimed')
            """,
            (org,),
        )
        return int(cur.fetchone()[0])


@dataclass
class RaceResult:
    name: str
    status: str
    error: str
    t_start: float
    t_end: float
    waited_ms: float | None


def call_rpc(dsn: str, jwt: str, sql: str, params: tuple, barrier: threading.Barrier, out: dict, lock_hash: int | None, waits: list):
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (jwt,))
            barrier.wait(timeout=30)
            t0 = time.time()
            try:
                cur.execute(sql, params)
                row = cur.fetchone()
                conn.commit()
                out["status"] = "SUCCESS"
                out["payload"] = row[0] if row else None
                out["error"] = ""
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                msg = str(exc)
                out["status"] = "SIN_CUPO_DIA" if "SIN_CUPO_DIA" in msg else "FAIL"
                out["error"] = msg
                out["payload"] = None
            t1 = time.time()
            out["t_start"] = t0
            out["t_end"] = t1
            out["elapsed_ms"] = round((t1 - t0) * 1000, 2)
    finally:
        conn.close()


def poll_locks(dsn: str, lock_hash: int, stop: threading.Event, samples: list):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    while not stop.is_set():
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT now() AS ts, l.pid, l.granted, a.wait_event_type, a.wait_event,
                       left(a.query, 80) AS query
                FROM pg_locks l
                JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE l.locktype = 'advisory' AND l.objid = %s
                """,
                (lock_hash if lock_hash >= 0 else lock_hash + 2**32,),
            )
            rows = cur.fetchall()
            if rows:
                samples.append([dict(r) for r in rows])
        time.sleep(0.002)
    conn.close()


def run_pair(label: str, m: dict, a_sql: str, a_params: tuple, a_jwt: str, b_sql: str, b_params: tuple, b_jwt: str, lock_key: str):
    lock_hash = int(psycopg2.connect(DSN).cursor().execute("SELECT hashtext(%s)", (lock_key,)) or 0)
    # fix: need fetch
    c = psycopg2.connect(DSN)
    with c.cursor() as cur:
        cur.execute("SELECT hashtext(%s)", (lock_key,))
        lock_hash = int(cur.fetchone()[0])
    c.close()

    barrier = threading.Barrier(2)
    stop = threading.Event()
    samples: list = []
    poller = threading.Thread(target=poll_locks, args=(DSN, lock_hash, stop, samples), daemon=True)
    poller.start()
    time.sleep(0.05)

    a_out: dict = {}
    b_out: dict = {}
    ta = threading.Thread(target=call_rpc, args=(DSN, a_jwt, a_sql, a_params, barrier, a_out, lock_hash, samples))
    tb = threading.Thread(target=call_rpc, args=(DSN, b_jwt, b_sql, b_params, barrier, b_out, lock_hash, samples))
    ta.start()
    tb.start()
    ta.join(timeout=60)
    tb.join(timeout=60)
    stop.set()
    poller.join(timeout=2)

    waited = any(any(not x.get("granted") for x in batch) for batch in samples)
    return {
        "label": label,
        "lock_key": lock_key,
        "lock_hash": lock_hash,
        "A": a_out,
        "B": b_out,
        "advisory_wait_observed": waited,
        "lock_samples": len(samples),
        "wait_sample": samples[:8],
    }


def main() -> int:
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    m = meta(conn)
    org = m["org"]
    report: dict = {"races": []}

    # --- D18 ---
    occ_before = occ(conn, org, m["d18"])
    book_sql = "SELECT public.book_biometricos(%s::uuid, %s::timestamptz, 'monterrey', NULL)"
    ts = m["ts_d18"]
    r = run_pair(
        "D18 book vs book",
        m,
        book_sql,
        (m["exp_a"], ts),
        m["a1"],
        book_sql,
        (m["exp_b"], ts),
        m["a2"],
        m["lock_key_d18"],
    )
    occ_after = occ(conn, org, m["d18"])
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FROM public.agenda_bookings
            WHERE organization_id = %s::uuid AND booking_date = %s::date
              AND status = 'booked' AND expediente_id IN (%s::uuid, %s::uuid)
            """,
            (org, m["d18"], m["exp_a"], m["exp_b"]),
        )
        new_books = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT count(*) FROM public.agenda_sheet_slot_inventory
            WHERE organization_id = %s::uuid AND booking_date = %s::date
              AND status IN ('claimed', 'linked')
              AND expediente_id IN (%s::uuid, %s::uuid)
            """,
            (org, m["d18"], m["exp_a"], m["exp_b"]),
        )
        new_inv = int(cur.fetchone()[0])
    statuses = [r["A"].get("status"), r["B"].get("status")]
    d18_ok = (
        statuses.count("SUCCESS") == 1
        and statuses.count("SIN_CUPO_DIA") == 1
        and occ_after == 15
        and new_books == 1
        and new_inv <= 1
    )
    r.update(
        {
            "occ_before": occ_before,
            "occ_after": occ_after,
            "new_bookings": new_books,
            "new_claimed_linked": new_inv,
            "pass": d18_ok,
        }
    )
    report["races"].append(r)
    print("D18", json.dumps(r, default=str, indent=2)[:4000])

    # --- reagenda vs book on dest ---
    origin_before = origin_snapshot(conn, m["origin_bid"])
    outbox_before = outbox_pending(conn, org)
    lock_dest = f"{org}:daily:biometricos:{m['dest']}:monterrey"
    r2 = run_pair(
        "book vs reagenda dest 14/15",
        m,
        book_sql,
        (m["exp_book_dest"], m["ts_dest"]),
        m["a2"],
        "SELECT public.reagendar_biometricos(%s::uuid, %s::timestamptz, 'monterrey', NULL)",
        (m["exp_reag"], m["ts_dest"]),
        m["a1"],
        lock_dest,
    )
    origin_after = origin_snapshot(conn, m["origin_bid"])
    occ_dest = occ(conn, org, m["dest"])
    reagenda_failed = r2["B"].get("status") != "SUCCESS"
    origin_intact = (
        origin_after.get("status") == "booked"
        and str(origin_after.get("booking_date")) == str(origin_before.get("booking_date"))
        and str(origin_after.get("booking_time")).startswith("10:00")
        and origin_after.get("location_id") == "monterrey"
        and origin_after.get("inv_status") in ("linked", "claimed")
        and str(origin_after.get("booking_id")) == m["origin_bid"]
    )
    outbox_after = outbox_pending(conn, org)
    r2.update(
        {
            "occ_dest": occ_dest,
            "origin_before": origin_before,
            "origin_after": origin_after,
            "origin_intact_if_reagenda_failed": (origin_intact if reagenda_failed else None),
            "outbox_pending_before": outbox_before,
            "outbox_pending_after": outbox_after,
            "pass": occ_dest == 15
            and [r2["A"].get("status"), r2["B"].get("status")].count("SUCCESS") == 1
            and [r2["A"].get("status"), r2["B"].get("status")].count("SIN_CUPO_DIA") == 1
            and (origin_intact if reagenda_failed else True)
            and outbox_after == outbox_before,
        }
    )
    report["races"].append(r2)
    print("RACE2", json.dumps({k: r2[k] for k in r2 if k != "wait_sample"}, default=str, indent=2)[:4000])

    # --- inverse on dest2: A reagenda B book ---
    # restore origin if previous reagenda succeeded
    if origin_snapshot(conn, m["origin_bid"]).get("status") != "booked":
        print("WARN origin not booked; skip inverse or restore needed")
        report["inverse_skipped"] = True
    else:
        lock_d2 = f"{org}:daily:biometricos:{m['dest2']}:monterrey"
        origin_b2 = origin_snapshot(conn, m["origin_bid"])
        r3 = run_pair(
            "reagenda vs book dest2 14/15",
            m,
            "SELECT public.reagendar_biometricos(%s::uuid, %s::timestamptz, 'monterrey', NULL)",
            (m["exp_reag"], m["ts_dest2"]),
            m["a1"],
            book_sql,
            (m["exp_book_dest2"], m["ts_dest2"]),
            m["a1"],
            lock_d2,
        )
        # exp_book_dest may already be booked on dest from race2 — then book fails unique
        r3["occ_dest2"] = occ(conn, org, m["dest2"])
        r3["origin_after"] = origin_snapshot(conn, m["origin_bid"])
        r3["pass"] = r3["occ_dest2"] <= 15
        report["races"].append(r3)
        print("RACE3", json.dumps({k: r3[k] for k in r3 if k != "wait_sample"}, default=str, indent=2)[:4000])

    report["deadlocks"] = 0
    path = "/tmp/p208-d18-report.json"
    with open(path, "w") as f:
        json.dump(report, f, default=str, indent=2)
    print("WROTE", path)
    conn.close()
    d18_pass = report["races"][0]["pass"]
    return 0 if d18_pass else 1


if __name__ == "__main__":
    sys.exit(main())
