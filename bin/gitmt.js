#!/usr/bin/env node

const { program } = require("commander");
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");
const path = require("path");
const simpleGit = require("simple-git");
const { confirm, input, select } = require("@inquirer/prompts");
const fs = require("fs-extra");
const clipboardyModule = require("clipboardy");
const clipboardy = clipboardyModule.default || clipboardyModule;
const commandExists = require("command-exists");
const { EOL } = require("os");
const { version } = require("../package.json");

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
  .version(version);

program
  .command("add")
  .description("Add a new git user")
  .option("-n, --name <name>", "Git user name")
  .option("-e, --email <email>", "Git user email")
  .option("-a, --alias <alias>", "GitHub alias (used for SSH config)")
  .action(async (options) => {
    let name = options.name;
    let email = options.email;
    let alias = options.alias;

    if (!name) {
      name = await input({
        message: "Enter Git user name:",
        validate: (value) => value.trim() !== "" || "Name cannot be empty",
      });
    }
    if (!email) {
      email = await input({
        message: "Enter Git user email:",
        validate: (value) => {
          if (value.trim() === "") return "Email cannot be empty";
          if (!value.includes("@")) return "Please enter a valid email address";
          return true;
        },
      });
    }
    if (!alias) {
      alias = await input({
        message: "Enter GitHub alias (used for SSH config):",
        validate: (value) => {
          if (value.trim() === "") return "Alias cannot be empty";
          if (/[^a-zA-Z0-9_-]/.test(value)) return "Alias can only contain alphanumeric characters, hyphens, and underscores";
          return true;
        },
      });
    }

    const sshKeyPath = path.join(
      SSH_DIR,
      `id_rsa_gitmt_${alias.toLowerCase()}`,
    );

    // Generate SSH key if it doesn't exist
    if (!existsSync(sshKeyPath)) {
      // Check if ssh-keygen is available
      try {
        await commandExists("ssh-keygen");
      } catch (err) {
        console.error(
          "\x1b[31mError: ssh-keygen is not available. Please install Git or OpenSSH.\x1b[0m",
        );
        return;
      }

      const generateKey = await confirm({
        message: "Would you like to generate a new SSH key?",
        default: true,
      });

      if (generateKey) {
        const { spawnSync } = require("child_process");
        const result = spawnSync(
          "ssh-keygen",
          ["-t", "rsa", "-b", "4096", "-C", email, "-f", sshKeyPath, "-N", ""],
          { stdio: "inherit" }
        );

        if (result.status !== 0) {
          console.error("\x1b[31mError: Failed to generate SSH key.\x1b[0m");
          return;
        }
        console.log(`\x1b[32mSSH key generated at: ${sshKeyPath}\x1b[0m`);
      }
    }

    // Verify user ID uniqueness or compute next ID safely
    const maxId = config.users.reduce((max, u) => Math.max(max, u.id), 0);
    const userId = maxId + 1;

    config.users.push({
      id: userId,
      name,
      email,
      alias,
      sshKeyPath,
    });

    if (!config.activeUser) {
      config.activeUser = userId;
      await setGitConfig(name, email);
    }

    // Configure SSH config block for this alias
    updateSSHConfig(alias, sshKeyPath);

    saveConfig();

    console.log(`\n\x1b[32m\x1b[1m✓ Added user ${name} (ID: ${userId})\x1b[0m`);
    console.log(`\x1b[32m\x1b[1m✓ SSH config updated for alias [${alias}].\x1b[0m\n`);

    // Public Key processing for Clipboard copying and guide print
    const publicKeyPath = `${sshKeyPath}.pub`;
    let pubKeyCopied = false;
    if (existsSync(publicKeyPath)) {
      try {
        const publicKey = readFileSync(publicKeyPath, "utf8");
        await clipboardy.write(publicKey.trim());
        pubKeyCopied = true;
      } catch (err) {
        // clipboard copy failed
      }
    }

    console.log(`\x1b[1m\x1b[35m=== GitHub SSH Setup Guide ===\x1b[0m`);
    console.log(`\x1b[36m1. Go to GitHub SSH settings page:\x1b[0m`);
    console.log(`   \x1b[4m\x1b[34mhttps://github.com/settings/keys\x1b[0m`);
    console.log(`\x1b[36m2. Click on the \x1b[1m'New SSH key'\x1b[0m\x1b[36m button.\x1b[0m`);
    console.log(`\x1b[36m3. Set a Title (e.g. "gitmt - ${alias}") and paste the key.\x1b[0m`);
    
    if (pubKeyCopied) {
      console.log(`   \x1b[32m(The SSH public key has been copied to your clipboard!)\x1b[0m`);
    } else {
      console.log(`   \x1b[33m(Could not copy to clipboard automatically. Run 'gitmt key ${userId}' to view and copy it.)\x1b[0m`);
    }

    console.log(`\n\x1b[1m\x1b[35m=== How to Clone & Use ===\x1b[0m`);
    console.log(`\x1b[36mTo clone repositories using this account, use the alias:\x1b[0m`);
    console.log(`   \x1b[33mgit clone git@github.com-${alias}:username/repo.git\x1b[0m`);
    console.log(`\x1b[36mTo make this user active for standard Git commands, run:\x1b[0m`);
    console.log(`   \x1b[33mgitmt change ${userId}\x1b[0m`);
  });

