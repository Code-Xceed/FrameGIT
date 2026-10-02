// FrameGit Core - Creative Collaboration Engine
// Role-Based Access Control (RBAC), Branch Protection, Creative Pull Requests,
// Timecode Comments, and 3-Way Structural Timeline Merge with Conflict Resolution.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ChangeEngine } = require('./change_engine');
const { safeJsonParse, wrapFsOperation } = require('./errors');

const ROLES = {
  OWNER: 'owner',
  LEAD_EDITOR: 'lead_editor',
  ASSISTANT_EDITOR: 'assistant_editor',
  VIEWER: 'viewer'
};

const REVIEW_STATUS = {
  OPEN: 'OPEN',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  APPROVED: 'APPROVED',
  MERGED: 'MERGED',
  CLOSED: 'CLOSED'
};

const RESOLUTION_STRATEGY = {
  USE_HEAD: 'USE_HEAD',
  USE_INCOMING: 'USE_INCOMING',
  FORK_TRACK: 'FORK_TRACK'
};

class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
  }
}

class BranchProtectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BranchProtectionError';
  }
}

class CreativeMergeConflictError extends Error {
  constructor(message, conflicts = []) {
    super(message);
    this.name = 'CreativeMergeConflictError';
    this.conflicts = conflicts;
  }
}

class CollaborationEngine {
  /**
   * @param {import('./version_engine').VersionEngine} versionEngine
   */
  constructor(versionEngine) {
    this.versionEngine = versionEngine;
    this.rootPath = versionEngine.rootPath;
    this.reviewsDir = path.join(versionEngine.framegitDir, 'reviews');
    this.db = versionEngine.db;
  }

