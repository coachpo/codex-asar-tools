import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const APP        = '/Applications/Codex.app';
const ASAR       = `${APP}/Contents/Resources/app.asar`;
const PLIST      = `${APP}/Contents/Info.plist`;
const TARGET_RE  = /[A-Za-z_$][\w$]*\(`1506311413`\)/g;
const AFTER      = `(           !0)`;     // 15 bytes, evaluates !0 = true
const DRY_RUN    = process.argv.includes('--dry-run');
const STAMP      = Date.now();

// 1. Parse asar layout from raw bytes (NOT from getRawHeader's headerSize, which is off by 8)
const fullBuf = readFileSync(ASAR);
const innerPickleTotal = fullBuf.readUInt32LE(4);
const stringLen        = fullBuf.readUInt32LE(12);
const headerJsonStart  = 16;
const headerJsonEnd    = headerJsonStart + stringLen;
const dataStart        = 8 + innerPickleTotal;        // <-- where file content blob begins

const header = JSON.parse(fullBuf.subarray(headerJsonStart, headerJsonEnd).toString('utf8'));

function* entries(node, parts = []) {
  if (!node.files) return;
  for (const [name, child] of Object.entries(node.files)) {
    const nextParts = [...parts, name];
    if (child.files) {
      yield* entries(child, nextParts);
    } else if (child.size !== undefined && child.offset !== undefined) {
      yield { entry: child, rel: nextParts.join('/') };
    }
  }
}

function readEntry(entry) {
  const fileSize = Number(entry.size);
  const fileAbsOffset = dataStart + Number(entry.offset);
  return fullBuf.subarray(fileAbsOffset, fileAbsOffset + fileSize);
}

const candidates = [];
for (const candidate of entries(header)) {
  const candidateText = readEntry(candidate.entry).toString('utf8');
  for (const match of candidateText.matchAll(TARGET_RE)) {
    candidates.push({ ...candidate, before: match[0] });
  }
}

if (candidates.length !== 1) {
  throw new Error(`expected exactly one target marker, found ${candidates.length}`);
}

const { entry, rel: REL, before: BEFORE } = candidates[0];
const fileAbsOffset  = dataStart + Number(entry.offset);
console.log('target:', REL);

// 2. Read the file, swap the pattern, verify size
const orig = readEntry(entry);
const text = orig.toString('utf8');
if (BEFORE.length !== AFTER.length) throw new Error('replacement length mismatch');
const newBuf = Buffer.from(text.replace(BEFORE, AFTER), 'utf8');

// 3. Sanity: pre-patch hash must match header
const preHash = createHash('sha256').update(orig).digest('hex');
if (preHash !== entry.integrity.hash) throw new Error('pre-patch hash mismatch — file may already be patched or asar is corrupt');

// 4. Back up before writing anything
if (!DRY_RUN) {
  copyFileSync(ASAR,  `${ASAR}.bak.${STAMP}`);
  copyFileSync(PLIST, `${PLIST}.bak.${STAMP}`);
  console.log(`backups: *.bak.${STAMP}`);
}

// 5. Compute new file integrity (single block since file < 4 MiB)
const newOverall = createHash('sha256').update(newBuf).digest('hex');
const newBlocks  = [];
for (let off = 0; off < newBuf.length; off += entry.integrity.blockSize) {
  newBlocks.push(createHash('sha256').update(newBuf.subarray(off, off + entry.integrity.blockSize)).digest('hex'));
}

// 6. In-place edit: replace hash strings inside the JSON header
function replaceInRange(big, [lo, hi], oldStr, newStr) {
  const oldB = Buffer.from(oldStr, 'utf8');
  const newB = Buffer.from(newStr, 'utf8');
  if (oldB.length !== newB.length) throw new Error('hash length changed');
  let pos = lo, count = 0;
  while (pos < hi) {
    const found = big.indexOf(oldB, pos);
    if (found < 0 || found >= hi) break;
    newB.copy(big, found);
    count++;
    pos = found + 1;
  }
  return count;
}
replaceInRange(fullBuf, [headerJsonStart, headerJsonEnd], entry.integrity.hash, newOverall);
for (let i = 0; i < entry.integrity.blocks.length; i++) {
  replaceInRange(fullBuf, [headerJsonStart, headerJsonEnd], entry.integrity.blocks[i], newBlocks[i]);
}

// 7. Patch file content at the correct offset
newBuf.copy(fullBuf, fileAbsOffset);

// 8. Recompute asar header hash for Info.plist
const newHeaderJson = fullBuf.subarray(headerJsonStart, headerJsonEnd).toString('utf8');
const newHeaderHash = createHash('sha256').update(newHeaderJson).digest('hex');
console.log('new asar header hash:', newHeaderHash);

if (DRY_RUN) {
  console.log('dry run: skipping writes, Info.plist update, and codesign');
  process.exit(0);
}

writeFileSync(ASAR, fullBuf);

// 9. Update Info.plist
execSync(`/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash ${newHeaderHash}" "${PLIST}"`);

// 10. Ad-hoc re-sign (Info.plist change invalidates Apple's signature)
execSync(`codesign --force --deep --sign - "${APP}"`, { stdio: 'inherit' });

console.log('Done. Restart Codex.app.');
