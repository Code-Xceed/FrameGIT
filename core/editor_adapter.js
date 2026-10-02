// FrameGit Core - Creative Editor Adapter Interface
// Establishes common abstraction across NLEs (Premiere Pro, DaVinci Resolve, After Effects, etc.)

class CreativeEditorAdapter {
  constructor(editorName, capabilities = {}) {
    this.editorName = editorName;
    this.capabilities = {
      supportsPushEvents: false,
      supportsLiveColorNodeDiff: false,
      projectModel: 'file_on_disk', // 'file_on_disk' | 'database_export'
      fileExtension: '',
      ...capabilities
    };
  }

  /**
   * Get editor identification & capabilities.
   */
  getCapabilities() {
    return {
      editorName: this.editorName,
      ...this.capabilities
    };
  }

  /**
   * Parse project file/export into canonical ProjectState representation.
   * @param {string} projectPath 
   * @returns {Object} Normalized ProjectState
   */
  getProjectState(projectPath) {
    throw new Error('Method getProjectState() must be implemented by adapter subclass');
  }

  /**
   * Extract all media asset references from project.
   * @param {string} projectPath 
   * @returns {Array<{id: string, filePath: string, name: string}>}
   */
  getAssets(projectPath) {
    const state = this.getProjectState(projectPath);
    return state.mediaItems || [];
  }

  /**
   * Extract sequences and timeline tracks from project.
   * @param {string} projectPath 
   * @returns {Array<Object>}
   */
  getTimeline(projectPath) {
    const state = this.getProjectState(projectPath);
    return state.sequences || [];
  }

  /**
   * Calculate semantic diff between two project states.
   * @param {Object} prevState 
   * @param {Object} currState 
   * @returns {Array<Object>}
   */
  getChanges(prevState, currState) {
    const { ChangeEngine } = require('./change_engine');
    return ChangeEngine.diffStates(prevState, currState);
  }

  /**
   * Prepare project snapshot buffer/archive for CAS storage.
   * @param {string} projectPath 
   * @returns {Buffer}
   */
  createSnapshot(projectPath) {
    throw new Error('Method createSnapshot() must be implemented by adapter subclass');
  }

  /**
   * Reconstruct and restore project state to target file.
   * @param {Buffer} snapshotBuffer 
   * @param {string} targetPath 
   */
  restoreSnapshot(snapshotBuffer, targetPath) {
    const fs = require('node:fs');
    const { wrapFsOperation } = require('./errors');
    wrapFsOperation(() => fs.writeFileSync(targetPath, snapshotBuffer), targetPath, 'write');
  }

  /**
   * Serialize a normalized ProjectState back into native editor file buffer.
   * @param {Object} state 
   * @returns {Buffer}
   */
  serializeProjectState(state) {
    throw new Error('Method serializeProjectState() must be implemented by adapter subclass');
  }

  /**
   * Open the project in the host editor.
   * @param {string} projectPath 
   */
  openProject(projectPath) {
    throw new Error('Method openProject() must be implemented by adapter subclass');
  }
}

module.exports = { CreativeEditorAdapter };