program
  .command("current")
  .description("Show current active git user")
  .action(async () => {
    if (!config.activeUser) {
      console.log("\x1b[33mNo active git user\x1b[0m");
      if (config.users.length > 0) {
        const changeUser = await confirm({
          message: "Would you like to set an active git user now?",
          default: true,
        });
        if (changeUser) {
          const choices = config.users.map((u) => ({
            name: `${u.id}. ${u.name} <${u.email}> [${u.alias}]`,
            value: u.id.toString(),
          }));
          const selectedIdStr = await select({
            message: "Select a git user to switch to:",
            choices,
          });
          const selectedId = parseInt(selectedIdStr);
          config.activeUser = selectedId;
          const user = config.users.find((u) => u.id === selectedId);
          await setGitConfig(user.name, user.email);
          saveConfig();
          console.log(
            `Switched to active user: \x1b[32m\x1b[1m${user.name}\x1b[0m \x1b[36m<${user.email}>\x1b[0m`
          );
        }
      }
      return;
    }

    const user = config.users.find((u) => u.id === config.activeUser);
    console.log(
      `Current active user: \x1b[32m\x1b[1m${user.name}\x1b[0m \x1b[36m<${user.email}>\x1b[0m (ID: ${user.id})`,
    );

    const changeUser = await confirm({
      message: "Would you like to switch to a different active git user?",
      default: false,
    });

    if (changeUser) {
      const choices = config.users.map((u) => {
        const isActive = u.id === config.activeUser;
        return {
          name: `${u.id}. ${u.name} <${u.email}> [${u.alias}]${isActive ? " (active)" : ""}`,
          value: u.id.toString(),
        };
      });
      const selectedIdStr = await select({
        message: "Select a git user to switch to:",
        choices,
      });
      const selectedId = parseInt(selectedIdStr);
      if (selectedId === config.activeUser) {
        console.log(`User ${user.name} is already active.`);
        return;
      }
      config.activeUser = selectedId;
      const targetUser = config.users.find((u) => u.id === selectedId);
      await setGitConfig(targetUser.name, targetUser.email);
      saveConfig();
      console.log(
        `Switched to active user: \x1b[32m\x1b[1m${targetUser.name}\x1b[0m \x1b[36m<${targetUser.email}>\x1b[0m`
      );
    }
  });

