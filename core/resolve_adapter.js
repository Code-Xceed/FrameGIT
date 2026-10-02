const fs = require('node:fs');
const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { create } = require('xmlbuilder2');
const { CreativeEditorAdapter } = require('./editor_adapter');
const { ZipUtil } = require('./zip_util');
const { Hasher } = require('./hasher');
const { wrapFsOperation } = require('./errors');

function getProp(node, ...keys) {
  if (!node || typeof node !== 'object') return '';
  for (const k of keys) {
    if (node[k] !== undefined && node[k] !== null) return node[k];
    if (node['@_' + k] !== undefined && node['@_' + k] !== null) return node['@_' + k];
  }
  return '';
}

function findNodes(obj, tagName, results = []) {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    for (const item of obj) findNodes(item, tagName, results);
    return results;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === tagName) {
      if (Array.isArray(value)) results.push(...value);
      else results.push(value);
    } else if (typeof value === 'object') {
      findNodes(value, tagName, results);
    }
  }
  return results;
}

class ResolveAdapter extends CreativeEditorAdapter {
  constructor() {
    super('DaVinciResolve', {
      supportsPushEvents: false,
      supportsLiveColorNodeDiff: false, // Color node graphs are stored as proprietary binary blobs
      projectModel: 'database_export',
      fileExtension: '.drp'
    });
  }

