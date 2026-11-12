#!/usr/bin/env python3
"""Verify every exported record against its actual downloaded Crossref response.
This verifies metadata extraction, not scientific conclusions or full texts.
"""
import argparse,gzip,hashlib,importlib.util,json,pathlib,sqlite3,tempfile
spec=importlib.util.spec_from_file_location('collector',pathlib.Path(__file__).with_name('collect-literature.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
p=argparse.ArgumentParser();p.add_argument('--cache',required=True);p.add_argument('--output',required=True);args=p.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent/'data/literature';cache=pathlib.Path(args.cache)
manifest=json.loads((root/'manifest.json').read_text());journals={j['issn']:j for j in json.loads((root/'journals.json').read_text())}
with tempfile.TemporaryDirectory() as tmp:
 db=sqlite3.connect(pathlib.Path(tmp)/'audit.sqlite')
 db.execute('CREATE TABLE records(doi TEXT PRIMARY KEY, body TEXT, source TEXT, verified INTEGER DEFAULT 0)')
 for shard in manifest['shards']:
  data=(root/shard['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==shard['sha256']
  for line in gzip.decompress(data).decode().splitlines():
   r=json.loads(line);db.execute('INSERT INTO records(doi,body,source) VALUES(?,?,?)',(r['doi'],collector.encoded(r),r['responseSha256']))
 db.commit();pages=json.loads((root/'provenance.json').read_text());fetched=0
 for page in pages:
  raw=gzip.decompress((cache/f"{page['issn']}-{page['page']:05d}.json.gz").read_bytes());assert hashlib.sha256(raw).hexdigest()==page['sha256']
  items=json.loads(raw)['message']['items'];assert len(items)==page['received'];fetched+=len(items)
  for item in items:
   r=collector.normalize(item,journals[page['issn']],page['sha256'],page['retrievedAt'])
   if r is None:continue
   row=db.execute('SELECT body,source FROM records WHERE doi=?',(r['doi'],)).fetchone()
   if row and row[1]==page['sha256']:
    assert json.loads(row[0])==r, f"Source mismatch: {r['doi']}"
    db.execute('UPDATE records SET verified=1 WHERE doi=?',(r['doi'],))
  db.commit()
 total,verified=db.execute('SELECT count(*),sum(verified) FROM records').fetchone()
 assert total==verified==manifest['records']
 report={'records':total,'sourceMatchedRecords':verified,'downloadedPages':len(pages),'receivedRecordsBeforeFiltering':fetched,'manifestSha256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest(),'scope':'Exact metadata extraction and hash checks only; no full-text, research conclusion, expert or real-machine verification.','diagnosticEvidence':False,'fullTextVerified':False}
 pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report))
