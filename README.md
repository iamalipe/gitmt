# GitMT - Git Multiple Account Manager

A lightweight, developer-friendly CLI tool to seamlessly manage multiple Git accounts and SSH keys across different platforms (**macOS, Windows, and Linux**).

## Features

- 👤 **Multiple Profiles**: Keep work, personal, and client profiles isolated.
- 🔑 **SSH Key Management**: Automatically generate secure SSH keys and configure `~/.ssh/config`.
- 💻 **Cross-Platform**: Fully supports Windows (resolves backslash path issues for OpenSSH), macOS, and Linux.
- 🎨 **Visual Indicator**: Easily check your active profile with a color-coded terminal list.
- 📋 **Clipboard Integration**: Copy public SSH keys instantly with one command.

---

## Installation

Install GitMT globally via npm:

```bash
npm install -g gitmt
```

> **Prerequisite:** Make sure `git` and OpenSSH (`ssh-keygen`) are installed on your system.

---

## Commands

```bash
gitmt add -n "<name>" -e "<email>" -a "<alias>"   # Add a new git user
gitmt list                                        # List all configured users
gitmt current                                     # Show current active user
gitmt change <id>                                 # Switch to a different user
gitmt key <id>                                    # Copy & display public key
gitmt remove <id>                                 # Remove a user profile
```

---

## Step-by-Step Example Workflow

### 1. Add your Profiles

Add your work profile:
```bash
gitmt add -n "John Doe (Work)" -e "john.doe@corporate.com" -a "john-work"
```

Add your personal profile:
```bash
gitmt add -n "John Doe" -e "johndoe@personal.me" -a "john-personal"
```

### 2. View Profiles

To see all your profiles, run:
```bash
gitmt list
```

**Output Terminal Preview:**
```text
Configured git users:
  1. John Doe (Work) <john.doe@corporate.com> [john-work]
   Clone URL format: git clone git@github.com-john-work:username/repo.git
* 2. John Doe <johndoe@personal.me> [john-personal] (active)
   Clone URL format: git clone git@github.com-john-personal:username/repo.git
```
*(The active profile row `* 2. John Doe...` will be highlighted in **bold green** in your terminal).*

### 3. Switch Profiles

Switch global git configuration (updates `user.name` and `user.email` globally):
```bash
gitmt change 1
```

### 4. Clone Repositories

Use the customized SSH host alias when cloning repositories:

- For work:
  ```bash
  git clone git@github.com-john-work:org/work-repo.git
  ```
- For personal:
  ```bash
  git clone git@github.com-john-personal:username/personal-repo.git
  ```

---

## Cross-Platform Notes & Troubleshooting

### Windows Compatibility
OpenSSH on Windows expects path separators in the SSH config file (`~/.ssh/config`) to be forward slashes (`/`). GitMT automatically handles this by converting standard backslash pathing (e.g., `C:\Users\John\.ssh\...`) to forward slash format (e.g., `C:/Users/John/.ssh/...`) in your configuration, preventing connection issues.

### Linux Clipboard Support
For the `gitmt key <id>` copy-to-clipboard functionality to work on Linux, one of the following clipboard managers must be installed:
- `xclip` (recommended)
- `xsel`

Install using your package manager (e.g., `sudo apt install xclip`).
