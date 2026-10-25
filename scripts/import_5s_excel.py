"""Turn the old TSAT4-5S workbooks into SQL for Tx Data (tables: db/act/5s.sql, names mt_5s_* / tx_5s_*).

    python -I scripts/import_5s_excel.py            # reads inbox/master_5s.xlsx + inbox/transaction_5s.xlsx
    -> writes inbox/import_5s.sql (inbox/ is git-ignored: the data stays off GitHub)

Run it in the Tx Data SQL Editor after db/act/5s.sql. It is safe to run again (on conflict).
tr_role is read for employee_id + role only; its password hashes are never read.
"""
import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent


def sheet(path, name):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)[name]
    rows = [r for r in ws.iter_rows(values_only=True) if any(c not in (None, '') for c in r)]
    head = [str(c).strip() if c is not None else '' for c in rows[0]]
    return [{k: v for k, v in zip(head, r) if k} for r in rows[1:]]


def lit(value, cast='text'):
    """SQL literal with an explicit cast so VALUES columns keep their type even when a row is NULL."""
    if value is None or value == '':
        return f'null::{cast}'
    if isinstance(value, datetime):
        text = value.strftime('%Y-%m-%d %H:%M:%S') + '+07' if cast == 'timestamptz' else value.strftime('%Y-%m-%d')
    elif isinstance(value, date):
        text = value.strftime('%Y-%m-%d')
    else:
        text = str(value).strip()
    return "'" + text.replace("'", "''") + f"'::{cast}"


def emp(value):
    if value is None or value == '':
        return None
    return str(int(value)) if isinstance(value, (int, float)) else str(value).strip()


def item_no(value):
    digits = ''.join(ch for ch in str(value) if ch.isdigit())
    return int(digits) if digits else None


