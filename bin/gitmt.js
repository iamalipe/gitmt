#!/usr/bin/env node

const { program } = require("commander");
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");
const path = require("path");
const simpleGit = require("simple-git");
const { confirm } = require("@inquirer/prompts");
const fs = require("fs-extra");

// Constants
const CONFIG_DIR = path.join(homedir(), ".gitmt");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SSH_DIR = path.join(homedir(), ".ssh");

// Ensure config directory exists
if (!existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Load or create config
let config = { users: [], activeUser: null };
if (existsSync(CONFIG_FILE)) {
  config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

// Helper to manage SSH config
const SSH_CONFIG_FILE = path.join(SSH_DIR, "config");

const updateSSHConfig = (alias, sshKeyPath, isRemove = false) => {
  let sshConfig = "";
  if (existsSync(SSH_CONFIG_FILE)) {
    sshConfig = readFileSync(SSH_CONFIG_FILE, "utf8");
  }

  if (isRemove) {
    // Remove existing config block
    const regex = new RegExp(
      `\\nHost github.com-${alias}[\\s\\S]*?(?=\\n\\w|$)`,
      "g"
    );
    sshConfig = sshConfig.replace(regex, "");
  } else {
    // Add new config block
    const newConfig = `
Host github.com-${alias}
    HostName github.com
    User git
    IdentityFile ${sshKeyPath}
    IdentitiesOnly yes
`;
    sshConfig += newConfig;
  }

  writeFileSync(SSH_CONFIG_FILE, sshConfig.trim() + "\n");
};

// Save config
const saveConfig = () => {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

// Helper to set git config
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
      `id_rsa_gitmt_${options.alias.toLowerCase()}`
    );

    // Generate SSH key if it doesn't exist
    if (!existsSync(sshKeyPath)) {
      const generateKey = await confirm({
        message: `Would you like to generate a new SSH key for ${options.name}?`,
        default: true,
      });

      if (generateKey) {
        const { execSync } = require("child_process");
        execSync(
          `ssh-keygen -t rsa -b 4096 -C "${options.email}" -f "${sshKeyPath}" -N ""`
        );
        console.log(`SSH key generated at: ${sshKeyPath}`);
        updateSSHConfig(options.alias, sshKeyPath);
        console.log(
          `SSH config updated. You can now clone repositories using:`
        );
        console.log(
          `git clone git@github.com-${options.alias}:username/repo.git`
        );
      }
    }

    const userId = config.users.length + 1;
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

    updateSSHConfig(options.name, sshKeyPath);

    saveConfig();
    console.log(`Added user ${options.name} (ID: ${userId})`);
  });

program
  .command("current")
  .description("Show current active git user")
  .action(() => {
    if (!config.activeUser) {
      console.log("No active git user");
      return;
    }

    const user = config.users.find((u) => u.id === config.activeUser);
    console.log(
      `Current active user: ${user.name} <${user.email}> (ID: ${user.id})`
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
          updateSSHConfig(user.alias, "", true); // Remove from SSH config
          console.log(`SSH keys and config removed for ${user.name}`);
        } catch (error) {
          console.error(`Error removing SSH keys: ${error.message}`);
        }
      }
    }

    config.users.splice(userIndex, 1);
    if (config.activeUser === userId) {
      config.activeUser = null;
    }

    updateSSHConfig(user.name, user.sshKeyPath, true);

    saveConfig();
    console.log(`Removed user ${user.name} (ID: ${userId})`);
  });

program
  .command("change")
  .description("Switch to a different git user")
  .argument("<id>", "User ID to switch to")
  .action(async (id, options) => {
    const userId = parseInt(id);
    const user = config.users.find((u) => u.id === userId);

    if (!user) {
      console.log(`No user found with ID ${userId}`);
      return;
    }

    config.activeUser = userId;
    await setGitConfig(user.name, user.email);
    saveConfig();
    console.log(`Switched to user: ${user.name} <${user.email}>`);
  });

program
  .command("list")
  .description("List all git users")
  .action(() => {
    if (config.users.length === 0) {
      console.log("No users configured");
      return;
    }

    console.log("Configured git users:");
    config.users.forEach((user) => {
      const activeMarker = user.id === config.activeUser ? "(active)" : "";
      console.log(
        `${user.id}. ${user.name} <${user.email}> [${user.alias}] ${activeMarker}`
      );
      console.log(
        `   Clone URL format: git clone git@github.com-${user.alias}:username/repo.git`
      );
    });
  });

program
  .command("key")
  .description("Show public SSH key for a user")
  .argument("<id>", "User ID to show key for")
  .action((id) => {
    const userId = parseInt(id);
    const user = config.users.find((u) => u.id === userId);
    // TODO copy the public key to clipboard

    if (!user) {
      console.log(`No user found with ID ${userId}`);
      return;
    }

    const publicKeyPath = `${user.sshKeyPath}.pub`;
    if (!existsSync(publicKeyPath)) {
      console.log(`No SSH key found for user ${user.name}`);
      return;
    }

    const publicKey = readFileSync(publicKeyPath, "utf8");
    console.log(`Public SSH key for ${user.name}:`);
    console.log(publicKey);
  });

program.parse();
