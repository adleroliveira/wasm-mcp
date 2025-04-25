import { promises as fs } from 'fs';
import path from 'path';

import { Command } from 'commander';

import { Installer, MCPServerConfig } from './installer';

interface RawConfig {
  mcpServers: {
    [key: string]: {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      [key: string]: unknown;
    };
  };
}

async function validateConfig(config: RawConfig): Promise<{ serverConfig: MCPServerConfig; projectName: string }> {
  const serverConfigs = Object.entries(config.mcpServers);
  if (serverConfigs.length === 0) {
    throw new Error('No server configurations found in the config file');
  }

  const [projectName, serverConfig] = serverConfigs[0];
  if (!serverConfig.command || typeof serverConfig.command !== 'string') {
    throw new Error('Config must have a "command" string property');
  }
  if (!serverConfig.args || !Array.isArray(serverConfig.args)) {
    throw new Error('Config must have an "args" array property');
  }
  return { serverConfig: serverConfig as MCPServerConfig, projectName };
}

async function main() {
  const program = new Command();

  program
    .name('wasm-mcp')
    .description('CLI tool for installing MCP packages')
    .version('1.0.0');

  program
    .command('compile')
    .description('Compile and install packages based on config file')
    .requiredOption('--config-file <path>', 'Path to the config file')
    .action(async (options) => {
      try {
        const configPath = path.resolve(options.configFile);
        const configContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        // Validate the config structure
        const { serverConfig, projectName } = await validateConfig(config);

        // Initialize installer
        const installer = new Installer({ path: './packages' });
        await installer.initDir();

        // Install the package
        const installDir = await installer.install(serverConfig, projectName);
        console.log(`Package installed successfully at: ${installDir}`);
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : 'Unknown error occurred');
        process.exit(1);
      }
    });

  program.parse(process.argv);
}

main(); 