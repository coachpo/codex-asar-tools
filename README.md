# codex-asar-tools

English | [简体中文](README_CN.md)

Enable the Computer Use feature in the macOS Codex.app when it is hidden because of regional availability.

This tool directly patches `/Applications/Codex.app/Contents/Resources/app.asar`, replaces the target availability check with an always-true expression, updates the ASAR integrity hash, and re-signs the app.

## Usage

Quit Codex.app first, then run:

```sh
node patch.mjs --dry-run
```

If the dry run finds exactly one target, apply the patch:

```sh
node patch.mjs
```

If macOS reports a permission error:

```sh
sudo node patch.mjs
```

Restart Codex.app when the script finishes.

## Backup and Restore

Before writing changes, the script creates backups:

- `app.asar.bak.<timestamp>`
- `Info.plist.bak.<timestamp>`

To restore, copy the matching backup files back to their original paths. Codex.app updates usually replace the patch, so you may need to rerun the script after updating the app.

## Notes

- Only supports the default install path: `/Applications/Codex.app`
- Only writes when the target marker is unique, to avoid patching unrelated code
- `--dry-run` does not write files, update `Info.plist`, or re-sign the app
