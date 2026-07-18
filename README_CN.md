# codex-asar-tools

[English](README.md) | 简体中文

给 macOS 版 Codex.app 启用被地域限制隐藏的 Computer Use 功能。

这个工具会直接修改 `/Applications/Codex.app/Contents/Resources/app.asar`,把应用里用于判断 Computer Use 可用性的目标调用替换成恒真表达式,然后更新 ASAR 完整性哈希并重新签名应用。

## 使用

先退出 Codex.app,然后执行:

```sh
node patch.mjs --dry-run
```

确认只找到一个目标后再真正写入:

```sh
node patch.mjs
```

如果提示没有权限:

```sh
sudo node patch.mjs
```

完成后重新打开 Codex.app。

## 备份和恢复

真正写入前脚本会备份:

- `app.asar.bak.<timestamp>`
- `Info.plist.bak.<timestamp>`

需要恢复时,把对应备份复制回原路径即可。Codex.app 更新后补丁通常会失效,需要重新运行脚本。

## 说明

- 只支持默认安装路径:`/Applications/Codex.app`
- 只在目标标记唯一时写入,避免误改其他代码
- `--dry-run` 不会写文件、更新 `Info.plist` 或重新签名
