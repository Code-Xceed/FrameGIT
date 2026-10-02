// FrameGit Core - Creative Visual Diff Engine
// Generates interactive HTML/SVG timeline diffs and high-density terminal diff representations
// for creative video editing projects (Premiere Pro, DaVinci Resolve).

const { ChangeEngine } = require('./change_engine');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TICKS_PER_SECOND_PREMIERE = 254016000000n;

class VisualDiff {
  /**
   * Convert ticks into SMPTE Timecode string (HH:MM:SS:FF)
   * @param {string|bigint|number} ticks 
   * @param {number} [fps=24]
   * @returns {string}
   */
  static ticksToTimecode(ticks, fps = 24) {
    try {
      const bTicks = BigInt(ticks || 0);
      // Check if ticks are large Premiere ticks or frame numbers
      let totalSeconds;
      if (bTicks > 1000000000n) {
        totalSeconds = Number(bTicks) / Number(TICKS_PER_SECOND_PREMIERE);
      } else {
        totalSeconds = Number(bTicks) / fps;
      }

      const totalFrames = Math.round(totalSeconds * fps);
      const ff = totalFrames % fps;
      const s = Math.floor(totalSeconds) % 60;
      const m = Math.floor(totalSeconds / 60) % 60;
      const h = Math.floor(totalSeconds / 3600);

      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ff)}`;
    } catch {
      return '00:00:00:00';
    }
  }

  /**
   * Compare two project states and generate structured timeline diff model.
   * @param {Object} prevState Base/Previous Normalized ProjectState
   * @param {Object} currState Head/Current Normalized ProjectState
   * @returns {Object} Structured visual diff model
   */
  static computeVisualDiff(prevState, currState) {
    const rawChanges = ChangeEngine.diffStates(prevState, currState);

    const prevSeq = prevState?.sequences?.[0] || null;
    const currSeq = currState?.sequences?.[0] || null;
    const seqName = currSeq?.name || prevSeq?.name || 'Timeline';

    // Collect all tracks across both states
    const trackOrder = [];
    const prevTracks = new Map((prevSeq?.tracks || []).map(t => [t.name, t]));
    const currTracks = new Map((currSeq?.tracks || []).map(t => [t.name, t]));

    for (const t of prevSeq?.tracks || []) {
      if (!trackOrder.includes(t.name)) trackOrder.push(t.name);
    }
    for (const t of currSeq?.tracks || []) {
      if (!trackOrder.includes(t.name)) trackOrder.push(t.name);
    }

    // Determine timeline duration
    const prevDur = BigInt(prevSeq?.durationTicks || '0');
    const currDur = BigInt(currSeq?.durationTicks || '0');
    const maxDur = prevDur > currDur ? prevDur : currDur;
    const durationTicks = maxDur > 0n ? maxDur : 725760000000n; // fallback 30s

    const tracksDiff = [];

    for (const trackName of trackOrder) {
      const pTrack = prevTracks.get(trackName) || null;
      const cTrack = currTracks.get(trackName) || null;

      const trackType = cTrack?.type || pTrack?.type || 'video';
      const trackClips = [];

      const pClipsMap = new Map((pTrack?.clips || []).map(c => [c.id || `${c.name}:${c.startTicks}`, c]));
      const cClipsMap = new Map((cTrack?.clips || []).map(c => [c.id || `${c.name}:${c.startTicks}`, c]));

      // 1. Clips present in current
      for (const [key, cClip] of cClipsMap.entries()) {
        const pClip = pClipsMap.get(key);
        if (!pClip) {
          // Added Clip
          trackClips.push({
            status: 'ADDED',
            name: cClip.name,
            mediaId: cClip.mediaId,
            startTicks: cClip.startTicks,
            endTicks: cClip.endTicks,
            startTimecode: this.ticksToTimecode(cClip.startTicks),
            endTimecode: this.ticksToTimecode(cClip.endTicks),
            effects: cClip.effects || [],
            diffDetails: ['New clip inserted onto timeline']
          });
        } else {
          // Compare clip properties
          const details = [];
          let status = 'UNCHANGED';

          // Position movement
          if (pClip.startTicks !== cClip.startTicks) {
            status = 'MOVED';
            const deltaTicks = BigInt(cClip.startTicks) - BigInt(pClip.startTicks);
            const deltaSec = (Number(deltaTicks) / 254016000000).toFixed(2);
            details.push(`Moved position by ${Number(deltaSec) > 0 ? '+' : ''}${deltaSec}s`);
          }

          // In/Out trim
          if (pClip.inPointTicks !== cClip.inPointTicks || pClip.outPointTicks !== cClip.outPointTicks) {
            status = status === 'MOVED' ? 'MODIFIED' : 'TRIMMED';
            details.push('Trimmed In/Out edit points');
          }

          // Effect parameter changes
          const effectChanges = this.diffEffects(pClip.effects, cClip.effects);
          if (effectChanges.length > 0) {
            status = 'EFFECT_MODIFIED';
            details.push(...effectChanges);
          }

          trackClips.push({
            status,
            name: cClip.name,
            mediaId: cClip.mediaId,
            startTicks: cClip.startTicks,
            endTicks: cClip.endTicks,
            startTimecode: this.ticksToTimecode(cClip.startTicks),
            endTimecode: this.ticksToTimecode(cClip.endTicks),
            effects: cClip.effects || [],
            diffDetails: details
          });
        }
      }

      // 2. Deleted clips
      for (const [key, pClip] of pClipsMap.entries()) {
        if (!cClipsMap.has(key)) {
          trackClips.push({
            status: 'DELETED',
            name: pClip.name,
            mediaId: pClip.mediaId,
            startTicks: pClip.startTicks,
            endTicks: pClip.endTicks,
            startTimecode: this.ticksToTimecode(pClip.startTicks),
            endTimecode: this.ticksToTimecode(pClip.endTicks),
            effects: pClip.effects || [],
            diffDetails: ['Clip removed from track']
          });
        }
      }

      tracksDiff.push({
        name: trackName,
        type: trackType,
        clips: trackClips
      });
    }

    return {
      sequenceName: seqName,
      durationTicks: durationTicks.toString(),
      durationTimecode: this.ticksToTimecode(durationTicks),
      tracks: tracksDiff,
      rawChanges
    };
  }

  /**
   * Helper to format clip effect parameter deltas.
   */
  static diffEffects(prevEffects = [], currEffects = []) {
    const details = [];
    const pEffMap = new Map(prevEffects.map(e => [e.name, e]));
    const cEffMap = new Map(currEffects.map(e => [e.name, e]));

    for (const [name, cEff] of cEffMap.entries()) {
      const pEff = pEffMap.get(name);
      if (!pEff) {
        details.push(`Effect added: ${name}`);
      } else {
        const pParams = pEff.parameters || {};
        const cParams = cEff.parameters || {};
        for (const [k, v] of Object.entries(cParams)) {
          if (pParams[k] !== undefined && String(pParams[k]) !== String(v)) {
            details.push(`${name} • ${k}: ${pParams[k]} -> ${v}`);
          }
        }
      }
    }

    for (const name of pEffMap.keys()) {
      if (!cEffMap.has(name)) {
        details.push(`Effect removed: ${name}`);
      }
    }

    return details;
  }

  /**
   * Render high-density terminal ASCII timeline diff.
   * @param {Object} prevState 
   * @param {Object} currState 
   * @returns {string}
   */
  static formatAsciiDiff(prevState, currState) {
    const diff = this.computeVisualDiff(prevState, currState);
    const lines = [];

    lines.push(`TIMELINE VISUAL DIFF: "${diff.sequenceName}" [${diff.durationTimecode}]`);
    lines.push('='.repeat(70));

    const totalDur = BigInt(diff.durationTicks || '1');
    const cols = 50;

    for (const track of diff.tracks) {
      lines.push(`\n[ ${track.name.padEnd(16)} ]`);
      let trackBar = new Array(cols).fill('·');

      for (const clip of track.clips) {
        const cStart = BigInt(clip.startTicks || '0');
        const cEnd = BigInt(clip.endTicks || '0');
        const sCol = Math.max(0, Math.min(cols - 1, Number((cStart * BigInt(cols)) / totalDur)));
        const eCol = Math.max(sCol + 1, Math.min(cols, Number((cEnd * BigInt(cols)) / totalDur)));

        let char = '█';
        if (clip.status === 'ADDED') char = '+';
        else if (clip.status === 'DELETED') char = 'X';
        else if (clip.status === 'MOVED') char = '>';
        else if (clip.status === 'EFFECT_MODIFIED') char = '*';
        else if (clip.status === 'TRIMMED' || clip.status === 'MODIFIED') char = '~';

        for (let i = sCol; i < eCol; i++) {
          trackBar[i] = char;
        }
      }

      lines.push(`  |${trackBar.join('')}|`);
      for (const clip of track.clips) {
        if (clip.status !== 'UNCHANGED') {
          const detailStr = clip.diffDetails.length > 0 ? ` (${clip.diffDetails.join(', ')})` : '';
          lines.push(`    • [${clip.status}] ${clip.name} @ ${clip.startTimecode}${detailStr}`);
        }
      }
    }

    lines.push('\n' + '-'.repeat(70));
    lines.push('Legend: [█ Unchanged] [+ Added] [X Deleted] [> Moved] [* Effect/Grade] [~ Trimmed]');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Render rich interactive HTML / SVG visual diff canvas.
   * Can be rendered directly in Adobe Premiere UXP panel, web browsers, or saved to file.
   * @param {Object} prevState 
   * @param {Object} currState 
   * @param {Object} [options={}]
   * @returns {string} HTML string
   */
  static renderHtmlDiff(prevState, currState, { title = 'FrameGit Visual Timeline Diff', width = 900 } = {}) {
    const diff = this.computeVisualDiff(prevState, currState);
    const totalDur = BigInt(diff.durationTicks || '1');

    const trackHeight = 44;
    const headerHeight = 36;
    const rulerHeight = 30;
    const canvasWidth = width - 180; // track label margin
    const totalHeight = headerHeight + rulerHeight + (diff.tracks.length * (trackHeight + 12)) + 60;

    // Build Timecode Ruler ticks
    let rulerSvg = '';
    const numMarkers = 6;
    for (let i = 0; i <= numMarkers; i++) {
      const frac = i / numMarkers;
      const x = 160 + (frac * canvasWidth);
      const markTicks = BigInt(Math.round(Number(totalDur) * frac));
      const tc = this.ticksToTimecode(markTicks);
      rulerSvg += `
        <line x1="${x}" y1="10" x2="${x}" y2="28" stroke="#4a5568" stroke-width="1" />
        <text x="${x + 4}" y="24" fill="#a0aec0" font-size="11" font-family="monospace">${tc}</text>
      `;
    }

    // Build Track Lanes & Clips
    let tracksHtml = '';
    let currentY = headerHeight + rulerHeight;

    for (let tIdx = 0; tIdx < diff.tracks.length; tIdx++) {
      const track = diff.tracks[tIdx];
      let clipsSvg = '';

      for (const clip of track.clips) {
        const cStart = BigInt(clip.startTicks || '0');
        const cEnd = BigInt(clip.endTicks || '0');
        const x = 160 + Number((cStart * BigInt(canvasWidth)) / totalDur);
        const w = Math.max(12, Number(((cEnd - cStart) * BigInt(canvasWidth)) / totalDur));

        let bgColor = '#4a5568'; // Unchanged
        let borderColor = '#718096';
        let badge = '';

        if (clip.status === 'ADDED') {
          bgColor = '#22543d';
          borderColor = '#38a169';
          badge = '<span class="badge add">+ ADDED</span>';
        } else if (clip.status === 'DELETED') {
          bgColor = '#742a2a';
          borderColor = '#e53e3e';
          badge = '<span class="badge del">- DELETED</span>';
        } else if (clip.status === 'MOVED') {
          bgColor = '#744210';
          borderColor = '#ecc94b';
          badge = '<span class="badge mov">➔ MOVED</span>';
        } else if (clip.status === 'EFFECT_MODIFIED') {
          bgColor = '#44337a';
          borderColor = '#9f7aea';
          badge = '<span class="badge eff">✦ GRADE/FX</span>';
        } else if (clip.status === 'TRIMMED' || clip.status === 'MODIFIED') {
          bgColor = '#2c5282';
          borderColor = '#4299e1';
          badge = '<span class="badge trim">✂ TRIMMED</span>';
        }

        const tooltip = `${clip.name} [${clip.status}]&#10;In: ${clip.startTimecode} | Out: ${clip.endTimecode}&#10;${clip.diffDetails.join('\n')}`;

