#!/usr/bin/env node

const { program } = require("commander");
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");
const path = require("path");
const simpleGit = require("simple-git");
const { confirm } = require("@inquirer/prompts");
const fs = require("fs-extra");
const clipboardyModule = require("clipboardy");
const clipboardy = clipboardyModule.default || clipboardyModule;
const commandExists = require("command-exists");
const { EOL } = require("os");

// Constants
const CONFIG_DIR = path.join(homedir(), ".gitmt");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SSH_DIR = path.join(homedir(), ".ssh");

// Ensure config directory exists
if (!existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Ensure SSH directory exists
if (!existsSync(SSH_DIR)) {
  fs.mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
}

// Load or create config
let config = { users: [], activeUser: null };
if (existsSync(CONFIG_FILE)) {
  config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

// Helper to manage SSH config
const SSH_CONFIG_FILE = path.join(SSH_DIR, "config");

/**
 * Updates the SSH config file (~/.ssh/config) to add or remove host configuration blocks for GitHub aliases.
 * Matches host configuration blocks like: Host github.com-<alias>
 * Uses forward slashes in key paths (required for Windows OpenSSH compatibility).
 *
 * @param {string} alias - The GitHub account alias.
 * @param {string} sshKeyPath - The absolute path to the private SSH key file.
 * @param {boolean} [isRemove=false] - Whether to remove the host block instead of adding/updating it.
 */
const updateSSHConfig = (alias, sshKeyPath, isRemove = false) => {
  let sshConfig = "";
  if (existsSync(SSH_CONFIG_FILE)) {
    sshConfig = readFileSync(SSH_CONFIG_FILE, "utf8");
  }

  // Normalize all line endings to LF for simple internal regex processing
  sshConfig = sshConfig.replace(/\r\n/g, "\n");

  // Remove existing config block for this alias to prevent duplicates.
  // The block starts with "Host github.com-<alias>" and runs until the next "Host" block or end of file.
  const regex = new RegExp(
    `(?:^|\\n)Host github.com-${alias}(?:\\s|\\n)+[\\s\\S]*?(?=\\nHost|$)`,
    "gi"
  );
  sshConfig = sshConfig.replace(regex, "");

  if (!isRemove) {
    // Format SSH key path with forward slashes for Windows OpenSSH compatibility
    const formattedKeyPath = sshKeyPath.replace(/\\/g, "/");
    const newConfig = `
Host github.com-${alias}
    HostName github.com
    User git
    IdentityFile ${formattedKeyPath}
    IdentitiesOnly yes`;

    sshConfig = sshConfig.trim() + "\n" + newConfig.trim() + "\n";
  } else {
    sshConfig = sshConfig.trim();
    if (sshConfig !== "") {
      sshConfig += "\n";
    }
  }

  // Convert LF endings to the platform-specific line endings before writing
  writeFileSync(SSH_CONFIG_FILE, sshConfig.replace(/\n/g, EOL));
};

/**
 * Saves the current GitMT CLI configuration to config.json.
 */
const saveConfig = () => {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

/**
 * Sets the global Git user.name and user.email config options.
 *
 * @param {string} name - The Git user name.
 * @param {string} email - The Git user email.
 * @returns {Promise<void>}
 */
const setGitConfig = async (name, email) => {
  const git = simpleGit();
  await git.addConfig("user.name", name, false, "global");
  await git.addConfig("user.email", email, false, "global");
};

// Commands
program
  .name("gitmt")
  .description("CLI tool to manage multiple git accounts")
  .version("1.0.0");

program
  .command("add")
  .description("Add a new git user")
  .requiredOption("-n, --name <name>", "Git user name")
  .requiredOption("-e, --email <email>", "Git user email")
  .requiredOption("-a, --alias <alias>", "GitHub alias (used for SSH config)")
  .action(async (options) => {
    const sshKeyPath = path.join(
      SSH_DIR,
      `id_rsa_gitmt_${options.alias.toLowerCase()}`,
    );

    // Generate SSH key if it doesn't exist
    if (!existsSync(sshKeyPath)) {
      // Check if ssh-keygen is available
      try {
        await commandExists("ssh-keygen");
      } catch (err) {
        console.error(
          "Error: ssh-keygen is not available. Please install Git or OpenSSH.",
        );
        return;
      }

      const generateKey = await confirm({
        message: `Would you like to generate a new SSH key for ${options.name}?`,
        default: true,
      });

      if (generateKey) {
        const { spawnSync } = require("child_process");
        const result = spawnSync(
          "ssh-keygen",
          ["-t", "rsa", "-b", "4096", "-C", options.email, "-f", sshKeyPath, "-N", ""],
          { stdio: "inherit" }
        );

        if (result.status !== 0) {
          console.error("Error: Failed to generate SSH key.");
          return;
        }
        console.log(`SSH key generated at: ${sshKeyPath}`);
      }
    }

    // Verify user ID uniqueness or compute next ID safely
    const maxId = config.users.reduce((max, u) => Math.max(max, u.id), 0);
    const userId = maxId + 1;

    config.users.push({
      id: userId,
      name: options.name,
      email: options.email,
      alias: options.alias,
      sshKeyPath,
    });

    if (!config.activeUser) {
      config.activeUser = userId;
      await setGitConfig(options.name, options.email);
    }

    // Configure SSH config block for this alias
    updateSSHConfig(options.alias, sshKeyPath);

    saveConfig();
    console.log(`Added user ${options.name} (ID: ${userId})`);
    console.log(`SSH config updated for alias [${options.alias}].`);
    console.log(`You can clone repositories using:`);
    console.log(`  git clone git@github.com-${options.alias}:username/repo.git`);
  });

program
  .command("current")
  .description("Show current active git user")
  .action(() => {
    if (!config.activeUser) {
      console.log("\x1b[33mNo active git user\x1b[0m");
      return;
    }

    const user = config.users.find((u) => u.id === config.activeUser);
    console.log(
      `Current active user: \x1b[32m\x1b[1m${user.name}\x1b[0m \x1b[36m<${user.email}>\x1b[0m (ID: ${user.id})`,
    );
  });

program
  .command("remove")
  .description("Remove a git user")
  .argument("<id>", "User ID to remove")
  .action(async (id) => {
    const userId = parseInt(id);
    const userIndex = config.users.findIndex((u) => u.id === userId);

    if (userIndex === -1) {
      console.log(`No user found with ID ${userId}`);
      return;
    }

    const user = config.users[userIndex];
    const sshKeyExists =
      existsSync(user.sshKeyPath) || existsSync(`${user.sshKeyPath}.pub`);

    if (sshKeyExists) {
      const removeSSH = await confirm({
        message: `Do you want to remove the SSH keys for ${user.name}?`,
        default: false,
      });

      if (removeSSH) {
        try {
          if (existsSync(user.sshKeyPath)) {
            fs.unlinkSync(user.sshKeyPath);
          }
          if (existsSync(`${user.sshKeyPath}.pub`)) {
            fs.unlinkSync(`${user.sshKeyPath}.pub`);
          }
          console.log(`SSH keys removed for ${user.name}`);
        } catch (error) {
          console.error(`Error removing SSH keys: ${error.message}`);
        }
      }
    }

    config.users.splice(userIndex, 1);
    if (config.activeUser === userId) {
      config.activeUser = null;
    }

    // Always remove from SSH config to avoid leaving dead host aliases
    updateSSHConfig(user.alias, "", true);

    saveConfig();
    console.log(`Removed user ${user.name} (ID: ${userId})`);
  });

program
  .command("change")
  .description("Switch to a different git user")
  .argument("<id>", "User ID to switch to")
  .action(async (id) => {
    const userId = parseInt(id);
    const user = config.users.find((u) => u.id === userId);

    if (!user) {
      console.log(`\x1b[31mError: No user found with ID ${userId}\x1b[0m`);
      return;
    }

    config.activeUser = userId;
    await setGitConfig(user.name, user.email);
    saveConfig();
    console.log(
      `Switched to active user: \x1b[32m\x1b[1m${user.name}\x1b[0m \x1b[36m<${user.email}>\x1b[0m`
    );
  });

program
  .command("list")
  .description("List all git users")
  .action(() => {
    if (config.users.length === 0) {
      console.log("\x1b[33mNo users configured. Use 'gitmt add' to add a user.\x1b[0m");
      return;
    }

    console.log("\x1b[1mConfigured git users:\x1b[0m");
    config.users.forEach((user) => {
      const isActive = user.id === config.activeUser;
      const prefix = isActive ? "* " : "  ";
      const activeMarker = isActive ? " (active)" : "";

      let userLine = `${prefix}${user.id}. ${user.name} <${user.email}> [${user.alias}]${activeMarker}`;
      if (isActive) {
        userLine = `\x1b[32m\x1b[1m${userLine}\x1b[0m`;
      } else {
        userLine = `\x1b[90m${prefix}\x1b[0m${user.id}. ${user.name} \x1b[36m<${user.email}>\x1b[0m \x1b[33m[${user.alias}]\x1b[0m`;
      }

      console.log(userLine);
      console.log(
        `   \x1b[90mClone URL format: git clone git@github.com-${user.alias}:username/repo.git\x1b[0m`
      );
    });
  });

program
  .command("key")
  .description("Show public SSH key for a user")
  .argument("<id>", "User ID to show key for")
  .action(async (id) => {
    const userId = parseInt(id);
    const user = config.users.find((u) => u.id === userId);

    if (!user) {
      console.log(`\x1b[31mError: No user found with ID ${userId}\x1b[0m`);
      return;
    }

    const publicKeyPath = `${user.sshKeyPath}.pub`;
    if (!existsSync(publicKeyPath)) {
      console.log(`\x1b[33mNo SSH key found for user ${user.name}\x1b[0m`);
      return;
    }

    const publicKey = readFileSync(publicKeyPath, "utf8");
    console.log(`Public SSH key for \x1b[32m\x1b[1m${user.name}\x1b[0m:`);
    console.log(`\x1b[90m${publicKey.trim()}\x1b[0m`);

    try {
      await clipboardy.write(publicKey);
      console.log("\x1b[32mPublic key copied to clipboard!\x1b[0m");
    } catch (error) {
      console.error("\x1b[31mFailed to copy to clipboard:\x1b[0m", error.message);
    }
  });

program.parse();
