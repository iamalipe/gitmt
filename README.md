# GitMT - Git Multiple Account Manager

A CLI tool to manage multiple Git accounts with SSH key support.

## Installation

```bash
npm install -g gitmt
```

## Usage

### Add a new user

```bash
gitmt add -n "John Doe" -e "john@example.com" -a "johndoe"
```

This will:

- Generate SSH key if needed
- Configure SSH for GitHub
- Set up git config

### Clone repositories

After setting up a user, clone repositories using the alias:

```bash
git clone git@github.com-johndoe:username/repo.git
```

### Other commands

```bash
gitmt list          # List all configured users
gitmt current       # Show current active user
gitmt change <id>   # Switch to a different user
gitmt remove <id>   # Remove a user
gitmt key <id>      # Show public SSH key for a user
```
