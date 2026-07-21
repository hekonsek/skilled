# skilled repo install

Downloads skills repo into local device.

## Example command

```bash
# Clone https://github.com/hekonsek/skilled-repo into ~/.skilled/repos/hekonsek/skilled-repo
skilled repo install hekonsek/skilled-repo
```

## Behavior

Clones the remote skills repository onto the local device. If the repository is already
installed, runs `git pull --ff-only` in the existing checkout so Git downloads and
fast-forwards only the missing changes.
