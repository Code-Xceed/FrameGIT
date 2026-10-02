// FrameGit Core - Creative Project Change Engine
// Calculates structural, semantic diffs between two normalized project states.

class ChangeEngine {
  /**
   * Compare previous committed state and current state.
   * @param {Object} prevState Normalized ProjectState
   * @param {Object} currState Normalized ProjectState
   * @returns {Array<{type: string, description: string, details: Object}>}
   */
  static diffStates(prevState, currState) {
    const changes = [];

    if (!prevState) {
      changes.push({
        type: 'initial_project',
        description: 'Initial project state tracked',
        details: { projectPath: currState?.metadata?.projectPath }
      });
      return changes;
    }

    // 1. Diff Media Items / Assets
    const prevMedia = new Map((prevState.mediaItems || []).map(m => [m.filePath, m]));
    const currMedia = new Map((currState.mediaItems || []).map(m => [m.filePath, m]));

    for (const [path, m] of currMedia.entries()) {
      if (!prevMedia.has(path)) {
        changes.push({
          type: 'media_added',
          description: `New media asset imported: '${m.name || path}'`,
          details: { filePath: path, name: m.name }
        });
      }
    }

    for (const [path, m] of prevMedia.entries()) {
      if (!currMedia.has(path)) {
        changes.push({
          type: 'media_deleted',
          description: `Media asset removed: '${m.name || path}'`,
          details: { filePath: path, name: m.name }
        });
      }
    }

    // 2. Diff Sequences & Tracks
    const prevSeqs = new Map((prevState.sequences || []).map(s => [s.name, s]));
    const currSeqs = new Map((currState.sequences || []).map(s => [s.name, s]));

    for (const [seqName, currSeq] of currSeqs.entries()) {
      const prevSeq = prevSeqs.get(seqName);
      if (!prevSeq) {
        changes.push({
          type: 'sequence_added',
          description: `New sequence created: '${seqName}'`,
          details: { sequenceName: seqName }
        });
        continue;
      }

      // Diff Markers in sequence
      const prevMarkers = new Map((prevSeq.markers || []).map(m => [m.id || m.name || m.timeTicks, m]));
      const currMarkers = new Map((currSeq.markers || []).map(m => [m.id || m.name || m.timeTicks, m]));

      for (const [key, m] of currMarkers.entries()) {
        if (!prevMarkers.has(key)) {
          changes.push({
            type: 'marker_added',
            description: `Marker added at tick ${m.timeTicks}: '${m.name || m.comment}'`,
            details: { marker: m }
          });
        }
      }

      for (const [key, m] of prevMarkers.entries()) {
        if (!currMarkers.has(key)) {
          changes.push({
            type: 'marker_deleted',
            description: `Marker removed: '${m.name || m.comment}'`,
            details: { marker: m }
          });
        }
      }

      // Diff Clips in Tracks
      const prevClipMap = new Map();
      for (const track of prevSeq.tracks || []) {
        for (const clip of track.clips || []) {
          const key = clip.id || `${track.name}:${clip.name}`;
          prevClipMap.set(key, { track, clip });
        }
      }

      const currClipMap = new Map();
      for (const track of currSeq.tracks || []) {
        for (const clip of track.clips || []) {
          const key = clip.id || `${track.name}:${clip.name}`;
          currClipMap.set(key, { track, clip });
        }
      }

      // Check for added, moved, or trimmed clips
      for (const [key, { track, clip }] of currClipMap.entries()) {
        const prevEntry = prevClipMap.get(key);
        if (!prevEntry) {
          changes.push({
            type: 'clip_added',
            description: `Clip '${clip.name}' added to ${track.name}`,
            details: { sequence: seqName, track: track.name, clip: clip.name, start: clip.startTicks }
          });
        } else {
          const prevClip = prevEntry.clip;
          // Check position movement
          if (prevClip.startTicks !== clip.startTicks) {
            let deltaSec = '0.00';
            let deltaTicksStr = '0';
            try {
              const deltaTicks = BigInt(clip.startTicks || '0') - BigInt(prevClip.startTicks || '0');
              deltaTicksStr = deltaTicks.toString();
              if (deltaTicks > 1000000000n || deltaTicks < -1000000000n) {
                deltaSec = (Number(deltaTicks) / 254016000000).toFixed(2);
              } else {
                deltaSec = (Number(deltaTicks) / 24).toFixed(2);
              }
            } catch (_) {}

            changes.push({
              type: 'clip_moved',
              description: `Clip '${clip.name}' moved on ${track.name} (${Number(deltaSec) > 0 ? '+' : ''}${deltaSec}s)`,
              details: { sequence: seqName, track: track.name, clip: clip.name, deltaTicks: deltaTicksStr }
            });
          }

          // Check trim (in/out points)
          if (prevClip.inPointTicks !== clip.inPointTicks || prevClip.outPointTicks !== clip.outPointTicks) {
            changes.push({
              type: 'clip_trimmed',
              description: `Clip '${clip.name}' in/out points trimmed on ${track.name}`,
              details: { sequence: seqName, track: track.name, clip: clip.name }
            });
          }

          // Check effect parameter changes
          diffClipEffects(prevClip, clip, track.name, changes);
        }
      }

      // Check for deleted clips
      for (const [key, { track, clip }] of prevClipMap.entries()) {
        if (!currClipMap.has(key)) {
          changes.push({
            type: 'clip_deleted',
            description: `Clip '${clip.name}' removed from ${track.name}`,
            details: { sequence: seqName, track: track.name, clip: clip.name }
          });
        }
      }
    }

    // Check for deleted sequences
    for (const [seqName, prevSeq] of prevSeqs.entries()) {
      if (!currSeqs.has(seqName)) {
        changes.push({
          type: 'sequence_deleted',
          description: `Sequence deleted: '${seqName}'`,
          details: { sequenceName: seqName }
        });
      }
    }

    return changes;
  }
}

/**
 * Compare effects and parameter values on a clip.
 */
function diffClipEffects(prevClip, currClip, trackName, changes) {
  const prevEffects = new Map((prevClip.effects || []).map(e => [e.name, e]));
  const currEffects = new Map((currClip.effects || []).map(e => [e.name, e]));

  for (const [effName, currEff] of currEffects.entries()) {
    const prevEff = prevEffects.get(effName);
    if (!prevEff) {
      changes.push({
        type: 'effect_added',
        description: `Effect '${effName}' added to clip '${currClip.name}' on ${trackName}`,
        details: { clip: currClip.name, effect: effName }
      });
    } else {
      // Check parameters
      const prevParams = prevEff.parameters || {};
      const currParams = currEff.parameters || {};
      for (const [pKey, pVal] of Object.entries(currParams)) {
        if (prevParams[pKey] !== undefined && String(prevParams[pKey]) !== String(pVal)) {
          changes.push({
            type: 'effect_parameter_changed',
            description: `${effName} on '${currClip.name}': Parameter '${pKey}' changed (${prevParams[pKey]} -> ${pVal})`,
            details: { clip: currClip.name, effect: effName, parameter: pKey, oldVal: prevParams[pKey], newVal: pVal }
          });
        }
      }
    }
  }
}

module.exports = { ChangeEngine };
