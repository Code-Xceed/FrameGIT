/**
 * FrameGit Fixture Generator
 * Generates realistic commercial video project fixtures (.prproj and .drp)
 * with complex multi-track timelines, 4K footage references, Lumetri grades, and markers.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PremiereParser } = require('../../core/premiere_parser');
const { ResolveAdapter } = require('../../core/resolve_adapter');

const FIXTURES_DIR = path.resolve(__dirname);

function generateCommercialPrproj() {
  const prprojPath = path.join(FIXTURES_DIR, 'commercial_4k.prproj');
  const TICKS_PER_SEC = 254016000000n;

  const complexState = {
    version: '1.0.0',
    metadata: {
      editor: 'PremierePro',
      projectName: 'Commercial_4K_Campaign'
    },
    mediaItems: [
      { id: 'media_001', filePath: 'Footage/A-Roll/A001_C001_0428QX_001.mov', name: 'Hero Interview 4K ProRes 422HQ' },
      { id: 'media_002', filePath: 'Footage/B-Roll/DJI_0492_Drone_Sunset.mov', name: 'Drone Sunset Cityscape 4K' },
      { id: 'media_003', filePath: 'Audio/Mix/VO_Commercial_Master_v3.wav', name: 'Voiceover 48kHz 24-bit' },
      { id: 'media_004', filePath: 'Audio/Music/Cinematic_Uplifting_120bpm.wav', name: 'Soundtrack Stereo 48kHz' },
      { id: 'media_005', filePath: 'Graphics/LowerThird_Animated.mogrt', name: 'Branded Lower Third MOGRT' }
    ],
    sequences: [
      {
        id: 'seq_hero_30s',
        name: 'Commercial_Hero_30s_4K',
        durationTicks: String(30n * TICKS_PER_SEC),
        markers: [
          { id: 'm_001', name: 'Beat Drop', timeTicks: String(8n * TICKS_PER_SEC), comment: 'Transition to fast cut b-roll', color: 'Green' },
          { id: 'm_002', name: 'Client Feedback', timeTicks: String(22n * TICKS_PER_SEC), comment: 'Adjust logo opacity per legal', color: 'Red' },
          { id: 'm_003', name: 'End Card', timeTicks: String(27n * TICKS_PER_SEC), comment: 'Fade to black & CTA', color: 'Cyan' }
        ],
        tracks: [
          {
            id: 'video_1_V1',
            type: 'video',
            index: 1,
            name: 'VIDEO 1 (A-Roll)',
            clips: [
              {
                id: 'clip_v1_01',
                name: 'A001_C001_0428QX_001.mov',
                mediaId: 'media_001',
                startTicks: String(0n),
                endTicks: String(12n * TICKS_PER_SEC),
                inPointTicks: String(5n * TICKS_PER_SEC),
                outPointTicks: String(17n * TICKS_PER_SEC),
                effects: [
                  {
                    name: 'Lumetri Color',
                    parameters: {
                      'Exposure': '0.65',
                      'Temperature': '5600',
                      'Contrast': '22',
                      'Highlights': '-18',
                      'Shadows': '12',
                      'Vibrance': '15'
                    }
                  }
                ]
              },
              {
                id: 'clip_v1_02',
                name: 'A001_C001_0428QX_001.mov',
                mediaId: 'media_001',
                startTicks: String(18n * TICKS_PER_SEC),
                endTicks: String(30n * TICKS_PER_SEC),
                inPointTicks: String(25n * TICKS_PER_SEC),
                outPointTicks: String(37n * TICKS_PER_SEC),
                effects: [
                  {
                    name: 'Lumetri Color',
                    parameters: {
                      'Exposure': '0.70',
                      'Temperature': '5800',
                      'Contrast': '25'
                    }
                  }
                ]
              }
            ]
          },
          {
            id: 'video_2_V2',
            type: 'video',
            index: 2,
            name: 'VIDEO 2 (B-Roll & GFX)',
            clips: [
              {
                id: 'clip_v2_01',
                name: 'DJI_0492_Drone_Sunset.mov',
                mediaId: 'media_002',
                startTicks: String(12n * TICKS_PER_SEC),
                endTicks: String(18n * TICKS_PER_SEC),
                inPointTicks: String(2n * TICKS_PER_SEC),
                outPointTicks: String(8n * TICKS_PER_SEC),
                effects: [
                  {
                    name: 'Lumetri Color',
                    parameters: {
                      'Exposure': '0.20',
                      'Saturation': '120'
                    }
                  }
                ]
              },
              {
                id: 'clip_v2_02',
                name: 'LowerThird_Animated.mogrt',
                mediaId: 'media_005',
                startTicks: String(2n * TICKS_PER_SEC),
                endTicks: String(7n * TICKS_PER_SEC),
                inPointTicks: '0',
                outPointTicks: String(5n * TICKS_PER_SEC),
                effects: []
              }
            ]
          },
          {
            id: 'audio_1_A1',
            type: 'audio',
            index: 1,
            name: 'AUDIO 1 (Voiceover)',
            clips: [
              {
                id: 'clip_a1_01',
                name: 'VO_Commercial_Master_v3.wav',
                mediaId: 'media_003',
                startTicks: String(1n * TICKS_PER_SEC),
                endTicks: String(29n * TICKS_PER_SEC),
                inPointTicks: '0',
                outPointTicks: String(28n * TICKS_PER_SEC),
                effects: [
                  {
                    name: 'Volume',
                    parameters: { 'Level': '0.0' }
                  }
                ]
              }
            ]
          },
          {
            id: 'audio_2_A2',
            type: 'audio',
            index: 2,
            name: 'AUDIO 2 (Music Bed)',
            clips: [
              {
                id: 'clip_a2_01',
                name: 'Cinematic_Uplifting_120bpm.wav',
                mediaId: 'media_004',
                startTicks: '0',
                endTicks: String(30n * TICKS_PER_SEC),
                inPointTicks: '0',
                outPointTicks: String(30n * TICKS_PER_SEC),
                effects: [
                  {
                    name: 'Volume',
                    parameters: { 'Level': '-8.5' }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const gzippedBuffer = PremiereParser.serializeProjectState(complexState);
  fs.writeFileSync(prprojPath, gzippedBuffer);
  return prprojPath;
}

function generateFeatureDocDrp() {
  const drpPath = path.join(FIXTURES_DIR, 'feature_doc.drp');
  const complexResolveState = {
    version: '1.0.0',
    metadata: {
      editor: 'DaVinciResolve',
      projectName: 'Nature_Documentary_Feature',
      fps: 24
    },
    mediaPool: [
      { id: 'item_raw_01', name: 'A001_C001_RawWildlife_4K.braw', path: 'Media/RAW/A001_C001_RawWildlife_4K.braw' },
      { id: 'item_raw_02', name: 'B002_C014_CanopyDrone_60fps.braw', path: 'Media/RAW/B002_C014_CanopyDrone_60fps.braw' },
      { id: 'item_amb_01', name: 'Rainforest_Ambience_Ambisonics.wav', path: 'Audio/Rainforest_Ambience_Ambisonics.wav' }
    ],
    sequences: [
      {
        id: 'timeline_act1',
        name: 'Act_1_The_Canopy',
        fps: 24,
        startFrame: 0,
        endFrame: 1440, // 60 seconds
        tracks: [
          {
            name: 'VIDEO 1',
            type: 'video',
            clips: [
              {
                id: 'clip_res_01',
                name: 'A001_C001_RawWildlife_4K.braw',
                startFrame: 0,
                endFrame: 720,
                inPoint: 100,
                outPoint: 820
              },
              {
                id: 'clip_res_02',
                name: 'B002_C014_CanopyDrone_60fps.braw',
                startFrame: 720,
                endFrame: 1440,
                inPoint: 0,
                outPoint: 720
              }
            ]
          }
        ],
        markers: [
          { frame: 360, name: 'Grade Check', note: 'Balance green saturation in leaves', color: 'Yellow' }
        ]
      }
    ]
  };

  const drpBuffer = ResolveAdapter.serializeProjectState(complexResolveState);
  fs.writeFileSync(drpPath, drpBuffer);
  return drpPath;
}

function generateAllFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  const p1 = generateCommercialPrproj();
  const p2 = generateFeatureDocDrp();
  return { p1, p2 };
}

if (require.main === module) {
  const { p1, p2 } = generateAllFixtures();
  console.log(`Generated fixtures:\n  • ${p1}\n  • ${p2}`);
}

module.exports = {
  generateAllFixtures,
  generateCommercialPrproj,
  generateFeatureDocDrp
};
