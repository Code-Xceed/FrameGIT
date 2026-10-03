const zlib = require('node:zlib');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { create } = require('xmlbuilder2');
const { Hasher } = require('./hasher');

function getProp(node, ...keys) {
  if (!node || typeof node !== 'object') return '';
  for (const k of keys) {
    if (node[k] !== undefined && node[k] !== null) return node[k];
    if (node['@_' + k] !== undefined && node['@_' + k] !== null) return node['@_' + k];
  }
  return '';
}

class PremiereParser {
  /**
   * Decompress and parse a .prproj file into a Normalized ProjectState.
   * @param {string} prprojPath 
   * @returns {Object} Normalized ProjectState
   */
  static parseProjectFile(prprojPath) {
    const rawBuffer = fs.readFileSync(prprojPath);
    let xmlString;

    // Check GZIP magic bytes (0x1f, 0x8b)
    if (rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
      xmlString = zlib.gunzipSync(rawBuffer).toString('utf-8');
    } else {
      xmlString = rawBuffer.toString('utf-8');
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true
    });

    const parsedXml = parser.parse(xmlString);
    const premiereData = parsedXml.PremiereData || parsedXml;

    const fileHash = Hasher.hash(rawBuffer);

    // Normalize sequences, clips, effects, and media items
    const normalized = {
      version: '1.0.0',
      metadata: {
        editor: 'PremierePro',
        projectPath: prprojPath,
        rawHash: fileHash,
        rawSize: rawBuffer.length
      },
      mediaItems: [],
      sequences: []
    };

    // Extract Media Items / Footage References
    const mediaNodes = findNodes(premiereData, 'Media');
    for (const media of mediaNodes) {
      const mediaId = getProp(media, 'ObjectID', 'ObjectRef');
      const filePath = getProp(media, 'FilePath', 'ActualMediaFilePath', 'RelativePath');
      const name = getProp(media, 'Name') || filePath;
      if (filePath) {
        normalized.mediaItems.push({
          id: String(mediaId),
          filePath: String(filePath),
          name: String(name)
        });
      }
    }

    // Build fast ObjectID dictionary to resolve subclips and media
    const objectMap = new Map();
    for (const [key, val] of Object.entries(premiereData)) {
      if (key.startsWith('@_')) continue;
      const items = Array.isArray(val) ? val : [val];
      for (const item of items) {
        if (item && typeof item === 'object') {
          const id = item['@_ObjectID'];
          if (id !== undefined) objectMap.set(String(id), { tag: key, node: item });
        }
      }
    }