  /**
   * Parse a DaVinci Resolve Project (.drp) ZIP archive into normalized ProjectState.
   * @param {string} projectPath 
   * @returns {Object} Normalized ProjectState
   */
  getProjectState(projectPath) {
    const rawBuffer = fs.readFileSync(projectPath);
    const files = ZipUtil.unpack(rawBuffer);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true
    });

    const normalized = {
      version: '1.0.0',
      metadata: {
        editor: 'DaVinciResolve',
        projectPath,
        rawHash: Hasher.hash(rawBuffer),
        rawSize: rawBuffer.length,
        colorScience: 'DaVinci YRGB',
        timelineFrameRate: '24'
      },
      mediaItems: [],
      mediaPool: [],
      sequences: []
    };

    // 1. Parse project.xml (Project settings & metadata)
    const projectXmlBuf = files.get('project.xml');
    if (projectXmlBuf) {
      const projXml = parser.parse(projectXmlBuf.toString('utf-8'));
      normalized.metadata.projectName = getProp(projXml.Project || projXml, 'Name') || 'Resolve Project';
      normalized.metadata.timelineFrameRate = String(getProp(projXml.Project || projXml, 'FrameRate') || '24');
    }

    // 2. Parse MediaPool/*.xml for media references
    for (const [filePath, content] of files.entries()) {
      if (filePath.startsWith('MediaPool') && filePath.endsWith('.xml')) {
        const parsedPool = parser.parse(content.toString('utf-8'));
        const clipNodes = findNodes(parsedPool, 'Clip');
        for (const c of clipNodes) {
          const mediaPath = getProp(c, 'FilePath', 'Path');
          const mediaName = getProp(c, 'Name') || mediaPath;
          if (mediaPath) {
            const item = {
              id: String(getProp(c, 'ID', 'ClipID') || Hasher.hash(mediaPath).slice(0, 12)),
              filePath: String(mediaPath),
              name: String(mediaName)
            };
            normalized.mediaItems.push(item);
            normalized.mediaPool.push(item);
          }
        }
      }
    }

    // 3. Parse SeqContainer/*.xml for Timelines
    for (const [filePath, content] of files.entries()) {
      if (filePath.startsWith('SeqContainer') && filePath.endsWith('.xml')) {
        const parsedSeq = parser.parse(content.toString('utf-8'));
        const seqRoot = parsedSeq.Sequence || parsedSeq;

        const seqObj = {
          id: String(getProp(seqRoot, 'ID', 'SeqID') || path.basename(filePath, '.xml')),
          name: String(getProp(seqRoot, 'Name') || 'Resolve Timeline'),
          durationTicks: String(getProp(seqRoot, 'Duration') || '0'),
          tracks: [],
          markers: []
        };

        // Extract Markers
        const markers = findNodes(seqRoot, 'Marker');
        for (const m of markers) {
          seqObj.markers.push({
            id: String(getProp(m, 'ID')),
            name: String(getProp(m, 'Name', 'Note')),
            timeTicks: String(getProp(m, 'Frame', 'Time') || '0'),
            comment: String(getProp(m, 'Comment', 'Note')),
            color: String(getProp(m, 'Color') || 'Cyan')
          });
        }

        // Extract Video/Audio Tracks and Clips
        const trackNodes = findNodes(seqRoot, 'Track');
        for (let tIdx = 0; tIdx < trackNodes.length; tIdx++) {
          const t = trackNodes[tIdx];
          const trackType = getProp(t, 'Type') || 'video';
          const trackName = getProp(t, 'Name') || `${trackType.toUpperCase()} ${tIdx + 1}`;

          const trackObj = {
            id: `track_${tIdx + 1}`,
            type: trackType,
            index: tIdx + 1,
            name: trackName,
            clips: []
          };

          const clipItems = findNodes(t, 'Item') || findNodes(t, 'Clip');
          for (const item of clipItems) {
            const rawId = getProp(item, 'ID');
            const clipName = String(getProp(item, 'Name') || 'Resolve Clip');
            const startT = String(getProp(item, 'Start', 'In') || '0');
            const inT = String(getProp(item, 'LeftOffset', 'In') || '0');
            const deterministicId = 'r_' + Hasher.hash(`${trackName}:${clipName}:${startT}:${inT}`).slice(0, 16);

            trackObj.clips.push({
              id: String(rawId || deterministicId),
              name: clipName,
              mediaId: String(getProp(item, 'MediaID', 'ClipID') || ''),
              startTicks: startT,
              endTicks: String(getProp(item, 'End', 'Out') || '0'),
              inPointTicks: inT,
              outPointTicks: String(getProp(item, 'Duration') || '0'),
              effects: []
            });
          }

          seqObj.tracks.push(trackObj);
        }

        normalized.sequences.push(seqObj);
      }
    }

    return normalized;
  }

  createSnapshot(projectPath) {
    return fs.readFileSync(projectPath);
  }

  restoreSnapshot(snapshotBuffer, targetPath) {
    wrapFsOperation(() => fs.writeFileSync(targetPath, snapshotBuffer), targetPath, 'write');
  }

  serializeProjectState(state) {
    return ResolveAdapter.serializeProjectState(state);
  }

  static serializeProjectState(state) {
    const files = new Map();
    const projName = String(state.metadata?.projectName || 'Resolve Project');
    const fps = String(state.metadata?.timelineFrameRate || '24');

    const projDoc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Project', {
        Name: projName,
        FrameRate: fps,
        ColorScience: 'DaVinci YRGB'
      });
    files.set('project.xml', Buffer.from(projDoc.end({ prettyPrint: true }), 'utf-8'));

    const mediaDoc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('MediaPool');
    for (const m of state.mediaItems || state.mediaPool || []) {
      mediaDoc.ele('Clip', {
        ID: String(m.id || ''),
        Name: String(m.name || ''),
        FilePath: String(m.filePath || m.path || '')
      });
    }
    files.set('MediaPool/MediaPool.xml', Buffer.from(mediaDoc.end({ prettyPrint: true }), 'utf-8'));

    for (let sIdx = 0; sIdx < (state.sequences || []).length; sIdx++) {
      const seq = state.sequences[sIdx];
      const seqDoc = create({ version: '1.0', encoding: 'UTF-8' })
        .ele('Sequence', {
          ID: String(seq.id || `seq_${sIdx + 1}`),
          Name: String(seq.name || `Sequence ${sIdx + 1}`),
          Duration: String(seq.durationTicks !== undefined ? seq.durationTicks : (seq.endFrame || '0'))
        });

      for (const m of seq.markers || []) {
        seqDoc.ele('Marker', {
          ID: String(m.id || ''),
          Name: String(m.name || ''),
          Frame: String(m.timeTicks !== undefined ? m.timeTicks : (m.frame || '0')),
          Comment: String(m.comment || m.note || ''),
          Color: String(m.color || 'Cyan')
        });
      }

      for (const track of seq.tracks || []) {
        const trackNode = seqDoc.ele('Track', {
          Type: String(track.type || 'video'),
          Name: String(track.name || '')
        });

        for (const clip of track.clips || []) {
          trackNode.ele('Item', {
            ID: String(clip.id || ''),
            Name: String(clip.name || ''),
            ClipID: String(clip.mediaId || ''),
            Start: String(clip.startTicks !== undefined ? clip.startTicks : (clip.startFrame || '0')),
            End: String(clip.endTicks !== undefined ? clip.endTicks : (clip.endFrame || '0')),
            LeftOffset: String(clip.inPointTicks !== undefined ? clip.inPointTicks : (clip.inPoint || '0')),
            Duration: String(clip.outPointTicks !== undefined ? clip.outPointTicks : (clip.outPoint || '0'))
          });
        }
      }

      files.set(`SeqContainer/Sequence_${sIdx + 1}.xml`, Buffer.from(seqDoc.end({ prettyPrint: true }), 'utf-8'));
    }

    return ZipUtil.pack(files);
  }

  openProject(projectPath) {
    // In real DaVinci Resolve environment: ProjectManager.LoadProject() or ImportProject()
    return { opened: true, projectPath, editor: 'DaVinciResolve' };
  }
}

module.exports = { ResolveAdapter };
