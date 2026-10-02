/**
 * FrameGit Phase 20 Test Suite: Real Project File Validation & Round-Trip Fidelity
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PremiereParser } = require('../core/premiere_parser');
const { ResolveAdapter } = require('../core/resolve_adapter');
const { generateAllFixtures } = require('./fixtures/generate_fixtures');

test('Premiere Pro Real Fixture - 4K Commercial Campaign Round-Trip Fidelity', () => {
  const { p1: prprojPath } = generateAllFixtures();
  assert.ok(fs.existsSync(prprojPath));

  // 1. Initial parse of real 4K commercial project
  const state1 = PremiereParser.parseProjectFile(prprojPath);
  assert.strictEqual(state1.metadata.editor, 'PremierePro');
  assert.ok(state1.metadata.rawSize > 500);

  // Validate media items
  assert.strictEqual(state1.mediaItems.length, 5);
  const heroMedia = state1.mediaItems.find(m => m.id === 'media_001');
  assert.ok(heroMedia);
  assert.ok(heroMedia.filePath.includes('A001_C001_0428QX_001.mov'));

  // Validate sequence and tracks
  assert.strictEqual(state1.sequences.length, 1);
  const heroSeq = state1.sequences[0];
  assert.strictEqual(heroSeq.name, 'Commercial_Hero_30s_4K');
  assert.strictEqual(heroSeq.markers.length, 3);
  assert.ok(heroSeq.markers.some(m => m.name === 'Beat Drop' && m.comment.includes('fast cut b-roll')));

  // Check video and audio tracks
  assert.strictEqual(heroSeq.tracks.length, 4); // 2 Video, 2 Audio
  const v1 = heroSeq.tracks.find(t => t.name.includes('VIDEO 1'));
  assert.ok(v1);
  assert.strictEqual(v1.clips.length, 2);

  // Check Lumetri Color effect on Video 1 clip
  const clip1 = v1.clips[0];
  assert.ok(clip1.effects.length > 0);
  const lumetri = clip1.effects.find(e => e.name === 'Lumetri Color');
  assert.ok(lumetri);
  assert.strictEqual(lumetri.parameters.Exposure, '0.65');
  assert.strictEqual(lumetri.parameters.Temperature, '5600');
  assert.strictEqual(lumetri.parameters.Contrast, '22');

  // 2. Re-serialize and re-parse to guarantee round-trip fidelity
  const roundTripBuffer = PremiereParser.serializeProjectState(state1);
  const tempPrproj = path.join(__dirname, 'temp_roundtrip.prproj');
  fs.writeFileSync(tempPrproj, roundTripBuffer);

  try {
    const state2 = PremiereParser.parseProjectFile(tempPrproj);

    // Deep assertions on reconstructed state
    assert.strictEqual(state2.sequences.length, state1.sequences.length);
    assert.strictEqual(state2.sequences[0].name, state1.sequences[0].name);
    assert.strictEqual(state2.sequences[0].tracks.length, state1.sequences[0].tracks.length);
    assert.strictEqual(state2.sequences[0].markers.length, state1.sequences[0].markers.length);

    const reV1 = state2.sequences[0].tracks.find(t => t.name.includes('VIDEO 1'));
    assert.ok(reV1);
    assert.strictEqual(reV1.clips.length, 2);
    const reLumetri = reV1.clips[0].effects.find(e => e.name === 'Lumetri Color');
    assert.ok(reLumetri);
    assert.strictEqual(reLumetri.parameters.Exposure, '0.65');
    assert.strictEqual(reLumetri.parameters.Temperature, '5600');
  } finally {
    try {
      if (fs.existsSync(tempPrproj)) fs.unlinkSync(tempPrproj);
    } catch (_) {}
  }
});

test('DaVinci Resolve Real Fixture - Documentary Feature Round-Trip Fidelity', () => {
  const { p2: drpPath } = generateAllFixtures();
  assert.ok(fs.existsSync(drpPath));

  const adapter = new ResolveAdapter();

  // 1. Initial parse of real .drp archive
  const resolveState1 = adapter.getProjectState(drpPath);
  assert.strictEqual(resolveState1.metadata.editor, 'DaVinciResolve');
  assert.strictEqual(resolveState1.metadata.projectName, 'Nature_Documentary_Feature');

  // Validate media pool
  assert.strictEqual(resolveState1.mediaPool.length, 3);
  const rawClip = resolveState1.mediaPool.find(m => m.name.includes('RawWildlife'));
  assert.ok(rawClip);

  // Validate timeline
  assert.strictEqual(resolveState1.sequences.length, 1);
  const act1 = resolveState1.sequences[0];
  assert.strictEqual(act1.name, 'Act_1_The_Canopy');
  assert.strictEqual(act1.markers.length, 1);
  assert.strictEqual(act1.markers[0].name, 'Grade Check');

  // Check clips on Video 1
  assert.strictEqual(act1.tracks.length, 1);
  assert.strictEqual(act1.tracks[0].clips.length, 2);
  assert.strictEqual(act1.tracks[0].clips[0].name, 'A001_C001_RawWildlife_4K.braw');

  // 2. Re-serialize and re-parse to guarantee round-trip fidelity
  const roundTripDrp = adapter.serializeProjectState(resolveState1);
  const tempDrp = path.join(__dirname, 'temp_roundtrip.drp');
  fs.writeFileSync(tempDrp, roundTripDrp);

  try {
    const resolveState2 = adapter.getProjectState(tempDrp);
    assert.strictEqual(resolveState2.metadata.projectName, resolveState1.metadata.projectName);
    assert.strictEqual(resolveState2.mediaPool.length, resolveState1.mediaPool.length);
    assert.strictEqual(resolveState2.sequences.length, resolveState1.sequences.length);
    assert.strictEqual(resolveState2.sequences[0].name, resolveState1.sequences[0].name);
    assert.strictEqual(resolveState2.sequences[0].tracks[0].clips.length, 2);
    assert.strictEqual(resolveState2.sequences[0].markers[0].name, 'Grade Check');
  } finally {
    try {
      if (fs.existsSync(tempDrp)) fs.unlinkSync(tempDrp);
    } catch (_) {}
  }
});
