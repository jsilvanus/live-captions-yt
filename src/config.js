const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigError } = require('./errors');

const DEFAULT_CONFIG_FILENAME = '.lcyt-config.json';

function getDefaultConfigPath() {
  return path.join(os.homedir(), DEFAULT_CONFIG_FILENAME);
}

function getDefaultConfig() {
  return {
    url: null,
    ytKey: null,
    key: null,
    sequence: 0
  };
}

function loadConfig(configPath) {
  const filePath = configPath || getDefaultConfigPath();

  try {
    if (!fs.existsSync(filePath)) {
      return getDefaultConfig();
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);

    return {
      ...getDefaultConfig(),
      ...config
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return getDefaultConfig();
    }
    throw new ConfigError(`Failed to load config from ${filePath}: ${err.message}`);
  }
}

function saveConfig(configPath, config) {
  const filePath = configPath || getDefaultConfigPath();

  try {
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (err) {
    throw new ConfigError(`Failed to save config to ${filePath}: ${err.message}`);
  }
}

function buildIngestionUrl(config) {
  if (!config.url) {
    return null;
  }

  if (config.ytKey) {
    return `${config.url}?cid=${config.ytKey}`;
  }

  if (config.key) {
    return `${config.url}${config.key}`;
  }

  return config.url;
}

module.exports = {
  getDefaultConfigPath,
  getDefaultConfig,
  loadConfig,
  saveConfig,
  buildIngestionUrl
};
