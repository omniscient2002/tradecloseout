#!/usr/bin/env python3
"""Read-only verification of the pinned source inventory in an extracted candidate."""
from pathlib import Path
import hashlib,json,sys
here=Path(__file__).resolve().parent
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else here.parents[3]
manifest=json.loads((here/'source-inventory.json').read_text())
fail=[]
for row in manifest['files']:
 p=root/row['path']
 if not p.is_file():fail.append(row['path']+': missing');continue
 b=p.read_bytes();actual=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if actual!=row['gitBlob']:fail.append(row['path']+': differs')
print(json.dumps({'sourceSha':manifest['sourceSha'],'checkedFiles':len(manifest['files']),'failures':fail},indent=2))
sys.exit(bool(fail))
