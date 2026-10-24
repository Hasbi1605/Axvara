#!/usr/bin/env node
/**
 * Patch Baileys 7.0.0-rc13: skip empty link_code_companion_reg notifications
 * that crash pairing with "Invalid buffer" (WhiskeySockets/Baileys#2600 / PR#2608).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js');

if (!existsSync(target)) {
  console.warn('[patch-baileys-pairing] messages-recv.js not found — skip');
  process.exit(0);
}

let src = readFileSync(target, 'utf8');
if (src.includes('without pairing data, skipping')) {
  console.log('[patch-baileys-pairing] already applied');
  process.exit(0);
}

const needle = `case 'link_code_companion_reg':
                const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');
                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));
                const primaryIdentityPublicKey = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub'));
                const primaryEphemeralPublicKeyWrapped = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub'));`;

const replacement = `case 'link_code_companion_reg': {
                const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');
                // WA can send empty/partial link_code_companion_reg notifications
                // (e.g. when user opens Linked Devices UI). Skip instead of crashing.
                if (!linkCodeCompanionReg ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub') ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref') ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub')) {
                    logger.debug({ id: node.attrs.id }, 'link_code_companion_reg notification without pairing data, skipping');
                    break;
                }
                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));
                const primaryIdentityPublicKey = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub'));
                const primaryEphemeralPublicKeyWrapped = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub'));`;

if (!src.includes(needle)) {
  console.error('[patch-baileys-pairing] unexpected Baileys source — patch site not found');
  process.exit(1);
}

// Close the extra block before the next case. Find end of this case body carefully:
// After replacement we opened `{` — need matching `break;` before next case to close with `}`.
// The original ends with `break;` then `case 'privacy_token':` typically.
src = src.replace(needle, replacement);

// Close the block: first `break;` after our case that belongs to link_code — find privacy_token case
const privacy = "case 'privacy_token':";
const pIdx = src.indexOf(privacy);
if (pIdx === -1) {
  console.error('[patch-baileys-pairing] could not find privacy_token case to close block');
  process.exit(1);
}
// insert `}` before privacy_token case (after preceding break)
const before = src.lastIndexOf('break;', pIdx);
if (before === -1) {
  console.error('[patch-baileys-pairing] could not find break before privacy_token');
  process.exit(1);
}
// only close if we haven't already
const segment = src.slice(before, pIdx);
if (!segment.includes('}\n') && !segment.includes('}\r\n')) {
  src = src.slice(0, before) + 'break;\n            }\n            ' + src.slice(pIdx);
  // we duplicated break — fix by removing the original break we left
  // Actually: we inserted "break;\n            }\n            " at `before` which is start of "break;"
  // so we get "break;\n            }\n            case 'privacy_token'" and the original "break;" is replaced start...
  // lastIndexOf('break;', pIdx) points to the break of the PREVIOUS case or our case.
}

// Simpler approach: re-read and do a cleaner transform
src = readFileSync(target, 'utf8');
if (!src.includes(needle)) {
  // already partially patched? re-check
  if (src.includes('without pairing data, skipping')) {
    console.log('[patch-baileys-pairing] already applied');
    process.exit(0);
  }
  console.error('[patch-baileys-pairing] needle missing on re-read');
  process.exit(1);
}

// Replace entire case block until next "case 'privacy_token'"
const start = src.indexOf("case 'link_code_companion_reg':");
const end = src.indexOf("case 'privacy_token':", start);
if (start < 0 || end < 0) {
  console.error('[patch-baileys-pairing] case bounds not found');
  process.exit(1);
}
const originalCase = src.slice(start, end);
// original case ends with break; and whitespace
const bodyMatch = originalCase.match(/^case 'link_code_companion_reg':([\s\S]*?)\bbreak;\s*$/);
if (!bodyMatch) {
  // try without end anchor
  const m2 = originalCase.match(/^case 'link_code_companion_reg':([\s\S]*)\bbreak;\s*$/m);
  if (!m2) {
    console.error('[patch-baileys-pairing] could not parse case body');
    console.error(originalCase.slice(0, 200));
    console.error('...');
    console.error(originalCase.slice(-200));
    process.exit(1);
  }
}

const caseBody = (bodyMatch || originalCase.match(/^case 'link_code_companion_reg':([\s\S]*)\bbreak;\s*$/))[1];

const newCase = `case 'link_code_companion_reg': {
                const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');
                if (!linkCodeCompanionReg ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub') ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref') ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub')) {
                    logger.debug({ id: node.attrs?.id }, 'link_code_companion_reg notification without pairing data, skipping');
                    break;
                }
                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));
                const primaryIdentityPublicKey = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub'));
                const primaryEphemeralPublicKeyWrapped = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub'));
${caseBody.replace(/^\s*const linkCodeCompanionReg[\s\S]*?const primaryEphemeralPublicKeyWrapped = toRequiredBuffer\([^;]+;\n?/, '')}                break;
            }
            `;

// The caseBody still has the three const lines at start - strip them carefully
let rest = caseBody;
// remove first three const assignments we already rewrote
rest = rest.replace(/^\s*const linkCodeCompanionReg = getBinaryNodeChild\(node, 'link_code_companion_reg'\);\s*/, '');
rest = rest.replace(/^\s*const ref = toRequiredBuffer\(getBinaryNodeChildBuffer\(linkCodeCompanionReg, 'link_code_pairing_ref'\)\);\s*/, '');
rest = rest.replace(/^\s*const primaryIdentityPublicKey = toRequiredBuffer\(getBinaryNodeChildBuffer\(linkCodeCompanionReg, 'primary_identity_pub'\)\);\s*/, '');
rest = rest.replace(/^\s*const primaryEphemeralPublicKeyWrapped = toRequiredBuffer\(getBinaryNodeChildBuffer\(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub'\)\);\s*/, '');

const rebuilt = `case 'link_code_companion_reg': {
                const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');
                if (!linkCodeCompanionReg ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub') ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref') ||
                    !getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub')) {
                    logger.debug({ id: node.attrs?.id }, 'link_code_companion_reg notification without pairing data, skipping');
                    break;
                }
                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));
                const primaryIdentityPublicKey = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub'));
                const primaryEphemeralPublicKeyWrapped = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_wrapped_primary_ephemeral_pub'));
${rest}                break;
            }
            `;

src = src.slice(0, start) + rebuilt + src.slice(end);
writeFileSync(target, src);
console.log('[patch-baileys-pairing] applied OK →', target);