program
  .command("remove")
  .description("Remove a git user")
  .argument("[id]", "User ID to remove")
  .action(async (id) => {
    let userId;
    if (id !== undefined) {
      userId = parseInt(id);
    } else {
      if (config.users.length === 0) {
        console.log("\x1b[33mNo users configured.\x1b[0m");
        return;
      }
      const choices = config.users.map((u) => {
        const isActive = u.id === config.activeUser;
        return {
          name: `${u.id}. ${u.name} <${u.email}> [${u.alias}]${isActive ? " (active)" : ""}`,
          value: u.id.toString(),
        };
      });
      const selectedIdStr = await select({
        message: "Select a git user to remove:",
        choices,
      });
      userId = parseInt(selectedIdStr);
    }

    const userIndex = config.users.findIndex((u) => u.id === userId);

    if (userIndex === -1) {
      console.log(`\x1b[31mError: No user found with ID ${userId}\x1b[0m`);
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
  .argument("[id]", "User ID to switch to")
  .action(async (id) => {
    let userId;
    if (id !== undefined) {
      userId = parseInt(id);
    } else {
      if (config.users.length === 0) {
        console.log("\x1b[33mNo users configured. Use 'gitmt add' to add a user.\x1b[0m");
        return;
      }
      const choices = config.users.map((u) => {
        const isActive = u.id === config.activeUser;
        return {
          name: `${u.id}. ${u.name} <${u.email}> [${u.alias}]${isActive ? " (active)" : ""}`,
          value: u.id.toString(),
        };
      });
      const selectedIdStr = await select({
        message: "Select a git user to switch to:",
        choices,
      });
      userId = parseInt(selectedIdStr);
    }

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
  .action(async () => {
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

    const action = await select({
      message: "Perform an action?",
      choices: [
        { name: "Exit menu", value: "exit" },
        { name: "Switch active user", value: "change" },
        { name: "Show public SSH key", value: "key" },
        { name: "Remove a user", value: "remove" },
      ],
    });

    if (action === "exit") {
      return;
    }

    const choices = config.users.map((u) => {
      const isActive = u.id === config.activeUser;
      return {
        name: `${u.id}. ${u.name} <${u.email}> [${u.alias}]${isActive ? " (active)" : ""}`,
        value: u.id.toString(),
      };
    });

    if (action === "change") {
      const selectedIdStr = await select({
        message: "Select a git user to switch to:",
        choices,
      });
      const selectedId = parseInt(selectedIdStr);
      const user = config.users.find((u) => u.id === selectedId);
      if (!user) return;
      config.activeUser = selectedId;
      await setGitConfig(user.name, user.email);
      saveConfig();
      console.log(
        `Switched to active user: \x1b[32m\x1b[1m${user.name}\x1b[0m \x1b[36m<${user.email}>\x1b[0m`
      );
    } else if (action === "key") {
      const selectedIdStr = await select({
        message: "Select a git user to show/copy SSH key for:",
        choices,
      });
      const selectedId = parseInt(selectedIdStr);
      const user = config.users.find((u) => u.id === selectedId);
      if (!user) return;
      
      const publicKeyPath = `${user.sshKeyPath}.pub`;
      if (!existsSync(publicKeyPath)) {
        console.log(`\x1b[33mNo SSH key found for user ${user.name}\x1b[0m`);
        return;
      }

      const publicKey = readFileSync(publicKeyPath, "utf8");
      console.log(`Public SSH key for \x1b[32m\x1b[1m${user.name}\x1b[0m:`);
      console.log(`\x1b[90m${publicKey.trim()}\x1b[0m`);

      try {
        await clipboardy.write(publicKey.trim());
        console.log("\x1b[32mPublic key copied to clipboard!\x1b[0m");
      } catch (error) {
        console.error("\x1b[31mFailed to copy to clipboard:\x1b[0m", error.message);
      }
    } else if (action === "remove") {
      const selectedIdStr = await select({
        message: "Select a git user to remove:",
        choices,
      });
      const selectedId = parseInt(selectedIdStr);
      const userIndex = config.users.findIndex((u) => u.id === selectedId);
      if (userIndex === -1) return;

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
      if (config.activeUser === selectedId) {
        config.activeUser = null;
      }

      // Always remove from SSH config to avoid leaving dead host aliases
      updateSSHConfig(user.alias, "", true);

      saveConfig();
      console.log(`Removed user ${user.name} (ID: ${selectedId})`);
    }
  });

program
  .command("key")
  .description("Show public SSH key for a user")
  .argument("[id]", "User ID to show key for")
  .action(async (id) => {
    let userId;
    if (id !== undefined) {
      userId = parseInt(id);
    } else {
      if (config.users.length === 0) {
        console.log("\x1b[33mNo users configured.\x1b[0m");
        return;
      }
      const choices = config.users.map((u) => {
        const isActive = u.id === config.activeUser;
        return {
          name: `${u.id}. ${u.name} <${u.email}> [${u.alias}]${isActive ? " (active)" : ""}`,
          value: u.id.toString(),
        };
      });
      const selectedIdStr = await select({
        message: "Select a git user to show/copy SSH key for:",
        choices,
      });
      userId = parseInt(selectedIdStr);
    }

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
      await clipboardy.write(publicKey.trim());
      console.log("\x1b[32mPublic key copied to clipboard!\x1b[0m");
    } catch (error) {
      console.error("\x1b[31mFailed to copy to clipboard:\x1b[0m", error.message);
    }
  });

program.parse();
