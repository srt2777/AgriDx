"""Rebuild the public product-model register from the retained official XLS (requires xlrd)."""
import hashlib,json,pathlib,unicodedata
import xlrd
root=pathlib.Path(__file__).resolve().parents[1]; dest=root/'public/assets/model-registry'; source=dest/'jiangsu-2025-3.xls'
sheet=xlrd.open_workbook(source).sheet_by_index(0)
assert sheet.row_values(0)[:8]==['序号','机具大类','机具小类','机具品目','分档名称','企业名称','产品名称','机具型号']
clean=lambda value:unicodedata.normalize('NFKC',str(value)).strip()
records={}
for i in range(1,sheet.nrows):
 row=[clean(v) for v in sheet.row_values(i)]
 if not any(row):continue
 assert row[5] and row[7] and row[14]=='通过',f'Unexpected row {i+1}'
 key=(row[5],row[7]); ident=hashlib.sha256('\0'.join(key).encode()).hexdigest()[:20]
 if key not in records:records[key]={'id':'JS25-3-'+ident,'manufacturer':row[5],'model':row[7],'product':row[6],'category':row[3],'rows':[]}
 records[key]['rows'].append(i+1)
items=sorted(records.values(),key=lambda r:(r['manufacturer'],r['model']))
payload=(json.dumps(items,ensure_ascii=False,separators=(',',':'))+'\n').encode();(dest/'records.json').write_bytes(payload)
meta={'schemaVersion':1,'sourceTitle':'江苏省2025年第三批农机补贴形式审核通过产品汇总表','publisher':'江苏省农业农村厅','publishedAt':'2025-10-28','retrievedAt':'2026-11-12','sourceUrl':'https://nynct.jiangsu.gov.cn/art/2025/10/28/art_11977_11669509.html','downloadUrl':'https://nynct.jiangsu.gov.cn/module/download/downfile.jsp?classid=0&filename=393c03904ffa4c93a3dd5f47bc151e7d.xls','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sheet':sheet.name,'rawRows':sum(len(r['rows']) for r in items),'models':len(items),'manufacturers':len({r['manufacturer'] for r in items}),'categories':len({r['category'] for r in items}),'recordsSha256':hashlib.sha256(payload).hexdigest(),'diagnosticEvidence':False,'deduplication':'NFKC-normalized manufacturer + model; original spreadsheet row numbers retained'}
(root/'config/model-registry.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print(json.dumps(meta,ensure_ascii=False))
