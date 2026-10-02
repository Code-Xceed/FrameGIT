/**
 * FrameGit Configuration System
 * 
 * Loads configuration from multiple sources with this priority:
 * 1. Explicit overrides (passed programmatically)
 * 2. Environment variables (FRAMEGIT_*)
 * 3. Project-level config (./framegit.config.json)
 * 4. Global config (~/.framegit/config.json)
 * 5. Built-in defaults
 * 
 * The exported `loadConfig()` returns a frozen config object.
 * All other modules MUST use this instead of hardcoding values.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ConfigurationError } = require('./errors.js');

// --- Built-in defaults (never hardcode these elsewhere) ---

const DEFAULTS = Object.freeze({
    version: '1.0.0',

    storage: {
        hashAlgorithm: 'blake2s256',
        chunkMinSize: 262144,       // 256 KB
        chunkTargetSize: 1048576,   // 1 MB
        chunkMaxSize: 4194304,      // 4 MB
        streamHighWaterMark: 2097152, // 2 MB
        objectMagicHeader: 'FGOB',
        objectVersion: 1
    },

    cloud: {
        provider: 'r2',             // 'r2' | 's3' | 'minio' | 'b2'
        endpoint: '',
        bucket: '',
        region: 'auto',
        accessKeyId: '',
        secretAccessKey: '',
        maxRetries: 5,
        retryBaseDelayMs: 1000,
        multipartThresholdBytes: 5242880, // 5 MB
        requestTimeoutMs: 30000,
        isMock: false
    },

    github: {
        token: '',
        defaultOrg: '',
        metadataRepo: '',
        apiBaseUrl: 'https://api.github.com',
        isMock: false
    },

    daemon: {
        port: 41793,
        host: '127.0.0.1',
        authTokenExpiryMs: 86400000 // 24 hours
    },

    project: {
        defaultBranch: 'main',
        assetDirectories: ['Footage', 'Media', 'Assets', 'Audio', 'Graphics', 'Images', 'VFX', 'GFX'],
        ignorePatterns: [
            'node_modules/**',
            '.framegit/**',
            '*.tmp',
            '*.autosave',
            '*.bak',
            'Media Cache Files/**',
            'Peak Files/**',
            'Adobe Premiere Pro Auto-Save/**',
            'Optimized Media/**',
            'CacheClip/**'
        ],
        databaseFilename: 'state.db'
    },

    user: {
        name: '',
        email: ''
    },

    editor: {
        ticksPerSecond: {
            premiere: 254016000000,
            resolve: 1
        },
        defaultFrameRate: 24
    },

    logging: {
        level: 'info',   // 'debug' | 'info' | 'warn' | 'error'
        file: ''         // Empty = no file logging
    }
});

// --- Environment variable mapping ---

const ENV_MAP = {
    'FRAMEGIT_CLOUD_PROVIDER':    'cloud.provider',
    'FRAMEGIT_CLOUD_ENDPOINT':    'cloud.endpoint',
    'FRAMEGIT_CLOUD_BUCKET':      'cloud.bucket',
    'FRAMEGIT_CLOUD_REGION':      'cloud.region',
    'FRAMEGIT_CLOUD_ACCESS_KEY':  'cloud.accessKeyId',
    'FRAMEGIT_CLOUD_SECRET_KEY':  'cloud.secretAccessKey',
    'FRAMEGIT_CLOUD_MOCK':        'cloud.isMock',
    'FRAMEGIT_GITHUB_TOKEN':      'github.token',
    'FRAMEGIT_GITHUB_ORG':        'github.defaultOrg',
    'FRAMEGIT_GITHUB_REPO':       'github.metadataRepo',
    'FRAMEGIT_GITHUB_MOCK':       'github.isMock',
    'FRAMEGIT_PORT':              'daemon.port',
    'FRAMEGIT_HOST':              'daemon.host',
    'FRAMEGIT_USER_NAME':         'user.name',
    'FRAMEGIT_USER_EMAIL':        'user.email',
    'FRAMEGIT_DEFAULT_BRANCH':    'project.defaultBranch',
    'FRAMEGIT_LOG_LEVEL':         'logging.level',
    'FRAMEGIT_LOG_FILE':          'logging.file'
};

// --- Utility functions ---

/**
 * Deep merge source into target (target is mutated).
 * Only merges plain objects, arrays and primitives replace.
 */
function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object' &&
            !Array.isArray(target[key])
        ) {
            target[key] = deepMerge({ ...target[key] }, source[key]);
        } else if (source[key] !== undefined) {
            target[key] = source[key];
        }
    }
    return target;
}

/**
 * Set a nested key like 'cloud.endpoint' on an object.
 */
function setNestedValue(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    const lastKey = parts[parts.length - 1];

    // Type coercion based on default types
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);

    current[lastKey] = value;
}