        clipsSvg += `
          <g class="clip-node" data-clip="${escapeHtml(clip.name)}" data-status="${escapeHtml(clip.status)}">
            <rect x="${x}" y="4" width="${w}" height="36" rx="4" fill="${bgColor}" stroke="${borderColor}" stroke-width="1.5">
              <title>${escapeHtml(tooltip)}</title>
            </rect>
            <text x="${x + 8}" y="24" fill="#ffffff" font-size="11" font-weight="600" font-family="sans-serif">
              ${escapeHtml(clip.name)}
            </text>
          </g>
        `;
      }

      tracksHtml += `
        <div class="track-row" style="top: ${currentY}px; height: ${trackHeight}px;">
          <div class="track-label">${escapeHtml(track.name)}</div>
          <svg class="track-svg" width="${width}" height="${trackHeight}">
            ${clipsSvg}
          </svg>
        </div>
      `;

      currentY += trackHeight + 10;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #121417;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #2d3748;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
    }
    .duration {
      font-family: monospace;
      color: #38b2ac;
      font-size: 14px;
    }
    .timeline-container {
      position: relative;
      background: #1a202c;
      border: 1px solid #2d3748;
      border-radius: 6px;
      overflow-x: auto;
      padding-bottom: 20px;
    }
    .ruler-svg {
      width: 100%;
      height: 30px;
      background: #14171d;
      border-bottom: 1px solid #2d3748;
    }
    .track-row {
      display: flex;
      align-items: center;
      margin-top: 10px;
    }
    .track-label {
      width: 150px;
      font-size: 12px;
      font-weight: 600;
      color: #cbd5e0;
      padding-left: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .track-svg {
      flex: 1;
    }
    .clip-node {
      cursor: pointer;
      transition: filter 0.15s ease;
    }
    .clip-node:hover rect {
      filter: brightness(1.25);
    }
    .legend {
      display: flex;
      gap: 16px;
      margin-top: 24px;
      padding: 12px 16px;
      background: #1a202c;
      border-radius: 6px;
      font-size: 12px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .legend-color {
      width: 14px;
      height: 14px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">🎞️ ${escapeHtml(diff.sequenceName)} — Visual Timeline Diff</div>
    <div class="duration">Duration: ${escapeHtml(diff.durationTimecode)}</div>
  </div>

  <div class="timeline-container" style="min-width: ${width}px;">
    <svg class="ruler-svg" width="${width}" height="30">
      ${rulerSvg}
    </svg>
    ${tracksHtml}
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background:#4a5568;"></div> Unchanged</div>
    <div class="legend-item"><div class="legend-color" style="background:#22543d; border: 1px solid #38a169;"></div> Added</div>
    <div class="legend-item"><div class="legend-color" style="background:#742a2a; border: 1px solid #e53e3e;"></div> Deleted</div>
    <div class="legend-item"><div class="legend-color" style="background:#744210; border: 1px solid #ecc94b;"></div> Moved</div>
    <div class="legend-item"><div class="legend-color" style="background:#44337a; border: 1px solid #9f7aea;"></div> Grade / Effects</div>
    <div class="legend-item"><div class="legend-color" style="background:#2c5282; border: 1px solid #4299e1;"></div> Trimmed</div>
  </div>
</body>
</html>`;
  }

  static renderTerminalDiff(prevState, currState) {
    return this.formatAsciiDiff(prevState, currState);
  }
}

module.exports = { VisualDiff };
