// FrameGit Core - Adobe Premiere Pro Adapter
// Subclasses CreativeEditorAdapter to interface with Premiere Pro (.prproj GZIP XML)
const fs = require('node:fs');
const { CreativeEditorAdapter } = require('./editor_adapter');
const { PremiereParser } = require('./premiere_parser');

class PremiereAdapter extends CreativeEditorAdapter {
  constructor() {
    super('PremierePro', {
      supportsPushEvents: false,
      supportsLiveColorNodeDiff: true, // Lumetri color parameters in XML
      projectModel: 'file_on_disk',
      fileExtension: '.prproj'
    });
  }

  getProjectState(projectPath) {
    return PremiereParser.parseProjectFile(projectPath);
  }

  createSnapshot(projectPath) {
    return fs.readFileSync(projectPath);
  }

  restoreSnapshot(snapshotBuffer, targetPath) {
    fs.writeFileSync(targetPath, snapshotBuffer);
  }

  serializeProjectState(state) {
    return PremiereParser.serializeProjectState(state);
  }

  openProject(projectPath) {
    // In real UXP panel environment: app.openDocument(projectPath)
    return { opened: true, projectPath, editor: 'PremierePro' };
  }
}

module.exports = { PremiereAdapter };
