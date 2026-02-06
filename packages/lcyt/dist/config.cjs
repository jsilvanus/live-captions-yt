const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigError } = require('./errors.cjs');

const DEFAULT_CONFIG_FILENAME = '.lcyt-config.json';
const DEFAULT_YOUTUBE_URL = 'http://upload.youtube.com/closedcaption';

function getDefaultConfigPath() {
  return path.join(os.homedir(), DEFAULT_CONFIG_FILENAME);
}

function getDefaultConfig() {
  return {
    baseUrl: DEFAULT_YOUTUBE_URL,
    streamKey: null,
    region: 'reg1',
    cue: 'cue1',
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
  if (!config.streamKey) {
    return null;
  }

  const baseUrl = config.baseUrl || DEFAULT_YOUTUBE_URL;

  return `${baseUrl}?cid=${config.streamKey}`;
}

module.exports = { getDefaultConfigPath, getDefaultConfig, loadConfig, saveConfig, buildIngestionUrl, DEFAULT_YOUTUBE_URL };