    // Extract Sequences
    const sequenceNodes = findNodes(premiereData, 'Sequence');
    for (const seq of sequenceNodes) {
      const seqId = getProp(seq, 'ObjectID', 'ObjectRef') || 'seq_default';
      const seqName = getProp(seq, 'Name') || 'Untitled Sequence';
      const duration = getProp(seq, 'Duration') || '0';

      const sequenceObj = {
        id: String(seqId),
        name: String(seqName),
        durationTicks: String(duration),
        tracks: [],
        markers: []
      };

      // Extract Markers
      const markerNodes = findNodes(seq, 'Marker');
      for (const m of markerNodes) {
        sequenceObj.markers.push({
          id: String(getProp(m, 'ObjectID')),
          name: String(getProp(m, 'Name')),
          timeTicks: String(getProp(m, 'Time', 'Frame') || '0'),
          comment: String(getProp(m, 'Comment')),
          color: String(getProp(m, 'Type', 'Color') || 'Default')
        });
      }

      // Extract Video and Audio Tracks
      const trackNodes = findNodes(seq, 'TrackItem');
      const trackMap = new Map();

      for (const item of trackNodes) {
        const trackIndex = getProp(item, 'TrackIndex') || '1';
        const trackType = getProp(item, 'TrackType') || 'video';
        const trackName = getProp(item, 'TrackName') || `${String(trackType).toUpperCase()} ${trackIndex}`;
        const trackKey = `${trackType}_${trackIndex}_${trackName}`;

        if (!trackMap.has(trackKey)) {
          trackMap.set(trackKey, {
            id: trackKey,
            type: trackType,
            index: parseInt(trackIndex, 10),
            name: trackName,
            clips: []
          });
        }

        const rawId = getProp(item, 'ObjectID', 'SubClipID');
        const clipName = String(getProp(item, 'Name') || 'Untitled Clip');
        const startT = String(getProp(item, 'Start') || '0');
        const inT = String(getProp(item, 'In') || '0');
        const deterministicId = 'c_' + Hasher.hash(`${trackName}:${clipName}:${startT}:${inT}`).slice(0, 16);

        const clipObj = {
          id: String(rawId || deterministicId),
          name: clipName,
          mediaId: String(getProp(item, 'MediaID', 'MediaRef') || ''),
          startTicks: startT,
          endTicks: String(getProp(item, 'End') || '0'),
          inPointTicks: inT,
          outPointTicks: String(getProp(item, 'Out') || '0'),
          effects: []
        };

        // Extract Effect Components (e.g. Lumetri Color, Motion, Volume)
        const components = findNodes(item, 'Component');
        for (const comp of components) {
          const compName = getProp(comp, 'DisplayName', 'MatchName') || 'Filter';
          const paramMap = {};

          const params = findNodes(comp, 'Parameter');
          for (const p of params) {
            const pName = getProp(p, 'Name');
            const pVal = getProp(p, 'CurrentValue', 'Value', '#text');
            if (pName) {
              paramMap[pName] = pVal;
            }
          }

          clipObj.effects.push({
            name: String(compName),
            parameters: paramMap
          });
        }

        trackMap.get(trackKey).clips.push(clipObj);
      }

      // If no simplified TrackItem nodes found, parse native Premiere VideoClipTrackItem & AudioClipTrackItem nodes
      if (trackMap.size === 0) {
        const rawVideoItems = premiereData.VideoClipTrackItem ? (Array.isArray(premiereData.VideoClipTrackItem) ? premiereData.VideoClipTrackItem : [premiereData.VideoClipTrackItem]) : [];
        const rawAudioItems = premiereData.AudioClipTrackItem ? (Array.isArray(premiereData.AudioClipTrackItem) ? premiereData.AudioClipTrackItem : [premiereData.AudioClipTrackItem]) : [];

        if (rawVideoItems.length > 0) {
          const vKey = 'video_1_VIDEO 1';
          trackMap.set(vKey, { id: vKey, type: 'video', index: 1, name: 'VIDEO 1', clips: [] });
          for (let vi = 0; vi < rawVideoItems.length; vi++) {
            const item = rawVideoItems[vi];
            const clipTrack = item.ClipTrackItem || item;
            const trackItem = clipTrack.TrackItem || {};
            const subClipRef = clipTrack.SubClip ? clipTrack.SubClip['@_ObjectRef'] : null;
            let clipName = 'Video Clip ' + (vi + 1);
            if (subClipRef && objectMap.has(String(subClipRef))) {
              const sub = objectMap.get(String(subClipRef)).node;
              clipName = sub.Name || clipName;
            }
            trackMap.get(vKey).clips.push({
              id: String(item['@_ObjectID'] || ('vc_' + vi)),
              name: String(clipName),
              mediaId: String(subClipRef || ''),
              startTicks: String(trackItem.Start || '0'),
              endTicks: String(trackItem.End || '0'),
              inPointTicks: String(trackItem.In || '0'),
              outPointTicks: String(trackItem.End || '0'),
              effects: []
            });
          }
        }

        if (rawAudioItems.length > 0) {
          const aKey = 'audio_1_AUDIO 1';
          trackMap.set(aKey, { id: aKey, type: 'audio', index: 1, name: 'AUDIO 1', clips: [] });
          for (let ai = 0; ai < rawAudioItems.length; ai++) {
            const item = rawAudioItems[ai];
            const clipTrack = item.ClipTrackItem || item;
            const trackItem = clipTrack.TrackItem || {};
            const subClipRef = clipTrack.SubClip ? clipTrack.SubClip['@_ObjectRef'] : null;
            let clipName = 'Audio Clip ' + (ai + 1);
            if (subClipRef && objectMap.has(String(subClipRef))) {
              const sub = objectMap.get(String(subClipRef)).node;
              clipName = sub.Name || clipName;
            }
            trackMap.get(aKey).clips.push({
              id: String(item['@_ObjectID'] || ('ac_' + ai)),
              name: String(clipName),
              mediaId: String(subClipRef || ''),
              startTicks: String(trackItem.Start || '0'),
              endTicks: String(trackItem.End || '0'),
              inPointTicks: String(trackItem.In || '0'),
              outPointTicks: String(trackItem.End || '0'),
              effects: []
            });
          }
        }
      }

      sequenceObj.tracks = Array.from(trackMap.values());
      normalized.sequences.push(sequenceObj);
    }

