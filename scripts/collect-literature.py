#!/usr/bin/env python3
"""Collect only Crossref bibliographic facts from reviewed journal ISSNs.
Resumable page cache is outside the repository; no generated scientific claims.
"""
import argparse, concurrent.futures, datetime, gzip, hashlib, json, pathlib, re, sqlite3, threading, time, unicodedata, urllib.error, urllib.parse, urllib.request

SELECT = 'DOI,title,container-title,publisher,published,type,ISSN,author,update-to'
LOCK = threading.Lock()

def encoded(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))

def normalize(item, journal, response_hash, retrieved_at):
    doi = str(item.get('DOI', '')).strip().lower()
    title = next((x.strip() for x in item.get('title', []) if isinstance(x, str) and x.strip()), '')
    if not re.fullmatch(r'10\.\d{4,9}/\S+', doi) or len(title) < 12 or item.get('type') != 'journal-article':
        return None
    if not set(item.get('ISSN', [])).intersection(journal['issns']):
        return None
    if re.match(r'^(?:editorial board|contents|table of contents|front matter|back matter|cover image|index|erratum|corrigendum|retraction|withdrawn)(?:\b|:)', title, re.I):
        return None
    date = item.get('published', {}).get('date-parts', [[]])[0]
    if not date or not isinstance(date[0], int) or not 1600 <= date[0] <= 2026:
        return None
    authors = [' '.join(str(a.get(k, '')).strip() for k in ('given', 'family')).strip() or str(a.get('name', '')).strip() for a in item.get('author', [])]
    return {'id': 'CR-' + hashlib.sha256(doi.encode()).hexdigest()[:24], 'doi': doi,
            'title': title, 'journal': item.get('container-title', [journal['title']])[0],
            'publisher': item.get('publisher', ''), 'published': date, 'authors': [a for a in authors if a],
            'issns': item.get('ISSN', []), 'sourceIssn': journal['issn'], 'topic': journal['topic'],
            'sourceUrl': 'https://api.crossref.org/works/' + urllib.parse.quote(doi, safe=''),
            'url': 'https://doi.org/' + urllib.parse.quote(doi, safe='/'),
            'retrievedAt': retrieved_at, 'responseSha256': response_hash,
            'diagnosticEvidence': False, 'fullTextVerified': False,
            'updates': item.get('update-to', [])}