/**
 * Get a nested value by dot path.
 */
function getNestedValue(obj, dotPath) {
    const parts = dotPath.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Try to read and parse a JSON config file. Returns null if not found.
 * Throws ConfigurationError if file exists but is invalid JSON.
 */
function readConfigFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        try {
            return JSON.parse(raw);
        } catch (parseErr) {
            throw new ConfigurationError(filePath, `Invalid JSON in config file "${filePath}": ${parseErr.message}`);
        }
    } catch (err) {
        if (err instanceof ConfigurationError) throw err;
        if (err.code === 'ENOENT') return null;
        // Permission errors etc. should still throw
        throw new ConfigurationError(filePath, `Cannot read config file "${filePath}": ${err.message}`);
    }
}

/**
 * Deep freeze an object recursively.
 */
function deepFreeze(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    Object.freeze(obj);
    for (const value of Object.values(obj)) {
        if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }
    return obj;
}

// --- Main API ---

/**
 * Load FrameGit configuration.
 * 
 * @param {object} [options]
 * @param {string} [options.projectDir] - Project directory (default: cwd)
 * @param {object} [options.overrides] - Explicit overrides (highest priority)
 * @param {boolean} [options.requireAuthor] - If true, throws if user.name/email not set
 * @returns {Readonly<object>} Frozen configuration object
 */
function loadConfig(options = {}) {
    const projectDir = options.projectDir || process.cwd();

    // Start with deep copy of defaults
    let config = JSON.parse(JSON.stringify(DEFAULTS));

    // Layer 1: Global config (~/.framegit/config.json)
    const globalConfigPath = path.join(os.homedir(), '.framegit', 'config.json');
    const globalConfig = readConfigFile(globalConfigPath);
    if (globalConfig) {
        config = deepMerge(config, globalConfig);
    }

    // Layer 2: Project config (./framegit.config.json)
    const projectConfigPath = path.join(projectDir, 'framegit.config.json');
    const projectConfig = readConfigFile(projectConfigPath);
    if (projectConfig) {
        config = deepMerge(config, projectConfig);
    }

    // Layer 2.5: Secure Credential Vault (~/.framegit/credentials.enc)
    try {
        const { getDefaultVault } = require('./vault');
        const vault = getDefaultVault();
        if (!config.github.token && vault.hasSecret('github.token')) {
            config.github.token = vault.getSecret('github.token');
        }
        if (!config.cloud.accessKeyId && vault.hasSecret('cloud.accessKeyId')) {
            config.cloud.accessKeyId = vault.getSecret('cloud.accessKeyId');
        }
        if (!config.cloud.secretAccessKey && vault.hasSecret('cloud.secretAccessKey')) {
            config.cloud.secretAccessKey = vault.getSecret('cloud.secretAccessKey');
        }
    } catch (_) {}

    // Layer 3: Environment variables
    for (const [envKey, configPath] of Object.entries(ENV_MAP)) {
        const envValue = process.env[envKey];
        if (envValue !== undefined && envValue !== '') {
            setNestedValue(config, configPath, envValue);
        }
    }

    // Layer 4: Explicit overrides (highest priority)
    if (options.overrides) {
        config = deepMerge(config, options.overrides);
    }

    // Validation
    if (options.requireAuthor) {
        if (!config.user.name || !config.user.email) {
            const { AuthorNotConfiguredError } = require('./errors.js');
            throw new AuthorNotConfiguredError();
        }
    }

    // Freeze to prevent accidental mutation
    return deepFreeze(config);
}

/**
 * Write a config value to the project config file.
 * 
 * @param {string} dotPath - Config key in dot notation (e.g. 'user.name')
 * @param {*} value - The value to set
 * @param {object} [options]
 * @param {string} [options.projectDir] - Project directory
 * @param {boolean} [options.global] - Write to global config instead
 */
function setConfigValue(dotPath, value, options = {}) {
    const configPath = options.global
        ? path.join(os.homedir(), '.framegit', 'config.json')
        : path.join(options.projectDir || process.cwd(), 'framegit.config.json');

    // Read existing config
    let existing = {};
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        existing = JSON.parse(raw);
    } catch {
        // File doesn't exist yet — start fresh
    }

    setNestedValue(existing, dotPath, value);

    // Ensure directory exists
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

/**
 * Get the author info from config, with a fallback for backward compatibility.
 * @param {object} config - Loaded config object
 * @returns {{ name: string, email: string }}
 */
function getAuthor(config) {
    return {
        name: config.user.name || 'Unknown',
        email: config.user.email || 'unknown@framegit.local'
    };
}

module.exports = {
    loadConfig,
    setConfigValue,
    getAuthor,
    getNestedValue,
    DEFAULTS
};
