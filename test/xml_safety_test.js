/**
 * FrameGit Phase 14 Test Suite: XML Safety & Entity Escaping
 * 
 * Verifies that project states containing special characters (&, <, >, ", '),
 * math symbols, quotes, and unicode/emojis serialize into valid, well-formed XML
 * and round-trip with 100% fidelity without parsing crashes or data corruption.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { XMLParser } = require('fast-xml-parser');
const { PremiereParser } = require('../core/premiere_parser');
const { ResolveAdapter } = require('../core/resolve_adapter');
const { ZipUtil } = require('../core/zip_util');

const WORKSPACE = path.join(__dirname, 'xml_safety_workspace');

test.before(() => {
  if (fs.existsSync(WORKSPACE)) {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(WORKSPACE, { recursive: true });
});

test.after(() => {
  if (fs.existsSync(WORKSPACE)) {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  }
});

test('PremiereParser: Special characters, XML entities, quotes, and unicode round-trip cleanly', () => {
  const specialClipName = `Client's Cut (v2) <APPROVED> & Final "Hero".mov`;
  const specialMarkerComment = `Need <color fix> & contrast > 1.2; check "LUT"`;
  const unicodeClipName = `🎬 Scene 1_インタビュー_A & B.mov`;
  const specialMediaFilePath = `Footage/Cam_A & B <4K>/Take'1 "Special".mov`;

  const state = {
    metadata: {
      projectName: `Commercial "Summer & Winter" <Final>`
    },
    mediaItems: [
      { id: 'm1', filePath: specialMediaFilePath, name: specialClipName },
      { id: 'm2', filePath: 'Footage/B-Roll.mov', name: unicodeClipName }
    ],
    sequences: [
      {
        id: 'seq_hero',
        name: `Hero <Main> & "Director's" Cut`,
        durationTicks: '7620480000000',
        markers: [
          {
            id: 'mark_1',
            name: 'Client Note',
            timeTicks: '120960000000',
            comment: specialMarkerComment,
            color: 'Cyan'
          }
        ],
        tracks: [
          {
            index: 1,
            type: 'video',
            name: 'VIDEO 1 (A-Roll & Titles)',
            clips: [
              {
                id: 'clip_01',
                name: specialClipName,
                mediaId: 'm1',
                startTicks: '0',
                endTicks: '3810240000000',
                inPointTicks: '0',
                outPointTicks: '3810240000000',
                effects: [
                  {
                    name: 'Lumetri Color & Grade',
                    parameters: {
                      Exposure: '1.25',
                      Temperature: '5600',
                      PresetName: 'Moody & Warm <v3>'
                    }
                  }
                ]
              },
              {
                id: 'clip_02',
                name: unicodeClipName,
                mediaId: 'm2',
                startTicks: '3810240000000',
                endTicks: '7620480000000',
                inPointTicks: '0',
                outPointTicks: '3810240000000',
                effects: []
              }
            ]
          }
        ]
      }
    ]
  };

  // 1. Serialize using xmlbuilder2
  const gzipBuf = PremiereParser.serializeProjectState(state);
  assert.ok(gzipBuf.length > 0, 'Serialized GZIP buffer must not be empty');

  // 2. Decompress and inspect raw XML text to confirm valid entity escaping
  const rawXml = zlib.gunzipSync(gzipBuf).toString('utf-8');
  assert.ok(rawXml.includes('&amp;'), 'Ampersands must be escaped as &amp;');
  assert.ok(rawXml.includes('&lt;'), 'Left angle brackets must be escaped as &lt;');
  assert.ok(rawXml.includes('&gt;'), 'Right angle brackets must be escaped as &gt;');
  assert.ok(!rawXml.includes('<APPROVED>'), 'Raw unescaped <APPROVED> must NOT appear in attributes');

  // 3. Write to disk and parse back with PremiereParser.parseProjectFile()
  const testPrproj = path.join(WORKSPACE, 'SpecialChars.prproj');
  fs.writeFileSync(testPrproj, gzipBuf);

  const parsed = PremiereParser.parseProjectFile(testPrproj);
  assert.strictEqual(parsed.sequences.length, 1);
  const parsedSeq = parsed.sequences[0];
  assert.strictEqual(parsedSeq.name, `Hero <Main> & "Director's" Cut`);

  // Verify marker comment round-tripped with full fidelity
  assert.strictEqual(parsedSeq.markers.length, 1);
  assert.strictEqual(parsedSeq.markers[0].comment, specialMarkerComment);

  // Verify clip names round-tripped with full fidelity
  const track = parsedSeq.tracks[0];
  assert.strictEqual(track.clips.length, 2);
  assert.strictEqual(track.clips[0].name, specialClipName);
  assert.strictEqual(track.clips[1].name, unicodeClipName);

  // Verify Lumetri effect parameters
  const eff = track.clips[0].effects[0];
  assert.strictEqual(eff.name, 'Lumetri Color & Grade');
  assert.strictEqual(eff.parameters.Exposure, '1.25');
  assert.strictEqual(eff.parameters.PresetName, 'Moody & Warm <v3>');
});

test('ResolveAdapter: Special characters and unicode serialize and unpack cleanly', () => {
  const adapter = new ResolveAdapter();
  const specialClipName = `Resolve "Grade & Conform" <Final>.braw`;

  const state = {
    metadata: {
      projectName: `Nature "Doc & Reel" <4K>`,
      timelineFrameRate: '24'
    },
    mediaItems: [
      { id: 'clip_braw_1', name: specialClipName, filePath: `Media/BRAW & ProRes/Take'1.braw` }
    ],
    sequences: [
      {
        id: 'seq_timeline',
        name: `Timeline 1 (Main & "Selects")`,
        durationTicks: '240',
        markers: [
          { id: 'm1', name: 'Color Note', timeTicks: '48', comment: 'Fix <hotspot> & LUT "contrast"', color: 'Blue' }
        ],
        tracks: [
          {
            type: 'video',
            name: 'VIDEO 1',
            clips: [
              {
                id: 'item_1',
                name: specialClipName,
                mediaId: 'clip_braw_1',
                startTicks: '0',
                endTicks: '120',
                inPointTicks: '0',
                outPointTicks: '120'
              }
            ]
          }
        ]
      }
    ]
  };

  // 1. Serialize into DRP ZIP archive
  const drpBuffer = adapter.serializeProjectState(state);
  assert.ok(drpBuffer.length > 0);

  // 2. Unpack files and verify well-formedness
  const unpacked = ZipUtil.unpack(drpBuffer);
  assert.ok(unpacked.has('project.xml'));
  assert.ok(unpacked.has('MediaPool/MediaPool.xml'));
  assert.ok(unpacked.has('SeqContainer/Sequence_1.xml'));

  const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

  const projectXml = unpacked.get('project.xml').toString('utf-8');
  const projectObj = xmlParser.parse(projectXml);
  assert.strictEqual(projectObj.Project['@_Name'], `Nature "Doc & Reel" <4K>`);

  const mediaXml = unpacked.get('MediaPool/MediaPool.xml').toString('utf-8');
  const mediaObj = xmlParser.parse(mediaXml);
  assert.strictEqual(mediaObj.MediaPool.Clip['@_Name'], specialClipName);

  const seqXml = unpacked.get('SeqContainer/Sequence_1.xml').toString('utf-8');
  const seqObj = xmlParser.parse(seqXml);
  assert.strictEqual(seqObj.Sequence['@_Name'], `Timeline 1 (Main & "Selects")`);
  assert.strictEqual(seqObj.Sequence.Marker['@_Comment'], 'Fix <hotspot> & LUT "contrast"');
  assert.strictEqual(seqObj.Sequence.Track.Item['@_Name'], specialClipName);
});