  /**
   * Initialize collaboration schema and directories.
   */
  init() {
    if (!fs.existsSync(this.reviewsDir)) {
      fs.mkdirSync(this.reviewsDir, { recursive: true });
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_members (
        user_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS branch_protections (
        branch_name TEXT PRIMARY KEY,
        require_review INTEGER DEFAULT 1,
        required_approvals INTEGER DEFAULT 1,
        require_lead_approval INTEGER DEFAULT 1,
        block_direct_push INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS review_requests (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        source_branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        author_id TEXT NOT NULL,
        source_commit TEXT NOT NULL,
        target_commit TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        merge_commit_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS review_comments (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        sequence_name TEXT,
        timecode TEXT,
        clip_name TEXT,
        comment TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS review_approvals (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        verdict TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // Default branch protection on main
    const mainProt = this.db.prepare("SELECT branch_name FROM branch_protections WHERE branch_name = 'main'").get();
    if (!mainProt) {
      this.setBranchProtection('main', {
        requireReview: true,
        requiredApprovals: 1,
        requireLeadApproval: true,
        blockDirectPush: true
      });
    }
  }

  // =========================================================================
  // TEAM & RBAC MANAGEMENT
  // =========================================================================

  /**
   * Add or update a team member with a designated creative role.
   * @param {{userId: string, name: string, email: string, role: string}} member
   */
  addMember({ userId, name, email, role }) {
    if (!Object.values(ROLES).includes(role)) {
      throw new Error(`Invalid role '${role}'. Must be one of: ${Object.values(ROLES).join(', ')}`);
    }

    const now = Date.now();
    this.db.prepare(`
      INSERT INTO team_members (user_id, name, email, role, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, email = excluded.email, role = excluded.role
    `).run(userId, name, email, role, now);

    return { userId, name, email, role };
  }

  /**
   * Retrieve a team member.
   * @param {string} userId 
   */
  getMember(userId) {
    return this.db.prepare('SELECT user_id, name, email, role, created_at FROM team_members WHERE user_id = ?').get(userId);
  }

  /**
   * List all team members.
   */
  listMembers() {
    return this.db.prepare('SELECT user_id, name, email, role, created_at FROM team_members ORDER BY name ASC').all();
  }

  /**
   * Set branch protection rules for a specific branch.
   */
  setBranchProtection(branchName, { requireReview = true, requiredApprovals = 1, requireLeadApproval = true, blockDirectPush = true } = {}) {
    this.db.prepare(`
      INSERT INTO branch_protections (branch_name, require_review, required_approvals, require_lead_approval, block_direct_push)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(branch_name) DO UPDATE SET
        require_review = excluded.require_review,
        required_approvals = excluded.required_approvals,
        require_lead_approval = excluded.require_lead_approval,
        block_direct_push = excluded.block_direct_push
    `).run(
      branchName,
      requireReview ? 1 : 0,
      requiredApprovals,
      requireLeadApproval ? 1 : 0,
      blockDirectPush ? 1 : 0
    );
  }

  /**
   * Get branch protection policy.
   */
  getBranchProtection(branchName) {
    const row = this.db.prepare('SELECT * FROM branch_protections WHERE branch_name = ?').get(branchName);
    if (!row) return null;
    return {
      branchName: row.branch_name,
      requireReview: Boolean(row.require_review),
      requiredApprovals: row.required_approvals,
      requireLeadApproval: Boolean(row.require_lead_approval),
      blockDirectPush: Boolean(row.block_direct_push)
    };
  }

  /**
   * Check whether a user is allowed to push directly to a branch.
   * @param {{userId: string, role: string}} user 
   * @param {string} branchName 
   */
  assertDirectPushAllowed(user, branchName) {
    const protection = this.getBranchProtection(branchName);
    if (!protection) return true; // Branch has no protection rules

    if (protection.blockDirectPush) {
      if (user.role === ROLES.ASSISTANT_EDITOR || user.role === ROLES.VIEWER) {
        throw new BranchProtectionError(
          `Direct push to protected branch '${branchName}' is blocked for role '${user.role}'. Assistant Editors must submit a Creative Review Request.`
        );
      }
    }
    return true;
  }

  // =========================================================================
  // CREATIVE PULL REQUESTS / BRANCH REVIEWS
  // =========================================================================

  /**
   * Open a new Creative Review Request from source branch into target branch.
   */
  createReviewRequest({ title, description = '', sourceBranch, targetBranch = 'main', author }) {
    if (!author || !author.userId) {
      throw new Error('Author with userId is required');
    }

    const member = this.getMember(author.userId);
    if (!member) {
      throw new PermissionError(`User '${author.userId}' is not a registered team member.`);
    }

    if (member.role === ROLES.VIEWER) {
      throw new PermissionError('Viewers are not permitted to open review requests.');
    }

    if (sourceBranch === targetBranch) {
      throw new Error('Source branch and target branch cannot be identical.');
    }

    const sourceBranchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(sourceBranch);
    if (!sourceBranchRow) throw new Error(`Source branch '${sourceBranch}' does not exist.`);

    const targetBranchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(targetBranch);
    if (!targetBranchRow) throw new Error(`Target branch '${targetBranch}' does not exist.`);

    const sourceCommit = sourceBranchRow.commit_hash;
    const targetCommit = targetBranchRow.commit_hash;

    // Find Lowest Common Ancestor (merge base)
    const baseCommit = this.versionEngine.getMergeBase(sourceCommit, targetCommit);
    if (!baseCommit) {
      throw new Error(`No common ancestor found between branch '${sourceBranch}' and '${targetBranch}'.`);
    }

    // Extract states for automated changelog
    const baseState = this.versionEngine.getCommitProjectState(baseCommit);
    const sourceState = this.versionEngine.getCommitProjectState(sourceCommit);

    const changes = ChangeEngine.diffStates(baseState, sourceState);
    const summary = this.formatCreativeSummary(changes);

    const reviewId = 'REV-' + crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO review_requests (
        id, title, description, source_branch, target_branch, author_id,
        source_commit, target_commit, base_commit, status, summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId, title, description, sourceBranch, targetBranch, author.userId,
      sourceCommit, targetCommit, baseCommit, REVIEW_STATUS.OPEN, JSON.stringify(summary), now, now
    );

    const review = this.getReview(reviewId);
    this.persistReviewJson(review);

    return review;
  }

  /**
   * Get full review request with comments and approvals.
   * @param {string} reviewId 
   */
  getReview(reviewId) {
    const row = this.db.prepare('SELECT * FROM review_requests WHERE id = ?').get(reviewId);
    if (!row) return null;

    const author = this.getMember(row.author_id);
    const comments = this.db.prepare(`
      SELECT c.*, m.name as author_name, m.role as author_role
      FROM review_comments c
      LEFT JOIN team_members m ON c.author_id = m.user_id
      WHERE c.review_id = ?
      ORDER BY c.created_at ASC
    `).all(reviewId);

    const approvals = this.db.prepare(`
      SELECT a.*, m.name as reviewer_name, m.role as reviewer_role
      FROM review_approvals a
      LEFT JOIN team_members m ON a.reviewer_id = m.user_id
      WHERE a.review_id = ?
      ORDER BY a.created_at ASC
    `).all(reviewId);

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      sourceBranch: row.source_branch,
      targetBranch: row.target_branch,
      author: author || { userId: row.author_id, name: 'Unknown', role: 'unknown' },
      sourceCommit: row.source_commit,
      targetCommit: row.target_commit,
      baseCommit: row.base_commit,
      status: row.status,
      summary: row.summary ? safeJsonParse(row.summary, `review[${row.id}].summary`) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      mergeCommitHash: row.merge_commit_hash,
      comments: comments.map(c => ({
        id: c.id,
        authorId: c.author_id,
        authorName: c.author_name,
        authorRole: c.author_role,
        sequenceName: c.sequence_name,
        timecode: c.timecode,
        clipName: c.clip_name,
        comment: c.comment,
        createdAt: c.created_at,
        resolved: Boolean(c.resolved)
      })),
      approvals: approvals.map(a => ({
        id: a.id,
        reviewerId: a.reviewer_id,
        reviewerName: a.reviewer_name,
        reviewerRole: a.reviewer_role,
        verdict: a.verdict,
        note: a.note,
        createdAt: a.created_at
      }))
    };
  }

  /**
   * List review requests.
   */
  listReviews({ status = null, targetBranch = null } = {}) {
    let sql = 'SELECT id FROM review_requests WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (targetBranch) {
      sql += ' AND target_branch = ?';
      params.push(targetBranch);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this.getReview(r.id));
  }

  /**
   * Add a timecode-anchored or clip-anchored comment.
   */
  addComment(reviewId, { author, comment, sequenceName = null, timecode = null, clipName = null }) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found.`);

    const member = this.getMember(author.userId);
    if (!member) throw new PermissionError(`User '${author.userId}' is not a registered team member.`);

    const commentId = 'COM-' + crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO review_comments (id, review_id, author_id, sequence_name, timecode, clip_name, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(commentId, reviewId, author.userId, sequenceName, timecode, clipName, comment, now);

    this.db.prepare('UPDATE review_requests SET updated_at = ? WHERE id = ?').run(now, reviewId);

    const updated = this.getReview(reviewId);
    this.persistReviewJson(updated);
    return updated;
  }

  /**
   * Submit an approval or change request.
   */
  submitReviewVerdict(reviewId, { reviewer, verdict, note = '' }) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found.`);

    const member = this.getMember(reviewer.userId);
    if (!member) throw new PermissionError(`Reviewer '${reviewer.userId}' is not a registered team member.`);

    if (review.author.userId === reviewer.userId) {
      throw new PermissionError('Authors are not permitted to approve their own review request.');
    }

    if (verdict === 'APPROVED') {
      const protection = this.getBranchProtection(review.targetBranch);
      if (protection && protection.requireLeadApproval) {
        if (member.role !== ROLES.LEAD_EDITOR && member.role !== ROLES.OWNER) {
          throw new PermissionError(`Branch '${review.targetBranch}' requires Lead Editor or Owner approval.`);
        }
      }
    }

    const approvalId = 'APP-' + crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO review_approvals (id, review_id, reviewer_id, verdict, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(approvalId, reviewId, reviewer.userId, verdict, note, now);

    let newStatus = review.status;
    if (verdict === 'CHANGES_REQUESTED') {
      newStatus = REVIEW_STATUS.CHANGES_REQUESTED;
    } else if (verdict === 'APPROVED') {
      const protection = this.getBranchProtection(review.targetBranch);
      const required = protection ? protection.requiredApprovals : 1;
      const count = this.db.prepare(`
        SELECT COUNT(*) as count FROM review_approvals WHERE review_id = ? AND verdict = 'APPROVED'
      `).get(reviewId).count;

      if (count >= required) {
        newStatus = REVIEW_STATUS.APPROVED;
      }
    }

    this.db.prepare('UPDATE review_requests SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, reviewId);

    const updated = this.getReview(reviewId);
    this.persistReviewJson(updated);
    return updated;
  }

  // =========================================================================
  // 3-WAY STRUCTURAL TIMELINE MERGE & CONFLICT RESOLUTION
  // =========================================================================

  /**
   * Reconcile Base, Head, and Incoming project states.
   * Detects non-conflicting track additions, orthogonal track edits, and clip collisions.
   * 
   * @param {Object} baseState 
   * @param {Object} headState 
   * @param {Object} incomingState 
   * @param {Object} [resolutions={}] Map of conflictId -> RESOLUTION_STRATEGY
   * @returns {{success: boolean, conflicts: Array, mergedState: Object}}
   */
  reconcileCreativeStates(baseState, headState, incomingState, resolutions = {}) {
    const conflicts = [];

    // Clone head state as starting baseline
    const mergedState = JSON.parse(JSON.stringify(headState));

    // 1. Reconcile Media Pool / Footage Items (Union of both)
    const mediaPathMap = new Map();
    for (const m of mergedState.mediaItems || []) {
      mediaPathMap.set(m.filePath, m);
    }
    for (const m of incomingState.mediaItems || []) {
      if (!mediaPathMap.has(m.filePath)) {
        mergedState.mediaItems.push(m);
        mediaPathMap.set(m.filePath, m);
      }
    }

    // 2. Reconcile Sequences
    const baseSeqMap = new Map((baseState?.sequences || []).map(s => [s.name, s]));
    const incomingSeqMap = new Map((incomingState?.sequences || []).map(s => [s.name, s]));

    for (const headSeq of mergedState.sequences || []) {
      const baseSeq = baseSeqMap.get(headSeq.name) || null;
      const incomingSeq = incomingSeqMap.get(headSeq.name) || null;

      if (!incomingSeq) continue; // Untouched in incoming branch

      // Reconcile Markers
      const existingMarkerKeys = new Set((headSeq.markers || []).map(m => `${m.timeTicks}:${m.name}`));
      for (const m of incomingSeq.markers || []) {
        const key = `${m.timeTicks}:${m.name}`;
        if (!existingMarkerKeys.has(key)) {
          headSeq.markers.push(m);
          existingMarkerKeys.add(key);
        }
      }

      // Reconcile Tracks
      const baseTracks = new Map((baseSeq?.tracks || []).map(t => [t.name, t]));
      const headTracks = new Map((headSeq.tracks || []).map(t => [t.name, t]));
      const incomingTracks = new Map((incomingSeq.tracks || []).map(t => [t.name, t]));

      // Check for tracks that only exist in incoming branch (e.g. new audio stems)
      for (const [tName, incTrack] of incomingTracks.entries()) {
        if (!headTracks.has(tName)) {
          headSeq.tracks.push(JSON.parse(JSON.stringify(incTrack)));
        }
      }

      // Reconcile shared tracks
      for (const [tName, headTrack] of headTracks.entries()) {
        const incTrack = incomingTracks.get(tName);
        if (!incTrack) continue; // Track only in head

        const baseTrack = baseTracks.get(tName) || null;

        const headModified = !this.areTracksIdentical(baseTrack, headTrack);
        const incModified = !this.areTracksIdentical(baseTrack, incTrack);

        if (!headModified && incModified) {
          // Clean track merge: Head did not touch this track, but incoming did!
          headTrack.clips = JSON.parse(JSON.stringify(incTrack.clips));
        } else if (headModified && incModified) {
          // Both modified this track! Inspect clip-level collisions.
          this.reconcileTrackClips(headSeq, headTrack, incTrack, resolutions, conflicts);
        }
      }
    }

    if (conflicts.length > 0) {
      return { success: false, conflicts, mergedState: null };
    }

    return { success: true, conflicts: [], mergedState };
  }

  /**
   * Reconcile clips on a track modified by both branches.
   */
  reconcileTrackClips(sequence, headTrack, incomingTrack, resolutions, conflicts) {
    const headClips = [...headTrack.clips];
    const incomingClips = [...incomingTrack.clips];

    for (const inClip of incomingClips) {
      // Find any overlapping clip on the head track
      const inStart = BigInt(inClip.startTicks || '0');
      const inEnd = BigInt(inClip.endTicks || '0');

      let collidedHeadClip = null;
      for (const hClip of headClips) {
        const hStart = BigInt(hClip.startTicks || '0');
        const hEnd = BigInt(hClip.endTicks || '0');

        // Check temporal overlap: max(start) < min(end)
        const overlapStart = inStart > hStart ? inStart : hStart;
        const overlapEnd = inEnd < hEnd ? inEnd : hEnd;

        if (overlapStart < overlapEnd || inClip.name === hClip.name) {
          collidedHeadClip = hClip;
          break;
        }
      }

      if (!collidedHeadClip) {
        // Non-overlapping addition in different timecode region: Clean placement!
        headTrack.clips.push(inClip);
      } else {
        // Timeline Conflict Detected!
        const conflictId = `conflict_${headTrack.name}_${collidedHeadClip.id}_${inClip.id}`;
        const resolution = resolutions[conflictId];

        if (!resolution) {
          conflicts.push({
            conflictId,
            sequenceName: sequence.name,
            trackName: headTrack.name,
            headClip: collidedHeadClip,
            incomingClip: inClip,
            overlapRange: [collidedHeadClip.startTicks, collidedHeadClip.endTicks],
            resolutionOptions: [
              RESOLUTION_STRATEGY.USE_HEAD,
              RESOLUTION_STRATEGY.USE_INCOMING,
              RESOLUTION_STRATEGY.FORK_TRACK
            ]
          });
        } else if (resolution === RESOLUTION_STRATEGY.USE_INCOMING) {
          // Replace head clip with incoming clip
          const idx = headTrack.clips.findIndex(c => c.id === collidedHeadClip.id);
          if (idx !== -1) {
            headTrack.clips[idx] = inClip;
          }
        } else if (resolution === RESOLUTION_STRATEGY.FORK_TRACK) {
          // Preserve head clip on current track, and fork incoming clip into a new alternate track!
          const altTrackName = `${headTrack.name} (Incoming Alt)`;
          let altTrack = sequence.tracks.find(t => t.name === altTrackName);
          if (!altTrack) {
            altTrack = {
              id: `${headTrack.id}_alt_${Date.now()}`,
              name: altTrackName,
              type: headTrack.type,
              index: sequence.tracks.length + 1,
              clips: []
            };
            sequence.tracks.push(altTrack);
          }
          altTrack.clips.push(inClip);
        }
        // If USE_HEAD: head clip remains, inClip is ignored
      }
    }
  }

  /**
   * Helper to check if two tracks have identical clip setups.
   */
  areTracksIdentical(trackA, trackB) {
    if (!trackA || !trackB) return false;
    if (trackA.clips.length !== trackB.clips.length) return false;
    for (let i = 0; i < trackA.clips.length; i++) {
      const a = trackA.clips[i];
      const b = trackB.clips[i];
      if (a.name !== b.name || a.startTicks !== b.startTicks || a.endTicks !== b.endTicks) {
        return false;
      }
      if (JSON.stringify(a.effects || []) !== JSON.stringify(b.effects || [])) {
        return false;
      }
    }
    return true;
  }

  /**
   * Execute merge of an approved review request.
   */
  async mergeReview(reviewId, { merger, resolutions = {} }) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found.`);

    if (review.status === REVIEW_STATUS.MERGED) {
      throw new Error(`Review '${reviewId}' has already been merged.`);
    }

    const member = this.getMember(merger.userId);
    if (!member) throw new PermissionError(`User '${merger.userId}' is not a registered team member.`);

    // RBAC: Merging requires Lead Editor or Owner
    if (member.role !== ROLES.LEAD_EDITOR && member.role !== ROLES.OWNER) {
      throw new PermissionError(`User role '${member.role}' does not have permission to merge reviews.`);
    }

    // Gating check: Must be APPROVED unless Owner force merges
    if (review.status !== REVIEW_STATUS.APPROVED && member.role !== ROLES.OWNER) {
      throw new PermissionError(`Review '${reviewId}' is in '${review.status}' state and has not been approved.`);
    }

    const sourceBranchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(review.sourceBranch);
    const targetBranchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(review.targetBranch);

    const sourceCommit = sourceBranchRow.commit_hash;
    const targetCommit = targetBranchRow.commit_hash;
    const baseCommit = this.versionEngine.getMergeBase(sourceCommit, targetCommit);

    const baseState = this.versionEngine.getCommitProjectState(baseCommit);
    const headState = this.versionEngine.getCommitProjectState(targetCommit);
    const incomingState = this.versionEngine.getCommitProjectState(sourceCommit);

    // 1. Reconcile creative project states
    const result = this.reconcileCreativeStates(baseState, headState, incomingState, resolutions);
    if (!result.success) {
      throw new CreativeMergeConflictError(
        `Structural timeline conflict detected on ${result.conflicts.length} clip(s). Conflict resolution required.`,
        result.conflicts
      );
    }

    // 2. Switch to target branch if not active
    const currBranch = this.versionEngine.getCurrentBranch();
    if (currBranch !== review.targetBranch) {
      this.versionEngine.switchBranch(review.targetBranch, true);
    }

    // 3. Serialize and write merged state to disk
    const mergedBuffer = this.versionEngine.adapter.serializeProjectState(result.mergedState);
    fs.writeFileSync(this.versionEngine.projectFilePath, mergedBuffer);

    // 4. Create merge commit with dual parents (targetCommit, sourceCommit)
    const mergeMessage = `Merge branch '${review.sourceBranch}' into ${review.targetBranch} (#${review.id}): ${review.title}`;
    const commitResult = await this.versionEngine.commit(
      mergeMessage,
      { name: member.name, email: member.email },
      sourceCommit // Second parent!
    );

    // 5. Update review request in DB and JSON
    const now = Date.now();
    this.db.prepare(`
      UPDATE review_requests
      SET status = ?, merge_commit_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(REVIEW_STATUS.MERGED, commitResult.commitHash, now, reviewId);

    const updated = this.getReview(reviewId);
    this.persistReviewJson(updated);

    return {
      reviewId,
      mergeCommitHash: commitResult.commitHash,
      targetBranch: review.targetBranch,
      sourceBranch: review.sourceBranch,
      status: REVIEW_STATUS.MERGED
    };
  }

  // =========================================================================
  // UTILITIES & SUMMARY FORMATTING
  // =========================================================================

  formatCreativeSummary(changes) {
    let clipsAdded = 0;
    let clipsMoved = 0;
    let clipsTrimmed = 0;
    let clipsDeleted = 0;
    let effectsChanged = 0;
    let markersAdded = 0;
    let mediaAdded = 0;

    for (const c of changes) {
      if (c.type === 'clip_added') clipsAdded++;
      else if (c.type === 'clip_moved') clipsMoved++;
      else if (c.type === 'clip_trimmed') clipsTrimmed++;
      else if (c.type === 'clip_deleted') clipsDeleted++;
      else if (c.type.startsWith('effect_')) effectsChanged++;
      else if (c.type === 'marker_added') markersAdded++;
      else if (c.type === 'media_added') mediaAdded++;
    }

    return {
      totalChanges: changes.length,
      clipsAdded,
      clipsMoved,
      clipsTrimmed,
      clipsDeleted,
      effectsChanged,
      markersAdded,
      mediaAdded,
      changesList: changes
    };
  }

  persistReviewJson(review) {
    const filePath = path.join(this.reviewsDir, `${review.id}.json`);
    wrapFsOperation(() => fs.writeFileSync(filePath, JSON.stringify(review, null, 2), 'utf-8'), filePath, 'write');
  }
}

module.exports = {
  CollaborationEngine,
  ROLES,
  REVIEW_STATUS,
  RESOLUTION_STRATEGY,
  PermissionError,
  BranchProtectionError,
  CreativeMergeConflictError
};
