"""Check the public documentation, figures, file inventory, and SHA-256 manifest."""
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {'.git', 'node_modules', 'dist', '__pycache__', '.cache', 'coverage'}

def files():
    return sorted(p for p in ROOT.rglob('*')
                  if p.is_file() and not any(part in IGNORED for part in p.relative_to(ROOT).parts))

issues = []
public_files = files()
for p in public_files:
    relative = p.relative_to(ROOT)
    if any(part in {'demo', 'references', 'artifacts', '.codex', '.scratch'} for part in relative.parts):
        issues.append(f'Unexpected private/material path: {relative}')
    if p.name.startswith('.env') and not p.name.endswith('.example'):
        issues.append(f'Environment file is not an example: {relative}')
    if p.suffix in {'.key', '.pem'} or '.local.toml' in p.name:
        issues.append(f'Unexpected credential/configuration file: {relative}')
    content = p.read_bytes()
    if re.search(rb'(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)', content):
        issues.append(f'Credential-shaped value requires inspection: {relative}')
    if relative.parts[0] == 'docs':
        issues.append(f'Internal documentation path: {relative}')
    if p.suffix == '.md':
        for target in re.findall(r'\]\(([^)]+)\)', content.decode()):
            target = target.strip('<>').split('#')[0]
            if not target or target.startswith(('https:', 'http:', 'mailto:')):
                continue
            if not (p.parent / target).exists():
                issues.append(f'Missing link: {relative} -> {target}')

for language in ('en', 'zh'):
    folder = ROOT / 'figure' / language
    for extension in ('.drawio', '.svg', '.png'):
        selected = sorted(folder.glob('*' + extension))
        if len(selected) != 9:
            issues.append(f'{language} needs nine {extension} figures')
        for p in selected:
            if extension in ('.drawio', '.svg'):
                ET.parse(p)
combined = ET.parse(ROOT / 'figure/HAKCC_mechanisms.drawio')
if len(combined.getroot().findall('diagram')) != 18:
    issues.append('Aggregate draw.io needs eighteen pages')

if 'MIT License' not in (ROOT / 'LICENSE').read_text():
    issues.append('Missing MIT license')
for language_file in ('README.md', 'README.zh-CN.md', 'figure/README.md'):
    if 'HAKCC_Mechanism.png' not in (ROOT / language_file).read_text():
        issues.append(f'Missing integrated overview: {language_file}')
for p in (ROOT / 'media').glob('*.gif'):
    if p.stat().st_size > 8 * 1024 * 1024:
        issues.append(f'GIF exceeds documentation size budget: {p.name}')

snapshot = json.loads((ROOT / 'evidence/source_snapshot.json').read_text())
for record in snapshot['published_source_files']:
    p = ROOT / record['path']
    if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest() != record['public_sha256']:
        issues.append(f'Source fingerprint mismatch: {record["path"]}')

manifest = ROOT / 'evidence/public_files.sha256'
if not manifest.exists():
    issues.append('Missing public file manifest')
else:
    expected = {}
    for line in manifest.read_text().splitlines():
        digest, name = line.split('  ', 1)
        expected[name] = digest
        p = ROOT / name
        if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
            issues.append(f'Public fingerprint mismatch: {name}')
    actual = {str(p.relative_to(ROOT)) for p in public_files if p != manifest}
    if actual != set(expected):
        issues.append('Public manifest does not match file inventory')

print(json.dumps({'files': len(public_files), 'source_files': len(snapshot['published_source_files']),
                  'figure_variants': 18, 'issues': issues}, indent=2))
raise SystemExit(1 if issues else 0)