def values(rows):
    return ',\n  '.join('(' + ', '.join(r) + ')' for r in rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--master', default=ROOT / 'inbox' / 'master_5s.xlsx')
    ap.add_argument('--trans', default=ROOT / 'inbox' / 'transaction_5s.xlsx')
    ap.add_argument('--out', default=ROOT / 'inbox' / 'import_5s.sql')
    ap.add_argument('--year', type=int, default=2026, help='year of the area owners and the checklist')
    ap.add_argument('--activity', default='5s')
    a = ap.parse_args()
    k = ''.join(ch for ch in a.activity if ch.isalnum())

    areas = sheet(a.master, 'mt_area')
    team = sheet(a.master, 'mt_audit')
    checklist = sheet(a.master, 'mt_list')
    audits = sheet(a.trans, 'tr_5s')
    issues = sheet(a.trans, 'tr_issue')
    plans = sheet(a.trans, 'tr_plan')
    admins = [r for r in sheet(a.trans, 'tr_role') if str(r.get('role', '')).strip().lower() == 'admin']

    out = [f'-- generated {datetime.now():%Y-%m-%d %H:%M} from {Path(a.master).name} + {Path(a.trans).name} · activity {a.activity}', 'begin;']

    out.append('\n-- areas')
    out.append(f'insert into public.mt_{k}_area (code, area_type, name, section, status) values\n  ' + values(
        [[lit(r['area_id']), lit(r['area_type']), lit(r['objectname']), lit(r.get('section')), lit(r.get('status') or 'Active')] for r in areas]
    ) + '\non conflict (code) do update set area_type = excluded.area_type, name = excluded.name, section = excluded.section, status = excluded.status;')

    out.append('\n-- area owners')
    out.append(f'insert into public.mt_{k}_area_owner (year, area_id, employee_id)\nselect v.year, ar.id, v.employee_id from (values\n  ' + values(
        [[lit(a.year, 'integer'), lit(r['area_id']), lit(emp(r['employee_id']))] for r in areas if emp(r.get('employee_id'))]
    ) + f'\n) v(year, code, employee_id)\njoin public.mt_{k}_area ar on ar.code = v.code\non conflict (year, area_id) do update set employee_id = excluded.employee_id;')

    out.append('\n-- team (หัวหน้าทีม -> chairman, Auditor -> auditor + team, Admin จาก tr_role -> admin)')
    rows = []
    for r in team:
        role = 'chairman' if str(r.get('role', '')).strip() == 'หัวหน้าทีม' else 'auditor'
        letter = str(r.get('audit_team') or '').strip().upper()
        rows.append([lit(r['auditor_year'], 'integer'), lit(emp(r['employee_id'])), lit(role), lit(letter if role == 'auditor' else None), lit(r.get('status') or 'Active')])
    for r in admins:
        rows.append([lit(a.year, 'integer'), lit(emp(r['employee_id'])), lit('admin'), lit(None), lit('Active')])
    out.append(f'insert into public.mt_{k}_team (year, employee_id, role, team, status) values\n  ' + values(rows) + f'\non conflict on constraint mt_{k}_team_unique do nothing;')

    out.append('\n-- checklist')
    out.append(f'insert into public.mt_{k}_checklist (year, item_no, s_group, title, score_max, status) values\n  ' + values(
        [[lit(a.year, 'integer'), lit(item_no(r['item_id']), 'integer'), lit(item_no(r['s_type']), 'integer'), lit(r['checklist_name']), lit(r.get('score_max') or 5, 'integer'), lit(r.get('status') or 'Active')] for r in checklist]
    ) + '\non conflict (year, item_no) do update set s_group = excluded.s_group, title = excluded.title, score_max = excluded.score_max, status = excluded.status;')

    out.append('\n-- committee plan (area x month x week)')
    out.append(f'insert into public.mt_{k}_audit_plan (year, area_id, month, week, round, team)\nselect v.year, ar.id, v.month, v.week, v.round, v.team from (values\n  ' + values(
        [[lit(r['audit_year'], 'integer'), lit(r['area_id']), lit(r['audit_month'], 'integer'), lit(item_no(r['audit_week']), 'integer'), lit(r.get('audit_round'), 'integer'), lit(r.get('audit_team'))] for r in plans]
    ) + f'\n) v(year, code, month, week, round, team)\njoin public.mt_{k}_area ar on ar.code = v.code\non conflict (year, area_id, month, week) do update set round = excluded.round, team = excluded.team;')

    out.append('\n-- audits')
    out.append(f'insert into public.tx_{k}_audit (audit_no, year, audit_type, area_id, team, audited_at, total_score, percent_score, result, status)\nselect v.audit_no, v.year, v.audit_type, ar.id, v.team, v.audited_at, v.total, v.percent, v.result, v.status from (values\n  ' + values(
        [[lit(r['audit_id']), lit(r['datetime'].year, 'integer'), lit(r['audit_type']), lit(r['area_id']), lit(r.get('audit_team')), lit(r['datetime'], 'timestamptz'),
          lit(r['total_score'], 'numeric'), lit(r['percent_score'], 'numeric'), lit(r.get('result')), lit(r.get('status') or 'COMPLETED')] for r in audits]
    ) + f'\n) v(audit_no, year, audit_type, code, team, audited_at, total, percent, result, status)\njoin public.mt_{k}_area ar on ar.code = v.code\non conflict (audit_no) do nothing;')

    out.append('\n-- scores (no01..no25 -> one row per item)')
    rows = []
    for r in audits:
        for n in range(1, 101):
            key = f'no{n:02d}'
            if key in r and r[key] not in (None, ''):
                rows.append([lit(r['audit_id']), lit(n, 'integer'), lit(r[key], 'numeric')])
    out.append(f'insert into public.tx_{k}_audit_score (audit_id, checklist_id, score)\nselect au.id, c.id, v.score from (values\n  ' + values(rows) +
               '\n) v(audit_no, item_no, score)\n' f'join public.tx_{k}_audit au on au.audit_no = v.audit_no\n'
               f'join public.mt_{k}_checklist c on c.year = au.year and c.item_no = v.item_no\non conflict (audit_id, checklist_id) do nothing;')

    out.append('\n-- people in each audit')
    rows = []
    for r in audits:
        for kind, col in (('assigned', 'assigned_json'), ('participated', 'participated_json'), ('receiver', 'receiver_json')):
            for person in json.loads(r.get(col) or '[]'):
                rows.append([lit(r['audit_id']), lit(emp(person)), lit(kind)])
    if rows:
        out.append(f'insert into public.tx_{k}_audit_person (audit_id, employee_id, kind)\nselect au.id, v.employee_id, v.kind from (values\n  ' + values(rows) +
                   '\n) v(audit_no, employee_id, kind)\n' f'join public.tx_{k}_audit au on au.audit_no = v.audit_no\non conflict (audit_id, employee_id, kind) do nothing;')

    out.append('\n-- issues')
    out.append(f'insert into public.tx_{k}_issue (issue_no, audit_id, area_id, checklist_id, score, description, issue_date, responsible_id, due_date, action_description, action_date, status, verify_audit_no, final_score, closed_by, closed_at)\n'
               'select v.issue_no, au.id, ar.id, c.id, v.score, v.description, v.issue_date, v.responsible_id, v.due_date, v.action_description, v.action_date, v.status, v.verify_audit_no, v.final_score, v.closed_by, v.closed_at from (values\n  ' + values(
        [[lit(r['issue_id']), lit(r['audit_id']), lit(r['area_id']), lit(item_no(r['list_no']), 'integer'), lit(r['score'], 'numeric'), lit(r.get('issue_description') or '-'),
          lit(r.get('issue_date'), 'date'), lit(emp(r.get('responsible_id'))), lit(r.get('due_date'), 'date'), lit(r.get('action_description')), lit(r.get('action_date'), 'date'),
          lit(r.get('status') or 'OPEN'), lit(r.get('verify_audit_id')), lit(r.get('final_score'), 'numeric'), lit(emp(r.get('close_by'))), lit(r.get('close_date'), 'date')] for r in issues]
    ) + '\n) v(issue_no, audit_no, code, item_no, score, description, issue_date, responsible_id, due_date, action_description, action_date, status, verify_audit_no, final_score, closed_by, closed_at)\n'
        f'join public.tx_{k}_audit au on au.audit_no = v.audit_no\n'
        f'join public.mt_{k}_area ar on ar.code = v.code\n'
        f'join public.mt_{k}_checklist c on c.year = au.year and c.item_no = v.item_no\non conflict (issue_no) do nothing;')

    out.append('\n-- issue photos (Google Drive URLs from the old system)')
    rows = []
    for r in issues:
        for kind, col in (('BEFORE', 'issue_photo'), ('AFTER', 'action_photo')):
            for photo in json.loads(r.get(col) or '[]'):
                url = photo.get('file_url') if isinstance(photo, dict) else photo
                if url:
                    rows.append([lit(r['issue_id']), lit(kind), lit(url)])
    if rows:
        out.append(f'insert into public.tx_{k}_issue_photo (issue_id, kind, url)\nselect i.id, v.kind, v.url from (values\n  ' + values(rows) +
                   '\n) v(issue_no, kind, url)\n' f'join public.tx_{k}_issue i on i.issue_no = v.issue_no\non conflict (issue_id, url) do nothing;')

    out.append('\ncommit;')
    out.append('\n-- check: expect ' + ', '.join(f'{k} {v}' for k, v in (('areas', len(areas)), ('team', len(team) + len(admins)), ('checklist', len(checklist)), ('plans', len(plans)), ('audits', len(audits)), ('issues', len(issues)))))
    out.append(f"select (select count(*) from public.mt_{k}_area) as areas,\n"
               f"  (select count(*) from public.mt_{k}_team) as team,\n"
               f"  (select count(*) from public.mt_{k}_checklist) as checklist,\n"
               f"  (select count(*) from public.mt_{k}_audit_plan) as plans,\n"
               f"  (select count(*) from public.tx_{k}_audit) as audits,\n"
               f"  (select count(*) from public.tx_{k}_issue) as issues;")
    Path(a.out).write_text('\n'.join(out) + '\n', encoding='utf-8')
    # The same statements one section per file, for SQL editors that refuse a large paste.
    parts_dir = Path(a.out).with_suffix('')
    parts_dir.mkdir(exist_ok=True)
    for old in parts_dir.glob('*.sql'):
        old.unlink()
    sections = []
    for chunk in out[2:]:
        if chunk.startswith('\n-- ') and not chunk.startswith('\n-- check:'):
            sections.append([chunk.strip()])
        elif sections and chunk.strip() != 'commit;' and not chunk.startswith('\n-- check:') and not chunk.startswith('select (select count'):
            sections[-1].append(chunk)
    for i, sec in enumerate(sections, 1):
        name = ''.join(ch if ch.isalnum() else '_' for ch in sec[0].lstrip('- ').split(' (')[0]).strip('_').lower()
        (parts_dir / f'{i:02d}_{name}.sql').write_text('\n'.join(sec) + '\n', encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(f'wrote {len(sections)} parts in {parts_dir}')
    print(f'wrote {a.out}: areas {len(areas)}, team {len(team) + len(admins)}, checklist {len(checklist)}, plans {len(plans)}, audits {len(audits)}, issues {len(issues)}')


if __name__ == '__main__':
    main()