def main():
    p = argparse.ArgumentParser(); p.add_argument('--cache', required=True); p.add_argument('--target', type=int, default=486764); p.add_argument('--export-only', action='store_true'); p.add_argument('--skip-failed', action='store_true')
    args = p.parse_args()
    if args.target <= 0: p.error('--target must be positive')
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / 'data/literature'; cache = pathlib.Path(args.cache); cache.mkdir(parents=True, exist_ok=True)
    journals = json.loads((out / 'journals.json').read_text())
    db = sqlite3.connect(cache / 'harvest.sqlite', check_same_thread=False, timeout=60)
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('CREATE TABLE IF NOT EXISTS records(doi TEXT PRIMARY KEY, dedup TEXT UNIQUE, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pages(issn TEXT, number INTEGER, url TEXT, sha256 TEXT, retrieved TEXT, received INTEGER, PRIMARY KEY(issn,number));')
    count = [db.execute('SELECT count(*) FROM records').fetchone()[0]]
    def journal_task(journal):
        cursor = '*'; page = 0
        while True:
            with LOCK:
                if count[0] >= args.target: return
            page += 1; file = cache / f"{journal['issn']}-{page:05d}.json.gz"; meta = file.with_suffix('.meta.json')
            url = 'https://api.crossref.org/journals/' + journal['issn'] + '/works?' + urllib.parse.urlencode({'rows': 1000, 'cursor': cursor, 'select': SELECT, 'filter': 'type:journal-article,until-pub-date:2026-11-12'})
            if file.exists() and meta.exists():
                raw = gzip.decompress(file.read_bytes()); info = json.loads(meta.read_text())
                if info['url'] != url: raise RuntimeError('Cached cursor mismatch')
            else:
                for attempt in range(6):
                    try:
                        req = urllib.request.Request(url, headers={'User-Agent': 'AgriDx-Literature/1.0 (https://github.com/srt2777/AgriDx)', 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
                        with urllib.request.urlopen(req, timeout=45) as response:
                            raw = response.read()
                            if response.headers.get('Content-Encoding') == 'gzip': raw = gzip.decompress(raw)
                        payload = json.loads(raw)
                        if payload.get('status') != 'ok': raise RuntimeError('Non-success response')
                        break
                    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                        if attempt == 5: raise
                        print(f"retry {journal['issn']} page={page} {type(exc).__name__}", flush=True); delay = min(45, 2 ** (attempt + 1))
                        if isinstance(exc, urllib.error.HTTPError):
                            retry_after = exc.headers.get('Retry-After', '')
                            if retry_after.isdigit(): delay = min(60, max(delay, int(retry_after)))
                        time.sleep(delay)
                info = {'url': url, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sha256': hashlib.sha256(raw).hexdigest()}
                file.write_bytes(gzip.compress(raw, mtime=0)); meta.write_text(encoded(info))
            if hashlib.sha256(raw).hexdigest() != info['sha256']: raise RuntimeError('Source checksum mismatch')
            message = json.loads(raw)['message']; items = message['items']
            with LOCK:
                for item in items:
                    if count[0] >= args.target: break
                    record = normalize(item, journal, info['sha256'], info['retrievedAt'])
                    if record is None: continue
                    key = re.sub(r'\W+', '', unicodedata.normalize('NFKC', record['title']).casefold()) + ':' + str(record['published'][0]) + ':' + record['journal'].casefold()
                    if db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?)', (record['doi'], key, encoded(record))).rowcount: count[0] += 1
                db.execute('INSERT OR REPLACE INTO pages VALUES(?,?,?,?,?,?)', (journal['issn'], page, url, info['sha256'], info['retrievedAt'], len(items))); db.commit()
                print(f"{journal['issn']} page={page} received={len(items)} unique={count[0]}/{args.target}", flush=True)
            if len(items) < 1000: return
            next_cursor = message.get('next-cursor')
            if not next_cursor or next_cursor == cursor: raise RuntimeError('Cursor did not advance')
            cursor = next_cursor; time.sleep(0.25)
    if not args.export_only:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            failures = []
            for journal in journals:
                try: pool.submit(journal_task, journal).result()
                except Exception as exc:
                    failures.append({'issn': journal['issn'], 'error': str(exc)})
                    (cache/'failures.json').write_text(json.dumps(failures, indent=2))
                    print(f"failed {journal['issn']}: {type(exc).__name__}", flush=True)
                    if not args.skip_failed or len(failures) >= 3: break
    shards = []; rows = db.execute('SELECT body FROM records ORDER BY doi'); total = 0
    while batch := rows.fetchmany(10000):
        data = ('\n'.join(row[0] for row in batch) + '\n').encode(); compressed = gzip.compress(data, compresslevel=9, mtime=0)
        name = f'records-{len(shards)+1:03d}.jsonl.gz'; (out / name).write_bytes(compressed)
        shards.append({'file': name, 'records': len(batch), 'sha256': hashlib.sha256(compressed).hexdigest(), 'bytes': len(compressed), 'contentSha256': hashlib.sha256(data).hexdigest()}); total += len(batch)
    pages = [dict(zip(['issn','page','url','sha256','retrievedAt','received'], row)) for row in db.execute('SELECT * FROM pages ORDER BY issn,number')]
    (out / 'provenance.json').write_text(json.dumps(pages, ensure_ascii=False, indent=2)+'\n')
    manifest = {'schemaVersion': 1, 'provider': 'Crossref', 'collection': 'agricultural-literature-metadata', 'target': args.target, 'records': total, 'complete': total >= args.target,
        'diagnosticEvidence': False, 'fullTextVerified': False, 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'deduplication': ['lowercase DOI', 'NFKC alphanumeric title + publication year + journal'],
        'scope': 'Records registered in the reviewed agricultural journal ISSNs; relevance selected at journal level, not verified article by article.',
        'licenseUrl': 'https://www.crossref.org/documentation/retrieve-metadata/', 'shards': shards,
        'provenanceSha256': hashlib.sha256((out/'provenance.json').read_bytes()).hexdigest()}
    (out/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n'); print(encoded({'exported': total, 'shards': len(shards)}),flush=True)

if __name__ == '__main__': main()
