/**
 * FrameGit Error System
 * 
 * Typed error classes for all FrameGit error conditions.
 * Every error has a machine-readable `code` for programmatic handling
 * and a human-readable `message` for display.
 */

'use strict';

class FrameGitError extends Error {
    /**
     * @param {string} code - Machine-readable error code (e.g. 'DISK_FULL')
     * @param {string} message - Human-readable description
     * @param {object} [details] - Additional context for debugging
     */
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'FrameGitError';
        this.code = code;
        this.details = details;
        // Capture clean stack trace excluding this constructor
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details
        };
    }
}

// --- Storage Errors ---

class DiskFullError extends FrameGitError {
    constructor(path, originalError) {
        super('DISK_FULL', `Disk full: cannot write to ${path}. Free up space and try again.`, {
            path,
            originalCode: originalError?.code
        });
        this.name = 'DiskFullError';
    }
}

class PermissionDeniedError extends FrameGitError {
    constructor(path, operation, originalError) {
        super('PERMISSION_DENIED', `Permission denied: cannot ${operation} "${path}".`, {
            path,
            operation,
            originalCode: originalError?.code
        });
        this.name = 'PermissionDeniedError';
    }
}

class FileNotFoundError extends FrameGitError {
    constructor(path, originalError) {
        super('FILE_NOT_FOUND', `File not found: "${path}".`, {
            path,
            originalCode: originalError?.code
        });
        this.name = 'FileNotFoundError';
    }
}

class CorruptDataError extends FrameGitError {
    /**
     * @param {string} context - What was being parsed (e.g. 'commit abc123')
     * @param {string} [snippet] - First 200 chars of the corrupt payload
     * @param {Error} [originalError] - The original parse error
     */
    constructor(context, snippet, originalError) {
        super('CORRUPT_DATA', `Corrupt data in ${context}: ${originalError?.message || 'parse failed'}`, {
            context,
            snippet: snippet ? snippet.substring(0, 200) : undefined,
            originalMessage: originalError?.message
        });
        this.name = 'CorruptDataError';
    }
}

// --- Configuration Errors ---

class ConfigurationError extends FrameGitError {
    constructor(key, message) {
        super('CONFIG_ERROR', message, { key });
        this.name = 'ConfigurationError';
    }
}

class AuthorNotConfiguredError extends FrameGitError {
    constructor() {
        super(
            'AUTHOR_NOT_CONFIGURED',
            'Author not configured. Run: framegit config set user.name "Your Name" && framegit config set user.email "you@example.com"'
        );
        this.name = 'AuthorNotConfiguredError';
    }
}

// --- Repository Errors ---

class NotARepositoryError extends FrameGitError {
    constructor(path) {
        super('NOT_A_REPOSITORY', `"${path}" is not a FrameGit repository. Run: framegit init`, { path });
        this.name = 'NotARepositoryError';
    }
}

class BranchNotFoundError extends FrameGitError {
    constructor(branchName) {
        super('BRANCH_NOT_FOUND', `Branch "${branchName}" does not exist.`, { branchName });
        this.name = 'BranchNotFoundError';
    }
}

class CommitNotFoundError extends FrameGitError {
    constructor(hash) {
        super('COMMIT_NOT_FOUND', `Commit "${hash}" not found.`, { hash });
        this.name = 'CommitNotFoundError';
    }
}

class IntegrityError extends FrameGitError {
    constructor(objectHash, message) {
        super('INTEGRITY_ERROR', message || `Object ${objectHash} failed integrity check.`, { objectHash });
        this.name = 'IntegrityError';
    }
}

// --- Network / Cloud Errors ---

class NetworkError extends FrameGitError {
    constructor(operation, message, originalError) {
        super('NETWORK_ERROR', `Network error during ${operation}: ${message}`, {
            operation,
            originalMessage: originalError?.message,
            statusCode: originalError?.status || originalError?.statusCode
        });
        this.name = 'NetworkError';
    }
}

class CloudAuthError extends FrameGitError {
    constructor(provider, message) {
        super('CLOUD_AUTH_ERROR', `Authentication failed for ${provider}: ${message}`, { provider });
        this.name = 'CloudAuthError';
    }
}

// --- Editor Errors ---

class UnsupportedEditorError extends FrameGitError {
    constructor(fileExtension) {
        super('UNSUPPORTED_EDITOR', `Unsupported project file type: "${fileExtension}". Supported: .prproj, .drp`, {
            fileExtension
        });
        this.name = 'UnsupportedEditorError';
    }
}

class ProjectParseError extends FrameGitError {
    constructor(filePath, message, originalError) {
        super('PROJECT_PARSE_ERROR', `Failed to parse project file "${filePath}": ${message}`, {
            filePath,
            originalMessage: originalError?.message
        });
        this.name = 'ProjectParseError';
    }
}

// --- Collaboration Errors ---

class MergeConflictError extends FrameGitError {
    constructor(conflicts) {
        super('MERGE_CONFLICT', `Merge conflict: ${conflicts.length} conflict(s) detected.`, { conflicts });
        this.name = 'MergeConflictError';
    }
}

class PermissionError extends FrameGitError {
    constructor(action, role) {
        super('PERMISSION_ERROR', `Role "${role}" does not have permission to ${action}.`, { action, role });
        this.name = 'PermissionError';
    }
}

// --- Helper: Wrap filesystem errors ---

/**
 * Wraps a synchronous filesystem operation with proper error translation.
 * @param {Function} fn - The operation to execute
 * @param {string} path - The file/dir path (for error messages)
 * @param {string} operation - What we're doing (for error messages)
 * @returns {*} The return value of fn()
 */
function wrapFsOperation(fn, path, operation) {
    try {
        return fn();
    } catch (err) {
        if (err instanceof FrameGitError) throw err;
        switch (err.code) {
            case 'ENOSPC':
                throw new DiskFullError(path, err);
            case 'EACCES':
            case 'EPERM':
                throw new PermissionDeniedError(path, operation, err);
            case 'ENOENT':
                throw new FileNotFoundError(path, err);
            default:
                throw new FrameGitError('FS_ERROR', `Filesystem error during ${operation} on "${path}": ${err.message}`, {
                    path,
                    operation,
                    originalCode: err.code,
                    originalMessage: err.message
                });
        }
    }
}

/**
 * Wraps JSON.parse with proper error context.
 * @param {string} jsonString - The raw JSON string
 * @param {string} context - Description of what's being parsed (e.g. 'commit abc123')
 * @returns {*} Parsed value
 */
function safeJsonParse(jsonString, context) {
    try {
        return JSON.parse(jsonString);
    } catch (err) {
        const snippet = typeof jsonString === 'string' ? jsonString.substring(0, 200) : String(jsonString);
        throw new CorruptDataError(context, snippet, err);
    }
}

module.exports = {
    FrameGitError,
    DiskFullError,
    PermissionDeniedError,
    FileNotFoundError,
    CorruptDataError,
    ConfigurationError,
    AuthorNotConfiguredError,
    NotARepositoryError,
    BranchNotFoundError,
    CommitNotFoundError,
    IntegrityError,
    NetworkError,
    CloudAuthError,
    UnsupportedEditorError,
    ProjectParseError,
    MergeConflictError,
    PermissionError,
    wrapFsOperation,
    safeJsonParse
};
