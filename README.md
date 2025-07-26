# gitmt

A CLI tool to manage multiple git accounts and their SSH keys. Perfect for developers who need to switch between different git accounts (personal, work, etc.) and maintain separate SSH keys for each.

## Features

- 🔄 Easily switch between different git accounts
- 🔑 Automatic SSH key generation and management
- 💾 Stores configurations locally
- 🌍 Supports both global and local git configs
- 📋 Simple command-line interface

## Installation

```bash
npm install -g gitmt
```

## Usage

### Adding a New User

Add a new git user with optional SSH key generation:

```bash
gitmt add -n "John Smith" -e "john@example.com"
```

Options:

- `-n, --name`: Git user name
- `-e, --email`: Git user email
- `-l, --local`: Set as local git config (optional)

This will:

- Add the user to the configuration
- Generate an SSH key if it doesn't exist
- Set as active user if no other user is active

### Viewing Current User

Show the currently active git user:

```bash
gitmt current
```

### Removing a User

Remove a user and optionally their SSH keys:

```bash
gitmt remove <id>
```

Example: `gitmt remove 1`

### Switching Users

Switch to a different git user:

```bash
gitmt change <id>
```

Options:

- `-l, --local`: Apply changes to local git config (optional)

Example: `gitmt change 2`

### Listing Users

List all configured users:

```bash
gitmt list
```

### Managing SSH Keys

Show public SSH key for a user:

```bash
gitmt key <id>
```

Example: `gitmt key 1`

### Viewing Global Config

Show saved global git configuration:

```bash
gitmt global
```

## Configuration

The tool stores its configuration in:

- Configuration file: `~/.gitmt/config.json`
- SSH keys: `~/.ssh/id_rsa_gitmt_username`

## Setting up SSH Keys with GitHub/GitLab

1. Add a new git user:

   ```bash
   gitmt add -n "Your Name" -e "your@email.com"
   ```

2. Get the public key:

   ```bash
   gitmt key 1
   ```

3. Add the public key to your GitHub/GitLab account:

   - GitHub: Settings > SSH and GPG keys > New SSH key
   - GitLab: Settings > SSH Keys

4. Update your repository's remote URL to use SSH:
   ```bash
   git remote set-url origin git@github.com:username/repository.git
   ```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT © Abhiseck Bhattacharya

## Support

If you encounter any problems or have suggestions, please file an issue at [https://github.com/iamalipe/gitmt/issues](https://github.com/iamalipe/gitmt/issues)
