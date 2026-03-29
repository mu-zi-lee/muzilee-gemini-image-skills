# Muzilee Gemini Image Skills

正式版 Gemini Web Skill。 
欢迎加入 Linux DO https://linux.do/

它采用：

- Python daemon 负责任务协议、队列、状态和结果落盘
- Tampermonkey userscript 负责页面 DOM 动作
- 统一任务信封协议承载文本、图片、模型切换、新建会话和参考图上传

## 目录

- `protocol/catalog.json`: 任务类型、能力名、模型别名、输出模式的单一事实源
- `src/muzilee_gemini_image_skills/`: Python daemon、CLI、状态与服务层
- `worker-src/`: 模块化 worker 源码
- `userscripts/gemini_web_worker.user.js`: 构建产物，直接安装到 Tampermonkey
- `tests/python/`: Python 单测与集成测试
- `tests/worker/`: Worker 侧 Node 测试

## 默认工作流

先准备 Python 环境：

```bash
uv venv
uv sync
```

启动 daemon：

```bash
uv run python -m muzilee_gemini_image_skills.server.app
```

构建 userscript：

```bash
npm run build:worker
```

把 [userscripts/gemini_web_worker.user.js](/Users/muzilee/Documents/auto-research-interns/Skills/muzilee-gemini-image-skills/userscripts/gemini_web_worker.user.js) 安装到 Tampermonkey，并打开 `https://gemini.google.com/`。

## CLI

发送文本：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main chat send "帮我总结这篇文章" --model quick
```

新建对话：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main chat new
```

切模型：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main model set pro
```

生图：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main image generate "电影感黄昏海边海报" --new-chat --ref /absolute/path/ref.png
```

上传参考图：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main image upload-ref /absolute/path/a.png /absolute/path/b.jpg
```

保存最近一张预览图：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main image download-latest
```

查看 worker 状态：

```bash
uv run python -m muzilee_gemini_image_skills.cli.main worker state
```

## 测试

Python：

```bash
uv run python -m unittest discover -s tests/python -p 'test_*.py'
```

Worker：

```bash
npm run test:worker
```

## 关键设计

- Agent 统一只走 `POST /agent/tasks/execute`
- `setup` 只做公共前置动作：`new_chat`、`model`、`reference_images`
- 当前图片读取策略固定为 preview-only，不点击 Gemini 下载按钮
- `--output-mode` 仍接受 `preview | full_size | auto`，但内部都会按 `preview` 处理
- `worker-src/` 按能力拆分，`runtime/execute_task.js` 只负责调度
