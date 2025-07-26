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
let config = { users: [], activeUser: null, globalConfig: null };
if (existsSync(CONFIG_FILE)) {
  config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

// Save config
const saveConfig = () => {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

// Helper to save current global git config
const saveGlobalGitConfig = async () => {
  const git = simpleGit();
  try {
    const userName = await git.getConfig("user.name", "global");
    const userEmail = await git.getConfig("user.email", "global");
    config.globalConfig = {
      name: userName.value,
      email: userEmail.value,
    };
    saveConfig();
  } catch (error) {
    console.log("No global git config found");
  }
};

// Helper to set git config
const setGitConfig = async (name, email, scope = "global") => {
  const git = simpleGit();
  if (!config.globalConfig) {
    await saveGlobalGitConfig();
  }
  await git.addConfig("user.name", name, false, scope);
  await git.addConfig("user.email", email, false, scope);
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
  .option("-l, --local", "Set as local git config")
  .action(async (options) => {
    const sshKeyPath = path.join(
      SSH_DIR,
      `id_rsa_gitmt_${options.name.replace(/\s+/g, "_").toLowerCase()}`
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
      }
    }

    const userId = config.users.length + 1;
    config.users.push({
      id: userId,
      name: options.name,
      email: options.email,
      sshKeyPath,
    });

    if (!config.activeUser) {
      config.activeUser = userId;
      await setGitConfig(
        options.name,
        options.email,
        options.local ? "local" : "global"
      );
    }

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
            fs.unlinkSync(user.sshKeyPath); // Remove private key
          }
          if (existsSync(`${user.sshKeyPath}.pub`)) {
            fs.unlinkSync(`${user.sshKeyPath}.pub`); // Remove public key
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

    saveConfig();
    console.log(`Removed user ${user.name} (ID: ${userId})`);
  });

program
  .command("change")
  .description("Switch to a different git user")
  .argument("<id>", "User ID to switch to")
  .option("-l, --local", "Set as local git config")
  .action(async (id, options) => {
    const userId = parseInt(id);
    const user = config.users.find((u) => u.id === userId);

    if (!user) {
      console.log(`No user found with ID ${userId}`);
      return;
    }

    config.activeUser = userId;
    await setGitConfig(
      user.name,
      user.email,
      options.local ? "local" : "global"
    );
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
      console.log(`${user.id}. ${user.name} <${user.email}> ${activeMarker}`);
    });
  });

program
  .command("global")
  .description("Show saved global git config")
  .action(() => {
    if (config.globalConfig) {
      console.log("Saved global git config:");
      console.log(`Name: ${config.globalConfig.name}`);
      console.log(`Email: ${config.globalConfig.email}`);
    } else {
      console.log("No saved global git config");
    }
  });

program
  .command("key")
  .description("Show public SSH key for a user")
  .argument("<id>", "User ID to show key for")
  .action((id) => {
    const userId = parseInt(id);
    const user = config.users.find((u) => u.id === userId);

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
