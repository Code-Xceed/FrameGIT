// FrameGit - Version Control for Creative Video Professionals
// Primary library export for Node.js API and plugin integration.

'use strict';

const { VersionEngine, DirtyWorkingTreeError } = require('./core/version_engine');
const { AssetEngine } = require('./core/asset_engine');
const { StreamingChunker } = require('./core/streaming_chunker');
const { Chunker } = require('./core/chunker');
const { Hasher } = require('./core/hasher');
const { CASStorage, OBJECT_TYPES } = require('./core/storage');
const { PremiereParser } = require('./core/premiere_parser');
const { PremiereAdapter } = require('./core/premiere_adapter');
const { ResolveAdapter } = require('./core/resolve_adapter');
const { ChangeEngine } = require('./core/change_engine');
const { VisualDiff } = require('./core/visual_diff');
const { CloudClient, ConflictError } = require('./core/cloud_client');
const { SyncEngine } = require('./core/sync_engine');
const { GitHubSync, GitHubApiClient } = require('./core/github_sync');
const { WatcherDaemon } = require('./core/watcher');
const { IPCServer } = require('./core/ipc_server');
const { CredentialVault } = require('./core/vault');
const { ProductionHardening } = require('./core/hardening');
const { loadConfig, setConfigValue, getAuthor } = require('./core/config');

module.exports = {
  VersionEngine,
  DirtyWorkingTreeError,
  AssetEngine,
  StreamingChunker,
  Chunker,
  Hasher,
  CASStorage,
  OBJECT_TYPES,
  PremiereParser,
  PremiereAdapter,
  ResolveAdapter,
  ChangeEngine,
  VisualDiff,
  CloudClient,
  ConflictError,
  SyncEngine,
  GitHubSync,
  GitHubApiClient,
  WatcherDaemon,
  IPCServer,
  CredentialVault,
  ProductionHardening,
  loadConfig,
  setConfigValue,
  getAuthor
};
