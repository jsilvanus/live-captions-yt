/**
 * HTTP client for backend admin API - project and feature management.
 */

export class ProjectAdminClient {
  constructor(options = {}) {
    this.backendUrl = options.backendUrl || process.env.LCYT_BACKEND_URL;
    this.adminKey = options.adminKey;
    this.jwtToken = options.jwtToken;

    if (!this.backendUrl) {
      throw new Error('Backend URL is required (--backend-url or LCYT_BACKEND_URL env var)');
    }

    if (!this.adminKey && !this.jwtToken) {
      throw new Error('Admin key or JWT token is required');
    }
  }

  _getHeaders() {
    const headers = { 'Content-Type': 'application/json' };

    if (this.jwtToken) {
      headers['Authorization'] = 'Bearer ' + this.jwtToken;
    } else if (this.adminKey) {
      headers['X-Admin-Key'] = this.adminKey;
    }

    return headers;
  }

  async _request(method, endpoint, body = null) {
    const url = new URL(endpoint, this.backendUrl).toString();
    const options = {
      method,
      headers: this._getHeaders(),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  async createProject(payload) {
    return this._request('POST', '/api/v1/admin/keys', payload);
  }

  async listProjects(options = {}) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const params = new URLSearchParams({ limit, offset });
    return this._request('GET', `/admin/keys?${params.toString()}`);
  }

  async getProject(apiKey) {
    return this._request('GET', `/admin/projects/${apiKey}`);
  }

  async updateProject(apiKey, updates) {
    return this._request('PUT', `/admin/projects/${apiKey}`, updates);
  }

  async deleteProject(apiKey) {
    return this._request('DELETE', `/admin/projects/${apiKey}`);
  }

  async getProjectFeatures(apiKey) {
    const project = await this.getProject(apiKey);
    return project.features || {};
  }

  async setProjectFeatures(apiKey, features) {
    return this._request('PUT', `/admin/projects/${apiKey}/features`, { features });
  }

  async getProjectMembers(apiKey) {
    const project = await this.getProject(apiKey);
    return project.members || [];
  }

  async getDeviceRoles(apiKey) {
    return this._request('GET', `/admin/projects/${apiKey}/device-roles`);
  }
}

