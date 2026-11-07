/** Self-contained browser verifier. File selection also works when opened via file://. */
export function archiveVerifierHtml(expectedManifestSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw new Error('INVALID_MANIFEST_DIGEST');
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Evidence archive verification</title>
<h1>Verify extracted evidence</h1>
<p>Select the extracted archive folder. Files are read locally. These digest checks establish
consistency with this verifier's manifest digest; they do not authenticate a signer or protect
against replacement of the entire archive and verifier. Retain the export receipt separately.</p>
<input id="files" type="file" webkitdirectory multiple aria-label="Extracted archive folder">
<p id="status" role="status">Choose a folder to start verification.</p><ul id="results"></ul>
<script>
const expectedManifestSha256 = '${expectedManifestSha256}';
const status = document.getElementById('status');
const results = document.getElementById('results');
async function digest(file) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
document.getElementById('files').addEventListener('change', async (event) => {
  status.textContent = 'Verifying...';
  results.replaceChildren();
  event.target.disabled = true;
  try {
    const files = new Map();
    for (const file of event.target.files) {
      const relative = file.webkitRelativePath.split('/').slice(1).join('/');
      if (files.has(relative)) throw new Error('Duplicate file: ' + relative);
      files.set(relative, file);
    }
    const manifestFile = files.get('manifest.json');
    if (!manifestFile || await digest(manifestFile) !== expectedManifestSha256)
      throw new Error('Manifest missing or digest mismatch');
    const manifest = JSON.parse(await manifestFile.text());
    if (!Array.isArray(manifest.objects)) throw new Error('Invalid manifest');
    const paths = new Set();
    for (const item of manifest.objects) {
      const name = item.archive_path;
      if (typeof name !== 'string' || !new RegExp('^evidence/[a-f0-9-]+$').test(name) || paths.has(name))
        throw new Error('Invalid or duplicate evidence path');
      paths.add(name);
      const file = files.get(name);
      if (!file) throw new Error('Missing evidence: ' + name);
      if (BigInt(file.size) !== BigInt(item.size_bytes) || await digest(file) !== item.sha256)
        throw new Error('Evidence size or digest mismatch: ' + name);
      const result = document.createElement('li');
      result.textContent = String(item.document_title || name) + ': digest matches';
      results.appendChild(result);
    }
    for (const name of files.keys()) {
      if (name.startsWith('evidence/') && !paths.has(name)) throw new Error('Unexpected evidence: ' + name);
    }
    status.textContent = 'Verified ' + paths.size + ' evidence files against the manifest digest. Signer authenticity is not checked.';
  } catch (error) {
    status.textContent = 'Verification failed: ' + error.message;
  } finally { event.target.disabled = false; }
});
</script></html>`;
}
