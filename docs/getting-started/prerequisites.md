# Prerequisites and Preparation

Before the Quick Start instructions can be carried out, the O/S environment used for this installation requires the
following utilities to be available.

| Build Dependency Utility | Tested Version | More Information                          |
| ------------------------ | -------------- | ----------------------------------------- |
| `git`                    | v2.40.1        | https://github.com/git-guides/install-git |
| `nvm`                    | v0.40.0        | https://nvm.sh                            |
| `node`                   | v20.15.0       | https://nodejs.org                        |
| `pnpm`                   | v9.6.0         | https://pnpm.io/installation              |

NOTE: If you are using a restricted O/S environment for deployment where NodeJS package(s) cannot be installed in a
system-wide / global context (such as AWS Cloud9), you will need to run the following commands in order to install the
NodeJS package(s) locally.

```
# Verify GIT is installed and executable
[user ~]$ git --version                           # Expect v2.40.1

# Install NVM and verify it is executable
[user ~]$ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
[user ~]$ nvm --version                           # Expect v0.40.0

# Use NVM to install and use NodeJs ver 20.15.0
[user ~]$ nvm install 20.15.0
[user ~]$ nvm alias default 20.15.0
[user ~]$ node --version                          # Expect v20.15.0

# Install PNPM and verify it is executable
[user ~]$ npm install -g pnpm
[user ~]$ pnpm --version                          # Expect v9.6.0
```

Also ensure the O/S has sufficient disk space (50GiB or more) to complete the compilation and installation process.

If you are using the AWS Cloud9 environment, you will need to increase the EBS disk volume using the following
[AWS provided Bash script](https://docs.aws.amazon.com/cloud9/latest/user-guide/move-environment.html#move-environment-resize).
Copy and save the script logic as `resize.sh` to your AWS Cloud9 environment, and then run the script:

```
[user ~]$ chmod +x ./resize.sh                    # Make the './resize.sh' script executable
[user ~]$ ./resize.sh 200                         # Run './resize.sh' script to increase ESB volume size to 200GiB
```

Once the above prerequisites are satisfied, continue with [install.md](./install.md).
