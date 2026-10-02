/**
 * FrameGit Core - GitHub OAuth Device Authorization Flow
 * 
 * Implements RFC 8628 OAuth 2.0 Device Authorization Grant for headless / CLI login.
 * Allows video editors to log in to GitHub by entering a short code in their browser.
 */

'use strict';

const { NetworkError, CloudAuthError } = require('./errors');

// Default FrameGit public OAuth client ID (registered for FrameGit CLI)
const DEFAULT_CLIENT_ID = 'Iv23liFrameGitDefaultApp';

class GitHubAuth {
  /**
   * @param {Object} [options]
   * @param {string} [options.clientId]
   * @param {string} [options.baseUrl='https://github.com']
   */
  constructor(options = {}) {
    this.clientId = options.clientId || DEFAULT_CLIENT_ID;
    this.baseUrl = (options.baseUrl || 'https://github.com').replace(/\/+$/, '');
  }

  /**
   * Step 1: Request Device and User Verification Codes.
   * @param {string} [scope='repo,read:user']
   * @returns {Promise<{deviceCode: string, userCode: string, verificationUri: string, expiresIn: number, interval: number}>}
   */
  async requestDeviceCode(scope = 'repo,read:user') {
    const url = `${this.baseUrl}/login/device/code`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: this.clientId,
        scope
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new NetworkError('requestDeviceCode', `GitHub OAuth Device Flow failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval || 5
    };
  }

  /**
   * Step 2: Poll for access token until user authorizes in browser.
   * @param {string} deviceCode 
   * @param {number} [interval=5] 
   * @param {number} [expiresIn=900]
   * @param {Function} [onPollTick] Callback invoked on each polling interval
   * @param {AbortSignal} [abortSignal] Optional AbortSignal to cancel polling
   * @returns {Promise<{accessToken: string, tokenType: string, scope: string, cancelled?: boolean}>}
   */
  async pollForToken(deviceCode, interval = 5, expiresIn = 900, onPollTick = null, abortSignal = null) {
    const url = `${this.baseUrl}/login/oauth/access_token`;
    const startTime = Date.now();
    let currentInterval = interval;

    while ((Date.now() - startTime) < (expiresIn * 1000)) {
      if (abortSignal && abortSignal.aborted) {
        return { accessToken: null, tokenType: '', scope: '', cancelled: true };
      }
      await new Promise(r => setTimeout(r, currentInterval * 1000));
      if (abortSignal && abortSignal.aborted) {
        return { accessToken: null, tokenType: '', scope: '', cancelled: true };
      }
      if (onPollTick) onPollTick();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: this.clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();

      if (data.access_token) {
        return {
          accessToken: data.access_token,
          tokenType: data.token_type || 'bearer',
          scope: data.scope || ''
        };
      }

      if (data.error === 'authorization_pending') {
        // User has not entered code yet, keep polling
        continue;
      }

      if (data.error === 'slow_down') {
        currentInterval += 5;
        continue;
      }

      if (data.error === 'expired_token') {
        throw new CloudAuthError('GitHub', 'Device code has expired. Please run login again.');
      }

      if (data.error === 'access_denied') {
        throw new CloudAuthError('GitHub', 'Login was cancelled or rejected by user.');
      }

      throw new CloudAuthError('GitHub', `OAuth error: ${data.error_description || data.error}`);
    }

    throw new CloudAuthError('GitHub', 'OAuth device authorization timed out.');
  }

  /**
   * Step 3: Build Web Browser Authorization URL (1-Click Browser OAuth).
   * @param {Object} options
   * @param {string} options.redirectUri e.g. 'http://127.0.0.1:41793/oauth/callback'
   * @param {string} options.state Cryptographic random state for CSRF protection
   * @param {string} [options.scope='repo,read:user,user:email'] Full repository and user scope
   * @returns {string} Complete GitHub authorization URL
   */
  getAuthorizationUrl({ redirectUri, state, scope = 'repo,read:user,user:email' }) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope,
      state
    });
    return `${this.baseUrl}/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Step 4: Exchange Authorization Code for Access Token.
   * @param {Object} options
   * @param {string} options.code Authorization code received on callback
   * @param {string} options.redirectUri Redirect URI used in initial request
   * @param {string} [options.clientSecret] Optional OAuth App Client Secret
   * @returns {Promise<{accessToken: string, tokenType: string, scope: string}>}
   */
  async exchangeCodeForToken({ code, redirectUri, clientSecret = null }) {
    const url = `${this.baseUrl}/login/oauth/access_token`;
    const payload = {
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri
    };
    if (clientSecret) {
      payload.client_secret = clientSecret;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new NetworkError('exchangeCodeForToken', `OAuth token exchange failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new CloudAuthError('GitHub', `OAuth exchange error: ${data.error_description || data.error}`);
    }
    if (!data.access_token) {
      throw new CloudAuthError('GitHub', 'No access token received from GitHub OAuth exchange.');
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || 'bearer',
      scope: data.scope || ''
    };
  }
}

module.exports = {
  GitHubAuth,
  DEFAULT_CLIENT_ID
};
