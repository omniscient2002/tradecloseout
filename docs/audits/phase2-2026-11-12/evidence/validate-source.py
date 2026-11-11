#!/usr/bin/env python3
"""Verify pinned source bytes before replay; no network, migration or mutation."""
from pathlib import Path
import hashlib, json, sys
here=Path(__file__).resolve().parent
root=here.parents[3]
target=sys.argv[1] if len(sys.argv)>1 else 'shared'
labels={'shared':'shared-pr16','g03':'separate-g03-pr13'}
if target not in labels: raise SystemExit('Expected shared or g03')
rows=[r for r in json.loads((here/'source-manifest.json').read_text()) if r['candidate']==labels[target]]
errors=[]
for row in rows:
 path=root/row['path']
 if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:
  errors.append(row['path'])
if errors: raise SystemExit('SOURCE_MISMATCH: '+', '.join(errors))
print(f"Verified {len(rows)} source blobs for {labels[target]} at {rows[0]['sha']}")
