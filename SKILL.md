---
name: muzilee-gemini-image-skills
description: 通过本地 Python daemon 和模块化 Tampermonkey worker 操作 Gemini 网页，支持文本、图片、模型切换、参考图上传和最新图片下载。
---

# Muzilee Gemini Image Skills

## 目标

本 Skill 不直接操作网页。

调用链是：

1. Skill 调本地 Python daemon
2. Python daemon 通过统一任务信封协议派发任务
3. Tampermonkey worker 在 `gemini.google.com` 页面中执行
4. Python daemon 返回文本结果或本地图片路径

## 使用前提

先确保：

1. 已执行 `uv venv` 和 `uv sync`
2. daemon 已启动
3. 已安装 `userscripts/gemini_web_worker.user.js`
4. Gemini 页面已打开并登录

## 推荐命令

启动 daemon：

```bash
cd /Users/muzilee/Documents/auto-research-interns/Skills/muzilee-gemini-image-skills
uv run python -m muzilee_gemini_image_skills.server.app
```

发送文本：

```bash
cd /Users/muzilee/Documents/auto-research-interns/Skills/muzilee-gemini-image-skills
uv run python -m muzilee_gemini_image_skills.cli.main chat send "你好，请总结这篇文章"
```

生成图片：

```bash
cd /Users/muzilee/Documents/auto-research-interns/Skills/muzilee-gemini-image-skills
uv run python -m muzilee_gemini_image_skills.cli.main image generate "画一张赛博朋克城市夜景"
```

上传参考图：

```bash
cd /Users/muzilee/Documents/auto-research-interns/Skills/muzilee-gemini-image-skills
uv run python -m muzilee_gemini_image_skills.cli.main image upload-ref /absolute/path/ref.png
```

## 已支持能力

- `chat send`
- `chat new`
- `model set`
- `image generate`
- `image upload-ref`
- `image download-latest`
- `worker state`

## 工作原则

- 优先确认 daemon 在线
- 如果没有兼容 worker，要直接提示用户打开并刷新 Gemini 页面
- 文本任务返回最终文本
- 图片任务返回本地落盘后的文件路径
- 当前图片任务统一走页面 preview 提取，不使用 Gemini 下载按钮
- `--output-mode` 的 `auto` / `full_size` 仅为兼容旧命令保留，实际都会按 `preview` 执行