    return normalized;
  }

  /**
   * Helper to serialize an XML string to GZIP compressed buffer (for mock/synthetic .prproj creation).
   * @param {string} xmlString 
   * @returns {Buffer}
   */
  static compressXmlToGzip(xmlString) {
    return zlib.gzipSync(Buffer.from(xmlString, 'utf-8'));
  }

  /**
   * Serialize a normalized ProjectState back into a valid GZIP .prproj buffer.
   * @param {Object} state Normalized ProjectState
   * @returns {Buffer} GZIP compressed .prproj buffer
   */
  static serializeProjectState(state) {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('PremiereData', { Version: '3' });

    const projNode = doc.ele('Project', {
      ObjectID: '1',
      Name: String(state.metadata?.projectName || 'FrameGit Project')
    });

    for (const m of state.mediaItems || []) {
      projNode.ele('Media', {
        ObjectID: String(m.id || Hasher.hash(m.filePath || '').slice(0, 8)),
        FilePath: String(m.filePath || ''),
        Name: String(m.name || m.filePath || '')
      });
    }

    for (const seq of state.sequences || []) {
      const seqNode = projNode.ele('Sequence', {
        ObjectID: String(seq.id || 'seq_1'),
        Name: String(seq.name || 'Sequence'),
        Duration: String(seq.durationTicks !== undefined ? seq.durationTicks : '0')
      });

      for (const m of seq.markers || []) {
        const markerFallback = 'm_' + Hasher.hash(`${m.name}:${m.timeTicks}:${m.comment}`).slice(0, 10);
        seqNode.ele('Marker', {
          ObjectID: String(m.id || markerFallback),
          Name: String(m.name || ''),
          Time: String(m.timeTicks !== undefined ? m.timeTicks : '0'),
          Comment: String(m.comment || ''),
          Type: String(m.color || 'Cyan')
        });
      }

      for (const track of seq.tracks || []) {
        for (const clip of track.clips || []) {
          const clipFallback = 'c_' + Hasher.hash(`${track.name}:${clip.name}:${clip.startTicks}:${clip.inPointTicks}`).slice(0, 10);
          const itemNode = seqNode.ele('TrackItem', {
            ObjectID: String(clip.id || clipFallback),
            TrackIndex: String(track.index || 1),
            TrackType: String(track.type || 'video'),
            TrackName: String(track.name || ''),
            Name: String(clip.name || ''),
            MediaID: String(clip.mediaId || ''),
            Start: String(clip.startTicks !== undefined ? clip.startTicks : '0'),
            End: String(clip.endTicks !== undefined ? clip.endTicks : '0'),
            In: String(clip.inPointTicks !== undefined ? clip.inPointTicks : '0'),
            Out: String(clip.outPointTicks !== undefined ? clip.outPointTicks : '0')
          });

          for (const eff of clip.effects || []) {
            const compNode = itemNode.ele('Component', {
              DisplayName: String(eff.name || '')
            });

            for (const [pName, pVal] of Object.entries(eff.parameters || {})) {
              compNode.ele('Parameter', {
                Name: String(pName),
                CurrentValue: String(pVal !== undefined ? pVal : '')
              });
            }
          }
        }
      }
    }

    const xml = doc.end({ prettyPrint: true });
    return zlib.gzipSync(Buffer.from(xml, 'utf-8'));
  }
}

/**
 * Deep search helper to find nodes matching a tag name.
 */
function findNodes(obj, tagName, results = []) {
  if (!obj || typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findNodes(item, tagName, results);
    }
    return results;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === tagName) {
      if (Array.isArray(value)) {
        results.push(...value);
      } else {
        results.push(value);
      }
    } else if (typeof value === 'object') {
      findNodes(value, tagName, results);
    }
  }

  return results;
}

module.exports = { PremiereParser };
